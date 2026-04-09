// js/core/api.js
(function() {
    const { cacheGet, cacheSet, fetchWithTimeout, deduplicateByNumber } = NeonUtils;

    function getToken() {
        return localStorage.getItem('github_token');
    }

    async function githubFetch(url, options = {}) {
        const token = getToken();
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            ...options.headers
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetchWithTimeout(url, { ...options, headers }, 15000);
        if (!response.ok) {
            let errorMsg = `HTTP ${response.status}`;
            try {
                const errData = await response.json();
                errorMsg = errData.message || errorMsg;
            } catch (e) {}
            throw new Error(errorMsg);
        }
        return response;
    }

    // ---------- Issues ----------
    async function loadIssues({ labels = '', state = 'open', per_page = 30, page = 1, signal } = {}) {
        const url = `https://api.github.com/repos/${NeonConfig.REPO_OWNER}/${NeonConfig.REPO_NAME}/issues?state=${state}&per_page=${per_page}&page=${page}&labels=${encodeURIComponent(labels)}`;
        const response = await githubFetch(url, { signal });
        return response.json();
    }

    async function loadIssue(issueNumber, signal) {
        const url = `https://api.github.com/repos/${NeonConfig.REPO_OWNER}/${NeonConfig.REPO_NAME}/issues/${issueNumber}`;
        const response = await githubFetch(url, { signal });
        return response.json();
    }

    async function createIssue(title, body, labels) {
        const url = `https://api.github.com/repos/${NeonConfig.REPO_OWNER}/${NeonConfig.REPO_NAME}/issues`;
        const response = await githubFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, labels })
        });
        const issue = await response.json();
        window.dispatchEvent(new CustomEvent('issue-created', { detail: issue }));
        return issue;
    }

    async function updateIssue(issueNumber, data) {
        const url = `https://api.github.com/repos/${NeonConfig.REPO_OWNER}/${NeonConfig.REPO_NAME}/issues/${issueNumber}`;
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

    // ---------- Comments ----------
    async function loadComments(issueNumber, signal) {
        const url = `https://api.github.com/repos/${NeonConfig.REPO_OWNER}/${NeonConfig.REPO_NAME}/issues/${issueNumber}/comments`;
        const response = await githubFetch(url, { signal });
        return response.json();
    }

    async function addComment(issueNumber, body) {
        const url = `https://api.github.com/repos/${NeonConfig.REPO_OWNER}/${NeonConfig.REPO_NAME}/issues/${issueNumber}/comments`;
        const response = await githubFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body })
        });
        return response.json();
    }

    async function updateComment(commentId, body) {
        const url = `https://api.github.com/repos/${NeonConfig.REPO_OWNER}/${NeonConfig.REPO_NAME}/issues/comments/${commentId}`;
        const response = await githubFetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body })
        });
        return response.json();
    }

    async function deleteComment(commentId) {
        const url = `https://api.github.com/repos/${NeonConfig.REPO_OWNER}/${NeonConfig.REPO_NAME}/issues/comments/${commentId}`;
        await githubFetch(url, { method: 'DELETE' });
    }

    // ---------- Reactions ----------
    async function loadReactions(issueNumber, signal) {
        const url = `https://api.github.com/repos/${NeonConfig.REPO_OWNER}/${NeonConfig.REPO_NAME}/issues/${issueNumber}/reactions`;
        const response = await githubFetch(url, { signal });
        return response.json();
    }

    async function addReaction(issueNumber, content) {
        const url = `https://api.github.com/repos/${NeonConfig.REPO_OWNER}/${NeonConfig.REPO_NAME}/issues/${issueNumber}/reactions`;
        const response = await githubFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        return response.json();
    }

    async function removeReaction(issueNumber, reactionId) {
        const id = parseInt(reactionId, 10);
        if (isNaN(id)) throw new Error('Invalid reaction ID');
        const url = `https://api.github.com/repos/${NeonConfig.REPO_OWNER}/${NeonConfig.REPO_NAME}/issues/${issueNumber}/reactions/${id}`;
        await githubFetch(url, { method: 'DELETE' });
    }

    // ---------- Комбинированные загрузки ----------
    async function getAllIssuesByGame(game, types = []) {
        const promises = types.map(t => loadIssues({ labels: `game:${game},type:${t}`, per_page: 30 }));
        const results = await Promise.allSettled(promises);
        let all = [];
        results.forEach(res => {
            if (res.status === 'fulfilled') all = all.concat(res.value);
        });
        return deduplicateByNumber(all);
    }

    // ---------- Пользователь ----------
    async function getCurrentGitHubUser() {
        const token = getToken();
        if (!token) return null;
        try {
            const resp = await githubFetch('https://api.github.com/user');
            return resp.json();
        } catch (e) {
            return null;
        }
    }

    window.NeonAPI = {
        getToken,
        githubFetch,
        loadIssues, loadIssue, createIssue, updateIssue, closeIssue,
        loadComments, addComment, updateComment, deleteComment,
        loadReactions, addReaction, removeReaction,
        getAllIssuesByGame,
        getCurrentGitHubUser
    };
})();