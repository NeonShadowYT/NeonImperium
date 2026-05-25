// js/core/github-api.js – обёртка для совместимости со старым кодом
// Использует GitHubClient из github-client.js
(function() {
    const client = window.GitHubAPIClient;

    // Получение токена (для обратной совместимости)
    function getToken() {
        return localStorage.getItem('github_token');
    }

    // Обёртки для удобства вызова (сохраняем старые имена функций)
    async function loadIssues(params) {
        return client.issues().load(params);
    }

    async function loadIssue(issueNumber, signal) {
        return client.issues().loadOne(issueNumber, signal);
    }

    async function createIssue(title, body, labels) {
        return client.issues().create(title, body, labels);
    }

    async function updateIssue(issueNumber, updates) {
        return client.issues().update(issueNumber, updates);
    }

    async function closeIssue(issueNumber) {
        return client.issues().close(issueNumber);
    }

    async function loadComments(issueNumber, signal) {
        return client.comments().load(issueNumber, signal);
    }

    async function addComment(issueNumber, body) {
        return client.comments().add(issueNumber, body);
    }

    async function updateComment(commentId, body) {
        return client.comments().update(commentId, body);
    }

    async function deleteComment(commentId) {
        return client.comments().delete(commentId);
    }

    async function loadReactions(issueNumber, signal) {
        return client.reactions().load(issueNumber, signal);
    }

    async function addReaction(issueNumber, content) {
        return client.reactions().add(issueNumber, content);
    }

    async function removeReaction(issueNumber, reactionId) {
        return client.reactions().remove(issueNumber, reactionId);
    }

    // Прямой fetch (для обратной совместимости)
    async function githubFetch(url, options = {}) {
        return client.request(url, options);
    }

    // Экспорт в window.GithubAPI
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
        updateComment,
        deleteComment,
        loadReactions,
        addReaction,
        removeReaction
    };
})();