// js/core/github-core.js — расширенное ядро с утилитами и конфигурацией
const GithubCore = (function() {
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium',
        CACHE_TTL: 10 * 60 * 1000,
        ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567']
    };

    // Кэширование в sessionStorage
    function cacheGet(key) {
        const cached = sessionStorage.getItem(key);
        const time = sessionStorage.getItem(`${key}_time`);
        if (cached && time && (Date.now() - parseInt(time) < CONFIG.CACHE_TTL)) {
            return JSON.parse(cached);
        }
        return null;
    }

    function cacheSet(key, data) {
        sessionStorage.setItem(key, JSON.stringify(data));
        sessionStorage.setItem(`${key}_time`, Date.now().toString());
    }

    function cacheRemove(key) {
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(`${key}_time`);
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
    }

    // Безопасный HTML
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Markdown (использует глобальный marked)
    function renderMarkdown(text) {
        if (!text) return '';
        if (window.marked) {
            marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
            return marked.parse(text);
        }
        return text.replace(/\n/g, '<br>');
    }

    // Дедупликация по номеру issue
    function deduplicateByNumber(items) {
        const seen = new Set();
        return items.filter(item => {
            if (seen.has(item.number)) return false;
            seen.add(item.number);
            return true;
        });
    }

    // Создание AbortController с таймаутом
    function createAbortable(timeout = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return { controller, timeoutId };
    }

    // Очистка HTML
    function stripHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }

    // Извлечение мета-комментариев <!-- tag: value -->
    function extractMeta(body, tag) {
        const regex = new RegExp(`<!--\\s*${tag}:\\s*(.*?)\\s*-->`, 'i');
        const match = body?.match(regex);
        return match ? match[1].trim() : null;
    }

    function extractAllowed(body) { return extractMeta(body, 'allowed'); }
    function extractSummary(body) { return extractMeta(body, 'summary'); }

    // Лёгкое шифрование приватных постов (по списку allowed)
    function deriveKeyFromAllowedList(allowedStr) {
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
        const key = deriveKeyFromAllowedList(allowedStr);
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
            const key = deriveKeyFromAllowedList(allowedStr);
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

    // Утилиты для DOM
    function createElement(tag, className, styles = {}, attributes = {}) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        Object.assign(el.style, styles);
        Object.entries(attributes).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    }

    // Дебаунс
    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    // Форматирование даты
    function formatDate(date) {
        return new Date(date).toLocaleDateString();
    }

    return {
        CONFIG,
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
        escapeHtml, renderMarkdown, deduplicateByNumber, createAbortable,
        stripHtml, extractMeta, extractAllowed, extractSummary,
        encryptPrivateBody, decryptPrivateBody,
        createElement, debounce, formatDate
    };
})();

window.GithubCore = GithubCore;