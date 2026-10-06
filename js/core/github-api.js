// js/core/github-api.js
// Тонкая обёртка над window.GitHubAPIClient.
// Сохраняет старые имена методов (loadIssues, addComment и т.д.) для обратной совместимости.
// НЕ содержит собственной логики — только делегирует.

(function() {
    'use strict';

    function getClient() {
        if (!window.GitHubAPIClient) {
            console.error('[GithubAPI] GitHubAPIClient не загружен. Проверьте порядок скриптов.');
            return null;
        }
        return window.GitHubAPIClient;
    }

    function getToken() {
        try { return sessionStorage.getItem('github_token'); }
        catch { return null; }
    }

    async function loadIssues(params) {
        const c = getClient();
        if (!c) return [];
        return c.issues().load(params);
    }

    async function loadIssue(issueNumber, signal) {
        const c = getClient();
        if (!c) return null;
        return c.issues().loadOne(issueNumber, signal);
    }

    async function createIssue(title, body, labels) {
        const c = getClient();
        if (!c) throw new Error('GitHubAPIClient not loaded');
        return c.issues().create(title, body, labels);
    }

    async function updateIssue(issueNumber, updates) {
        const c = getClient();
        if (!c) throw new Error('GitHubAPIClient not loaded');
        return c.issues().update(issueNumber, updates);
    }

    async function closeIssue(issueNumber) {
        const c = getClient();
        if (!c) throw new Error('GitHubAPIClient not loaded');
        return c.issues().close(issueNumber);
    }

    async function loadComments(issueNumber, signal) {
        const c = getClient();
        if (!c) return [];
        return c.comments().load(issueNumber, signal);
    }

    async function addComment(issueNumber, body) {
        const c = getClient();
        if (!c) throw new Error('GitHubAPIClient not loaded');
        return c.comments().add(issueNumber, body);
    }

    async function updateComment(commentId, body) {
        const c = getClient();
        if (!c) throw new Error('GitHubAPIClient not loaded');
        return c.comments().update(commentId, body);
    }

    async function deleteComment(commentId) {
        const c = getClient();
        if (!c) throw new Error('GitHubAPIClient not loaded');
        return c.comments().delete(commentId);
    }

    async function loadReactions(issueNumber, signal) {
        const c = getClient();
        if (!c) return [];
        return c.reactions().load(issueNumber, signal);
    }

    async function addReaction(issueNumber, content) {
        const c = getClient();
        if (!c) throw new Error('GitHubAPIClient not loaded');
        return c.reactions().add(issueNumber, content);
    }

    async function removeReaction(issueNumber, reactionId) {
        const c = getClient();
        if (!c) throw new Error('GitHubAPIClient not loaded');
        return c.reactions().remove(issueNumber, reactionId);
    }

    async function githubFetch(url, options = {}) {
        const c = getClient();
        if (!c) throw new Error('GitHubAPIClient not loaded');
        return c.request(url, options);
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
        updateComment,
        deleteComment,
        loadReactions,
        addReaction,
        removeReaction
    };
})();