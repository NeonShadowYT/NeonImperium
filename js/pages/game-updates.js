// js/pages/game-updates.js – использует общий кэш и CardRenderer, с локализацией, обновление кнопки при смене языка
// При смене языка не перезагружает данные, только обновляет тексты через data-lang
(function() {
  const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG, deduplicateByNumber, createAbortable, stripHtml, extractAllowed, extractSummary, decryptPrivateBody, loadModule, createElement } = window.GithubCore;
  const { loadIssues } = window.GithubAPI;
  const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
  const { showToast } = window.UIUtils;
  const { createCard } = window.CardRenderer || {};

  if (!window.CardRenderer) {
    loadModule('js/features/card-renderer.js').catch(() => {});
  }

  let currentAbort = null, currentGame = null;
  const UPDATES_CACHE_TTL = 15 * 60 * 1000;

  // ---- экспорт функции инициализации ----
  window.initGameUpdates = function() {
    const container = document.getElementById('game-updates');
    if (container?.dataset.game) {
      currentGame = container.dataset.game;
      window.currentGame = currentGame;
      loadGameUpdates(container, currentGame);
    }
    window.addEventListener('github-issue-created', e => {
      const issue = e.detail;
      if (!currentGame) return;
      if (!issue.labels.some(l => l.name === 'type:update' && l.name === `game:${currentGame}`)) return;
      if (!CONFIG.ALLOWED_AUTHORS.includes(issue.user.login)) return;
      cacheRemoveByPrefix(`game_issues_${currentGame}`);
      const cont = document.getElementById('game-updates');
      if (!cont) return;
      const newPost = { number: issue.number, title: issue.title, body: issue.body, date: new Date(issue.created_at), author: issue.user.login, game: currentGame, labels: issue.labels.map(l=>l.name) };
      let grid = cont.querySelector('.projects-grid');
      if (!grid) { grid = createElement('div', 'projects-grid'); cont.innerHTML = ''; cont.appendChild(grid); }
      const card = createCard({
        type: 'update',
        id: newPost.number,
        title: newPost.title,
        body: newPost.body,
        author: newPost.author,
        date: newPost.date,
        game: newPost.game,
        labels: newPost.labels,
        isUpdate: true,
        thumbnail: null, // можно вытащить из body
      });
      grid.insertBefore(card, grid.firstChild);
    });
    window.addEventListener('github-login-success', () => { if (currentGame) refreshGameUpdates(currentGame); });
    window.addEventListener('github-logout', () => { if (currentGame) refreshGameUpdates(currentGame); });

    // ---- обновление кнопки при смене языка (без перезагрузки) ----
    window.addEventListener('languageChanged', () => {
      const container = document.getElementById('game-updates');
      if (!container) return;
      const parent = container.parentNode;
      const header = parent?.querySelector('.updates-header');
      if (header) {
        const btn = header.querySelector('.admin-update-btn');
        if (btn) {
          const t = window.I18n?.translate || (k => k);
          btn.innerHTML = `<i class="fas fa-plus"></i> ${t('addUpdate')}`;
        }
      }
    });
  };

  window.refreshGameUpdates = (game) => {
    const cont = document.getElementById('game-updates');
    if (cont && cont.dataset.game === game) loadGameUpdates(cont, game);
  };

  async function loadGameUpdates(container, game) {
    const t = window.I18n?.translate || (k => k);
    container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p data-lang="loading">${t('loading')}</p></div>`;
    if (currentAbort) {
      currentAbort.controller.abort();
      currentAbort = null;
    }
    const { controller, timeoutId } = createAbortable(10000);
    currentAbort = { controller };
    try {
      const cacheKey = `game_issues_${game}`;
      let issues = cacheGet(cacheKey);
      if (!issues) {
        issues = await loadIssues({ labels: `game:${game}`, state: 'open', per_page: 100, signal: controller.signal });
        cacheSet(cacheKey, issues);
      }
      let posts = issues.filter(i =>
        i.labels.some(l => l.name === 'type:update') &&
        CONFIG.ALLOWED_AUTHORS.includes(i.user.login)
      ).map(i => ({
        number: i.number,
        title: i.title,
        body: i.body,
        date: new Date(i.created_at),
        author: i.user.login,
        game,
        labels: i.labels.map(l => l.name)
      }));
      const currentUser = getCurrentUser();
      posts = posts.filter(p => {
        if (!p.labels.includes('private')) return true;
        if (isAdmin()) return true;
        const allowed = extractAllowed(p.body);
        return allowed && allowed.split(',').map(s=>s.trim()).includes(currentUser);
      });
      posts.sort((a, b) => b.date - a.date);
      if (posts.length === 0) {
        container.innerHTML = '<p class="text-secondary" data-lang="noUpdates"></p>';
        return;
      }
      container.innerHTML = '';
      const grid = createElement('div', 'projects-grid');
      const fragment = document.createDocumentFragment();
      posts.forEach(p => {
        // Используем CardRenderer
        const card = createCard({
          type: 'update',
          id: p.number,
          title: p.title,
          body: p.body,
          author: p.author,
          date: p.date,
          game: p.game,
          labels: p.labels,
          isUpdate: true,
          thumbnail: null,
          // Можно попытаться извлечь первое изображение из body
        });
        fragment.appendChild(card);
      });
      grid.appendChild(fragment);
      container.appendChild(grid);

      const parent = container.parentNode;
      let header = parent.querySelector('.updates-header');
      if (!header) {
        header = createElement('div', 'updates-header', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' });
        header.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><i class="fas fa-clock-rotate-left" style="font-size:24px;color:var(--accent);"></i> <h2 style="margin:0;" data-lang="updatesTitle">${t('updatesTitle')}</h2></div>`;
        parent.insertBefore(header, container);
      }
      const existing = header.querySelector('.admin-update-btn');
      if (isAdmin() && hasScope('repo')) {
        if (!existing) {
          const btn = createElement('button', 'button admin-update-btn');
          btn.innerHTML = `<i class="fas fa-plus"></i> ${t('addUpdate')}`;
          btn.addEventListener('click', async () => { if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js'); window.UIFeedback.openEditorModal('new', { game: currentGame }, 'update'); });
          header.appendChild(btn);
        } else {
          existing.innerHTML = `<i class="fas fa-plus"></i> ${t('addUpdate')}`;
        }
      } else if (existing) existing.remove();
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Update load error:', err);
      container.innerHTML = `<p class="error-message" data-lang="updatesLoadError"></p>`;
    } finally { clearTimeout(timeoutId); if (currentAbort?.controller === controller) currentAbort = null; }
  }
})();