// js/core/github-core.js – только специфические для GitHub функции
(function() {
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium',
        CACHE_TTL: 10 * 60 * 1000,
        ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567']
    };

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

    const {
        escapeHtml, stripHtml, createElement, formatDate,
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
        deduplicateByNumber, debounce, throttle, renderMarkdown,
        createAbortable, loadModule
    } = window.Utils;

    window.GithubCore = {
        CONFIG,
        escapeHtml, stripHtml, createElement, formatDate,
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
        deduplicateByNumber, debounce, throttle, renderMarkdown,
        createAbortable, loadModule,
        extractMeta, extractAllowed, extractSummary,
        encryptPrivateBody, decryptPrivateBody
    };
})();