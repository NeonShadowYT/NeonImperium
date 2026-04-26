// js/core/github-core.js — расширенное ядро с утилитами, конфигурацией, умным кешированием и дедупликацией запросов
const GithubCore = (function() {
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium',
        CACHE_TTL: 10 * 60 * 1000,
        DEFAULT_FETCH_TTL: 60000,
        ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567']
    };

    // ---------- кеширование метаданных запросов ----------
    const META_PREFIX = 'gh_meta_';
    const DATA_PREFIX = 'gh_data_';

    function getCacheMeta(key) {
        try { return JSON.parse(sessionStorage.getItem(META_PREFIX + key)); } catch { return null; }
    }
    function setCacheMeta(key, meta) {
        try { sessionStorage.setItem(META_PREFIX + key, JSON.stringify(meta)); } catch {}
    }
    function removeCacheMeta(key) {
        try { sessionStorage.removeItem(META_PREFIX + key); } catch {}
    }
    function getCachedData(key) {
        try { return JSON.parse(sessionStorage.getItem(DATA_PREFIX + key)); } catch { return null; }
    }
    function setCachedData(key, data) {
        try { sessionStorage.setItem(DATA_PREFIX + key, JSON.stringify(data)); } catch {}
    }
    function removeCachedData(key) {
        try { sessionStorage.removeItem(DATA_PREFIX + key); } catch {}
    }

    // ---------- дедупликация запросов ----------
    const inFlight = new Map(); // key -> Promise<CachedResponse>

    // ---------- умный кеширующий fetch ----------
    class CachedResponse {
        constructor(data, status = 200, headers = {}) {
            this._data = data;
            this.ok = true;
            this.status = status;
            this._headers = new Map(Object.entries(headers));
        }
        json() { return Promise.resolve(this._data); }
        text() { return Promise.resolve(JSON.stringify(this._data)); }
        clone() { return new CachedResponse(this._data, this.status, Object.fromEntries(this._headers)); }
        get headers() { return { get: (name) => this._headers.get(name) }; }
    }

    async function fetchCached(url, options = {}, cacheOpts = {}) {
        const cacheKey = cacheOpts.cacheKey || url;
        const ttl = cacheOpts.ttl ?? CONFIG.DEFAULT_FETCH_TTL;

        // Проверяем, нет ли уже выполняющегося запроса
        if (inFlight.has(cacheKey)) {
            return inFlight.get(cacheKey);
        }

        const fetchPromise = (async () => {
            // Проверяем свежий кеш
            const meta = getCacheMeta(cacheKey);
            const cachedData = getCachedData(cacheKey);
            if (meta && cachedData && Date.now() - meta.timestamp < ttl) {
                return new CachedResponse(cachedData, 200, meta.headers);
            }

            // Готовим условные заголовки
            const fetchOptions = { ...options };
            fetchOptions.headers = new Headers(fetchOptions.headers || {});
            if (meta) {
                if (meta.etag) fetchOptions.headers.set('If-None-Match', meta.etag);
                if (meta.lastModified) fetchOptions.headers.set('If-Modified-Since', meta.lastModified);
            }

            const response = await fetch(url, fetchOptions);

            if (response.status === 304 && cachedData) {
                // Обновляем timestamp, но используем кеш
                setCacheMeta(cacheKey, { ...meta, timestamp: Date.now() });
                return new CachedResponse(cachedData, 304, meta.headers);
            }

            if (!response.ok) {
                let errorMsg = `HTTP ${response.status}`;
                try {
                    const errData = await response.json();
                    errorMsg = errData.message || errorMsg;
                } catch {}
                throw new Error(errorMsg);
            }

            const data = await response.json();
            const resHeaders = {
                etag: response.headers.get('ETag'),
                lastModified: response.headers.get('Last-Modified')
            };
            // Кешируем только успешные GET
            if (!fetchOptions.method || fetchOptions.method.toUpperCase() === 'GET') {
                setCachedData(cacheKey, data);
                setCacheMeta(cacheKey, { ...resHeaders, timestamp: Date.now(), headers: resHeaders });
            }
            return new CachedResponse(data, response.status, resHeaders);
        })();

        inFlight.set(cacheKey, fetchPromise);
        try {
            return await fetchPromise;
        } finally {
            inFlight.delete(cacheKey);
        }
    }

    // ---------- Инвалидация кеша fetchCached ----------
    function invalidateFetchCache(urlPattern) {
        // удаляем все ключи, которые содержат urlPattern (или все, если не указан)
        const prefixes = [META_PREFIX, DATA_PREFIX];
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (!key) continue;
            const prefix = prefixes.find(p => key.startsWith(p));
            if (prefix) {
                if (!urlPattern || key.includes(urlPattern)) {
                    sessionStorage.removeItem(key);
                }
            }
        }
    }

    // ---------- старый слой кеша (совместимость) ----------
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
        } catch (e) {}
        return null;
    }

    function cacheSet(key, data) {
        sessionStorage.setItem(key, JSON.stringify(data));
        sessionStorage.setItem(`${key}_time`, Date.now().toString());
        try {
            localStorage.setItem(key, JSON.stringify(data));
            localStorage.setItem(`${key}_time`, Date.now().toString());
        } catch (e) {}
    }

    function cacheRemove(key) {
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(`${key}_time`);
        try { localStorage.removeItem(key); localStorage.removeItem(`${key}_time`); } catch (e) {}
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
        // также чистим новый fetch-кеш, если он пересекается
        invalidateFetchCache(prefix);
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function renderMarkdown(text) {
        if (!text) return '';
        if (window.marked) {
            marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
            return marked.parse(text);
        }
        return text.replace(/\n/g, '<br>');
    }

    function deduplicateByNumber(items) {
        const seen = new Set();
        return items.filter(item => {
            if (seen.has(item.number)) return false;
            seen.add(item.number);
            return true;
        });
    }

    function createAbortable(timeout = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return { controller, timeoutId };
    }

    function stripHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }

    function extractMeta(body, tag) {
        const regex = new RegExp(`<!--\\s*${tag}:\\s*(.*?)\\s*-->`, 'i');
        const match = body?.match(regex);
        return match ? match[1].trim() : null;
    }

    function extractAllowed(body) { return extractMeta(body, 'allowed'); }
    function extractSummary(body) { return extractMeta(body, 'summary'); }

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

    function createElement(tag, className, styles = {}, attributes = {}) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        Object.assign(el.style, styles);
        Object.entries(attributes).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    }

    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    function formatDate(date) {
        return new Date(date).toLocaleDateString();
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

    return {
        CONFIG,
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
        fetchCached, invalidateFetchCache,
        escapeHtml, renderMarkdown, deduplicateByNumber, createAbortable,
        stripHtml, extractMeta, extractAllowed, extractSummary,
        encryptPrivateBody, decryptPrivateBody,
        createElement, debounce, formatDate,
        loadModule
    };
})();

window.GithubCore = GithubCore;