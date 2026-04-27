// js/core/github-core.js — центральное ядро: конфигурация, утилиты, кэширование, модули
const GithubCore = (function() {
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium',
        CACHE_TTL: 10 * 60 * 1000,
        ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567']
    };

    // ---------- Кэширование ----------
    function cacheGet(key) {
        const cached = sessionStorage.getItem(key);
        const time = sessionStorage.getItem(`${key}_time`);
        if (cached && time && (Date.now() - parseInt(time) < CONFIG.CACHE_TTL)) {
            return JSON.parse(cached);
        }
        try {
            const localCached = localStorage.getItem(key);
            const localTime = localStorage.getItem(`${key}_time`);
            if (localCached && localTime && (Date.now() - parseInt(localTime) < CONFIG.CACHE_TTL)) {
                sessionStorage.setItem(key, localCached);
                sessionStorage.setItem(`${key}_time`, localTime);
                return JSON.parse(localCached);
            }
        } catch (e) { /* игнорировать ошибки quota */ }
        return null;
    }

    function cacheSet(key, data) {
        const serialized = JSON.stringify(data);
        sessionStorage.setItem(key, serialized);
        sessionStorage.setItem(`${key}_time`, Date.now().toString());
        try {
            localStorage.setItem(key, serialized);
            localStorage.setItem(`${key}_time`, Date.now().toString());
        } catch (e) { /* quota exceeded */ }
    }

    function cacheRemove(key) {
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(`${key}_time`);
        try {
            localStorage.removeItem(key);
            localStorage.removeItem(`${key}_time`);
        } catch (e) {}
    }

    function cacheRemoveByPrefix(prefix) {
        const keys = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith(prefix)) keys.push(key);
        }
        keys.forEach(k => {
            sessionStorage.removeItem(k);
            sessionStorage.removeItem(k + '_time');
        });
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (key && key.startsWith(prefix)) {
                    localStorage.removeItem(key);
                    localStorage.removeItem(key + '_time');
                }
            }
        } catch (e) {}
    }

    // ---------- HTML и текст ----------
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function stripHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }

    // ---------- Markdown ----------
    function renderMarkdown(text) {
        if (!text) return '';
        if (window.marked) {
            marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
            return marked.parse(text);
        }
        return text.replace(/\n/g, '<br>');
    }

    // ---------- Мета-комментарии ----------
    function extractMeta(body, tag) {
        const regex = new RegExp(`<!--\\s*${tag}:\\s*(.*?)\\s*-->`, 'i');
        const match = body?.match(regex);
        return match ? match[1].trim() : null;
    }

    function extractAllowed(body) { return extractMeta(body, 'allowed'); }
    function extractSummary(body) { return extractMeta(body, 'summary'); }

    // ---------- Шифрование (простое XOR) ----------
    function deriveKey(allowedStr) {
        if (!allowedStr) return 'default-key';
        let hash = 0;
        for (let i = 0; i < allowedStr.length; i++) {
            hash = ((hash << 5) - hash) + allowedStr.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(16);
    }

    function encryptPrivateBody(body, allowedStr) {
        if (!allowedStr) return body;
        const key = deriveKey(allowedStr);
        let result = '';
        for (let i = 0; i < body.length; i++) {
            const charCode = body.charCodeAt(i) ^ key.charCodeAt(i % key.length);
            result += String.fromCharCode(charCode);
        }
        return btoa(unescape(encodeURIComponent(result)));
    }

    function decryptPrivateBody(encryptedBase64, allowedStr) {
        if (!allowedStr) return encryptedBase64;
        try {
            const encrypted = decodeURIComponent(escape(atob(encryptedBase64)));
            const key = deriveKey(allowedStr);
            let result = '';
            for (let i = 0; i < encrypted.length; i++) {
                const charCode = encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length);
                result += String.fromCharCode(charCode);
            }
            return result;
        } catch (e) {
            console.warn('Decryption failed', e);
            return encryptedBase64;
        }
    }

    // ---------- Массивы ----------
    function deduplicateByNumber(items) {
        const seen = new Set();
        return items.filter(item => {
            if (seen.has(item.number)) return false;
            seen.add(item.number);
            return true;
        });
    }

    // ---------- DOM-утилиты ----------
    function createElement(tag, className, styles = {}, attributes = {}) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        Object.assign(el.style, styles);
        Object.entries(attributes).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    }

    // ---------- Время и дата ----------
    function formatDate(date) {
        const lang = localStorage.getItem('preferredLanguage') || 'ru';
        const locale = lang === 'en' ? 'en-US' : 'ru-RU';
        try {
            return new Intl.DateTimeFormat(locale, {
                year: 'numeric', month: 'long', day: 'numeric'
            }).format(new Date(date));
        } catch {
            return new Date(date).toLocaleDateString();
        }
    }

    // ---------- Планирование ----------
    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    function throttle(fn, delay) {
        let last = 0;
        return (...args) => {
            const now = Date.now();
            if (now - last >= delay) {
                last = now;
                fn(...args);
            }
        };
    }

    // ---------- Прерывание fetch ----------
    function createAbortable(timeout = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return { controller, timeoutId };
    }

    // ---------- Динамическая загрузка модулей ----------
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

    // ---------- Публичное API ----------
    return {
        CONFIG,
        cacheGet,
        cacheSet,
        cacheRemove,
        cacheRemoveByPrefix,
        escapeHtml,
        stripHtml,
        renderMarkdown,
        extractMeta,
        extractAllowed,
        extractSummary,
        encryptPrivateBody,
        decryptPrivateBody,
        deduplicateByNumber,
        createElement,
        formatDate,
        debounce,
        throttle,
        createAbortable,
        loadModule
    };
})();

window.GithubCore = GithubCore;