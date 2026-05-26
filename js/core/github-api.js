// js/core/github-api.js – обёртка для совместимости со старым кодом
(function() {
    const client = window.GitHubAPIClient;

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

    window.GithubAPI = {
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