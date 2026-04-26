// js/core/github-api.js — работа с GitHub REST API (с кешированием и инвалидацией)
(function() {
    const { CONFIG, fetchCached, invalidateFetchCache } = GithubCore;

    function getToken() {
        return localStorage.getItem('github_token');
    }

    // обёртка для запросов
    async function githubFetch(url, options = {}, cacheOpts = {}) {
        const token = getToken();
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            ...options.headers
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const fetchOptions = { ...options, headers };

        // для мутирующих методов кеш не используем
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

        return fetchCached(url, fetchOptions, { cacheKey: url, ttl: cacheOpts.ttl });
    }

    // Вспомогательная функция для инвалидации всевозможных представлений issues
    function invalidateIssueCaches(game, type) {
        if (game) {
            cacheRemoveByPrefix(`issues_${game}_page_`);
            invalidateFetchCache(`game:${game}`);
        }
        if (type === 'news' || type === 'update') {
            cacheRemoveByPrefix('posts_news+update_');
            cacheRemoveByPrefix('game_updates_');
            invalidateFetchCache('type:news');
            invalidateFetchCache('type:update');
        }
        // общий сброс для списков issues
        invalidateFetchCache('/issues?');
    }

    async function loadIssues({ labels = '', state = 'open', per_page = 20, page = 1, signal } = {}) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?state=${state}&per_page=${per_page}&page=${page}&labels=${encodeURIComponent(labels)}`;
        const response = await githubFetch(url, { signal }, { ttl: 30000 });
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
        // инвалидируем кеш, связанный с указанными game и type
        const game = issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1];
        const typeLabel = issue.labels.find(l => l.name.startsWith('type:'))?.name.split(':')[1];
        invalidateIssueCaches(game, typeLabel);
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
        const issue = await response.json();
        // инвалидируем кеш для данного issue и связанных списков
        invalidateFetchCache(`/issues/${issueNumber}`);
        if (data.labels) {
            const game = data.labels.find(l => l.startsWith('game:'))?.split(':')[1];
            const typeLabel = data.labels.find(l => l.startsWith('type:'))?.split(':')[1];
            invalidateIssueCaches(game, typeLabel);
        }
        return issue;
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
        const comment = await response.json();
        invalidateFetchCache(`/issues/${issueNumber}/comments`);
        invalidateFetchCache(`/issues/${issueNumber}`); // количество комментариев
        return comment;
    }

    async function updateComment(commentId, body) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/comments/${commentId}`;
        const response = await githubFetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body })
        });
        invalidateFetchCache('/comments');
        return response.json();
    }

    async function deleteComment(commentId) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/comments/${commentId}`;
        await githubFetch(url, { method: 'DELETE' });
        invalidateFetchCache('/comments');
    }

    async function loadReactions(issueNumber, signal) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`;
        const response = await githubFetch(url, { signal }, { ttl: 15000 });
        return response.json();
    }

    async function addReaction(issueNumber, content) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`;
        const response = await githubFetch(url, {
            method: 'POST',
            headers: { 'Accept': 'application/vnd.github.squirrel-girl-preview+json' },
            body: JSON.stringify({ content })
        });
        const reaction = await response.json();
        invalidateFetchCache(`/issues/${issueNumber}/reactions`);
        return reaction;
    }

    async function removeReaction(issueNumber, reactionId) {
        const id = parseInt(reactionId, 10);
        if (isNaN(id)) throw new Error('Invalid reaction ID');
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions/${id}`;
        await githubFetch(url, { method: 'DELETE' });
        invalidateFetchCache(`/issues/${issueNumber}/reactions`);
    }

    // экспорт
    window.GithubAPI = {
        getToken,
        fetch: githubFetch,
        loadIssues, loadIssue, createIssue, updateIssue, closeIssue,
        loadComments, addComment, updateComment, deleteComment,
        loadReactions, addReaction, removeReaction
    };
})();