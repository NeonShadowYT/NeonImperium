// js/core/github-core.js – оптимизированное ядро с глобальным кешем
(function() {
  const CONFIG = {
    REPO_OWNER: 'NeonShadowYT',
    REPO_NAME: 'NeonImperium',
    CACHE_TTL: 10 * 60 * 1000,
    API_CACHE_TTL: 5 * 60 * 1000,
    IMAGE_CACHE_TTL: 30 * 24 * 60 * 60 * 1000,
    RELEASES_CACHE_TTL: 60 * 60 * 1000,
    ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567']
  };

  const {
    escapeHtml, stripHtml, createElement, formatDate,
    cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
    deduplicateByNumber, debounce, throttle, renderMarkdown,
    createAbortable, loadModule
  } = window.Utils;

  // Функции для мета-тегов
  function extractMeta(body, tag) {
    const re = new RegExp(`<!--\\s*${tag}:\\s*(.*?)\\s*-->`, 'i');
    const match = body?.match(re);
    return match ? match[1].trim() : null;
  }
  const extractAllowed = body => extractMeta(body, 'allowed');
  const extractSummary = body => extractMeta(body, 'summary');

  // Шифрование/дешифрование (упрощённое)
  function deriveKey(allowedStr) {
    if (!allowedStr) return 'default-key';
    let hash = 0;
    for (let i = 0; i < allowedStr.length; i++) {
      hash = ((hash << 5) - hash) + allowedStr.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }

  function encryptPrivateBody(body, allowedStr) {
    if (!allowedStr) return body;
    const key = deriveKey(allowedStr);
    let result = '';
    for (let i = 0; i < body.length; i++) {
      result += String.fromCharCode(body.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(unescape(encodeURIComponent(result)));
  }

  function decryptPrivateBody(encBase64, allowedStr) {
    if (!allowedStr) return encBase64;
    try {
      const encrypted = decodeURIComponent(escape(atob(encBase64)));
      const key = deriveKey(allowedStr);
      let result = '';
      for (let i = 0; i < encrypted.length; i++) {
        result += String.fromCharCode(encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length));
      }
      return result;
    } catch (e) {
      return encBase64;
    }
  }

  // Выполнение действия с учётом лимитов и очереди
  async function performAction(actionType, payload, asyncFn) {
    if (!window.RateLimits) {
      await loadModule('js/features/rate-limits.js');
    }
    if (!window.RateLimits.checkLimit(actionType)) {
      const enqueued = await window.RateLimits.enqueueAction(actionType, payload);
      return { queued: true, actionId: enqueued };
    }
    try {
      const result = await asyncFn();
      window.RateLimits.increment(actionType);
      return { queued: false, result };
    } catch (err) {
      if (isRetryableError(err)) {
        const enqueued = await window.RateLimits.enqueueAction(actionType, payload);
        return { queued: true, actionId: enqueued };
      }
      throw err;
    }
  }

  function isRetryableError(err) {
    if (err instanceof TypeError || err.name === 'AbortError') return true;
    if (err.status && (err.status === 429 || err.status >= 500)) return true;
    if (err.message && (err.message.includes('rate limit') || err.message.includes('secondary'))) return true;
    return false;
  }

  async function isActionStillValid(actionType, payload) {
    // Проверка актуальности действия (упрощённо)
    if (actionType === 'reactions') {
      const { issueNumber, content } = payload;
      const currentUser = window.GithubAuth?.getCurrentUser();
      if (!currentUser) return false;
      // Проверяем, есть ли уже такая реакция
      try {
        const reactions = await window.GithubAPI.loadReactions(issueNumber);
        return !reactions.some(r => r.user.login === currentUser && r.content === content);
      } catch { return true; }
    }
    if (actionType === 'comments') {
      const { issueNumber, body } = payload;
      const currentUser = window.GithubAuth?.getCurrentUser();
      if (!currentUser) return false;
      try {
        const comments = await window.GithubAPI.loadComments(issueNumber);
        return !comments.some(c => c.user.login === currentUser && c.body.trim() === body.trim());
      } catch { return true; }
    }
    if (actionType === 'posts' && payload.mode === 'edit' && payload.id) {
      try {
        const issue = await window.GithubAPI.loadIssue(payload.id);
        return issue.state !== 'closed';
      } catch { return false; }
    }
    if (actionType === 'storageAdds' && payload.bookmark?.url) {
      try {
        const res = await window.BookmarkStorage.loadBookmarks();
        return !res.bookmarks.some(b => b.url === payload.bookmark.url);
      } catch { return true; }
    }
    return true;
  }

  window.GithubCore = {
    CONFIG,
    escapeHtml, stripHtml, createElement, formatDate,
    cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
    deduplicateByNumber, debounce, throttle, renderMarkdown,
    createAbortable, loadModule,
    extractMeta, extractAllowed, extractSummary,
    encryptPrivateBody, decryptPrivateBody,
    performAction,
    isActionStillValid,
    isRetryableError
  };

  window.performAction = performAction;
})();