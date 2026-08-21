// js/pages/game-updates.js – исправлен: добавлена проверка UIFeedback, подгрузка при необходимости
(function() {
  const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG, deduplicateByNumber, createAbortable, stripHtml, extractAllowed, extractSummary, decryptPrivateBody, loadModule, createElement } = window.GithubCore;
  const { loadIssues } = window.GithubAPI;
  const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
  const { showToast } = window.UIUtils;

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
      const fragment = document.createDocumentFragment();
      fragment.appendChild(createUpdateCard(newPost));
      grid.insertBefore(fragment, grid.firstChild);
    });
    window.addEventListener('github-login-success', () => { if (currentGame) refreshGameUpdates(currentGame); });
    window.addEventListener('github-logout', () => { if (currentGame) refreshGameUpdates(currentGame); });
  };

  window.refreshGameUpdates = (game) => {
    const cont = document.getElementById('game-updates');
    if (cont && cont.dataset.game === game) loadGameUpdates(cont, game);
  };

  async function ensureUIFeedback() {
    if (window.UIFeedback) return;
    try {
      await loadModule('js/features/ui-feedback.js');
    } catch (e) {
      console.warn('[game-updates] UIFeedback не загрузился:', e);
    }
  }

  async function loadGameUpdates(container, game) {
    const t = window.I18n?.translate || (k => k);
    container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> <span data-lang="loading">${t('loading')}</span></div>`;
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
      if (posts.length === 0) { container.innerHTML = `<p class="text-secondary" data-lang="noUpdates">${t('noUpdates')}</p>`; return; }
      container.innerHTML = '';
      const grid = createElement('div', 'projects-grid');
      const fragment = document.createDocumentFragment();

      // Гарантируем загрузку UIFeedback перед созданием карточек
      await ensureUIFeedback();

      posts.forEach(p => fragment.appendChild(createUpdateCard(p)));
      grid.appendChild(fragment);
      container.appendChild(grid);

      const parent = container.parentNode;
      let header = parent.querySelector('.updates-header');
      if (!header) {
        header = createElement('div', 'updates-header', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' });
        const left = createElement('div', '', { display: 'flex', alignItems: 'center', gap: '8px' });
        const icon = createElement('i', 'fas fa-clock-rotate-left', { fontSize: '24px', color: 'var(--accent)' });
        left.appendChild(icon);
        const h2 = createElement('h2', '', { margin: '0' });
        h2.setAttribute('data-lang', 'updatesTitle');
        h2.textContent = t('updatesTitle');
        left.appendChild(h2);
        header.appendChild(left);
        parent.insertBefore(header, container);
      }
      const existing = header.querySelector('.admin-update-btn');
      if (isAdmin() && hasScope('repo')) {
        if (!existing) {
          const btn = createElement('button', 'button admin-update-btn');
          btn.setAttribute('data-lang', 'addUpdate');
          btn.innerHTML = `<i class="fas fa-plus"></i> ${t('addUpdate')}`;
          btn.addEventListener('click', async () => {
            await ensureUIFeedback();
            if (window.UIFeedback) {
              window.UIFeedback.openEditorModal('new', { game: currentGame }, 'update');
            } else {
              showToast(t('loadModulesError'), 'error');
            }
          });
          header.appendChild(btn);
        } else {
          existing.setAttribute('data-lang', 'addUpdate');
          existing.innerHTML = `<i class="fas fa-plus"></i> ${t('addUpdate')}`;
        }
      } else if (existing) existing.remove();
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Update load error:', err);
      container.innerHTML = `<p class="error-message" data-lang="updatesLoadError">${t('updatesLoadError')}</p>`;
    } finally { clearTimeout(timeoutId); if (currentAbort?.controller === controller) currentAbort = null; }
  }

  function createUpdateCard(post) {
    let previewBody = post.body;
    const allowed = extractAllowed(post.body);
    const currentUser = getCurrentUser();
    if (post.labels.includes('private') && allowed && currentUser && allowed.split(',').map(s=>s.trim()).includes(currentUser)) {
      try { previewBody = decryptPrivateBody(post.body, allowed); } catch {}
    }
    const card = createElement('div', 'project-card-link no-tilt tilt-card', { cursor: 'pointer' });
    const inner = createElement('div', 'project-card');
    const imgMatch = previewBody.match(/!\[.*?\]\((.*?)\)/);
    const imgW = createElement('div', 'image-wrapper');
    const img = createElement('img', 'project-image', {}, { src: imgMatch?.[1] || 'images/default-news.webp', alt: post.title, loading: 'lazy' });
    img.onerror = () => img.src = 'images/default-news.webp';
    imgW.appendChild(img);
    const title = createElement('h3');
    title.textContent = post.title.length > 70 ? post.title.slice(0,70)+'…' : post.title;
    const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
    meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(post.author)} · <i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`;
    const summary = extractSummary(previewBody) || stripHtml(previewBody).substring(0,120)+'…';
    const preview = createElement('p', 'text-secondary', { fontSize: '13px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' });
    preview.textContent = summary;
    inner.append(imgW, title, meta, preview);
    card.appendChild(inner);
    card.addEventListener('click', async () => {
      await ensureUIFeedback();
      if (window.UIFeedback) {
        window.UIFeedback.openFullModal({ type: 'update', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game, labels: post.labels });
      } else {
        showToast(t('viewerNotAvailable'), 'error');
      }
    });
    return card;
  }
})();