// js/core/github-api.js — GitHub REST API с кэшированием и фоновым обновлением
(function() {
    const { CONFIG, cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix, createAbortable } = GithubCore;
    const TOKEN_KEY = 'github_token';

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    async function githubFetch(url, options = {}) {
        const token = getToken();
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            ...options.headers
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch(url, { ...options, headers });
        if (!response.ok) {
            let errorMsg = `HTTP ${response.status}`;
            try {
                const errorData = await response.json();
                errorMsg = errorData.message || errorMsg;
            } catch {}
            throw new Error(errorMsg);
        }
        return response;
    }

    function cacheKeyForUrl(url, params = {}) {
        const query = new URLSearchParams(params).toString();
        return `gh_api_${url}${query ? '?' + query : ''}`;
    }

    function invalidateRelated(prefix) {
        cacheRemoveByPrefix(prefix);
    }

    const pendingRequests = new Map();

    function getOrCreatePromise(key, factory, ttlKey = null) {
        if (pendingRequests.has(key)) return pendingRequests.get(key);
        const promise = factory().then(result => {
            if (ttlKey) cacheSet(key, result);
            return result;
        }).finally(() => {
            pendingRequests.delete(key);
        });
        pendingRequests.set(key, promise);
        return promise;
    }

    async function loadIssues({ labels = '', state = 'open', per_page = 20, page = 1, signal } = {}) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?state=${state}&per_page=${per_page}&page=${page}&labels=${encodeURIComponent(labels)}`;
        const cacheKey = cacheKeyForUrl(url, { state, per_page, page, labels });
        const cached = cacheGet(cacheKey);
        if (cached && !signal?.aborted) {
            fetch(url, {
                headers: { 'Authorization': `Bearer ${getToken()}` },
                signal: AbortSignal.timeout(8000)
            }).then(r => r.json()).then(data => cacheSet(cacheKey, data)).catch(() => {});
            return cached;
        }
        return getOrCreatePromise(cacheKey, async () => {
            const response = await githubFetch(url, { signal });
            return response.json();
        }, cacheKey);
    }

    async function loadIssue(issueNumber, signal) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}`;
        const cacheKey = cacheKeyForUrl(url);
        const cached = cacheGet(cacheKey);
        if (cached && !signal?.aborted) {
            fetch(url, {
                headers: { 'Authorization': `Bearer ${getToken()}` },
                signal: AbortSignal.timeout(5000)
            }).then(r => r.json()).then(data => cacheSet(cacheKey, data)).catch(() => {});
            return cached;
        }
        return getOrCreatePromise(cacheKey, async () => {
            const response = await githubFetch(url, { signal });
            const data = await response.json();
            cacheSet(cacheKey, data);
            return data;
        }, cacheKey);
    }

    async function createIssue(title, body, labels) {
        // Ensure labels is an array
        if (!Array.isArray(labels)) {
            console.warn('[createIssue] labels is not an array, converting', labels);
            labels = labels ? [labels] : [];
        }
        console.log('[createIssue] Sending labels:', labels);
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues`;
        const response = await githubFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, labels })
        });
        const issue = await response.json();
        invalidateRelated(`gh_api_https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues`);
        window.dispatchEvent(new CustomEvent('github-issue-created', { detail: issue }));
        return issue;
    }

    async function updateIssue(issueNumber, data) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}`;
        const response = await githubFetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        invalidateRelated(`gh_api_${url}`);
        return result;
    }

    async function closeIssue(issueNumber) {
        return updateIssue(issueNumber, { state: 'closed' });
    }

    async function loadComments(issueNumber, signal) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`;
        const cacheKey = cacheKeyForUrl(url);
        const cached = cacheGet(cacheKey);
        if (cached && !signal?.aborted) {
            fetch(url, {
                headers: { 'Authorization': `Bearer ${getToken()}` },
                signal: AbortSignal.timeout(8000)
            }).then(r => r.json()).then(data => cacheSet(cacheKey, data)).catch(() => {});
            return cached;
        }
        return getOrCreatePromise(cacheKey, async () => {
            const response = await githubFetch(url, { signal });
            const data = await response.json();
            cacheSet(cacheKey, data);
            return data;
        }, cacheKey);
    }

    async function addComment(issueNumber, body) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`;
        const response = await githubFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body })
        });
        const result = await response.json();
        invalidateRelated(`gh_api_https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`);
        return result;
    }

    async function updateComment(commentId, body) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/comments/${commentId}`;
        const response = await githubFetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body })
        });
        return response.json();
    }

    async function deleteComment(commentId) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/comments/${commentId}`;
        await githubFetch(url, { method: 'DELETE' });
        invalidateRelated('gh_api_https://api.github.com/repos/');
    }

    async function loadReactions(issueNumber, signal) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`;
        const cacheKey = cacheKeyForUrl(url);
        const cached = cacheGet(cacheKey);
        if (cached && !signal?.aborted) {
            fetch(url, {
                headers: { 'Authorization': `Bearer ${getToken()}` },
                signal: AbortSignal.timeout(8000)
            }).then(r => r.json()).then(data => cacheSet(cacheKey, data)).catch(() => {});
            return cached;
        }
        return getOrCreatePromise(cacheKey, async () => {
            const response = await githubFetch(url, { signal });
            const data = await response.json();
            cacheSet(cacheKey, data);
            return data;
        }, cacheKey);
    }

    async function addReaction(issueNumber, content) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`;
        const response = await githubFetch(url, {
            method: 'POST',
            headers: { 'Accept': 'application/vnd.github.squirrel-girl-preview+json' },
            body: JSON.stringify({ content })
        });
        const result = await response.json();
        invalidateRelated(`gh_api_https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`);
        return result;
    }

    async function removeReaction(issueNumber, reactionId) {
        const id = parseInt(reactionId, 10);
        if (isNaN(id)) throw new Error('Invalid reaction ID');
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions/${id}`;
        await githubFetch(url, { method: 'DELETE' });
        invalidateRelated(`gh_api_https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`);
    }

    window.GithubAPI = {
        getToken,
        fetch: githubFetch,
        loadIssues, loadIssue, createIssue, updateIssue, closeIssue,
        loadComments, addComment, updateComment, deleteComment,
        loadReactions, addReaction, removeReaction
    };
})();