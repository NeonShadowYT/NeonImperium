// js/utils.js – централизованные утилиты для всего сайта
// Кэш шифруется через CacheCrypto (AES-GCM), кроме исключённых ключей.
// cacheGet/cacheSet — асинхронные.
(function() {
    // ---- Источник конфигурации: window.NeonConfig (js/config.js) с fallback на дефолты ----
    const NC = (typeof window !== 'undefined' && window.NeonConfig) || {};
    const CONFIG = {
        CACHE_TTL: NC.CACHE_TTL || 10 * 60 * 1000,
        REPO_OWNER: NC.REPO_OWNER || 'NeonShadowYT',
        REPO_NAME: NC.REPO_NAME || 'NeonImperium'
    };

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function stripHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    }

    function createElement(tag, className, styles = {}, attrs = {}) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        Object.assign(el.style, styles);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    }

    function formatDate(date, lang = null) {
        const locale = lang || localStorage.getItem('preferredLanguage') || 'ru';
        const d = new Date(date);
        return d.toLocaleDateString(locale === 'en' ? 'en-US' : 'ru-RU', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    // ---- Асинхронный кэш с шифрованием ----

    /**
     * Читает значение из кэша. Если ключ не в исключениях — расшифровывает.
     * При ошибке расшифровки удаляет повреждённый ключ и возвращает null.
     */
    async function cacheGet(key, ttl = CONFIG.CACHE_TTL) {
        const isExcluded = window.CacheCrypto?.isExcludedKey(key) ?? true;

        const session = sessionStorage.getItem(key);
        const sessionTime = sessionStorage.getItem(`${key}_time`);
        if (session && sessionTime && (Date.now() - parseInt(sessionTime) < ttl)) {
            if (isExcluded) {
                try { return JSON.parse(session); } catch { return null; }
            }
            const decrypted = await window.CacheCrypto.decryptCacheValue(session);
            if (decrypted === null) {
                sessionStorage.removeItem(key);
                sessionStorage.removeItem(`${key}_time`);
                return null;
            }
            try { return JSON.parse(decrypted); } catch { return null; }
        }

        try {
            const local = localStorage.getItem(key);
            const localTime = localStorage.getItem(`${key}_time`);
            if (local && localTime && (Date.now() - parseInt(localTime) < ttl)) {
                sessionStorage.setItem(key, local);
                sessionStorage.setItem(`${key}_time`, localTime);
                if (isExcluded) {
                    try { return JSON.parse(local); } catch { return null; }
                }
                const decrypted = await window.CacheCrypto.decryptCacheValue(local);
                if (decrypted === null) {
                    localStorage.removeItem(key);
                    localStorage.removeItem(`${key}_time`);
                    return null;
                }
                try { return JSON.parse(decrypted); } catch { return null; }
            }
        } catch {}

        return null;
    }

    /**
     * Записывает значение в кэш. Если ключ не в исключениях — шифрует.
     */
    async function cacheSet(key, data) {
        const str = JSON.stringify(data);
        const isExcluded = window.CacheCrypto?.isExcludedKey(key) ?? true;

        let storedValue;
        if (isExcluded) {
            storedValue = str;
        } else if (window.CacheCrypto) {
            try {
                storedValue = await window.CacheCrypto.encryptCacheValue(str);
            } catch (e) {
                console.warn('[cacheSet] Ошибка шифрования, сохраняем как есть:', e);
                storedValue = str;
            }
        } else {
            storedValue = str;
        }

        const now = Date.now().toString();
        sessionStorage.setItem(key, storedValue);
        sessionStorage.setItem(`${key}_time`, now);
        try {
            localStorage.setItem(key, storedValue);
            localStorage.setItem(`${key}_time`, now);
        } catch {}
    }

    function cacheRemove(key) {
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(`${key}_time`);
        try {
            localStorage.removeItem(key);
            localStorage.removeItem(`${key}_time`);
        } catch {}
    }

    function cacheRemoveByPrefix(prefix) {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith(prefix)) {
                sessionStorage.removeItem(k);
                sessionStorage.removeItem(k + '_time');
            }
        }
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.startsWith(prefix)) {
                    localStorage.removeItem(k);
                    localStorage.removeItem(k + '_time');
                }
            }
        } catch {}
    }

    function deduplicateByNumber(items) {
        const seen = new Set();
        return items.filter(i => {
            if (seen.has(i.number)) return false;
            seen.add(i.number);
            return true;
        });
    }

    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function throttle(fn, delay) {
        let last = 0;
        return function(...args) {
            const now = Date.now();
            if (now - last >= delay) {
                last = now;
                fn.apply(this, args);
            }
        };
    }

    /**
     * Санитайзит HTML с помощью DOMPurify.
     */
    function sanitizeHtml(html) {
        if (!html) return '';
        if (typeof window.DOMPurify === 'undefined' || typeof window.DOMPurify.sanitize !== 'function') {
            console.warn('[sanitizeHtml] DOMPurify не загружен. HTML будет отброшен.');
            return '';
        }
        return window.DOMPurify.sanitize(html, {
            ADD_ATTR: ['target'],
            FORBID_TAGS: ['style'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick']
        });
    }

    function renderMarkdown(text) {
        if (!text) return '';
        let rawHtml;
        if (window.marked) {
            if (typeof marked.setOptions === 'function') {
                marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
            }
            if (typeof marked.parse === 'function') {
                rawHtml = marked.parse(text);
            } else if (typeof marked === 'function') {
                rawHtml = marked(text);
            }
        }
        if (rawHtml === undefined) {
            rawHtml = text.replace(/\n/g, '<br>');
        }
        return sanitizeHtml(rawHtml);
    }

    function createAbortable(timeout = 20000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return { controller, timeoutId };
    }

    const loadedScripts = new Set();
    function loadModule(path) {
        if (loadedScripts.has(path)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = path;
            script.async = true;
            script.onload = () => { loadedScripts.add(path); resolve(); };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function stripMarkdownAndHtml(text) {
        if (!text) return '';
        let cleaned = text;

        cleaned = cleaned.replace(/<details[\s\S]*?<\/details>/gi, '');
        cleaned = cleaned.replace(/<[^>]*>/g, ' ');
        cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
        cleaned = cleaned.replace(/<div class="youtube-embed">[\s\S]*?<\/div>/gi, '');
        cleaned = cleaned.replace(/\bhttps?:\/\/[^\s]+/g, '');
        cleaned = cleaned.replace(/[#*_~`>\-+=|]/g, ' ');
        cleaned = cleaned.replace(/\s+/g, ' ').trim();

        return cleaned;
    }

    function getPlainTextLength(text) {
        const plain = stripMarkdownAndHtml(text);
        return plain.length;
    }

    function containsGitHubToken(text) {
        if (!text) return false;
        const patterns = [
            /ghp_[a-zA-Z0-9]{36}/,
            /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/,
            /gho_[a-zA-Z0-9]{36}/,
            /ghu_[a-zA-Z0-9]{36}/,
            /ghs_[a-zA-Z0-9]{36}/,
            /gpl_[a-zA-Z0-9]{36}/
        ];
        for (const p of patterns) {
            if (p.test(text)) return true;
        }
        if (/\bgithub_token\b/i.test(text)) return true;
        return false;
    }

    // ----- XOR (оставлено для истории / обратной совместимости) -----
    function xorEncrypt(data, key) {
        let result = '';
        for (let i = 0; i < data.length; i++) {
            result += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return btoa(unescape(encodeURIComponent(result)));
    }

    function xorDecrypt(encrypted, key) {
        try {
            const decoded = decodeURIComponent(escape(atob(encrypted)));
            let result = '';
            for (let i = 0; i < decoded.length; i++) {
                result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return result;
        } catch (e) {
            return null;
        }
    }

    function generateRandomKey(length = 32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=';
        let key = '';
        for (let i = 0; i < length; i++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return key;
    }

    window.Utils = {
        escapeHtml, stripHtml, createElement, formatDate,
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
        deduplicateByNumber, debounce, throttle, renderMarkdown,
        createAbortable, loadModule,
        stripMarkdownAndHtml,
        getPlainTextLength,
        containsGitHubToken,
        xorEncrypt,
        xorDecrypt,
        generateRandomKey,
        sanitizeHtml
    };
})();