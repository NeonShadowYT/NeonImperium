// js/pages/game-updates.js – использует общий кэш и DocumentFragment
(function() {
  const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG, deduplicateByNumber, createAbortable, stripHtml, extractAllowed, extractSummary, decryptPrivateBody, loadModule, createElement } = window.GithubCore;
  const { loadIssues } = window.GithubAPI;
  const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
  const { showToast } = window.UIUtils;

  let currentAbort = null, currentGame = null;
  const UPDATES_CACHE_TTL = 15 * 60 * 1000; // 15 минут

  document.addEventListener('DOMContentLoaded', () => {
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
  });

  window.refreshGameUpdates = (game) => {
    const cont = document.getElementById('game-updates');
    if (cont && cont.dataset.game === game) loadGameUpdates(cont, game);
  };

  async function loadGameUpdates(container, game) {
    container.innerHTML = '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>';
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
      if (posts.length === 0) { container.innerHTML = '<p class="text-secondary">Нет обновлений</p>'; return; }
      container.innerHTML = '';
      const grid = createElement('div', 'projects-grid');
      const fragment = document.createDocumentFragment();
      posts.forEach(p => fragment.appendChild(createUpdateCard(p)));
      grid.appendChild(fragment);
      container.appendChild(grid);

      const parent = container.parentNode;
      let header = parent.querySelector('.updates-header');
      if (!header) {
        header = createElement('div', 'updates-header', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' });
        // Добавлена иконка к заголовку
        header.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><i class="fas fa-history" style="font-size:24px;color:var(--accent);"></i> <h2 style="margin:0;" data-lang="updatesTitle">Обновления</h2></div>';
        parent.insertBefore(header, container);
      }
      const existing = header.querySelector('.admin-update-btn');
      if (isAdmin() && hasScope('repo')) {
        if (!existing) {
          const btn = createElement('button', 'button admin-update-btn');
          btn.innerHTML = '<i class="fas fa-plus"></i> Добавить обновление';
          btn.addEventListener('click', async () => { if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js'); window.UIFeedback.openEditorModal('new', { game: currentGame }, 'update'); });
          header.appendChild(btn);
        }
      } else if (existing) existing.remove();
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Update load error:', err);
      container.innerHTML = '<p class="error-message">Ошибка загрузки обновлений</p>';
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
      if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
      window.UIFeedback.openFullModal({ type: 'update', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game, labels: post.labels });
    });
    return card;
  }
})();