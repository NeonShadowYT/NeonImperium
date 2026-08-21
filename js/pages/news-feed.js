// js/pages/news-feed.js – полная, с иконками, кнопкой "Добавить новость", повторными попытками
(function() {
  const {
    cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG,
    createAbortable, loadModule, createElement
  } = window.GithubCore;
  const { loadIssues, loadIssue } = window.GithubAPI;
  const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
  const { showToast } = window.UIUtils;

  const POSTS_CACHE_TTL = 3 * 60 * 1000;
  const VIDEOS_CACHE_TTL = 10 * 60 * 1000;
  const TWITCH_CACHE_TTL = 2 * 60 * 1000;
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000;

  let container, posts = [], videos = [], twitchStreams = [];
  let postsLoaded = false, videosLoaded = false, twitchLoaded = false;
  let currentUser = null;
  let loading = false;
  let currentAbortController = null;
  let retryCount = 0;

  const YT_CHANNELS = [
    { id: 'UC2pH2qNfh2sEAeYEGs1k_Lg', name: 'Neon Shadow' },
    { id: 'UCxuByf9jKs6ijiJyrMKBzdA', name: 'Оборотень' },
    { id: 'UCQKVSv62dLsK3QnfIke24uQ', name: 'Golden Creeper' },
    { id: 'UCcuqf3fNtZ2UP5MO89kVKLw', name: 'Mitmi' }
  ];

  const TWITCH_CHANNELS = ['sk0l3ra1', 'neoncyndows'];
  const DEFAULT_IMAGE = 'images/default-news.webp';

  function memoize(fn, maxSize = 100) {
    const cache = new Map();
    return function(...args) {
      const key = JSON.stringify(args);
      if (cache.has(key)) return cache.get(key);
      const result = fn.apply(this, args);
      if (cache.size >= maxSize) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
      }
      cache.set(key, result);
      return result;
    };
  }

  const renderMarkdownMemoized = memoize((text) => {
    if (!text) return '';
    if (window.marked) {
      if (typeof marked.setOptions === 'function') marked.setOptions({ gfm: true, breaks: true });
      if (typeof marked.parse === 'function') return marked.parse(text);
      else if (typeof marked === 'function') return marked(text);
    }
    return text.replace(/\n/g, '<br>');
  }, 100);

  // ---- Инициализация ----
  window.initNewsFeed = function() {
    const section = document.getElementById('news-section');
    if (!section) return;
    container = document.getElementById('news-feed');
    if (!container) return;

    // Создаём шапку новостей, если её нет
    let header = section.querySelector('.news-header');
    if (!header) {
      header = createElement('div', 'news-header', {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '20px',
        flexWrap: 'wrap',
        gap: '15px'
      });
      const t = window.I18n?.translate || (k => k);
      const div = createElement('div');
      const h2 = createElement('h2');
      h2.setAttribute('data-lang', 'newsTitle');
      h2.textContent = t('newsTitle');
      div.appendChild(h2);
      const p = createElement('p', 'text-secondary');
      p.setAttribute('data-lang', 'newsDesc');
      p.textContent = t('newsDesc');
      div.appendChild(p);
      header.appendChild(div);
      section.prepend(header);
    }

    currentUser = getCurrentUser();
    loadNewsFeed();

    window.addEventListener('github-login-success', e => {
      currentUser = e.detail.login;
      refreshNewsFeed();
    });
    window.addEventListener('github-logout', () => {
      currentUser = null;
      refreshNewsFeed();
    });
    window.addEventListener('github-issue-created', e => {
      const issue = e.detail;
      const typeLabel = issue.labels.find(l => l.name === 'type:news' || l.name === 'type:update');
      if (!typeLabel || !CONFIG.ALLOWED_AUTHORS.includes(issue.user.login)) return;
      cacheRemoveByPrefix('posts_news+update_v3');
      const newPost = {
        type: 'post',
        number: issue.number,
        title: issue.title,
        body: issue.body,
        author: issue.user.login,
        date: new Date(issue.created_at),
        labels: issue.labels.map(l => l.name),
        game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null
      };
      posts = [newPost, ...posts];
      renderMixed();
    });

    const postId = new URLSearchParams(location.search).get('post');
    if (postId) setTimeout(() => openPostFromUrl(postId), 1500);
  };

  window.refreshNewsFeed = function() {
    if (!container || loading) return;
    posts = []; videos = []; twitchStreams = [];
    postsLoaded = videosLoaded = twitchLoaded = false;
    loadNewsFeed();
  };

  // ---- Основная загрузка ----
  function loadNewsFeed() {
    if (loading) return;
    loading = true;
    if (currentAbortController) currentAbortController.abort();
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;
    const t = window.I18n?.translate || (k => k);
    container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p data-lang="newsLoading">${t('newsLoading')}</p></div>`;

    Promise.all([
      loadPostsWithRetry(signal),
      loadVideosWithRetry(signal),
      loadTwitchStreamsWithRetry(signal)
    ]).then(([loadedPosts, loadedVideos, loadedTwitch]) => {
      if (signal.aborted) return;
      posts = loadedPosts;
      videos = loadedVideos;
      twitchStreams = loadedTwitch;
      postsLoaded = videosLoaded = twitchLoaded = true;
      retryCount = 0;
      renderMixed();
    }).catch(err => {
      if (signal.aborted) return;
      console.error('[NewsFeed] Error loading:', err);
      postsLoaded = videosLoaded = twitchLoaded = true;
      posts = []; videos = []; twitchStreams = [];
      renderMixed();
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        setTimeout(loadNewsFeed, RETRY_DELAY * retryCount);
      }
    }).finally(() => {
      loading = false;
      currentAbortController = null;
    });
  }

  // ---- Загрузка постов с повторными попытками ----
  async function loadPostsWithRetry(signal) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await loadPosts(signal);
      } catch (err) {
        if (signal.aborted) throw err;
        console.warn(`[NewsFeed] Posts load attempt ${attempt+1} failed:`, err);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1)));
        } else {
          throw err;
        }
      }
    }
  }

  async function loadPosts(signal) {
    const cacheKey = 'posts_news+update_v3';
    const cached = cacheGet(cacheKey, POSTS_CACHE_TTL);
    if (cached) return cached.map(p => ({ ...p, date: new Date(p.date) }));

    const [news, updates] = await Promise.all([
      loadIssues({ labels: 'type:news', state: 'open', per_page: 10, page: 1 }, signal),
      loadIssues({ labels: 'type:update', state: 'open', per_page: 10, page: 1 }, signal)
    ]);

    if (signal.aborted) return [];
    const all = [...news, ...updates]
      .filter(i => i.state === 'open' && CONFIG.ALLOWED_AUTHORS.includes(i.user.login));

    const seen = new Set();
    const unique = all.filter(i => { if (seen.has(i.number)) return false; seen.add(i.number); return true; });

    const result = unique.map(i => {
      const isNews = i.labels.some(l => l.name === 'type:news');
      return {
        type: 'post',
        number: i.number,
        title: i.title,
        body: i.body,
        author: i.user.login,
        date: new Date(i.created_at),
        labels: i.labels.map(l => l.name),
        game: i.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null,
        postType: isNews ? 'news' : 'update'
      };
    });

    cacheSet(cacheKey, result.map(p => ({ ...p, date: p.date.toISOString() })));
    return result;
  }

  // ---- Загрузка видео (YouTube) ----
  async function loadVideosWithRetry(signal) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await loadVideos(signal);
      } catch (err) {
        if (signal.aborted) throw err;
        console.warn(`[NewsFeed] Videos load attempt ${attempt+1} failed:`, err);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1)));
        } else {
          throw err;
        }
      }
    }
  }

  async function loadVideos(signal) {
    const cacheKey = 'youtube_videos_rss2json_v3';
    const cached = cacheGet(cacheKey, VIDEOS_CACHE_TTL);
    if (cached) return cached.map(v => ({ ...v, date: new Date(v.date) }));

    const all = [];
    for (const ch of YT_CHANNELS) {
      if (signal.aborted) break;
      const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`)}`;
      try {
        const resp = await fetch(apiUrl, { signal });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data.status !== 'ok') continue;
        const items = data.items.slice(0, 3).map(item => {
          const vid = item.link.match(/(?:youtu\.be\/|v=)([^&\n?#]+)/)?.[1];
          if (!vid) return null;
          return {
            type: 'video',
            id: vid,
            title: item.title,
            author: ch.name,
            date: new Date(item.pubDate),
            thumbnail: item.thumbnail || `https://img.youtube.com/vi/${vid}/mqdefault.jpg`
          };
        }).filter(v => v);
        all.push(...items);
      } catch (e) {
        if (e.name === 'AbortError') break;
        console.warn('[NewsFeed] RSS error for', ch.name, e);
      }
    }
    const sorted = all.sort((a, b) => b.date - a.date).slice(0, 12);
    cacheSet(cacheKey, sorted.map(v => ({ ...v, date: v.date.toISOString() })));
    return sorted;
  }

  // ---- Загрузка Twitch стримов ----
  async function loadTwitchStreamsWithRetry(signal) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await loadTwitchStreams(signal);
      } catch (err) {
        if (signal.aborted) throw err;
        console.warn(`[NewsFeed] Twitch load attempt ${attempt+1} failed:`, err);
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1)));
        } else {
          throw err;
        }
      }
    }
  }

  async function loadTwitchStreams(signal) {
    const cacheKey = 'twitch_streams_v2';
    const cached = cacheGet(cacheKey, TWITCH_CACHE_TTL);
    if (cached) return cached.map(s => ({ ...s, date: new Date(s.date) }));

    const streams = [];
    // Пробуем GraphQL
    try {
      const clientId = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
      for (const channel of TWITCH_CHANNELS) {
        if (signal.aborted) break;
        const query = {
          operationName: "StreamMetadata",
          variables: { channelLogin: channel },
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash: "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890"
            }
          },
          query: `
            query StreamMetadata($channelLogin: String!) {
              user(login: $channelLogin) {
                stream {
                  id
                  game { name }
                  title
                  viewersCount
                  createdAt
                  thumbnailURL
                }
              }
            }
          `
        };
        const resp = await fetch('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Client-ID': clientId },
          body: JSON.stringify(query),
          signal
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        const streamData = data?.data?.user?.stream;
        if (streamData) {
          const t = window.I18n?.translate || (k => k);
          const viewers = streamData.viewersCount || 0;
          const title = streamData.title || `${t('stream')}: ${channel}`;
          const thumbnail = streamData.thumbnailURL || `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel}-320x180.jpg`;
          const embedUrl = `https://player.twitch.tv/?channel=${channel}&parent=${location.hostname}&autoplay=false`;
          streams.push({
            type: 'twitch',
            id: channel,
            title: `${title}${viewers ? ` (${viewers} ${t('viewers')})` : ''}`,
            game: streamData.game?.name || t('stream'),
            author: channel,
            date: new Date(streamData.createdAt || Date.now()),
            thumbnail,
            embedUrl
          });
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('[NewsFeed] Twitch GraphQL error:', e);
    }

    // Если стримов нет, пробуем альтернативный метод
    if (streams.length === 0) {
      try {
        for (const channel of TWITCH_CHANNELS) {
          if (signal.aborted) break;
          const url = `https://api.twitchinsights.net/v1/streams?channel=${channel}`;
          const resp = await fetch(url, { signal });
          if (!resp.ok) continue;
          const data = await resp.json();
          if (data.online !== 1) continue;
          const streamInfo = data.streams[0];
          if (!streamInfo) continue;
          const t = window.I18n?.translate || (k => k);
          const viewers = streamInfo[1] || 0;
          const thumbnail = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel}-320x180.jpg`;
          const embedUrl = `https://player.twitch.tv/?channel=${channel}&parent=${location.hostname}&autoplay=false`;
          streams.push({
            type: 'twitch',
            id: channel,
            title: `${t('stream')}: ${channel}${viewers ? ` (${viewers} ${t('viewers')})` : ''}`,
            game: streamInfo[2] || t('stream'),
            author: channel,
            date: new Date(),
            thumbnail,
            embedUrl
          });
        }
      } catch (e) {
        if (e.name !== 'AbortError') console.warn('[NewsFeed] Twitch insights error:', e);
      }
    }

    cacheSet(cacheKey, streams.map(s => ({ ...s, date: s.date.toISOString() })));
    return streams;
  }

  // ---- Рендеринг смешанного контента ----
  function renderMixed() {
    if (!postsLoaded || !videosLoaded || !twitchLoaded) return;
    const t = window.I18n?.translate || (k => k);
    const currentUser = getCurrentUser();

    // Фильтруем приватные посты
    const filteredPosts = posts.filter(p => {
      if (!p.labels.includes('private')) return true;
      if (isAdmin()) return true;
      const allowed = extractAllowed(p.body);
      return allowed && allowed.split(',').map(s => s.trim()).includes(currentUser);
    });

    let items = [];
    // Twitch стримы (всегда сверху)
    if (twitchStreams.length > 0) {
      twitchStreams.sort((a, b) => b.date - a.date);
      items = items.concat(twitchStreams);
    }
    // Видео
    const sortedVideos = videos.sort((a, b) => b.date - a.date);
    items = items.concat(sortedVideos);
    // Посты (новости и обновления)
    const sortedPosts = filteredPosts.sort((a, b) => b.date - a.date);
    items = items.concat(sortedPosts);

    const maxDisplay = 8;
    const showItems = items.slice(0, maxDisplay);

    const grid = createElement('div', 'projects-grid');
    if (showItems.length === 0) {
      grid.innerHTML = `<div class="empty-state"><i class="fas fa-newspaper"></i><p data-lang="newsNoItems">${t('newsNoItems')}</p></div>`;
    } else {
      const fragment = document.createDocumentFragment();
      showItems.forEach(item => {
        const card = createCard(item);
        fragment.appendChild(card);
      });
      grid.appendChild(fragment);
    }

    // Обновляем контейнер
    container.innerHTML = '';
    container.appendChild(grid);

    // Добавляем кнопку "Добавить новость" для админов
    const header = document.querySelector('.news-header');
    if (header) {
      const existing = header.querySelector('.admin-news-btn');
      if (isAdmin() && hasScope('repo')) {
        if (!existing) {
          const btn = createElement('button', 'button admin-news-btn');
          btn.setAttribute('data-lang', 'addNews');
          btn.innerHTML = `<i class="fas fa-plus"></i> ${t('addNews')}`;
          btn.addEventListener('click', async () => {
            if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
            window.UIFeedback.openEditorModal('new', { game: null }, 'news');
          });
          header.appendChild(btn);
        } else {
          existing.setAttribute('data-lang', 'addNews');
          existing.innerHTML = `<i class="fas fa-plus"></i> ${t('addNews')}`;
        }
      } else if (existing) {
        existing.remove();
      }
    }
  }

  // ---- Создание карточки ----
  function createCard(item) {
    const t = window.I18n?.translate || (k => k);
    const card = createElement('div', 'project-card-link card-interactive');
    const inner = createElement('div', 'project-card');

    let thumbnail = item.thumbnail || DEFAULT_IMAGE;
    let title = item.title || 'Без названия';
    let author = item.author || '';
    let date = item.date instanceof Date ? item.date.toLocaleDateString() : new Date(item.date).toLocaleDateString();

    // Иконка в зависимости от типа
    let iconHtml = '';
    if (item.type === 'post') {
      if (item.postType === 'news') {
        iconHtml = '<i class="fas fa-newspaper" style="font-size: 48px; color: var(--accent);"></i>';
      } else {
        iconHtml = '<i class="fas fa-clock-rotate-left" style="font-size: 48px; color: var(--accent);"></i>';
      }
    } else if (item.type === 'video') {
      iconHtml = '<i class="fab fa-youtube" style="font-size: 48px; color: #ff0000;"></i>';
    } else if (item.type === 'twitch') {
      iconHtml = '<i class="fab fa-twitch" style="font-size: 48px; color: #9146FF;"></i>';
    }

    // Изображение или иконка
    const imgWrapper = createElement('div', 'image-wrapper', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      position: 'relative',
      paddingBottom: '56.25%'
    });
    if (thumbnail && thumbnail !== DEFAULT_IMAGE) {
      const img = createElement('img', 'project-image', {
        position: 'absolute',
        top: 0, left: 0, width: '100%', height: '100%',
        objectFit: 'cover'
      }, { src: thumbnail, alt: title, loading: 'lazy' });
      img.onerror = () => img.src = DEFAULT_IMAGE;
      imgWrapper.appendChild(img);
    } else {
      // Если нет картинки, показываем иконку
      imgWrapper.style.paddingBottom = '0';
      imgWrapper.style.height = '180px';
      imgWrapper.style.display = 'flex';
      imgWrapper.style.alignItems = 'center';
      imgWrapper.style.justifyContent = 'center';
      imgWrapper.innerHTML = iconHtml || '<i class="fas fa-file-alt" style="font-size: 48px; color: var(--text-secondary);"></i>';
    }
    inner.appendChild(imgWrapper);

    // Заголовок
    const titleEl = createElement('h3', '', { cursor: 'pointer', margin: '8px 0 4px' });
    titleEl.textContent = title.length > 70 ? title.slice(0,70)+'…' : title;
    inner.appendChild(titleEl);

    // Метаданные (автор, дата)
    const meta = createElement('p', 'text-secondary', { fontSize: '12px', margin: '0 0 4px' });
    meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(author)} · <i class="fas fa-calendar-alt"></i> ${date}`;
    if (item.game) {
      meta.innerHTML += ` · <i class="fas fa-gamepad"></i> ${escapeHtml(item.game)}`;
    }
    inner.appendChild(meta);

    // Краткое описание (если есть)
    if (item.type === 'post' && item.body) {
      const summary = extractSummary(item.body) || stripHtml(item.body).substring(0,120)+'…';
      const preview = createElement('p', 'text-secondary', {
        fontSize: '13px',
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: '2',
        WebkitBoxOrient: 'vertical',
        margin: '4px 0 0'
      });
      preview.textContent = summary;
      inner.appendChild(preview);
    }

    card.appendChild(inner);

    // Клик для открытия
    card.addEventListener('click', () => {
      if (item.type === 'post') {
        if (!window.UIFeedback) {
          loadModule('js/features/ui-feedback.js').then(() => {
            window.UIFeedback.openFullModal({ ...item, id: item.number, date: item.date });
          }).catch(() => showToast(t('loadModulesError'), 'error'));
        } else {
          window.UIFeedback.openFullModal({ ...item, id: item.number, date: item.date });
        }
      } else {
        // Видео или Twitch – открываем в новой вкладке
        if (item.embedUrl) {
          window.open(item.embedUrl, '_blank');
        } else if (item.id) {
          window.open(`https://youtu.be/${item.id}`, '_blank');
        }
      }
    });

    return card;
  }

  // ---- Вспомогательные функции ----
  function extractAllowed(body) {
    const match = body?.match(/<!--\s*allowed:\s*(.*?)\s*-->/i);
    return match ? match[1].trim() : null;
  }

  function extractSummary(body) {
    const match = body?.match(/<!--\s*summary:\s*(.*?)\s*-->/i);
    return match ? match[1].trim() : null;
  }

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
  }

  async function openPostFromUrl(postId) {
    const t = window.I18n?.translate || (k => k);
    try {
      const issue = await loadIssue(postId);
      if (issue.state === 'closed') return showToast(t('postNotFound'), 'error');
      const item = {
        type: 'post',
        number: issue.number,
        title: issue.title,
        body: issue.body,
        author: issue.user.login,
        date: new Date(issue.created_at),
        game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null,
        labels: issue.labels.map(l => l.name),
        postType: issue.labels.some(l => l.name === 'type:news') ? 'news' : 'update'
      };
      if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
      if (!window.UIFeedback.canViewPost(issue.body, item.labels, getCurrentUser())) {
        return showToast(t('noAccess'), 'error');
      }
      window.UIFeedback.openFullModal(item);
    } catch (err) {
      showToast(t('postLoadError'), 'error');
    }
  }
})();