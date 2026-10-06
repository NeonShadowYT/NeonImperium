// js/features/storage/core.js
// Ядро: шифрование, работа с Gist, хеши, константы.
//
// ТРЕБОВАНИЯ К ТОКЕНУ:
//   Classic-токен (ghp_...) со scope `gist`. Fine-grained НЕ поддерживают Gist API.
//
// ВАЖНО: getToken() из GithubAuth — асинхронная. Все вызовы — через await.

(function() {
    'use strict';

    const { getCurrentUser, getToken } = window.GithubAuth || {};
    const { showToast } = window.UIUtils || {};

    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium encrypted bookmarks';
    const STORAGE_KEY_PREFIX = 'bookmarks_';
    const PASSWORD_CACHE_KEY = 'storage_password';
    const SALT = 'neon-storage-salt-v2';
    const SAVE_DEBOUNCE_MS = 2000;
    const MAX_BOOKMARKS = 100;
    const VERSION = 4;
    const GIST_CACHE_TTL = 5 * 60 * 1000;
    const GIST_ID_KEY_PREFIX = 'neon_gist_id_';

    function getGistIdKey(user) {
        return GIST_ID_KEY_PREFIX + (user || 'anonymous');
    }

    // ============================================================
    // Асинхронное получение токена
    // ============================================================

    async function getAuthToken() {
        // Приоритет: GithubAuth.getToken (async, читает sessionStorage + IndexedDB)
        if (window.GithubAuth && typeof window.GithubAuth.getToken === 'function') {
            try {
                const token = await window.GithubAuth.getToken();
                if (token) return token;
            } catch (e) {
                console.warn('[Storage] GithubAuth.getToken error:', e);
            }
        }
        // Fallback: прямой sessionStorage
        try { return sessionStorage.getItem('github_token') || null; }
        catch { return null; }
    }

    // ============================================================
    // Парсинг Gist ID из строки (ID или полный URL)
    // ============================================================

    function normalizeGistId(input) {
        if (!input || typeof input !== 'string') return null;
        let s = input.trim();
        if (!s) return null;

        // Если это уже чистый ID (hex, 8-64 символа) — возвращаем как есть
        if (/^[a-f0-9]{8,64}$/i.test(s)) return s.toLowerCase();

        // Убираем протокол и домен
        s = s.replace(/^https?:\/\//i, '');
        s = s.replace(/^gist\.github\.com\//i, '');
        s = s.replace(/^www\./i, '');

        // Убираем query и якорь
        s = s.split('?')[0];
        s = s.split('#')[0];

        const parts = s.split('/').filter(Boolean);
        if (parts.length === 0) return null;

        let candidate = null;

        if (parts.length >= 2) {
            // Пробуем вторую часть (после user)
            const second = parts[1];
            if (/^[a-f0-9]{8,64}$/i.test(second)) {
                candidate = second;
            } else {
                // Или первую (если это short URL /id/revision)
                const first = parts[0];
                if (/^[a-f0-9]{8,64}$/i.test(first)) {
                    candidate = first;
                }
            }
        } else {
            const first = parts[0];
            if (/^[a-f0-9]{8,64}$/i.test(first)) {
                candidate = first;
            }
        }

        return candidate ? candidate.toLowerCase() : null;
    }

    // ============================================================
    // Проверка scope `gist` у токена
    // ============================================================

    /**
     * Возвращает { ok: boolean, scopes: string[], reason: string|null }.
     * Делает GET /user и читает заголовок X-OAuth-Scopes.
     */
    async function checkGistScope() {
        const token = await getAuthToken();
        if (!token) {
            return { ok: false, scopes: [], reason: 'not_logged_in' };
        }
        try {
            const resp = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });
            if (resp.status === 401) {
                return { ok: false, scopes: [], reason: 'unauthorized' };
            }
            if (!resp.ok) {
                return { ok: false, scopes: [], reason: `http_${resp.status}` };
            }
            const scopesHeader = resp.headers.get('X-OAuth-Scopes') || '';
            const scopes = scopesHeader.split(',').map(s => s.trim()).filter(Boolean);
            if (!scopes.includes('gist')) {
                return { ok: false, scopes, reason: 'no_gist_scope' };
            }
            return { ok: true, scopes, reason: null };
        } catch (e) {
            return { ok: false, scopes: [], reason: 'network_error' };
        }
    }

    // ---- Шифрование ----
    async function deriveKeyFromString(str, salt = SALT) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            enc.encode(str + salt),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: enc.encode(salt),
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptData(data, key) {
        const enc = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            enc.encode(JSON.stringify(data))
        );
        return {
            iv: Array.from(iv),
            data: Array.from(new Uint8Array(encrypted))
        };
    }

    async function decryptData(encryptedObj, key) {
        const iv = new Uint8Array(encryptedObj.iv);
        const data = new Uint8Array(encryptedObj.data);
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );
        const dec = new TextDecoder();
        return JSON.parse(dec.decode(decrypted));
    }

    // ---- Gist: прямые операции ----

    async function gistFetchById(gistId) {
        if (!gistId) return null;
        const token = await getAuthToken();
        if (!token) {
            const err = new Error('No token');
            err.status = 401;
            err.code = 'unauthorized';
            throw err;
        }
        const url = `https://api.github.com/gists/${gistId}`;
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Authorization': `Bearer ${token}`
        };
        const resp = await fetch(url, { headers });
        if (resp.status === 404) return null;
        if (resp.status === 401) {
            const err = new Error('Unauthorized');
            err.status = 401;
            err.code = 'unauthorized';
            throw err;
        }
        if (resp.status === 403) {
            const err = new Error('Forbidden');
            err.status = 403;
            err.code = 'forbidden';
            throw err;
        }
        if (!resp.ok) throw new Error(`Gist fetch error: ${resp.status}`);
        return resp.json();
    }

    async function gistUpdate(gistId, content) {
        const token = await getAuthToken();
        if (!token) throw new Error('No token');
        const url = `https://api.github.com/gists/${gistId}`;
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Authorization': `Bearer ${token}`
        };
        const resp = await fetch(url, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } })
        });
        if (resp.status === 401) {
            const err = new Error('Unauthorized');
            err.status = 401;
            err.code = 'unauthorized';
            throw err;
        }
        if (resp.status === 403) {
            const err = new Error('Forbidden');
            err.status = 403;
            err.code = 'forbidden';
            throw err;
        }
        if (!resp.ok) throw new Error(`Gist update error: ${resp.status}`);
        return resp.json();
    }

    async function gistCreate(content) {
        const token = await getAuthToken();
        if (!token) throw new Error('No token');
        const url = 'https://api.github.com/gists';
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Authorization': `Bearer ${token}`
        };
        const resp = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                description: GIST_DESCRIPTION,
                public: false,
                files: { [GIST_FILENAME]: { content } }
            })
        });
        if (resp.status === 401) {
            const err = new Error('Unauthorized');
            err.status = 401;
            err.code = 'unauthorized';
            throw err;
        }
        if (resp.status === 403) {
            const err = new Error('Forbidden');
            err.status = 403;
            err.code = 'forbidden';
            throw err;
        }
        if (!resp.ok) {
            const err = new Error(`Gist create error: ${resp.status}`);
            err.status = resp.status;
            throw err;
        }
        const gist = await resp.json();
        return gist.id;
    }

    async function findGistByListing() {
        const token = await getAuthToken();
        if (!token) return null;
        try {
            const url = 'https://api.github.com/gists?per_page=100';
            const headers = {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'X-GitHub-Api-Version': '2022-11-28'
            };
            const resp = await fetch(url, { headers });
            if (!resp.ok) {
                console.warn('[Storage] Листинг Gists недоступен:', resp.status);
                return null;
            }
            const gists = await resp.json();
            const found = gists.find(g => g.files && g.files[GIST_FILENAME]);
            return found ? found.id : null;
        } catch (e) {
            console.warn('[Storage] Ошибка листинга Gists:', e);
            return null;
        }
    }

    // ---- Хеши ----
    async function hashString(str) {
        const enc = new TextEncoder();
        const hash = await crypto.subtle.digest('SHA-256', enc.encode(str));
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // ---- Диалоги ----
    async function promptPassword(message) {
        if (!window.Dialog || typeof window.Dialog.showPrompt !== 'function') {
            console.warn('[Storage] Dialog недоступен');
            return window.prompt(message);
        }
        return await window.Dialog.showPrompt({
            title: 'Введите данные',
            message: message,
            placeholder: 'Пароль',
            minLength: 0
        });
    }

    async function confirmResetStorage() {
        if (!window.Dialog || typeof window.Dialog.showConfirm !== 'function') {
            return window.confirm(
                'Не удалось расшифровать хранилище. Пересоздать (все данные будут потеряны)?'
            );
        }
        return await window.Dialog.showConfirm({
            title: 'Пересоздать хранилище?',
            message: 'Не удалось расшифровать хранилище. Возможно, вы изменили логин, токен или не указали пароль.\n\nХотите пересоздать хранилище (все старые данные будут потеряны)?\n\nНажмите "Отмена", чтобы попробовать ввести пароль ещё раз.',
            confirmText: 'Пересоздать',
            cancelText: 'Отмена',
            danger: true
        });
    }

    window._StorageCore = {
        GIST_FILENAME,
        GIST_DESCRIPTION,
        STORAGE_KEY_PREFIX,
        PASSWORD_CACHE_KEY,
        GIST_ID_KEY_PREFIX,
        SALT,
        SAVE_DEBOUNCE_MS,
        MAX_BOOKMARKS,
        VERSION,
        GIST_CACHE_TTL,
        getGistIdKey,
        normalizeGistId,
        getAuthToken,
        checkGistScope,
        deriveKeyFromString,
        encryptData,
        decryptData,
        gistFetchById,
        gistUpdate,
        gistCreate,
        findGistByListing,
        hashString,
        promptPassword,
        confirmResetStorage
    };
})();