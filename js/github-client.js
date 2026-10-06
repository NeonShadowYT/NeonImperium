// js/github-client.js
// Универсальный клиент GitHub API.
//   — Singleton.
//   — Exponential backoff с jitter на 5xx/429.
//   — Кэширование GET через ApiCache (stale-while-revalidate).
//   — ETag / If-None-Match.
//   — Дедупликация одновременных GET.
//   — При получении 401 — dispatch 'github-api-unauthorized'
//     (github-auth.js слушает и разлогинивает пользователя).

(function() {
    'use strict';

    const NC = (typeof window !== 'undefined' && window.NeonConfig) || {};
    const CONFIG = {
        REPO_OWNER: NC.REPO_OWNER || 'NeonShadowYT',
        REPO_NAME: NC.REPO_NAME || 'NeonImperium'
    };

    const BASE_URL = 'https://api.github.com';
    const DEFAULT_RETRIES = 3;
    const RETRY_BASE_DELAY = 1000;
    const MAX_RETRY_DELAY = 30000;
    const REQUEST_TIMEOUT = 15000;
    const API_CACHE_TTL = NC.API_CACHE_TTL || 5 * 60 * 1000;

    const MAX_INFLIGHT = 50;
    const inflightRequests = new Map();

    // ---- Cache helpers ----

    function invalidateCache(prefix) {
        const cache = window.ApiCache;
        if (!cache || typeof cache.cacheRemoveByPrefix !== 'function') return;
        try { cache.cacheRemoveByPrefix(prefix); } catch (e) { /* noop */ }
    }

    async function readCacheEntry(key) {
        const cache = window.ApiCache;
        if (!cache || typeof cache.cacheGet !== 'function') return null;
        try {
            const value = await cache.cacheGet(key, API_CACHE_TTL);
            if (value === undefined || value === null) return null;
            if (value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) {
                return { data: value.data, etag: value.etag || null };
            }
            return { data: value, etag: null };
        } catch { return null; }
    }

    async function writeCacheEntry(key, data, etag) {
        const cache = window.ApiCache;
        if (!cache || typeof cache.cacheSet !== 'function') return;
        try {
            await cache.cacheSet(key, { data, etag: etag || null });
        } catch (e) { /* noop */ }
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function buildError(message, status, body) {
        const err = new Error(message || 'Request failed');
        if (status) err.status = status;
        if (body) err.body = body;
        return err;
    }

    /**
     * Уведомляет UI о 401 от GitHub API.
     * github-auth.js слушает событие и вызывает handleApiUnauthorized().
     */
    function notifyUnauthorized() {
        try {
            window.dispatchEvent(new CustomEvent('github-api-unauthorized'));
        } catch (e) { /* noop */ }
    }

    // ============================================================
    // GitHubClient
    // ============================================================

    class GitHubClient {
        constructor(token = null) {
            this.token = token;
        }

        setToken(token) {
            this.token = token;
            invalidateCache(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}`);
            console.log('[GitHubClient] Токен обновлён, кеш API очищен');
        }

        getToken() {
            if (this.token) return this.token;
            try {
                const s = sessionStorage.getItem('github_token');
                if (s) return s;
            } catch { /* noop */ }
            return null;
        }

        async request(endpoint, options = {}, retries = DEFAULT_RETRIES) {
            const result = await this._performRequest(endpoint, options, retries);
            return result.data;
        }

        async requestWithETag(endpoint, options = {}, retries = DEFAULT_RETRIES) {
            return this._performRequest(endpoint, options, retries);
        }

        async _performRequest(endpoint, options, retries) {
            const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
            const method = (options.method || 'GET').toUpperCase();
            const isGet = method === 'GET';
            const hasSignal = !!options.signal;
            const hasIfNoneMatch = !!options.ifNoneMatch;

            const canDedupe = isGet && !hasSignal && !hasIfNoneMatch;
            const inflightKey = canDedupe ? `${method}:${url}` : null;

            if (canDedupe && inflightRequests.has(inflightKey)) {
                return inflightRequests.get(inflightKey);
            }

            const promise = this._doRequestWithMeta(url, options, retries);

            if (!canDedupe) {
                return promise;
            }

            if (inflightRequests.size >= MAX_INFLIGHT) {
                const firstKey = inflightRequests.keys().next().value;
                if (firstKey !== undefined) inflightRequests.delete(firstKey);
            }

            inflightRequests.set(inflightKey, promise);

            try {
                return await promise;
            } finally {
                inflightRequests.delete(inflightKey);
            }
        }

        async _doRequestWithMeta(url, options, retries) {
            const token = this.getToken();
            if (!token) throw buildError('No GitHub token provided', 401);

            const headers = Object.assign(
                { 'Accept': 'application/vnd.github.v3+json' },
                options.headers || {}
            );
            headers['Authorization'] = `Bearer ${token}`;

            if (options.ifNoneMatch) {
                headers['If-None-Match'] = options.ifNoneMatch;
            }

            let lastError;

            for (let attempt = 0; attempt <= retries; attempt++) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    try { controller.abort(new Error('timeout')); }
                    catch { controller.abort(); }
                }, options.timeout || REQUEST_TIMEOUT);

                let externalAbortHandler = null;
                if (options.signal) {
                    if (options.signal.aborted) {
                        clearTimeout(timeoutId);
                        throw buildError('Aborted', 0);
                    }
                    externalAbortHandler = () => {
                        try { controller.abort(); } catch { /* noop */ }
                    };
                    options.signal.addEventListener('abort', externalAbortHandler, { once: true });
                }

                try {
                    const response = await fetch(url, Object.assign({}, options, {
                        headers,
                        signal: controller.signal
                    }));
                    clearTimeout(timeoutId);
                    if (externalAbortHandler && options.signal) {
                        options.signal.removeEventListener('abort', externalAbortHandler);
                    }

                    if (response.status === 304) {
                        return {
                            data: null,
                            etag: options.ifNoneMatch || null,
                            notModified: true
                        };
                    }

                    if (response.status === 401) {
                        // Токен невалиден — уведомляем UI.
                        notifyUnauthorized();
                        let errorMsg = 'Unauthorized';
                        let errorBody = null;
                        try {
                            errorBody = await response.json();
                            if (errorBody && errorBody.message) errorMsg = errorBody.message;
                        } catch { /* noop */ }
                        throw buildError(errorMsg, 401, errorBody);
                    }

                    if (response.ok) {
                        if (response.status === 204) {
                            return { data: null, etag: null, notModified: false };
                        }
                        const data = await response.json();
                        const etag = response.headers.get('ETag') || null;
                        return { data, etag, notModified: false };
                    }

                    if (response.status >= 500 || response.status === 429) {
                        lastError = buildError(`HTTP ${response.status}`, response.status);
                        if (attempt < retries) {
                            const backoff = Math.min(
                                RETRY_BASE_DELAY * Math.pow(2, attempt),
                                MAX_RETRY_DELAY
                            );
                            const jitter = Math.floor(Math.random() * 500);
                            await delay(backoff + jitter);
                            continue;
                        }
                        throw lastError;
                    }

                    let errorMsg = `HTTP ${response.status}`;
                    let errorBody = null;
                    try {
                        errorBody = await response.json();
                        if (errorBody && errorBody.message) errorMsg = errorBody.message;
                    } catch { /* noop */ }
                    throw buildError(errorMsg, response.status, errorBody);
                } catch (err) {
                    clearTimeout(timeoutId);
                    if (externalAbortHandler && options.signal) {
                        options.signal.removeEventListener('abort', externalAbortHandler);
                    }

                    if (err.name === 'AbortError' || err.message === 'timeout') {
                        lastError = buildError('Request timeout', 0);
                    } else if (err.status) {
                        if (err.status !== 429 && err.status < 500) throw err;
                        lastError = err;
                    } else {
                        lastError = err;
                    }

                    if (attempt >= retries) break;

                    const backoff = Math.min(
                        RETRY_BASE_DELAY * Math.pow(2, attempt),
                        MAX_RETRY_DELAY
                    );
                    await delay(backoff);
                }
            }

            throw lastError || buildError('Request failed');
        }

        get issues() { return new IssuesAPI(this); }
        get reactions() { return new ReactionsAPI(this); }
        get comments() { return new CommentsAPI(this); }
    }

    // ============================================================
    // Issues API
    // ============================================================

    class IssuesAPI {
        constructor(client) { this.client = client; }

        _basePath() {
            return `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues`;
        }

        async load({ labels = '', state = 'open', per_page = 20, page = 1, signal } = {}) {
            const query = new URLSearchParams({ state, per_page, page, labels }).toString();
            const url = `${this._basePath()}?${query}`;
            const cacheKey = `gh_api_${url}`;

            const cached = await readCacheEntry(cacheKey);
            if (cached && !(signal && signal.aborted)) {
                this.client.requestWithETag(url, {
                    signal: AbortSignal.timeout(5000),
                    ifNoneMatch: cached.etag
                }).then(result => {
                    if (!result.notModified) {
                        writeCacheEntry(cacheKey, result.data, result.etag);
                    }
                }).catch(() => {});
                return cached.data;
            }

            const result = await this.client.requestWithETag(url, { signal });
            await writeCacheEntry(cacheKey, result.data, result.etag);
            return result.data;
        }

        async loadOne(issueNumber, signal) {
            const url = `${this._basePath()}/${issueNumber}`;
            const cacheKey = `gh_api_${url}`;

            const cached = await readCacheEntry(cacheKey);
            if (cached && !(signal && signal.aborted)) {
                this.client.requestWithETag(url, {
                    signal: AbortSignal.timeout(5000),
                    ifNoneMatch: cached.etag
                }).then(result => {
                    if (!result.notModified) {
                        writeCacheEntry(cacheKey, result.data, result.etag);
                    }
                }).catch(() => {});
                return cached.data;
            }

            const result = await this.client.requestWithETag(url, { signal });
            await writeCacheEntry(cacheKey, result.data, result.etag);
            return result.data;
        }

        async create(title, body, labels) {
            const url = this._basePath();
            const data = await this.client.request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, body, labels })
            });
            this._invalidateListCache();
            window.dispatchEvent(new CustomEvent('github-issue-created', { detail: data }));
            return data;
        }

        async update(issueNumber, updates) {
            const url = `${this._basePath()}/${issueNumber}`;
            const data = await this.client.request(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            this._invalidateCache(issueNumber);
            return data;
        }

        async close(issueNumber) {
            return this.update(issueNumber, { state: 'closed' });
        }

        _invalidateCache(issueNumber) {
            invalidateCache(
                `gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}`
            );
        }

        _invalidateListCache() {
            invalidateCache(
                `gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?`
            );
        }
    }

    // ============================================================
    // Reactions API
    // ============================================================

    class ReactionsAPI {
        constructor(client) { this.client = client; }

        _basePath(issueNumber) {
            return `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`;
        }

        async load(issueNumber, signal) {
            const url = this._basePath(issueNumber);
            const cacheKey = `gh_api_${url}`;

            const cached = await readCacheEntry(cacheKey);
            if (cached && !(signal && signal.aborted)) {
                this.client.requestWithETag(url, {
                    signal: AbortSignal.timeout(5000),
                    ifNoneMatch: cached.etag
                }).then(result => {
                    if (!result.notModified) {
                        writeCacheEntry(cacheKey, result.data, result.etag);
                    }
                }).catch(() => {});
                return cached.data;
            }

            const result = await this.client.requestWithETag(url, { signal });
            await writeCacheEntry(cacheKey, result.data, result.etag);
            return result.data;
        }

        async add(issueNumber, content) {
            const url = this._basePath(issueNumber);
            const data = await this.client.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.squirrel-girl-preview+json'
                },
                body: JSON.stringify({ content })
            });
            invalidateCache(url);
            return data;
        }

        async remove(issueNumber, reactionId) {
            const url = `${this._basePath(issueNumber)}/${reactionId}`;
            await this.client.request(url, { method: 'DELETE' });
            invalidateCache(this._basePath(issueNumber));
        }
    }

    // ============================================================
    // Comments API
    // ============================================================

    class CommentsAPI {
        constructor(client) { this.client = client; }

        _basePath(issueNumber) {
            return `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`;
        }

        async load(issueNumber, signal) {
            const url = this._basePath(issueNumber);
            const cacheKey = `gh_api_${url}`;

            const cached = await readCacheEntry(cacheKey);
            if (cached && !(signal && signal.aborted)) {
                this.client.requestWithETag(url, {
                    signal: AbortSignal.timeout(5000),
                    ifNoneMatch: cached.etag
                }).then(result => {
                    if (!result.notModified) {
                        writeCacheEntry(cacheKey, result.data, result.etag);
                    }
                }).catch(() => {});
                return cached.data;
            }

            const result = await this.client.requestWithETag(url, { signal });
            await writeCacheEntry(cacheKey, result.data, result.etag);
            return result.data;
        }

        async add(issueNumber, body) {
            const url = this._basePath(issueNumber);
            const data = await this.client.request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body })
            });
            invalidateCache(this._basePath(issueNumber));
            return data;
        }

        async update(commentId, body) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/comments/${commentId}`;
            const data = await this.client.request(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body })
            });
            invalidateCache(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/`);
            return data;
        }

        async delete(commentId) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/comments/${commentId}`;
            await this.client.request(url, { method: 'DELETE' });
            invalidateCache(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/`);
        }
    }

    // ============================================================
    // Singleton
    // ============================================================

    let clientInstance = null;

    function getClient() {
        if (!clientInstance) {
            clientInstance = new GitHubClient();
        }
        return clientInstance;
    }

    function updateToken(token) {
        getClient().setToken(token);
    }

    window.GitHubClient = GitHubClient;
    window.GitHubAPIClient = {
        getClient,
        updateToken,
        request: (...args) => getClient().request(...args),
        requestWithETag: (...args) => getClient().requestWithETag(...args),
        issues: () => getClient().issues,
        reactions: () => getClient().reactions,
        comments: () => getClient().comments
    };
})();