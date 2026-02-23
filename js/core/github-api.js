(function() {
    const { CONFIG } = GithubCore;

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
        
        const response = await fetch(url, { ...options, headers });
        if (!response.ok) {
            let errorMsg = `HTTP ${response.status}`;
            try {
                const errorData = await response.json();
                errorMsg = errorData.message || errorMsg;
            } catch {
            }
            throw new Error(errorMsg);
        }
        return response;
    }

    async function loadIssues({ labels = '', state = 'open', per_page = 20, page = 1, signal } = {}) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?state=${state}&per_page=${per_page}&page=${page}&labels=${encodeURIComponent(labels)}`;
        const response = await githubFetch(url, { signal });
        return response.json();
    }

    async function loadIssue(issueNumber, signal) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}`;
        const response = await githubFetch(url, { signal });
        return response.json();
    }

    async function createIssue(title, body, labels) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues`;
        const response = await githubFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, labels })
        });
        return response.json();
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
        const response = await githubFetch(url, { signal });
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

    async function deleteComment(commentId) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/comments/${commentId}`;
        await githubFetch(url, { method: 'DELETE' });
    }

    async function loadReactions(issueNumber, signal) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`;
        const response = await githubFetch(url, { signal });
        return response.json();
    }

    async function addReaction(issueNumber, content) {
        const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/reactions`;
        const response = await githubFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' },
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
        loadIssues,
        loadIssue,
        createIssue,
        updateIssue,
        closeIssue,
        loadComments,
        addComment,
        deleteComment,  // добавлено
        loadReactions,
        addReaction,
        removeReaction
    };
})();