// js/pages/feedback.js – обратная связь, инициализация через window.initFeedback
(function() {
  const {
    cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, deduplicateByNumber,
    createAbortable, loadModule, createElement, stripHtml,
    extractSummary, extractAllowed, decryptPrivateBody, performAction
  } = window.GithubCore || {};
  const { loadIssues, loadReactions, addReaction, removeReaction } = window.GithubAPI || {};
  const { getCurrentUser, isAdmin } = window.GithubAuth || {};
  const { showToast } = window.UIUtils || {};

  if (!window.GithubCore || !window.GithubAPI || !window.GithubAuth || !window.UIUtils) {
    console.error('[feedback.js] Missing dependencies');
    // Попытка загрузить модули может быть здесь, но мы полагаемся на common-init
    return;
  }

  const ITEMS_PER_PAGE = 10, MAX_DISPLAY = 30, CACHE_TTL = 10 * 60 * 1000;
  let currentGame, currentTab = 'all', currentPage = 1, hasMore = true, isLoading = false;
  let allIssues = [], container, grid, sentinel, observer, currentAbort, currentUser;
  let initialized = false;
  let loadRetries = 0;
  const MAX_RETRIES = 2;

  async function addReactionWithSync(issueNumber, content) {
    try {
      const result = await performAction('reactions', { issueNumber, content }, () => addReaction(issueNumber, content));
      if (result.queued) {
        showToast('Реакция будет отправлена позже', 'info');
      } else {
        showToast('Реакция добавлена', 'success');
      }
      window.UIFeedback?.invalidateCache(issueNumber);
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
    }
  }

  async function removeReactionWithSync(issueNumber, reactionId) {
    try {
      await removeReaction(issueNumber, reactionId);
      window.UIFeedback?.invalidateCache(issueNumber);
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
    }
  }

  function initLazy() {
    const section = document.getElementById('feedback-section');
    if (!section) return;
    if (initialized) return;
    const rect = section.getBoundingClientRect();
    if (rect.top < window.innerHeight + 200 && rect.bottom > -200) {
      initializeFeedback(section);
    } else {
      const obs = new IntersectionObserver((entries) => {
        if (entries.some(e => e.isIntersecting)) {
          obs.disconnect();
          initializeFeedback(section);
        }
      }, { rootMargin: '200px' });
      obs.observe(section);
    }
  }

  function initializeFeedback(section) {
    if (initialized) return;
    initialized = true;
    currentGame = section.dataset.game;
    if (!currentGame) {
      console.warn('[feedback.js] No data-game on #feedback-section');
      section.innerHTML = '<p class="error-message">Не указана игра</p>';
      return;
    }
    container = section.querySelector('.feedback-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'feedback-container';
      section.appendChild(container);
    }

    window.addEventListener('github-login-success', e => { currentUser = e.detail.login; checkAuthAndRender(); });
    window.addEventListener('github-logout', () => { currentUser = null; checkAuthAndRender(); });
    window.addEventListener('github-issue-created', e => {
      const issue = e.detail;
      if (!issue.labels.some(l => l.name === `game:${currentGame}`)) return;
      cacheRemoveByPrefix(`game_issues_${currentGame}`);
      allIssues = [issue, ...allIssues];
      filterAndDisplay(true);
    });

    currentUser = getCurrentUser();
    checkAuthAndRender();

    const postId = new URLSearchParams(location.search).get('post');
    if (postId) setTimeout(() => openPostFromUrl(postId), 1500);
  }

  async function loadGameIssues(reset) {
    if (isLoading) return;
    isLoading = true;
    if (currentAbort) {
      currentAbort.controller.abort();
      currentAbort = null;
    }
    const { controller, timeoutId } = createAbortable(15000);
    currentAbort = { controller };
    const t = window.I18n?.translate || (k => k);
    try {
      const key = `game_issues_${currentGame}`;
      let issues = cacheGet(key);
      if (!issues) {
        try {
          issues = await loadIssues({ labels: `game:${currentGame}`, state: 'open', per_page: 100, signal: controller.signal });
          cacheSet(key, issues);
          loadRetries = 0;
        } catch (err) {
          if (controller.signal.aborted) return;
          console.warn('[feedback.js] loadIssues error:', err);
          if (loadRetries < MAX_RETRIES) {
            loadRetries++;
            showToast(`${t('loadError')}, ${t('tryRefresh')}`, 'warning');
            await new Promise(r => setTimeout(r, 1000));
            return loadGameIssues(reset);
          } else {
            showToast(t('feedbackLoadFailed'), 'error');
            if (grid) grid.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${t('dataLoadError')}</p></div>`;
            return;
          }
        }
      }
      allIssues = deduplicateByNumber(issues);
      filterAndDisplay(reset);
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('[feedback.js] loadGameIssues error:', err);
      showToast(t('loadError') + ': ' + (err.message || err), 'error');
      if (grid) grid.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${t('dataLoadError')}</p></div>`;
    } finally {
      clearTimeout(timeoutId);
      if (currentAbort?.controller === controller) currentAbort = null;
      isLoading = false;
    }
  }

  function filterAndDisplay(reset) {
    if (!grid) return;
    let filtered = allIssues.filter(i => i.state === 'open').filter(i => {
      const labels = i.labels.map(l=>l.name);
      if (!labels.includes('private')) return true;
      if (isAdmin()) return true;
      const allowed = extractAllowed(i.body);
      return allowed && allowed.split(',').map(s=>s.trim()).includes(currentUser);
    });
    if (currentTab !== 'all') {
      filtered = filtered.filter(i => i.labels.some(l => l.name === `type:${currentTab}`));
    }
    if (reset) {
      grid.innerHTML = '';
      currentPage = 1;
      hasMore = true;
    }
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const pageItems = filtered.slice(start, start + ITEMS_PER_PAGE);
    if (pageItems.length === 0 && reset) {
      const t = window.I18n?.translate || (k => k);
      grid.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><p data-lang="feedbackNoItems">${t('feedbackNoItems')}</p></div>`;
      hasMore = false;
      return;
    }
    const fragment = document.createDocumentFragment();
    pageItems.forEach(issue => {
      if (!grid.querySelector(`[data-issue-number="${issue.number}"]`)) {
        fragment.appendChild(createCard(issue));
      }
    });
    grid.appendChild(fragment);
    hasMore = filtered.length > start + ITEMS_PER_PAGE;
    if (!hasMore && sentinel) sentinel.style.display = 'none';
  }

  function checkAuthAndRender() {
    if (currentUser) renderInterface();
    else renderLoginPrompt();
  }

  function renderLoginPrompt() {
    if (!container) return;
    const t = window.I18n?.translate || (k => k);
    container.innerHTML = `<div class="login-prompt"><i class="fab fa-github"></i><h3 data-lang="feedbackLoginPrompt">${t('feedbackLoginPrompt')}</h3><p class="text-secondary" data-lang="feedbackTokenNote">${t('githubTokenNote')}</p><button class="button" id="feedback-login-btn">${t('feedbackLoginBtn')}</button></div>`;
    const btn = container.querySelector('#feedback-login-btn');
    if (btn) btn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('github-login-requested')));
  }

  async function renderInterface() {
    if (!container) return;
    const t = window.I18n?.translate || (k => k);
    if (!window.UIFeedback) {
      try {
        await loadModule('js/features/ui-feedback.js');
      } catch (err) {
        console.error('[feedback.js] Failed to load UIFeedback:', err);
        container.innerHTML = `<p class="error-message">${t('loadModulesError')}</p>`;
        return;
      }
    }
    container.innerHTML = `
      <div class="feedback-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <h2 style="margin:0;"><i class="fas fa-comment-dots" style="font-size:24px;color:var(--accent);"></i> <span data-lang="feedbackTitle">${t('feedbackTitle')}</span></h2>
        </div>
        <button class="button" id="toggle-form-btn">+ ${t('feedbackNewBtn')}</button>
      </div>
      <p class="text-secondary" data-lang="feedbackDesc">${t('feedbackDesc')}</p>
      <div class="feedback-tabs"><button class="feedback-tab active" data-tab="all">${t('tabAll')}</button><button class="feedback-tab" data-tab="idea">💡 ${t('tabIdeas')}</button><button class="feedback-tab" data-tab="bug">🐛 ${t('tabBugs')}</button><button class="feedback-tab" data-tab="review">⭐ ${t('tabReviews')}</button></div>
      <div class="projects-grid" id="feedback-panel"></div><div id="sentinel" style="height:10px;"></div>
    `;
    const toggleBtn = document.getElementById('toggle-form-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        if (!window.UIFeedback) {
          showToast(t('editorNotLoaded'), 'error');
          return;
        }
        window.UIFeedback.openEditorModal('new', { game: currentGame }, 'feedback');
      });
    }
    grid = document.getElementById('feedback-panel');
    sentinel = document.getElementById('sentinel');
    const tabs = container.querySelectorAll('.feedback-tab');
    tabs.forEach(t => t.addEventListener('click', e => {
      tabs.forEach(tt => { tt.classList.remove('active'); tt.setAttribute('aria-selected','false'); });
      t.classList.add('active'); t.setAttribute('aria-selected','true');
      currentTab = t.dataset.tab;
      currentPage = 1;
      filterAndDisplay(true);
    }));
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(e => {
      if (e[0].isIntersecting && !isLoading && hasMore) {
        currentPage++;
        filterAndDisplay(false);
      }
    }, { threshold: 0.1 });
    if (sentinel) observer.observe(sentinel);
    await loadGameIssues(true);
  }

  function createCard(issue) {
    const type = issue.labels.find(l=>l.name.startsWith('type:'))?.name.split(':')[1] || 'idea';
    const icon = type === 'idea' ? '💡' : type === 'bug' ? '🐛' : '⭐';
    let summary = extractSummary(issue.body) || (issue.body||'').substring(0,120)+'…';
    const allowed = extractAllowed(issue.body);
    if (issue.labels.some(l=>l.name==='private') && allowed && currentUser && allowed.split(',').map(s=>s.trim()).includes(currentUser)) {
      try { summary = extractSummary(decryptPrivateBody(issue.body, allowed)) || ''; } catch {}
    }
    const card = createElement('div', 'project-card-link tilt-card', { cursor: 'pointer' });
    card.dataset.issueNumber = issue.number;
    const inner = createElement('div', 'project-card');
    const imgW = createElement('div', 'image-wrapper', { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', fontSize: '48px' });
    imgW.textContent = icon;
    const title = createElement('h3');
    title.textContent = issue.title.length > 70 ? issue.title.slice(0,70)+'…' : issue.title;
    const preview = createElement('p', 'text-secondary', { fontSize: '13px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' });
    preview.textContent = summary.replace(/\n/g,' ');
    const footer = createElement('div', '', { display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', marginTop: 'auto', paddingTop: '10px' });
    footer.innerHTML = `<span><i class="fas fa-user"></i> ${escapeHtml(issue.user.login)}</span><span><i class="fas fa-calendar-alt"></i> ${new Date(issue.created_at).toLocaleDateString()}</span><span><i class="fas fa-comment"></i> ${issue.comments}</span>`;
    inner.append(imgW, title, preview, footer);
    card.appendChild(inner);
    card.addEventListener('click', async e => {
      if (e.target.closest('button')) return;
      if (!window.UIFeedback) {
        try {
          await loadModule('js/features/ui-feedback.js');
        } catch (err) {
          showToast(t('viewerNotAvailable'), 'error');
          return;
        }
      }
      if (!window.UIFeedback) {
        showToast(t('viewerNotAvailable'), 'error');
        return;
      }
      window.UIFeedback.openFullModal({
        id: issue.number,
        title: issue.title,
        body: issue.body,
        author: issue.user.login,
        date: new Date(issue.created_at),
        game: currentGame,
        labels: issue.labels.map(l=>l.name)
      });
    });
    return card;
  }

  async function openPostFromUrl(id) {
    const t = window.I18n?.translate || (k => k);
    try {
      if (!window.GithubAPI) await loadModule('js/core/github-api.js');
      const issue = await window.GithubAPI.loadIssue(id);
      if (!issue || issue.state === 'closed') {
        showToast(t('postNotFound'), 'error');
        return;
      }
      const gameLabel = issue.labels.find(l => l.name.startsWith('game:'));
      if (!gameLabel || gameLabel.name.split(':')[1] !== currentGame) return;
      const item = {
        id: issue.number,
        title: issue.title,
        body: issue.body,
        author: issue.user.login,
        date: new Date(issue.created_at),
        game: currentGame,
        labels: issue.labels.map(l=>l.name)
      };
      if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
      if (!window.UIFeedback.canViewPost(issue.body, item.labels, currentUser)) {
        showToast(t('noAccess'), 'error');
        return;
      }
      window.UIFeedback.openFullModal(item);
    } catch (err) {
      console.error('[feedback.js] openPostFromUrl error:', err);
      showToast(t('postLoadError'), 'error');
    }
  }

  // ---- экспорт функции инициализации ----
  window.initFeedback = function() {
    initLazy();
  };

  // Убираем авто-вызов!
})();