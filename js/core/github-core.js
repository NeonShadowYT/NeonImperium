// js/core/github-core.js
const GithubCore = (function() {
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium',
        CACHE_TTL: 10 * 60 * 1000,
        ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567']
    };

    // Кэширование
    function cacheGet(key) {
        const cached = sessionStorage.getItem(key);
        const time = sessionStorage.getItem(`${key}_time`);
        if (cached && time && (Date.now() - parseInt(time) < CONFIG.CACHE_TTL)) return JSON.parse(cached);
        try {
            const lc = localStorage.getItem(key);
            const lt = localStorage.getItem(`${key}_time`);
            if (lc && lt && (Date.now() - parseInt(lt) < CONFIG.CACHE_TTL)) {
                sessionStorage.setItem(key, lc);
                sessionStorage.setItem(`${key}_time`, lt);
                return JSON.parse(lc);
            }
        } catch {}
        return null;
    }

    function cacheSet(key, data) {
        const s = JSON.stringify(data);
        sessionStorage.setItem(key, s);
        sessionStorage.setItem(`${key}_time`, Date.now().toString());
        try { localStorage.setItem(key, s); localStorage.setItem(`${key}_time`, Date.now().toString()); } catch {}
    }

    function cacheRemove(key) {
        sessionStorage.removeItem(key); sessionStorage.removeItem(`${key}_time`);
        try { localStorage.removeItem(key); localStorage.removeItem(`${key}_time`); } catch {}
    }

    function cacheRemoveByPrefix(prefix) {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const k = sessionStorage.key(i);
            if (k?.startsWith(prefix)) { sessionStorage.removeItem(k); sessionStorage.removeItem(k + '_time'); }
        }
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k?.startsWith(prefix)) { localStorage.removeItem(k); localStorage.removeItem(k + '_time'); }
            }
        } catch {}
    }

    // HTML и текст
    function escapeHtml(text) {
        if (!text) return '';
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    function stripHtml(html) {
        const d = document.createElement('div');
        d.innerHTML = html;
        return d.textContent || d.innerText || '';
    }

    // Markdown
    function renderMarkdown(text) {
        if (!text) return '';
        if (window.marked) {
            marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
            return marked.parse(text);
        }
        return text.replace(/\n/g, '<br>');
    }

    // Мета-комментарии
    function extractMeta(body, tag) {
        const re = new RegExp(`<!--\\s*${tag}:\\s*(.*?)\\s*-->`, 'i');
        const m = body?.match(re);
        return m ? m[1].trim() : null;
    }
    const extractAllowed = body => extractMeta(body, 'allowed');
    const extractSummary = body => extractMeta(body, 'summary');

    // Шифрование (XOR)
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
        for (let i = 0; i < body.length; i++) result += String.fromCharCode(body.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        return btoa(unescape(encodeURIComponent(result)));
    }

    function decryptPrivateBody(encBase64, allowedStr) {
        if (!allowedStr) return encBase64;
        try {
            const encrypted = decodeURIComponent(escape(atob(encBase64)));
            const key = deriveKey(allowedStr);
            let result = '';
            for (let i = 0; i < encrypted.length; i++) result += String.fromCharCode(encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            return result;
        } catch (e) { console.warn('Decrypt failed', e); return encBase64; }
    }

    // Массивы
    function deduplicateByNumber(items) {
        const s = new Set();
        return items.filter(i => { if (s.has(i.number)) return false; s.add(i.number); return true; });
    }

    // DOM
    function createElement(tag, cls, styles = {}, attrs = {}) {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        Object.assign(el.style, styles);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    }

    // Дата
    function formatDate(date) {
        const lang = localStorage.getItem('preferredLanguage') || 'ru';
        return new Date(date).toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    // Планирование
    const debounce = (fn, d) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), d); }; };
    const throttle = (fn, d) => { let l = 0; return (...a) => { const n = Date.now(); if (n - l >= d) { l = n; fn(...a); } }; };

    // Прерывание fetch (таймаут 20 с по умолчанию)
    function createAbortable(timeout = 20000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return { controller, timeoutId };
    }

    // Динамическая загрузка модулей
    const loadedScripts = new Set();
    function loadModule(path) {
        if (loadedScripts.has(path)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = path;
            s.async = true;
            s.onload = () => { loadedScripts.add(path); resolve(); };
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    return {
        CONFIG,
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
        escapeHtml, stripHtml, renderMarkdown,
        extractMeta, extractAllowed, extractSummary,
        encryptPrivateBody, decryptPrivateBody,
        deduplicateByNumber, createElement, formatDate,
        debounce, throttle, createAbortable, loadModule
    };
})();
window.GithubCore = GithubCore;