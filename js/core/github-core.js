// js/core/github-core.js
// Центральный фасад подсистемы GitHub.
// НЕ определяет собственных утилит — реэкспортирует из Utils / DomUtils / ApiCache.
// Содержит бизнес-логику: performAction, isActionStillValid, extractMeta, extractSummary.
//
// ЗАЩИТА ОТ ОТСУТСТВИЯ ЗАВИСИМОСТЕЙ:
//   Если dom-utils.js или utils.js не загрузились, используются безопасные
//   fallback-заглушки. Публичный API остаётся работоспособным, но с ограничениями
//   (см. комментарии у каждой safe* функции).

(function() {
    'use strict';

    const NC = (typeof window !== 'undefined' && window.NeonConfig) || {};

    // ---- Источники (могут быть не загружены) ----
    const U = window.Utils || {};
    const D = window.DomUtils || {};
    const C = window.ApiCache || {};

    // ============================================================
    // Safe fallbacks — гарантируют, что фасад не упадёт при
    // отсутствии зависимостей.
    // ============================================================

    const safeEscape = (typeof D.escapeHtml === 'function')
        ? D.escapeHtml
        : (t) => String(t ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c]));

    const safeStripHtml = (typeof D.stripHtml === 'function')
        ? D.stripHtml
        : (html) => String(html ?? '').replace(/<[^>]*>/g, '');

    const safeCreateElement = (typeof D.createElement === 'function')
        ? D.createElement
        : (tag, className, styles = {}, attrs = {}) => {
            const el = document.createElement(tag);
            if (className) el.className = className;
            if (styles && typeof styles === 'object') Object.assign(el.style, styles);
            if (attrs && typeof attrs === 'object') {
                for (const [k, v] of Object.entries(attrs)) {
                    if (v != null) el.setAttribute(k, String(v));
                }
            }
            return el;
        };

    const safeFormatDate = (typeof D.formatDate === 'function')
        ? D.formatDate
        : (date) => {
            const d = date instanceof Date ? date : new Date(date);
            return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
        };

    const safeSanitize = (typeof U.sanitizeHtml === 'function')
        ? U.sanitizeHtml
        : () => ''; // без DOMPurify — отбрасываем HTML полностью

    const safeRenderMarkdown = (typeof U.renderMarkdown === 'function')
        ? U.renderMarkdown
        : (text) => safeSanitize(String(text ?? '').replace(/\n/g, '<br>'));

    const safeDebounce = (typeof U.debounce === 'function')
        ? U.debounce
        : (fn) => {
            // Fallback: обёртка без реального debounce, но с сохранением API
            if (typeof fn !== 'function') {
                return function() {};
            }
            const wrapped = function(...args) { return fn.apply(this, args); };
            wrapped.cancel = () => {};
            wrapped.flush = function(...args) { return fn.apply(this, args); };
            return wrapped;
        };

    const safeThrottle = (typeof U.throttle === 'function')
        ? U.throttle
        : (fn) => {
            if (typeof fn !== 'function') return function() {};
            return function(...args) { return fn.apply(this, args); };
        };

    const safeCreateAbortable = (typeof U.createAbortable === 'function')
        ? U.createAbortable
        : (timeout = 20000) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                try { controller.abort(new Error('timeout')); }
                catch { controller.abort(); }
            }, timeout);
            return { controller, timeoutId };
        };

    const safeLoadModule = (typeof U.loadModule === 'function')
        ? U.loadModule
        : (p) => Promise.reject(new Error(`Utils.loadModule unavailable: ${p}`));

    const safeDeduplicate = (typeof U.deduplicateByNumber === 'function')
        ? U.deduplicateByNumber
        : (items) => Array.isArray(items) ? items.slice() : [];

    const safeStripMarkdown = (typeof U.stripMarkdownAndHtml === 'function')
        ? U.stripMarkdownAndHtml
        : (text) => String(text ?? '').replace(/<[^>]*>/g, '');

    const safePlainLength = (typeof U.getPlainTextLength === 'function')
        ? U.getPlainTextLength
        : (text) => safeStripMarkdown(text).length;

    const safeContainsToken = (typeof U.containsGitHubToken === 'function')
        ? U.containsGitHubToken
        : () => false;

    const safeXorEncrypt = (typeof U.xorEncrypt === 'function')
        ? U.xorEncrypt
        : () => '';

    const safeXorDecrypt = (typeof U.xorDecrypt === 'function')
        ? U.xorDecrypt
        : () => null;

    // ---- Cache (async) ----
    const safeCacheGet = (typeof C.cacheGet === 'function')
        ? C.cacheGet
        : async () => undefined;

    const safeCacheSet = (typeof C.cacheSet === 'function')
        ? C.cacheSet
        : async () => {};

    const safeCacheRemove = (typeof C.cacheRemove === 'function')
        ? C.cacheRemove
        : () => {};

    const safeCacheRemoveByPrefix = (typeof C.cacheRemoveByPrefix === 'function')
        ? C.cacheRemoveByPrefix
        : () => {};

    // ============================================================
    // Конфигурация
    // ============================================================

    const CONFIG = Object.freeze({
        REPO_OWNER: NC.REPO_OWNER || 'NeonShadowYT',
        REPO_NAME: NC.REPO_NAME || 'NeonImperium',
        CACHE_TTL: NC.CACHE_TTL || 10 * 60 * 1000,
        API_CACHE_TTL: NC.API_CACHE_TTL || 5 * 60 * 1000,
        IMAGE_CACHE_TTL: NC.IMAGE_CACHE_TTL || 30 * 24 * 60 * 60 * 1000,
        RELEASES_CACHE_TTL: NC.RELEASES_CACHE_TTL || 60 * 60 * 1000,
        ALLOWED_AUTHORS: Array.isArray(NC.ALLOWED_AUTHORS)
            ? Object.freeze(NC.ALLOWED_AUTHORS.slice())
            : Object.freeze(['NeonShadowYT', 'GoldenCreeper567'])
    });

    // ============================================================
    // Мета-теги в теле issue: <!-- key: value -->
    // ============================================================

    function extractMeta(body, tag) {
        if (!body || !tag) return null;
        const re = new RegExp(`<!--\\s*${tag}:\\s*(.*?)\\s*-->`, 'i');
        const match = String(body).match(re);
        return match ? match[1].trim() : null;
    }

    const extractSummary = body => extractMeta(body, 'summary');

    // ============================================================
    // Классификация ошибок
    // ============================================================

    function isRetryableError(err) {
        if (!err) return false;
        if (err instanceof TypeError) return true;
        if (err.name === 'AbortError') return true;
        if (err.status === 429) return true;
        if (err.status >= 500 && err.status < 600) return true;
        const msg = String(err.message || '');
        return msg.includes('rate limit') || msg.includes('secondary');
    }

    // ============================================================
    // performAction — обёртка над RateLimits
    // ============================================================

    async function performAction(actionType, payload, asyncFn) {
        if (typeof asyncFn !== 'function') {
            throw new TypeError('performAction: asyncFn must be a function');
        }

        if (!window.RateLimits) {
            try {
                await safeLoadModule('js/features/rate-limits.js');
            } catch (e) {
                console.warn('[performAction] RateLimits не загружен, выполняем сразу');
                return { queued: false, result: await asyncFn() };
            }
        }

        if (!window.RateLimits || typeof window.RateLimits.checkLimit !== 'function') {
            return { queued: false, result: await asyncFn() };
        }

        if (!window.RateLimits.checkLimit(actionType)) {
            const actionId = await window.RateLimits.enqueueAction(actionType, payload);
            return { queued: true, actionId };
        }

        try {
            const result = await asyncFn();
            window.RateLimits.increment(actionType);
            if (typeof window.RateLimits.addHistory === 'function') {
                window.RateLimits.addHistory(actionType, payload, 'completed');
            }
            return { queued: false, result };
        } catch (err) {
            if (isRetryableError(err)) {
                const actionId = await window.RateLimits.enqueueAction(actionType, payload);
                return { queued: true, actionId };
            }
            throw err;
        }
    }

    // ============================================================
    // isActionStillValid — дедупликация очереди
    // ============================================================

    async function hasPendingDuplicate(action, predicate) {
        if (!window.RateLimits || typeof window.RateLimits.getPendingActions !== 'function') {
            return false;
        }
        try {
            const pending = await window.RateLimits.getPendingActions();
            return pending.some(item => item.action === action && predicate(item));
        } catch {
            return false;
        }
    }

    async function isActionStillValid(actionType, payload) {
        const currentUser = (window.GithubAuth && typeof window.GithubAuth.getCurrentUser === 'function')
            ? window.GithubAuth.getCurrentUser()
            : null;

        switch (actionType) {
            case 'reactions': {
                if (!currentUser) return false;
                const { issueNumber, content } = payload || {};
                if (!issueNumber || !content) return false;

                if (await hasPendingDuplicate('reactions', item =>
                    item.data.issueNumber === issueNumber && item.data.content === content
                )) return false;

                try {
                    const reactions = await window.GithubAPI.loadReactions(issueNumber);
                    return !reactions.some(r =>
                        r.user && r.user.login === currentUser && r.content === content
                    );
                } catch { return true; }
            }

            case 'comments': {
                if (!currentUser) return false;
                const { issueNumber, body } = payload || {};
                if (!issueNumber || !body) return false;

                if (await hasPendingDuplicate('comments', item =>
                    item.data.issueNumber === issueNumber && item.data.body === body
                )) return false;

                try {
                    const comments = await window.GithubAPI.loadComments(issueNumber);
                    return !comments.some(c =>
                        c.user && c.user.login === currentUser &&
                        c.body.trim() === body.trim()
                    );
                } catch { return true; }
            }

            case 'posts': {
                const { id, mode } = payload || {};
                if (mode === 'edit' && id) {
                    try {
                        const issue = await window.GithubAPI.loadIssue(id);
                        return !!issue && issue.state !== 'closed';
                    } catch { return false; }
                }
                return true;
            }

            case 'storageAdds': {
                const { bookmark, bookmarks } = payload || {};
                if (Array.isArray(bookmarks)) return true;
                if (!bookmark) return true;

                if (bookmark.url) {
                    if (!currentUser) return false;
                    if (await hasPendingDuplicate('storageAdds', item =>
                        item.data.bookmark && item.data.bookmark.url === bookmark.url
                    )) return false;
                    try {
                        const res = await window.BookmarkStorage.loadBookmarks();
                        return !res.bookmarks.some(b => b.url === bookmark.url);
                    } catch { return true; }
                }

                if (bookmark.saveData && bookmark.saveData.hash) {
                    if (await hasPendingDuplicate('storageAdds', item =>
                        item.data.bookmark &&
                        item.data.bookmark.saveData &&
                        item.data.bookmark.saveData.hash === bookmark.saveData.hash
                    )) return false;
                    try {
                        const res = await window.BookmarkStorage.loadBookmarks();
                        return !res.bookmarks.some(b =>
                            b.saveData && b.saveData.hash === bookmark.saveData.hash
                        );
                    } catch { return true; }
                }
                return true;
            }

            case 'cacheClears':
                return true;

            default:
                return true;
        }
    }

    // ============================================================
    // Публичный фасад
    // ============================================================

    window.GithubCore = {
        CONFIG,

        // ---- DOM (safe*) ----
        escapeHtml: safeEscape,
        stripHtml: safeStripHtml,
        createElement: safeCreateElement,
        formatDate: safeFormatDate,

        // ---- Cache (async, safe*) ----
        cacheGet: safeCacheGet,
        cacheSet: safeCacheSet,
        cacheRemove: safeCacheRemove,
        cacheRemoveByPrefix: safeCacheRemoveByPrefix,

        // ---- Pure utils (safe*) ----
        deduplicateByNumber: safeDeduplicate,
        debounce: safeDebounce,
        throttle: safeThrottle,
        createAbortable: safeCreateAbortable,
        loadModule: safeLoadModule,
        renderMarkdown: safeRenderMarkdown,
        stripMarkdownAndHtml: safeStripMarkdown,
        getPlainTextLength: safePlainLength,
        containsGitHubToken: safeContainsToken,
        sanitizeHtml: safeSanitize,
        xorEncrypt: safeXorEncrypt,
        xorDecrypt: safeXorDecrypt,

        // ---- Локальная бизнес-логика ----
        extractMeta,
        extractSummary,
        performAction,
        isActionStillValid,
        isRetryableError
    };

    // ---- Backward compat ----
    window.performAction = performAction;
})();