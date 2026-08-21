// js/offline-queue.js – обёртка для обратной совместимости, использует единую очередь
(function() {
  // Все функции перенаправляем на RateLimits
  window.OfflineQueue = {
    queueMutation: async (mutation) => {
      // Преобразуем старые типы в новые
      let actionType, payload;
      switch (mutation.type) {
        case 'addReaction':
          actionType = 'reactions';
          payload = { issueNumber: mutation.issueNumber, content: mutation.content };
          break;
        case 'removeReaction':
          // Удаление реакции больше не используется, но оставим
          actionType = 'reactions';
          payload = { issueNumber: mutation.issueNumber, content: mutation.content, remove: true };
          break;
        case 'addComment':
          actionType = 'comments';
          payload = { issueNumber: mutation.issueNumber, body: mutation.body };
          break;
        case 'updateComment':
        case 'deleteComment':
          // Для простоты перенаправляем как комментарий, но с дополнительными полями
          actionType = 'comments';
          payload = { issueNumber: mutation.issueNumber, commentId: mutation.commentId, body: mutation.body, mode: 'edit' };
          break;
        case 'createIssue':
          actionType = 'posts';
          payload = { title: mutation.title, body: mutation.body, labels: mutation.labels };
          break;
        case 'updateIssue':
          actionType = 'posts';
          payload = { id: mutation.issueNumber, title: mutation.title, body: mutation.body, mode: 'edit' };
          break;
        default:
          return;
      }
      if (window.RateLimits) {
        return window.RateLimits.enqueueAction(actionType, payload);
      } else {
        console.warn('RateLimits not loaded, cannot queue mutation');
        return null;
      }
    },
    processQueue: () => {
      if (window.RateLimits) return window.RateLimits.processQueue();
      return Promise.resolve();
    },
    registerSync: () => {
      if (window.RateLimits) return window.RateLimits.registerSync();
      return Promise.resolve();
    },
    resetQueue: () => {
      if (window.RateLimits) {
        // Очищаем очередь
        return window.RateLimits.clearQueue();
      }
      return Promise.resolve();
    },
    getAllMutations: () => {
      if (window.RateLimits) return window.RateLimits.getPendingActions();
      return Promise.resolve([]);
    },
    clearQueue: () => {
      if (window.RateLimits) return window.RateLimits.clearQueue();
      return Promise.resolve();
    },
    getStoredToken: () => Promise.resolve(localStorage.getItem('github_token')),
    saveToken: (token) => { localStorage.setItem('github_token', token); return Promise.resolve(); }
  };
})();