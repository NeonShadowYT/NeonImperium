// js/utils.js
// Чистые утилиты без побочных эффектов.
// Cache-функции живут в js/core/api-cache.js, DOM-функции — в js/core/dom-utils.js.
// Все три файла мержатся в window.Utils для обратной совместимости.
//
// Порядок загрузки в HTML:
//   1. config.js
//   2. cache-crypto.js
//   3. token-store.js
//   4. dom-utils.js
//   5. api-cache.js
//   6. utils.js  ← этот файл

(function() {
    'use strict';

    // ============================================================
    // Утилиты коллекций
    // ============================================================

    function deduplicateByNumber(items) {
        if (!Array.isArray(items)) return [];
        const seen = new Set();
        const result = [];
        for (const item of items) {
            const key = item && item.number;
            if (key == null) { result.push(item); continue; }
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(item);
        }
        return result;
    }

    // ============================================================
    // Debounce / Throttle
    // ============================================================

    function debounce(fn, delay) {
        if (typeof fn !== 'function') throw new TypeError('debounce: fn must be a function');
        let timer = null;
        const wrapped = function(...args) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                try { fn.apply(this, args); }
                catch (e) { console.error('[debounce]', e); }
            }, delay);
        };
        wrapped.cancel = () => {
            if (timer) { clearTimeout(timer); timer = null; }
        };
        wrapped.flush = function(...args) {
            if (timer) { clearTimeout(timer); timer = null; }
            try { fn.apply(this, args); }
            catch (e) { console.error('[debounce]', e); }
        };
        return wrapped;
    }

    function throttle(fn, delay) {
        if (typeof fn !== 'function') throw new TypeError('throttle: fn must be a function');
        let last = 0;
        let timer = null;
        return function(...args) {
            const now = Date.now();
            const remaining = delay - (now - last);
            if (remaining <= 0) {
                if (timer) { clearTimeout(timer); timer = null; }
                last = now;
                try { fn.apply(this, args); }
                catch (e) { console.error('[throttle]', e); }
            } else if (!timer) {
                timer = setTimeout(() => {
                    last = Date.now();
                    timer = null;
                    try { fn.apply(this, args); }
                    catch (e) { console.error('[throttle]', e); }
                }, remaining);
            }
        };
    }

    // ============================================================
    // AbortController с таймаутом
    // ============================================================

    function createAbortable(timeout = 20000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            try { controller.abort(new Error('timeout')); }
            catch { controller.abort(); }
        }, timeout);
        return { controller, timeoutId };
    }

    // ============================================================
    // Загрузчик ES5-скриптов
    // ============================================================

    const loadedModules = new Set();
    const modulePromises = new Map();

    function loadModule(path) {
        if (!path) return Promise.reject(new Error('loadModule: path is required'));
        if (loadedModules.has(path)) return Promise.resolve();
        if (modulePromises.has(path)) return modulePromises.get(path);

        const promise = new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${path}"]`)) {
                loadedModules.add(path);
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = path;
            script.async = true;
            script.onload = () => {
                loadedModules.add(path);
                modulePromises.delete(path);
                resolve();
            };
            script.onerror = () => {
                modulePromises.delete(path);
                reject(new Error(`Failed to load module: ${path}`));
            };
            document.head.appendChild(script);
        });

        modulePromises.set(path, promise);
        return promise;
    }

    // ============================================================
    // Markdown / HTML безопасность
    // ============================================================

    const TOKEN_PATTERNS = [
        /ghp_[A-Za-z0-9]{36}/,
        /github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}/,
        /gho_[A-Za-z0-9]{36}/,
        /ghu_[A-Za-z0-9]{36}/,
        /ghs_[A-Za-z0-9]{36}/,
        /gpl_[A-Za-z0-9]{36}/
    ];

    function stripMarkdownAndHtml(text) {
        if (!text) return '';
        let cleaned = String(text);
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
        return stripMarkdownAndHtml(text).length;
    }

    function containsGitHubToken(text) {
        if (!text) return false;
        const str = String(text);
        for (const pattern of TOKEN_PATTERNS) {
            if (pattern.test(str)) return true;
        }
        return /\bgithub_token\b/i.test(str);
    }

    /**
     * Экранирует HTML-сущности.
     * Используется как fallback, если DOMPurify не загружен.
     */
    function escapeHtmlFallback(html) {
        return String(html)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Санитизирует HTML.
     *   — DOMPurify загружен: полная очистка, HTML сохраняется.
     *   — DOMPurify не загружен: HTML экранируется (безопасный fallback),
     *     чтобы не терять данные полностью.
     */
    function sanitizeHtml(html) {
        if (!html) return '';
        if (typeof window.DOMPurify === 'undefined' ||
            typeof window.DOMPurify.sanitize !== 'function') {
            console.warn('[sanitizeHtml] DOMPurify не загружен — используется escape-fallback.');
            return escapeHtmlFallback(html);
        }
        return window.DOMPurify.sanitize(String(html), {
            ADD_ATTR: ['target', 'rel', 'loading', 'referrerpolicy'],
            FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus']
        });
    }

    // ---- Markdown LRU по djb2-хешу ----
    const MAX_MARKDOWN_CACHE = 200;
    const markdownCache = new Map();

    function djb2Hash(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
        }
        return hash >>> 0;
    }

    function renderMarkdown(text) {
        if (!text) return '';
        const str = String(text);
        const hash = djb2Hash(str);

        if (markdownCache.has(hash)) {
            const entry = markdownCache.get(hash);
            if (entry.text === str) {
                markdownCache.delete(hash);
                markdownCache.set(hash, entry);
                return entry.html;
            }
        }

        let rawHtml;
        if (window.marked) {
            try {
                if (typeof window.marked.setOptions === 'function') {
                    window.marked.setOptions({
                        gfm: true,
                        breaks: true,
                        headerIds: false,
                        mangle: false
                    });
                }
                if (typeof window.marked.parse === 'function') {
                    rawHtml = window.marked.parse(str);
                } else if (typeof window.marked === 'function') {
                    rawHtml = window.marked(str);
                }
            } catch (e) {
                console.warn('[renderMarkdown] marked error:', e);
            }
        }
        if (rawHtml === undefined || rawHtml === null) {
            rawHtml = str.replace(/\n/g, '<br>');
        }
        const safe = sanitizeHtml(rawHtml);

        if (markdownCache.size >= MAX_MARKDOWN_CACHE) {
            const firstKey = markdownCache.keys().next().value;
            if (firstKey !== undefined) markdownCache.delete(firstKey);
        }
        markdownCache.set(hash, { text: str, html: safe });
        return safe;
    }

    // ============================================================
    // XOR — только для обфускации истории лимитов (rate-limits.js).
    // НЕ используется для токенов.
    // ============================================================

    function xorEncrypt(data, key) {
        if (!data || !key) return '';
        let result = '';
        for (let i = 0; i < data.length; i++) {
            result += String.fromCharCode(
                data.charCodeAt(i) ^ key.charCodeAt(i % key.length)
            );
        }
        return btoa(unescape(encodeURIComponent(result)));
    }

    function xorDecrypt(encrypted, key) {
        if (!encrypted || !key) return null;
        try {
            const decoded = decodeURIComponent(escape(atob(encrypted)));
            let result = '';
            for (let i = 0; i < decoded.length; i++) {
                result += String.fromCharCode(
                    decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length)
                );
            }
            return result;
        } catch (e) {
            return null;
        }
    }

    // ============================================================
    // Публикация
    // ============================================================

    const api = {
        deduplicateByNumber,
        debounce,
        throttle,
        createAbortable,
        loadModule,
        stripMarkdownAndHtml,
        getPlainTextLength,
        containsGitHubToken,
        sanitizeHtml,
        renderMarkdown,
        xorEncrypt,
        xorDecrypt
    };

    window.Utils = Object.assign(window.Utils || {}, api);
})();