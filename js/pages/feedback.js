// js/pages/feedback.js – обратная связь с performAction, улучшенная обработка ошибок
// cacheGet/cacheSet асинхронные (шифрование через CacheCrypto).
//
// ВАЖНО: файл грузится ДО js/lang.js. t() должен быть динамическим:
// проверять window.I18n.translate в момент вызова, а не при init модуля.
(function() {
  const {
    cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, deduplicateByNumber,
    createAbortable, loadModule, createElement, stripHtml,
    extractSummary, performAction
  } = window.GithubCore || {};
  const { loadIssues, loadReactions, addReaction, removeReaction } = window.GithubAPI || {};
  const { getCurrentUser, isAdmin } = window.GithubAuth || {};
  const { showToast } = window.UIUtils || {};

  if (!window.GithubCore || !window.GithubAPI || !window.GithubAuth || !window.UIUtils) {
    console.error('[feedback.js] Missing dependencies');
    Promise.all([
      loadModule('js/core/github-core.js'),
      loadModule('js/core/github-api.js'),
      loadModule('js/core/github-auth.js'),
      loadModule('js/features/ui-utils.js')
    ]).catch(() => {
      const t = window.I18n?.translate || (k => k);
      document.querySelector('#feedback-section')?.innerHTML?.(
        `<p class="error-message">${t('loadModulesError')}</p>`
      );
    });
    return;
  }

  function t(key) {
    if (window.I18n && typeof window.I18n.translate === 'function') {
      const v = window.I18n.translate(key);
      if (v && v !== key) return v;
    }
    switch (key) {
      case 'feedbackTitle': return 'Идеи, баги и отзывы';
      case 'feedbackNewBtn': return 'Оставить сообщение';
      case 'feedbackDesc': return 'Делитесь мыслями, сообщайте об ошибках или предлагайте улучшения.';
      case 'tabAll': return 'Все';
      case 'tabIdeas': return 'Идеи';
      case 'tabBugs': return 'Баги';
      case 'tabReviews': return 'Отзывы';
      case 'feedbackNoItems': return 'Пока нет сообщений. Будьте первым!';
      case 'loadError': return 'Ошибка загрузки';
      case 'dataLoadError': return 'Ошибка загрузки данных';
      case 'loadModulesError': return 'Ошибка загрузки модулей';
      case 'feedbackLoadFailed': return 'Не удалось загрузить отзывы';
      case 'tryRefresh': return 'Попробуйте обновить страницу';
      case 'viewerNotAvailable': return 'Модуль просмотра недоступен';
      case 'postNotFound': return 'Пост не найден или закрыт';
      case 'postLoadError': return 'Ошибка загрузки поста';
      case 'editorNotLoaded': return 'Модуль редактора не загружен';
      case 'feedbackLoginPrompt': return 'Войдите через GitHub, чтобы участвовать в обсуждениях';
      case 'githubTokenNote': return 'токен хранится в вашем браузере и передаётся только в GitHub API.';
      case 'feedbackLoginBtn': return 'Войти';
      default: return key;
    }
  }

  const ITEMS_PER_PAGE = 10, MAX_DISPLAY = 30, CACHE_TTL = 10 * 60 * 1000;
  let currentGame, currentTab = 'all', currentPage = 1, hasMore = true, isLoading = false;
  let allIssues = [], container, grid, sentinel, observer, currentAbort, currentUser;
  let initialized = false;
  let loadRetries = 0;
  const MAX_RETRIES = 2;

  let headerElement, tabsContainer, descElement, loginPromptContainer;

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

    window.addEventListener('languageChanged', () => {
      updateTextsOnly();
    });

    currentUser = getCurrentUser();
    checkAuthAndRender();

    const postId = new URLSearchParams(location.search).get('post');
    if (postId) setTimeout(() => openPostFromUrl(postId), 1500);
  }

  function updateTextsOnly() {
    if (headerElement) {
      const titleSpan = headerElement.querySelector('h2 span');
      if (titleSpan) titleSpan.textContent = t('feedbackTitle');
      const btn = headerElement.querySelector('#toggle-form-btn');
      if (btn) btn.textContent = '+ ' + t('feedbackNewBtn');
    }
    if (descElement) {
      descElement.textContent = t('feedbackDesc');
    }
    if (tabsContainer) {
      const tabs = tabsContainer.querySelectorAll('.feedback-tab');
      tabs.forEach(tab => {
        const key = tab.dataset.langKey;
        if (key) tab.textContent = t(key);
      });
    }
    if (loginPromptContainer) {
      const prompt = loginPromptContainer;
      const h3 = prompt.querySelector('h3');
      if (h3) h3.textContent = t('feedbackLoginPrompt');
      const p = prompt.querySelector('p');
      if (p) p.textContent = t('githubTokenNote');
      const btn = prompt.querySelector('#feedback-login-btn');
      if (btn) btn.textContent = t('feedbackLoginBtn');
    }
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
    try {
      const key = `game_issues_${currentGame}`;
      let issues = await cacheGet(key);
      if (!issues) {
        try {
          issues = await loadIssues({ labels: `game:${currentGame}`, state: 'open', per_page: 100, signal: controller.signal });
          await cacheSet(key, issues);
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
    let filtered = allIssues.filter(i => i.state === 'open');
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
    container.innerHTML = '';
    const prompt = createElement('div', 'login-prompt');
    loginPromptContainer = prompt;
    const icon = createElement('i', 'fab fa-github');
    prompt.appendChild(icon);
    const h3 = createElement('h3');
    h3.setAttribute('data-lang', 'feedbackLoginPrompt');
    h3.textContent = t('feedbackLoginPrompt');
    prompt.appendChild(h3);
    const p = createElement('p', 'text-secondary');
    p.setAttribute('data-lang', 'githubTokenNote');
    p.textContent = t('githubTokenNote');
    prompt.appendChild(p);
    const btn = createElement('button', 'button');
    btn.setAttribute('data-lang', 'feedbackLoginBtn');
    btn.textContent = t('feedbackLoginBtn');
    btn.id = 'feedback-login-btn';
    btn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('github-login-requested')));
    prompt.appendChild(btn);
    container.appendChild(prompt);
  }

  async function renderInterface() {
    if (!container) return;
    if (!window.UIFeedback) {
      try {
        await loadModule('js/features/ui-feedback.js');
      } catch (err) {
        console.error('[feedback.js] Failed to load UIFeedback:', err);
        container.innerHTML = `<p class="error-message">${t('loadModulesError')}</p>`;
        return;
      }
    }
    container.innerHTML = '';
    const header = createElement('div', 'feedback-header');
    headerElement = header;
    const titleWrap = createElement('div', '', { display: 'flex', alignItems: 'center', gap: '8px' });
    const h2 = createElement('h2', '', { margin: '0' });
    const icon = createElement('i', 'fas fa-comment-dots', { fontSize: '24px', color: 'var(--accent)' });
    h2.prepend(icon);
    const titleSpan = createElement('span');
    titleSpan.setAttribute('data-lang', 'feedbackTitle');
    titleSpan.textContent = t('feedbackTitle');
    h2.appendChild(titleSpan);
    titleWrap.appendChild(h2);
    header.appendChild(titleWrap);
    const btn = createElement('button', 'button');
    btn.setAttribute('data-lang', 'feedbackNewBtn');
    btn.textContent = '+ ' + t('feedbackNewBtn');
    btn.id = 'toggle-form-btn';
    btn.addEventListener('click', () => {
      if (!window.UIFeedback) {
        showToast(t('editorNotLoaded'), 'error');
        return;
      }
      window.UIFeedback.openEditorModal('new', { game: currentGame }, 'feedback');
    });
    header.appendChild(btn);
    container.appendChild(header);

    const desc = createElement('p', 'text-secondary');
    desc.setAttribute('data-lang', 'feedbackDesc');
    desc.textContent = t('feedbackDesc');
    descElement = desc;
    container.appendChild(desc);

    const tabs = createElement('div', 'feedback-tabs');
    tabsContainer = tabs;
    const tabAll = createElement('button', 'feedback-tab active');
    tabAll.setAttribute('data-lang-key', 'tabAll');
    tabAll.textContent = t('tabAll');
    tabAll.dataset.tab = 'all';
    tabs.appendChild(tabAll);
    const tabIdea = createElement('button', 'feedback-tab');
    tabIdea.setAttribute('data-lang-key', 'tabIdeas');
    tabIdea.textContent = '💡 ' + t('tabIdeas');
    tabIdea.dataset.tab = 'idea';
    tabs.appendChild(tabIdea);
    const tabBug = createElement('button', 'feedback-tab');
    tabBug.setAttribute('data-lang-key', 'tabBugs');
    tabBug.textContent = '🐛 ' + t('tabBugs');
    tabBug.dataset.tab = 'bug';
    tabs.appendChild(tabBug);
    const tabReview = createElement('button', 'feedback-tab');
    tabReview.setAttribute('data-lang-key', 'tabReviews');
    tabReview.textContent = '⭐ ' + t('tabReviews');
    tabReview.dataset.tab = 'review';
    tabs.appendChild(tabReview);
    container.appendChild(tabs);

    const panel = createElement('div', 'projects-grid');
    panel.id = 'feedback-panel';
    container.appendChild(panel);
    const sentinelEl = createElement('div', '', { height: '10px' });
    sentinelEl.id = 'sentinel';
    container.appendChild(sentinelEl);

    grid = document.getElementById('feedback-panel');
    sentinel = document.getElementById('sentinel');

    tabs.querySelectorAll('.feedback-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.querySelectorAll('.feedback-tab').forEach(tt => { tt.classList.remove('active'); tt.setAttribute('aria-selected','false'); });
        tab.classList.add('active'); tab.setAttribute('aria-selected','true');
        currentTab = tab.dataset.tab;
        currentPage = 1;
        filterAndDisplay(true);
      });
    });

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
    // tilt-card — 3D-вращение. project-image нет (там эмодзи-иконка), поэтому только tilt.
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
      window.UIFeedback.openFullModal(item);
    } catch (err) {
      console.error('[feedback.js] openPostFromUrl error:', err);
      showToast(t('postLoadError'), 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLazy();
    window.addEventListener('scroll', initLazy, { passive: true });
  });

  window.FeedbackPage = {
    addReactionWithSync,
    removeReactionWithSync,
    loadGameIssues,
    refresh: () => { if (currentGame) loadGameIssues(true); }
  };
})();