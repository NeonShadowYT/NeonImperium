// js/core/token-store.js
// Безопасное хранение GitHub-токена.
//
// СТРАТЕГИЯ:
//   — Основное хранилище: sessionStorage (умирает с закрытием вкладки).
//   — "Remember me": IndexedDB + AES-GCM, ключ производный от
//     device-specific энтропии через PBKDF2 (100k итераций, SHA-256).
//
// УРОВЕНЬ ЗАЩИТЫ:
//   XOR-обфускация (старый подход) полностью удалена.
//   PBKDF2 + AES-GCM защищает от:
//     — пассивного чтения IndexedDB сторонним скриптом (данные зашифрованы);
//     — копирования БД на другую машину (device-энтропия не совпадёт).
//   НЕ защищает от:
//     — XSS на том же origin (скрипт может вызвать TokenStore.load());
//     — активного malware на устройстве.
//
// FALLBACK:
//   — IndexedDB недоступен (private mode, Safari ITP) → remember me отключается.
//   — WebCrypto недоступен → remember me отключается.
//
// Публикует window.TokenStore.

(function() {
    'use strict';

    const DB_NAME = 'NeonTokenStore';
    const DB_VERSION = 1;
    const STORE_NAME = 'tokens';
    const TOKEN_ID = 'github';
    const PBKDF2_ITERATIONS = 100000;
    const PBKDF2_SALT = 'neon-token-store-salt-v1';
    const DEVICE_ID_KEY = 'neon_device_id';
    const SESSION_KEY = 'github_token'; // совместимо с github-auth.js

    // ---- Утилиты ----

    function getDeviceId() {
        try {
            let id = localStorage.getItem(DEVICE_ID_KEY);
            if (!id) {
                // Генерируем случайный ID (не содержит PII).
                const arr = new Uint8Array(16);
                (window.crypto || window.msCrypto).getRandomValues(arr);
                id = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
                localStorage.setItem(DEVICE_ID_KEY, id);
            }
            return id;
        } catch {
            return 'no-device-id';
        }
    }

    /**
     * Собирает device-specific энтропию.
     * ВАЖНО: если хотя бы один фактор изменится (например, смена языка,
     * поворот экрана), ключ не совпадёт и расшифровка не удастся.
     * Поэтому используется только стабильная энтропия: deviceId + UA + language.
     */
    function getDeviceEntropy() {
        const ua = navigator.userAgent || '';
        const lang = navigator.language || 'en';
        const deviceId = getDeviceId();
        return `${deviceId}|${ua}|${lang}`;
    }

    function isCryptoAvailable() {
        return !!(window.crypto && window.crypto.subtle &&
                  typeof window.crypto.subtle.importKey === 'function');
    }

    function isIndexedDBAvailable() {
        return typeof indexedDB !== 'undefined' && indexedDB !== null;
    }

    // ---- WebCrypto: PBKDF2 + AES-GCM ----

    async function deriveKey() {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            enc.encode(getDeviceEntropy()),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: enc.encode(PBKDF2_SALT),
                iterations: PBKDF2_ITERATIONS,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptAesGcm(plaintext, key) {
        const enc = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            enc.encode(plaintext)
        );
        return {
            ciphertext: new Uint8Array(ciphertext),
            iv
        };
    }

    async function decryptAesGcm(ciphertext, iv, key) {
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(iv) },
            key,
            new Uint8Array(ciphertext)
        );
        return new TextDecoder().decode(decrypted);
    }

    // ---- IndexedDB ----

    let dbPromise = null;

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (!isIndexedDBAvailable()) {
                reject(new Error('indexeddb_unavailable'));
                return;
            }
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('indexeddb_blocked'));
        });
        return dbPromise;
    }

    async function dbPut(record) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(record);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async function dbGet(id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    async function dbDelete(id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // ---- Session storage ----

    function sessionSave(token) {
        try { sessionStorage.setItem(SESSION_KEY, token); }
        catch { /* noop */ }
    }

    function sessionLoad() {
        try { return sessionStorage.getItem(SESSION_KEY); }
        catch { return null; }
    }

    function sessionClear() {
        try { sessionStorage.removeItem(SESSION_KEY); }
        catch { /* noop */ }
    }

    // ---- Публичный API ----

    const TokenStore = {
        /**
         * Сохраняет токен в sessionStorage (основное хранилище).
         * @param {string} token
         */
        async save(token) {
            if (!token) return;
            sessionSave(token);
        },

        /**
         * Загружает токен: сначала sessionStorage, потом IndexedDB.
         * @returns {Promise<string|null>}
         */
        async load() {
            const sessionToken = sessionLoad();
            if (sessionToken) return sessionToken;

            const remembered = await this.loadRemembered();
            if (remembered) {
                // Прогреваем session, чтобы не дёргать IndexedDB повторно.
                sessionSave(remembered);
                return remembered;
            }
            return null;
        },

        /**
         * Очищает оба хранилища.
         */
        async clear() {
            sessionClear();
            await this.clearRemembered();
        },

        /**
         * Сохраняет токен в IndexedDB (зашифрованным).
         * @returns {Promise<boolean>} true если сохранено, false при недоступности.
         */
        async saveRemembered(token) {
            if (!token) return false;
            if (!isCryptoAvailable() || !isIndexedDBAvailable()) return false;

            try {
                const key = await deriveKey();
                const { ciphertext, iv } = await encryptAesGcm(token, key);
                await dbPut({
                    id: TOKEN_ID,
                    ciphertext,
                    iv,
                    createdAt: Date.now()
                });
                return true;
            } catch (e) {
                console.warn('[TokenStore] saveRemembered failed:', e);
                return false;
            }
        },

        /**
         * Читает и расшифровывает токен из IndexedDB.
         * При ошибке расшифровки запись удаляется.
         * @returns {Promise<string|null>}
         */
        async loadRemembered() {
            if (!isCryptoAvailable() || !isIndexedDBAvailable()) return null;

            try {
                const record = await dbGet(TOKEN_ID);
                if (!record || !record.ciphertext || !record.iv) return null;

                const key = await deriveKey();
                const token = await decryptAesGcm(record.ciphertext, record.iv, key);
                return token || null;
            } catch (e) {
                // Расшифровка не удалась (device-энтропия изменилась) — очищаем.
                try { await dbDelete(TOKEN_ID); }
                catch { /* noop */ }
                return null;
            }
        },

        /**
         * Удаляет запись из IndexedDB.
         */
        async clearRemembered() {
            if (!isIndexedDBAvailable()) return;
            try { await dbDelete(TOKEN_ID); }
            catch { /* noop */ }
        },

        // ---- Диагностика ----
        isAvailable() {
            return isCryptoAvailable() && isIndexedDBAvailable();
        }
    };

    window.TokenStore = TokenStore;
})();