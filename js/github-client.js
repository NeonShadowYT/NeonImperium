// js/github-client.js – универсальный клиент GitHub API с ретраями, кэшированием и аутентификацией
// cacheGet/cacheSet теперь асинхронные (шифрование через CacheCrypto).
(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, createAbortable, debounce } = window.Utils;

    const BASE_URL = 'https://api.github.com';
    const DEFAULT_RETRIES = 3;
    const RETRY_DELAY = 1000;
    const CONFIG = window.GithubCore?.CONFIG || { REPO_OWNER: 'NeonShadowYT', REPO_NAME: 'NeonImperium' };

    class GitHubClient {
        constructor(token = null) {
            this.token = token;
        }

        setToken(token) {
            this.token = token;
            window.GithubCore?.cacheRemoveByPrefix('gh_api_/repos/');
            console.log('[GitHubClient] Токен обновлён, кеш API очищен');
        }

        getToken() {
            if (this.token) return this.token;
            const sessionToken = sessionStorage.getItem('github_token');
            if (sessionToken) return sessionToken;
            const localToken = localStorage.getItem('github_token');
            if (localToken) return localToken;
            return null;
        }

        async request(endpoint, options = {}, retries = DEFAULT_RETRIES) {
            const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
            const token = this.getToken();
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                ...options.headers
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            } else {
                throw new Error('No GitHub token provided');
            }

            let lastError;
            for (let attempt = 0; attempt <= retries; attempt++) {
                const { controller, timeoutId } = createAbortable(options.timeout || 15000);
                try {
                    const response = await fetch(url, {
                        ...options,
                        headers,
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);

                    if (response.ok) {
                        if (response.status === 204) return null;
                        return await response.json();
                    }

                    if (response.status >= 500 || response.status === 429) {
                        lastError = new Error(`HTTP ${response.status}`);
                        const delay = RETRY_DELAY * Math.pow(2, attempt);
                        await new Promise(r => setTimeout(r, delay));
                        continue;
                    }

                    let errorMsg = `HTTP ${response.status}`;
                    try {
                        const errorData = await response.json();
                        errorMsg = errorData.message || errorMsg;
                    } catch {}
                    throw new Error(errorMsg);
                } catch (err) {
                    if (err.name === 'AbortError') {
                        lastError = new Error('Request timeout');
                    } else {
                        lastError = err;
                    }
                    if (attempt === retries) break;
                    const delay = RETRY_DELAY * Math.pow(2, attempt);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
            throw lastError || new Error('Request failed');
        }

        get issues() { return new IssuesAPI(this); }
        get reactions() { return new ReactionsAPI(this); }
        get comments() { return new CommentsAPI(this); }
    }

    // ------ Issues API ------
    class IssuesAPI {
        constructor(client) { this.client = client; }

        async load({ labels = '', state = 'open', per_page = 20, page = 1, signal } = {}) {
            const query = new URLSearchParams({ state, per_page, page, labels }).toString();
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?${query}`;
            const cacheKey = `gh_api_${url}`;
            const cached = await cacheGet(cacheKey);
            if (cached && !signal?.aborted) {
                // Фоновое обновление
                this.client.request(url, { signal: AbortSignal.timeout(5000) })
                    .then(data => cacheSet(cacheKey, data))
                    .catch(() => {});
                return cached;
            }
            const data = await this.client.request(url, { signal });
            await cacheSet(cacheKey, data);
            return data;
        }

        async loadOne(issueNumber, signal) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}`;
            const cacheKey = `gh_api_${url}`;
            const cached = await cacheGet(cacheKey);
            if (cached && !signal?.aborted) {
                this.client.request(url, { signal: AbortSignal.timeout(5000) })
                    .then(data => cacheSet(cacheKey, data))
                    .catch(() => {});
                return cached;
            }
            const data = await this.client.request(url, { signal });
            await cacheSet(cacheKey, data);
            return data;
        }

        async create(title, body, labels) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues`;
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
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}`;
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
            cacheRemoveByPrefix(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}`);
        }

        _invalidateListCache() {
            cacheRemoveByPrefix(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?`);
        }
    }

    // ------ Reactions API ------
    class ReactionsAPI {
        constructor(client) { this.client = client; }

        async load(issueNumber, signal) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`;
            const cacheKey = `gh_api_${url}`;
            const cached = await cacheGet(cacheKey);
            if (cached && !signal?.aborted) {
                this.client.request(url, { signal: AbortSignal.timeout(5000) })
                    .then(data => cacheSet(cacheKey, data))
                    .catch(() => {});
                return cached;
            }
            const data = await this.client.request(url, { signal });
            await cacheSet(cacheKey, data);
            return data;
        }

        async add(issueNumber, content) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`;
            const data = await this.client.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.squirrel-girl-preview+json'
                },
                body: JSON.stringify({ content })
            });
            cacheRemoveByPrefix(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`);
            return data;
        }

        async remove(issueNumber, reactionId) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions/${reactionId}`;
            await this.client.request(url, { method: 'DELETE' });
            cacheRemoveByPrefix(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`);
        }
    }

    // ------ Comments API ------
    class CommentsAPI {
        constructor(client) { this.client = client; }

        async load(issueNumber, signal) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`;
            const cacheKey = `gh_api_${url}`;
            const cached = await cacheGet(cacheKey);
            if (cached && !signal?.aborted) {
                this.client.request(url, { signal: AbortSignal.timeout(5000) })
                    .then(data => cacheSet(cacheKey, data))
                    .catch(() => {});
                return cached;
            }
            const data = await this.client.request(url, { signal });
            await cacheSet(cacheKey, data);
            return data;
        }

        async add(issueNumber, body) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`;
            const data = await this.client.request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body })
            });
            cacheRemoveByPrefix(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`);
            return data;
        }

        async update(commentId, body) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/comments/${commentId}`;
            const data = await this.client.request(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body })
            });
            cacheRemoveByPrefix(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/`);
            return data;
        }

        async delete(commentId) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/comments/${commentId}`;
            await this.client.request(url, { method: 'DELETE' });
            cacheRemoveByPrefix(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/`);
        }
    }

    let clientInstance = null;

    function getClient() {
        if (!clientInstance) {
            clientInstance = new GitHubClient();
        }
        return clientInstance;
    }

    function updateToken(token) {
        const client = getClient();
        client.setToken(token);
    }

    window.GitHubClient = GitHubClient;
    window.GitHubAPIClient = {
        getClient,
        updateToken,
        request: (...args) => getClient().request(...args),
        issues: () => getClient().issues,
        reactions: () => getClient().reactions,
        comments: () => getClient().comments
    };
})();