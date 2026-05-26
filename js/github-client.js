// js/github-client.js – универсальный клиент GitHub API с ретраями, кэшированием и обработкой 304
(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, createAbortable } = window.Utils;

    const BASE_URL = 'https://api.github.com';
    const DEFAULT_RETRIES = 2;
    const RETRY_DELAY = 1000;
    const CONFIG = window.GithubCore?.CONFIG || { REPO_OWNER: 'NeonShadowYT', REPO_NAME: 'NeonImperium' };

    class GitHubClient {
        constructor(token = null) {
            this.token = token;
        }

        setToken(token) {
            this.token = token;
        }

        getToken() {
            return this.token || localStorage.getItem('github_token');
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

                    // Обработка 304 Not Modified – возвращаем null, чтобы вызвающий код использовал кэш
                    if (response.status === 304) {
                        return null;
                    }

                    if (response.ok) {
                        // Для DELETE и других без тела
                        if (response.status === 204) return null;
                        const data = await response.json();
                        return data;
                    }

                    // Ошибки, которые можно повторить
                    if (response.status >= 500 || response.status === 429) {
                        lastError = new Error(`HTTP ${response.status}`);
                        const delay = RETRY_DELAY * Math.pow(2, attempt);
                        await new Promise(r => setTimeout(r, delay));
                        continue;
                    }

                    // Клиентские ошибки – не повторяем
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
    }

    // ------ Issues API ------
    class IssuesAPI {
        constructor(client) {
            this.client = client;
        }

        async load({ labels = '', state = 'open', per_page = 20, page = 1, signal } = {}) {
            const query = new URLSearchParams({ state, per_page, page, labels }).toString();
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?${query}`;
            const cacheKey = `gh_api_${url}`;
            const cached = cacheGet(cacheKey);
            
            try {
                const data = await this.client.request(url, { signal });
                if (data !== null) {
                    cacheSet(cacheKey, data);
                    return data;
                }
                // Если 304 и есть кэш – возвращаем кэш
                if (cached) return cached;
                return [];
            } catch (err) {
                if (cached) return cached;
                throw err;
            }
        }

        async loadOne(issueNumber, signal) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}`;
            const cacheKey = `gh_api_${url}`;
            const cached = cacheGet(cacheKey);
            try {
                const data = await this.client.request(url, { signal });
                if (data !== null) {
                    cacheSet(cacheKey, data);
                    return data;
                }
                if (cached) return cached;
                throw new Error('Issue not found');
            } catch (err) {
                if (cached) return cached;
                throw err;
            }
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
        constructor(client) {
            this.client = client;
        }

        async load(issueNumber, signal) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`;
            const cacheKey = `gh_api_${url}`;
            const cached = cacheGet(cacheKey);
            try {
                const data = await this.client.request(url, { signal });
                if (data !== null) {
                    cacheSet(cacheKey, data);
                    return data;
                }
                if (cached) return cached;
                return [];
            } catch (err) {
                if (cached) return cached;
                throw err;
            }
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
        constructor(client) {
            this.client = client;
        }

        async load(issueNumber, signal) {
            const url = `/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`;
            const cacheKey = `gh_api_${url}`;
            const cached = cacheGet(cacheKey);
            try {
                const data = await this.client.request(url, { signal });
                if (data !== null) {
                    cacheSet(cacheKey, data);
                    return data;
                }
                if (cached) return cached;
                return [];
            } catch (err) {
                if (cached) return cached;
                throw err;
            }
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