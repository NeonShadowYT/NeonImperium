// js/core/github-api.js — работа с GitHub REST API (с кешированием)
(function() {
    const { CONFIG, fetchCached } = GithubCore;

    function getToken() {
        return localStorage.getItem('github_token');
    }

    // обёртка для запросов, не кешируем мутирующие методы
    async function githubFetch(url, options = {}, cacheOpts = {}) {
        const token = getToken();
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            ...options.headers
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const fetchOptions = { ...options, headers };

        // для мутирующих методов (POST/PATCH/DELETE) кеш не используем
        if (fetchOptions.method && fetchOptions.method.toUpperCase() !== 'GET') {
            const response = await fetch(url, fetchOptions);
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

        // GET‑запросы обслуживаются через fetchCached (TTL по умолчанию 60с)
        return fetchCached(url, fetchOptions, { cacheKey: url, ttl: cacheOpts.ttl });
    }

    async function loadIssues({ labels = '', state = 'open', per_page = 20, page = 1, signal } = {}) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?state=${state}&per_page=${per_page}&page=${page}&labels=${encodeURIComponent(labels)}`;
        const response = await githubFetch(url, { signal }, { ttl: 30000 }); // 30 сек
        return response.json();
    }

    async function loadIssue(issueNumber, signal) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}`;
        const response = await githubFetch(url, { signal }, { ttl: 30000 });
        return response.json();
    }

    async function createIssue(title, body, labels) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues`;
        const response = await githubFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, labels })
        });
        const issue = await response.json();
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
        return response.json();
    }

    async function closeIssue(issueNumber) {
        return updateIssue(issueNumber, { state: 'closed' });
    }

    async function loadComments(issueNumber, signal) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`;
        const response = await githubFetch(url, { signal }, { ttl: 30000 });
        return response.json();
    }

    async function addComment(issueNumber, body) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`;
        const response = await githubFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body })
        });
        return response.json();
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
    }

    async function loadReactions(issueNumber, signal) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`;
        const response = await githubFetch(url, { signal }, { ttl: 15000 }); // реакции меняются чаще
        return response.json();
    }

    async function addReaction(issueNumber, content) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`;
        const response = await githubFetch(url, {
            method: 'POST',
            headers: { 'Accept': 'application/vnd.github.squirrel-girl-preview+json' },
            body: JSON.stringify({ content })
        });
        return response.json();
    }

    async function removeReaction(issueNumber, reactionId) {
        const id = parseInt(reactionId, 10);
        if (isNaN(id)) throw new Error('Invalid reaction ID');
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions/${id}`;
        await githubFetch(url, { method: 'DELETE' });
    }

    window.GithubAPI = {
        getToken,
        fetch: githubFetch,
        loadIssues, loadIssue, createIssue, updateIssue, closeIssue,
        loadComments, addComment, updateComment, deleteComment,
        loadReactions, addReaction, removeReaction
    };
})();