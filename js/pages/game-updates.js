// js/pages/game-updates.js – использует общий кэш и CardRenderer, с локализацией, обновление кнопки при смене языка
// При смене языка не перезагружает данные, только обновляет тексты через data-lang
(function() {
  const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG, deduplicateByNumber, createAbortable, stripHtml, extractAllowed, extractSummary, decryptPrivateBody, loadModule, createElement } = window.GithubCore;
  const { loadIssues } = window.GithubAPI;
  const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
  const { showToast } = window.UIUtils;
  let cardRendererReady = false;
  let cardRendererPromise = null;

  function ensureCardRenderer() {
    if (cardRendererReady && window.CardRenderer) return Promise.resolve(window.CardRenderer);
    if (cardRendererPromise) return cardRendererPromise;
    cardRendererPromise = new Promise((resolve, reject) => {
      if (window.CardRenderer) {
        cardRendererReady = true;
        resolve(window.CardRenderer);
        return;
      }
      loadModule('js/features/card-renderer.js')
        .then(() => {
          if (window.CardRenderer) {
            cardRendererReady = true;
            resolve(window.CardRenderer);
          } else {
            reject(new Error('CardRenderer not available'));
          }
        })
        .catch(reject);
    });
    return cardRendererPromise;
  }

  let currentAbort = null, currentGame = null;
  const UPDATES_CACHE_TTL = 15 * 60 * 1000;

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
      ensureCardRenderer().then(renderer => {
        const card = renderer.createCard({
          type: 'update',
          id: newPost.number,
          title: newPost.title,
          body: newPost.body,
          author: newPost.author,
          date: newPost.date,
          game: newPost.game,
          labels: newPost.labels,
          isUpdate: true,
          thumbnail: null,
        });
        grid.insertBefore(card, grid.firstChild);
      }).catch(() => {
        // fallback: простая карточка
        const fallback = createFallbackUpdateCard(newPost);
        grid.insertBefore(fallback, grid.firstChild);
      });
    });
    window.addEventListener('github-login-success', () => { if (currentGame) refreshGameUpdates(currentGame); });
    window.addEventListener('github-logout', () => { if (currentGame) refreshGameUpdates(currentGame); });

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

  function createFallbackUpdateCard(post) {
    const wrapper = document.createElement('div');
    wrapper.className = 'project-card-link no-tilt tilt-card';
    wrapper.style.cursor = 'pointer';
    const card = document.createElement('div');
    card.className = 'project-card';
    const title = document.createElement('h3');
    title.textContent = post.title;
    const meta = document.createElement('p');
    meta.className = 'text-secondary';
    meta.textContent = post.author + ' · ' + post.date.toLocaleDateString();
    card.appendChild(title);
    card.appendChild(meta);
    wrapper.appendChild(card);
    wrapper.addEventListener('click', () => {
      if (window.UIFeedback) {
        window.UIFeedback.openFullModal({
          type: 'update',
          id: post.number,
          title: post.title,
          body: post.body,
          author: post.author,
          date: post.date,
          game: post.game,
          labels: post.labels
        });
      }
    });
    return wrapper;
  }

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

      // Ждём CardRenderer
      let renderer;
      try {
        renderer = await ensureCardRenderer();
      } catch (e) {
        console.warn('[game-updates] CardRenderer not available, using fallback');
        posts.forEach(p => {
          fragment.appendChild(createFallbackUpdateCard(p));
        });
        grid.appendChild(fragment);
        container.appendChild(grid);
        addAdminButton(container);
        return;
      }

      posts.forEach(p => {
        const card = renderer.createCard({
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
        });
        fragment.appendChild(card);
      });
      grid.appendChild(fragment);
      container.appendChild(grid);
      addAdminButton(container);
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Update load error:', err);
      container.innerHTML = `<p class="error-message" data-lang="updatesLoadError"></p>`;
    } finally { clearTimeout(timeoutId); if (currentAbort?.controller === controller) currentAbort = null; }
  }

  function addAdminButton(container) {
    const parent = container.parentNode;
    let header = parent.querySelector('.updates-header');
    if (!header) {
      const t = window.I18n?.translate || (k => k);
      header = createElement('div', 'updates-header', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' });
      header.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><i class="fas fa-clock-rotate-left" style="font-size:24px;color:var(--accent);"></i> <h2 style="margin:0;" data-lang="updatesTitle">${t('updatesTitle')}</h2></div>`;
      parent.insertBefore(header, container);
    }
    const existing = header.querySelector('.admin-update-btn');
    const t = window.I18n?.translate || (k => k);
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
  }
})();