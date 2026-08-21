// js/core/github-api.js – обёртка с кешированием и сигналами
(function() {
  const client = window.GitHubAPIClient;
  const { cacheGet, cacheSet, cacheRemoveByPrefix } = window.Utils;

  const API_CACHE_TTL = 5 * 60 * 1000;

  async function loadIssues(params, signal) {
    const cacheKey = `issues_${JSON.stringify(params)}`;
    const cached = cacheGet(cacheKey, API_CACHE_TTL);
    if (cached) return cached;
    const data = await client.issues().load({ ...params, signal });
    cacheSet(cacheKey, data);
    return data;
  }

  async function loadIssue(issueNumber, signal) {
    const cacheKey = `issue_${issueNumber}`;
    const cached = cacheGet(cacheKey, API_CACHE_TTL);
    if (cached) return cached;
    const data = await client.issues().loadOne(issueNumber, signal);
    cacheSet(cacheKey, data);
    return data;
  }

  async function createIssue(title, body, labels) {
    const data = await client.issues().create(title, body, labels);
    cacheRemoveByPrefix('issues_');
    return data;
  }

  async function updateIssue(issueNumber, updates) {
    const data = await client.issues().update(issueNumber, updates);
    cacheRemoveByPrefix(`issue_${issueNumber}`);
    cacheRemoveByPrefix('issues_');
    return data;
  }

  async function closeIssue(issueNumber) {
    const data = await client.issues().close(issueNumber);
    cacheRemoveByPrefix(`issue_${issueNumber}`);
    cacheRemoveByPrefix('issues_');
    return data;
  }

  async function loadComments(issueNumber, signal) {
    const cacheKey = `comments_${issueNumber}`;
    const cached = cacheGet(cacheKey, API_CACHE_TTL);
    if (cached) return cached;
    const data = await client.comments().load(issueNumber, signal);
    cacheSet(cacheKey, data);
    return data;
  }

  async function addComment(issueNumber, body) {
    const data = await client.comments().add(issueNumber, body);
    cacheRemoveByPrefix(`comments_${issueNumber}`);
    return data;
  }

  async function updateComment(commentId, body) {
    const data = await client.comments().update(commentId, body);
    cacheRemoveByPrefix('comments_');
    return data;
  }

  async function deleteComment(commentId) {
    await client.comments().delete(commentId);
    cacheRemoveByPrefix('comments_');
  }

  async function loadReactions(issueNumber, signal) {
    const cacheKey = `reactions_${issueNumber}`;
    const cached = cacheGet(cacheKey, API_CACHE_TTL);
    if (cached) return cached;
    const data = await client.reactions().load(issueNumber, signal);
    cacheSet(cacheKey, data);
    return data;
  }

  async function addReaction(issueNumber, content) {
    const data = await client.reactions().add(issueNumber, content);
    cacheRemoveByPrefix(`reactions_${issueNumber}`);
    return data;
  }

  async function removeReaction(issueNumber, reactionId) {
    await client.reactions().remove(issueNumber, reactionId);
    cacheRemoveByPrefix(`reactions_${issueNumber}`);
  }

  window.GithubAPI = {
    getToken: () => localStorage.getItem('github_token'),
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