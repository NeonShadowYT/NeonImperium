// js/pages/game-updates.js – использует общий кэш и DocumentFragment, с локализацией.
// cacheGet/cacheSet асинхронные (шифрование через CacheCrypto).
// tilt-card + project-image → 3D-вращение и параллакс картинки при hover.
//
// НОВОЕ: добавлена поддержка постов из Itch.io devlog.
//   - Itch.io предоставляет RSS-ленту: https://{user}.itch.io/{game}/devlog.rss
//   - Лента запрашивается через CORS-прокси (те же, что в news-feed.js).
//   - Из ленты берутся последние 3 поста и добавляются в раздел обновлений.
//   - Результат кешируется в localStorage на 30 минут.
//
// GAMEJOLT: официального API или RSS для devlog-постов нет. Для добавления
// постов GameJolt требуется внешний сервис (например, RSS.app) или ручное
// добавление. В данной версии автоматическое получение не реализовано.

(function() {
  const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG, deduplicateByNumber, createAbortable, stripHtml, extractSummary, loadModule, createElement, sanitizeHtml } = window.GithubCore;
  const { loadIssues } = window.GithubAPI;
  const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
  const { showToast } = window.UIUtils;

  let currentAbort = null, currentGame = null;
  const UPDATES_CACHE_TTL = 15 * 60 * 1000;
  const ITCH_POSTS_CACHE_KEY = 'itch_devlog_posts_cache';
  const ITCH_POSTS_CACHE_TTL = 30 * 60 * 1000;
  const VIDEO_PROXY_TIMEOUT = 12000;
  const MAX_ITCH_POSTS = 3;

  // ---- Itch.io Devlog ----
  const ITCH_DEVLOG_SOURCES = {
    'starve-neon': {
      name: 'Starve Neon',
      rssUrl: 'https://neon-shadow.itch.io/starve-neon/devlog.rss',
      devlogPageUrl: 'https://neon-shadow.itch.io/starve-neon/devlog'
    }
    // При необходимости можно добавить другие игры
  };

  // CORS-прокси (те же, что в news-feed.js)
  const VIDEO_PROXIES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(url)}`
  ];

  function t(key) {
    if (window.I18n && typeof window.I18n.translate === 'function') {
      const v = window.I18n.translate(key);
      if (v && v !== key) return v;
    }
    switch (key) {
      case 'loading': return 'Загрузка...';
      case 'noUpdates': return 'Нет обновлений';
      case 'updatesTitle': return 'Обновления';
      case 'addUpdate': return 'Добавить обновление';
      case 'updatesLoadError': return 'Ошибка загрузки обновлений';
      case 'readMore': return 'Читать далее';
      default: return key;
    }
  }

  function isAborted(err, signal) {
    if (!err) return false;
    if (signal && signal.aborted) return true;
    if (err.name === 'AbortError') return true;
    const msg = String(err.message || '');
    if (msg.includes('Aborted')) return true;
    return false;
  }

  // ============================================================
  // Itch.io Devlog — кеш
  // ============================================================

  function readItchPostsCache() {
    try {
      const raw = localStorage.getItem(ITCH_POSTS_CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.timestamp || !Array.isArray(data.posts)) return null;
      if (Date.now() - data.timestamp > ITCH_POSTS_CACHE_TTL) {
        localStorage.removeItem(ITCH_POSTS_CACHE_KEY);
        return null;
      }
      return data.posts;
    } catch (e) {
      return null;
    }
  }

  function writeItchPostsCache(posts) {
    try {
      localStorage.setItem(ITCH_POSTS_CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        posts
      }));
    } catch (e) { /* noop */ }
  }

  // ============================================================
  // Itch.io Devlog — парсинг RSS
  // ============================================================

  function decodeXmlEntities(s) {
    return String(s || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");
  }

  function parseItchDevlogXml(xmlText, source) {
    if (!xmlText || typeof xmlText !== 'string') return [];
    const itemBlocks = xmlText.split('<item>').slice(1);
    return itemBlocks.slice(0, MAX_ITCH_POSTS).map(block => {
      const titleMatch = block.match(/<title>([^<]*)<\/title>/);
      const linkMatch = block.match(/<link>([^<]*)<\/link>/);
      const pubDateMatch = block.match(/<pubDate>([^<]*)<\/pubDate>/);
      const descriptionMatch = block.match(/<description>([\s\S]*?)<\/description>/);

      const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : 'Без названия';
      const link = linkMatch ? linkMatch[1] : (source.devlogPageUrl || '#');
      let date = pubDateMatch ? new Date(pubDateMatch[1]) : new Date();
      if (isNaN(date.getTime())) date = new Date();

      let description = '';
      if (descriptionMatch) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = descriptionMatch[1];
        description = tempDiv.textContent || tempDiv.innerText || '';
      }

      return {
        type: 'itch-post',
        id: `itch-${link}`,
        title: title,
        author: source.name,
        date: date,
        body: description,
        itchLink: link,
        itchSource: source.name,
        labels: ['type:itch-post']
      };
    }).filter(p => p);
  }

  // ============================================================
  // Itch.io Devlog — запрос через прокси
  // ============================================================

  async function fetchViaProxy(proxyFn, targetUrl, signal) {
    const proxyUrl = proxyFn(targetUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VIDEO_PROXY_TIMEOUT);

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        throw new DOMException('Aborted', 'AbortError');
      }
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const resp = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      let text = await resp.text();
      if (!text || text.length < 200) throw new Error('too short');
      if (text.trim().startsWith('{')) {
        try {
          const json = JSON.parse(text);
          if (typeof json.contents === 'string') text = json.contents;
        } catch (e) { /* не JSON — оставляем как есть */ }
      }
      return text;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  async function fetchItchDevlogPosts(game, signal) {
    const source = ITCH_DEVLOG_SOURCES[game];
    if (!source) return [];

    const cached = readItchPostsCache();
    if (cached && cached.length) {
      console.log(`[GameUpdates] Посты Itch.io из кеша: ${cached.length}`);
      return cached;
    }

    const promises = VIDEO_PROXIES.map(proxyFn =>
      fetchViaProxy(proxyFn, source.rssUrl, signal)
        .then(text => {
          const posts = parseItchDevlogXml(text, source);
          if (!posts.length) throw new Error('no posts');
          return posts;
        })
    );

    try {
      const posts = await Promise.any(promises);
      if (posts && posts.length) {
        writeItchPostsCache(posts);
        console.log(`[GameUpdates] Посты Itch.io из сети: ${posts.length}`);
        return posts;
      }
      return [];
    } catch (e) {
      if (isAborted(e, signal)) return [];
      console.warn(`[GameUpdates] Не удалось загрузить Itch.io devlog для ${source.name}:`, e.message || e);
      return [];
    }
  }

  // ============================================================
  // Основные функции (адаптированы из существующего кода)
  // ============================================================

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

    window.addEventListener('languageChanged', () => {
      const container = document.getElementById('game-updates');
      if (!container) return;
      const parent = container.parentNode;
      const header = parent?.querySelector('.updates-header');
      if (header) {
        const btn = header.querySelector('.admin-update-btn');
        if (btn) {
          btn.innerHTML = sanitizeHtml(`<i class="fas fa-plus"></i> ${t('addUpdate')}`);
        }
      }
    });
  };

  window.refreshGameUpdates = (game) => {
    const cont = document.getElementById('game-updates');
    if (cont && cont.dataset.game === game) loadGameUpdates(cont, game);
  };

  async function loadGameUpdates(container, game) {
    container.innerHTML = sanitizeHtml(`<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p data-lang="loading">${t('loading')}</p></div>`);
    if (currentAbort) {
      currentAbort.controller.abort();
      currentAbort = null;
    }
    const { controller, timeoutId } = createAbortable(10000);
    currentAbort = { controller };

    try {
      const cacheKey = `game_issues_${game}`;
      let issues = await cacheGet(cacheKey);
      if (!issues) {
        issues = await loadIssues({ labels: `game:${game}`, state: 'open', per_page: 100, signal: controller.signal });
        await cacheSet(cacheKey, issues);
      }

      // GitHub обновления
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

      // Посты из Itch.io
      const itchPosts = await fetchItchDevlogPosts(game, controller.signal);
      // Объединяем и сортируем по дате (новые сначала)
      let allPosts = [...itchPosts, ...posts].sort((a, b) => b.date - a.date);

      if (allPosts.length === 0) {
        container.innerHTML = sanitizeHtml(`<p class="text-secondary" data-lang="noUpdates">${t('noUpdates')}</p>`);
        return;
      }

      container.innerHTML = '';
      const grid = createElement('div', 'projects-grid');
      const fragment = document.createDocumentFragment();
      allPosts.forEach(p => fragment.appendChild(createUpdateCard(p)));
      grid.appendChild(fragment);
      container.appendChild(grid);

      const parent = container.parentNode;
      let header = parent.querySelector('.updates-header');
      if (!header) {
        header = createElement('div', 'updates-header', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' });
        header.innerHTML = sanitizeHtml(`<div style="display:flex;align-items:center;gap:8px;"><i class="fas fa-clock-rotate-left" style="font-size:24px;color:var(--accent);"></i> <h2 style="margin:0;" data-lang="updatesTitle">${t('updatesTitle')}</h2></div>`);
        parent.insertBefore(header, container);
      }
      const existing = header.querySelector('.admin-update-btn');
      if (isAdmin() && hasScope('repo')) {
        if (!existing) {
          const btn = createElement('button', 'button admin-update-btn');
          btn.innerHTML = sanitizeHtml(`<i class="fas fa-plus"></i> ${t('addUpdate')}`);
          btn.addEventListener('click', async () => { if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js'); window.UIFeedback.openEditorModal('new', { game: currentGame }, 'update'); });
          header.appendChild(btn);
        } else {
          existing.innerHTML = sanitizeHtml(`<i class="fas fa-plus"></i> ${t('addUpdate')}`);
        }
      } else if (existing) existing.remove();
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('Update load error:', err);
      container.innerHTML = sanitizeHtml(`<p class="error-message" data-lang="updatesLoadError">${t('updatesLoadError')}</p>`);
    } finally {
      clearTimeout(timeoutId);
      if (currentAbort?.controller === controller) currentAbort = null;
    }
  }

  function createUpdateCard(post) {
    const card = createElement('div', 'project-card-link tilt-card', { cursor: 'pointer' });
    const inner = createElement('div', 'project-card');

    const imgMatch = (post.body || '').match(/!\[.*?\]\((.*?)\)/);
    const imgW = createElement('div', 'image-wrapper');
    const img = createElement('img', 'project-image', {}, { src: imgMatch?.[1] || 'images/default-news.webp', alt: post.title, loading: 'lazy' });
    img.onerror = () => img.src = 'images/default-news.webp';
    imgW.appendChild(img);

    const title = createElement('h3');
    title.textContent = post.title.length > 70 ? post.title.slice(0, 70) + '…' : post.title;

    const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
    meta.innerHTML = sanitizeHtml(`<i class="fas fa-user"></i> ${escapeHtml(post.author)} · <i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`);
    if (post.type === 'itch-post' && post.itchSource) {
      meta.innerHTML += sanitizeHtml(` · <i class="fab fa-itch-io"></i> ${escapeHtml(post.itchSource)}`);
    }

    const summary = extractSummary(post.body || '') || stripHtml(post.body || '').substring(0, 120) + '…';
    const preview = createElement('p', 'text-secondary', { fontSize: '13px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' });
    preview.textContent = summary;

    inner.append(imgW, title, meta, preview);

    // Кнопка "Читать далее" для постов Itch.io
    if (post.type === 'itch-post' && post.itchLink) {
      const readMore = createElement('a', 'button small', {
        marginTop: '8px', display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', gap: '6px', width: '100%'
      }, { href: post.itchLink, target: '_blank', rel: 'noopener noreferrer' });
      readMore.innerHTML = sanitizeHtml(`<i class="fas fa-external-link-alt" aria-hidden="true"></i> <span>${t('readMore')}</span>`);
      readMore.addEventListener('click', (e) => e.stopPropagation());
      inner.appendChild(readMore);
    }

    card.appendChild(inner);

    card.addEventListener('click', async () => {
      if (post.type === 'itch-post' && post.itchLink) {
        window.open(post.itchLink, '_blank', 'noopener,noreferrer');
        return;
      }
      if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
      window.UIFeedback.openFullModal({
        type: 'update',
        id: post.number || post.id,
        title: post.title,
        body: post.body,
        author: post.author,
        date: post.date,
        game: post.game,
        labels: post.labels
      });
    });

    return card;
  }
})();