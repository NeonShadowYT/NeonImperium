// js/core/github-core.js
(function() {
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium',
        CACHE_TTL: 10 * 60 * 1000,
        API_CACHE_TTL: 5 * 60 * 1000,
        IMAGE_CACHE_TTL: 30 * 24 * 60 * 60 * 1000,
        RELEASES_CACHE_TTL: 60 * 60 * 1000,
        ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567']
    };

    const {
        escapeHtml, stripHtml, createElement, formatDate,
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
        deduplicateByNumber, debounce, throttle, renderMarkdown,
        createAbortable, loadModule
    } = window.Utils;

    function extractMeta(body, tag) {
        const re = new RegExp(`<!--\\s*${tag}:\\s*(.*?)\\s*-->`, 'i');
        const match = body?.match(re);
        return match ? match[1].trim() : null;
    }
    const extractAllowed = body => extractMeta(body, 'allowed');
    const extractSummary = body => extractMeta(body, 'summary');

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
            result += String.fromCharCode(body.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return btoa(unescape(encodeURIComponent(result)));
    }

    function decryptPrivateBody(encBase64, allowedStr) {
        if (!allowedStr) return encBase64;
        try {
            const encrypted = decodeURIComponent(escape(atob(encBase64)));
            const key = deriveKey(allowedStr);
            let result = '';
            for (let i = 0; i < encrypted.length; i++) {
                result += String.fromCharCode(encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return result;
        } catch (e) {
            console.warn('Decrypt failed', e);
            return encBase64;
        }
    }

    async function performAction(actionType, payload, asyncFn) {
        if (!window.RateLimits) {
            await loadModule('js/features/rate-limits.js');
        }
        if (!window.RateLimits.checkLimit(actionType)) {
            const enqueued = await window.RateLimits.enqueueAction(actionType, payload);
            return { queued: true, actionId: enqueued };
        }
        try {
            const result = await asyncFn();
            window.RateLimits.increment(actionType);
            return { queued: false, result };
        } catch (err) {
            if (isRetryableError(err)) {
                const enqueued = await window.RateLimits.enqueueAction(actionType, payload);
                return { queued: true, actionId: enqueued };
            }
            throw err;
        }
    }

    function isRetryableError(err) {
        if (err instanceof TypeError || err.name === 'AbortError') return true;
        if (err.status && (err.status === 429 || err.status >= 500)) return true;
        if (err.message && (err.message.includes('rate limit') || err.message.includes('secondary'))) return true;
        return false;
    }

    async function isActionStillValid(actionType, payload) {
        if (actionType === 'reactions') {
            const { issueNumber, content } = payload;
            const currentUser = window.GithubAuth?.getCurrentUser();
            if (!currentUser) return false;
            if (window.RateLimits) {
                const pending = await window.RateLimits.getPendingActions();
                const existsInQueue = pending.some(item =>
                    item.action === 'reactions' &&
                    item.data.issueNumber === issueNumber &&
                    item.data.content === content
                );
                if (existsInQueue) return false;
            }
            try {
                const reactions = await window.GithubAPI.loadReactions(issueNumber);
                const exists = reactions.some(r => r.user.login === currentUser && r.content === content);
                return !exists;
            } catch (e) {
                return true;
            }
        }
        if (actionType === 'comments') {
            const { issueNumber, body } = payload;
            const currentUser = window.GithubAuth?.getCurrentUser();
            if (!currentUser) return false;
            if (window.RateLimits) {
                const pending = await window.RateLimits.getPendingActions();
                const existsInQueue = pending.some(item =>
                    item.action === 'comments' &&
                    item.data.issueNumber === issueNumber &&
                    item.data.body === body
                );
                if (existsInQueue) return false;
            }
            try {
                const comments = await window.GithubAPI.loadComments(issueNumber);
                const exists = comments.some(c => c.user.login === currentUser && c.body.trim() === body.trim());
                return !exists;
            } catch (e) {
                return true;
            }
        }
        if (actionType === 'posts') {
            const { id, mode } = payload;
            if (mode === 'edit' && id) {
                try {
                    const issue = await window.GithubAPI.loadIssue(id);
                    return issue.state !== 'closed';
                } catch (e) {
                    return false;
                }
            }
            return true;
        }
        if (actionType === 'storageAdds') {
            const { bookmark } = payload;
            if (bookmark.url) {
                const currentUser = window.GithubAuth?.getCurrentUser();
                if (!currentUser) return false;
                if (window.RateLimits) {
                    const pending = await window.RateLimits.getPendingActions();
                    const existsInQueue = pending.some(item =>
                        item.action === 'storageAdds' &&
                        item.data.bookmark.url === bookmark.url
                    );
                    if (existsInQueue) return false;
                }
                try {
                    const res = await window.BookmarkStorage.loadBookmarks();
                    const exists = res.bookmarks.some(b => b.url === bookmark.url);
                    return !exists;
                } catch (e) {
                    return true;
                }
            }
            if (bookmark.saveData && bookmark.saveData.hash) {
                if (window.RateLimits) {
                    const pending = await window.RateLimits.getPendingActions();
                    const existsInQueue = pending.some(item =>
                        item.action === 'storageAdds' &&
                        item.data.bookmark.saveData &&
                        item.data.bookmark.saveData.hash === bookmark.saveData.hash
                    );
                    if (existsInQueue) return false;
                }
                try {
                    const res = await window.BookmarkStorage.loadBookmarks();
                    const exists = res.bookmarks.some(b => b.saveData && b.saveData.hash === bookmark.saveData.hash);
                    return !exists;
                } catch (e) {
                    return true;
                }
            }
            return true;
        }
        if (actionType === 'cacheClears') {
            return true;
        }
        return true;
    }

    window.GithubCore = {
        CONFIG,
        escapeHtml, stripHtml, createElement, formatDate,
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
        deduplicateByNumber, debounce, throttle, renderMarkdown,
        createAbortable, loadModule,
        extractMeta, extractAllowed, extractSummary,
        encryptPrivateBody, decryptPrivateBody,
        performAction,
        isActionStillValid,
        isRetryableError
    };

    window.performAction = performAction;
})();