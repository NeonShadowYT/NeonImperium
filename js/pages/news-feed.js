// js/pages/news-feed.js
(function() {
  const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG, deduplicateByNumber, createAbortable, stripHtml, extractSummary, extractAllowed, decryptPrivateBody, loadModule, createElement } = window.GithubCore;
  const { loadIssues, loadIssue } = window.GithubAPI;
  const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
  const { showToast, createModal } = window.UIUtils;

  // Каналы YouTube
  const YT_CHANNELS = [
    { id: 'UC2pH2qNfh2sEAeYEGs1k_Lg', name: 'Neon Shadow' },
    { id: 'UCxuByf9jKs6ijiJyrMKBzdA', name: 'Оборотень' },
    { id: 'UCQKVSv62dLsK3QnfIke24uQ', name: 'Golden Creeper' },
    { id: 'UCcuqf3fNtZ2UP5MO89kVKLw', name: 'Mitmi' }
  ];

  // Список каналов Twitch для отображения в ленте
  const TWITCH_CHANNELS = [
    'sk0l3ra1',
    'neoncyndows'
  ];

  const DEFAULT_IMAGE = 'images/default-news.webp';

  let container, posts = [], videos = [], twitchStreams = [], postsLoaded = false, videosLoaded = false, twitchLoaded = false;
  let currentUser = null;
  let loading = false;
  let currentAbortController = null;

  async function ensureLoggedInAndGist() {
    if (getCurrentUser() && hasScope('gist')) return true;
    window.dispatchEvent(new CustomEvent('github-login-requested'));
    return new Promise((resolve) => {
      const onLogin = (e) => {
        if (e.detail?.scopes?.includes('gist')) {
          window.removeEventListener('github-login-success', onLogin);
          resolve(true);
        } else if (e.detail?.scopes) {
          showToast('Для закладок требуется scope "gist".', 'error');
          window.removeEventListener('github-login-success', onLogin);
          resolve(false);
        }
      };
      const onLogout = () => { window.removeEventListener('github-login-success', onLogin); window.removeEventListener('github-logout', onLogout); resolve(false); };
      window.addEventListener('github-login-success', onLogin);
      window.addEventListener('github-logout', onLogout);
      setTimeout(() => { window.removeEventListener('github-login-success', onLogin); window.removeEventListener('github-logout', onLogout); resolve(false); }, 60000);
    });
  }

  async function handleBookmark(item) {
    if (!(await ensureLoggedInAndGist())) { showToast('Необходимо войти с правами gist', 'error'); return; }
    if (!window.BookmarkStorage) {
      try {
        await loadModule('js/features/storage.js');
      } catch (e) {
        showToast('Не удалось загрузить хранилище', 'error');
        return;
      }
    }
    if (!window.BookmarkStorage) {
      showToast('Хранилище не загружено', 'error');
      return;
    }
    const bookmark = {
      url: item.type === 'video' ? `https://www.youtube.com/watch?v=${item.id}` :
            item.type === 'twitch' ? `https://www.twitch.tv/${item.id}` :
            `${location.origin}${location.pathname}?post=${item.number}`,
      title: item.title,
      type: item.type === 'video' ? 'video' : item.type === 'twitch' ? 'twitch' : 'post',
      thumbnail: item.thumbnail || DEFAULT_IMAGE,
      author: item.author,
      date: item.date,
      postData: item.type === 'post' ? { id: item.number, title: item.title, body: item.body, author: item.author, date: item.date instanceof Date ? item.date.toISOString() : item.date, labels: item.labels, game: item.game } : undefined,
      videoData: item.type === 'video' ? { id: item.id, service: 'youtube' } : undefined,
      twitchData: item.type === 'twitch' ? { channel: item.id } : undefined
    };
    try { await window.BookmarkStorage.addBookmark(bookmark); showToast('Добавлено в избранное', 'success'); } catch (err) { if (err.message !== 'duplicate') showToast('Ошибка: ' + err.message, 'error'); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const section = document.getElementById('news-section');
    if (!section) return;
    let header = section.querySelector('.news-header');
    if (!header) {
      header = createElement('div', 'news-header', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '15px' });
      header.innerHTML = '<div><h2 data-lang="newsTitle">📰 Последние новости</h2><p class="text-secondary" data-lang="newsDesc">Свежие видео, стримы и обновления</p></div>';
      section.prepend(header);
    }
    container = document.getElementById('news-feed');
    if (container) { currentUser = getCurrentUser(); loadNewsFeed(); }
    window.addEventListener('github-login-success', e => { currentUser = e.detail.login; refreshNewsFeed(); });
    window.addEventListener('github-logout', () => { currentUser = null; refreshNewsFeed(); });
    window.addEventListener('github-issue-created', e => {
      const issue = e.detail;
      const typeLabel = issue.labels.find(l => l.name === 'type:news' || l.name === 'type:update');
      if (!typeLabel || !CONFIG.ALLOWED_AUTHORS.includes(issue.user.login)) return;
      cacheRemoveByPrefix('posts_news+update_v3');
      const newPost = { type: 'post', number: issue.number, title: issue.title, body: issue.body, author: issue.user.login, date: new Date(issue.created_at), labels: issue.labels.map(l => l.name), game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null };
      posts = [newPost, ...posts];
      renderMixed();
    });
    const postId = new URLSearchParams(location.search).get('post');
    if (postId) setTimeout(() => openPostFromUrl(postId), 1500);
  });

  async function openPostFromUrl(postId) {
    try {
      const issue = await loadIssue(postId);
      if (issue.state === 'closed') return showToast('Пост закрыт', 'error');
      const item = { type: 'post', id: issue.number, title: issue.title, body: issue.body, author: issue.user.login, date: new Date(issue.created_at), game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null, labels: issue.labels.map(l => l.name) };
      if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
      if (!window.UIFeedback.canViewPost(issue.body, item.labels, currentUser)) return showToast('Нет доступа', 'error');
      window.UIFeedback.openFullModal(item);
    } catch { showToast('Ошибка загрузки', 'error'); }
  }

  window.refreshNewsFeed = () => { if (!container || loading) return; posts = []; videos = []; twitchStreams = []; postsLoaded = videosLoaded = twitchLoaded = false; loadNewsFeed(); };

  function loadNewsFeed() {
    if (loading) return;
    loading = true;
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    container.innerHTML = '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p data-lang="newsLoading">Загрузка новостей...</p></div>';
    
    console.log('[NewsFeed] Начинаем загрузку всех источников');
    Promise.all([ loadPosts(signal), loadVideos(signal), loadTwitchStreams(signal) ]).then(([loadedPosts, loadedVideos, loadedTwitch]) => {
      if (signal.aborted) return;
      posts = loadedPosts; videos = loadedVideos; twitchStreams = loadedTwitch;
      postsLoaded = videosLoaded = twitchLoaded = true;
      console.log(`[NewsFeed] Загружено: постов ${posts.length}, видео ${videos.length}, стримов ${twitchStreams.length}`);
      renderMixed();
    }).catch(err => {
      if (signal.aborted) return;
      console.error('[NewsFeed] Ошибка загрузки:', err);
      postsLoaded = videosLoaded = twitchLoaded = true;
      posts = []; videos = []; twitchStreams = [];
      renderMixed();
    }).finally(() => { loading = false; currentAbortController = null; });
  }

  // ---------- Загрузка YouTube видео ----------
  async function loadVideos(signal) {
    try { return await loadVideosFromRSS2JSON(signal); } catch { return []; }
  }

  async function loadVideosFromRSS2JSON(signal) {
    const cacheKey = 'youtube_videos_rss2json_v3';
    const cached = cacheGet(cacheKey, 30 * 60 * 1000);
    if (cached) return cached.map(v => ({ ...v, date: new Date(v.date) }));

    const all = [];
    for (const ch of YT_CHANNELS) {
      if (signal && signal.aborted) break;
      const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`)}`;
      try {
        const resp = await fetch(apiUrl, { signal });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data.status !== 'ok') continue;
        const items = data.items.slice(0, 3).map(item => {
          const vid = item.link.match(/(?:youtu\.be\/|v=)([^&\n?#]+)/)?.[1];
          if (!vid) return null;
          return { type: 'video', id: vid, title: item.title, author: ch.name, date: new Date(item.pubDate), thumbnail: item.thumbnail || `https://img.youtube.com/vi/${vid}/mqdefault.jpg` };
        }).filter(v => v);
        all.push(...items);
      } catch (e) {
        if (e.name === 'AbortError') break;
        console.warn('[NewsFeed] YouTube RSS ошибка для', ch.name, e);
      }
    }
    const sorted = all.sort((a, b) => b.date - a.date).slice(0, 12);
    cacheSet(cacheKey, sorted.map(v => ({ ...v, date: v.date.toISOString() })));
    return sorted;
  }

  // ---------- Загрузка стримов Twitch (с повторными попытками) ----------
  async function loadTwitchStreams(signal, retries = 2) {
    console.log('[NewsFeed] loadTwitchStreams вызвана');
    const cacheKey = 'twitch_streams_v1';
    const cached = cacheGet(cacheKey, 2 * 60 * 1000);
    if (cached) {
      console.log('[NewsFeed] Twitch стримы взяты из кеша:', cached.length);
      return cached.map(s => ({ ...s, date: new Date(s.date) }));
    }

    let attempt = 0;
    while (attempt < retries) {
      if (signal && signal.aborted) return [];
      try {
        const streams = await fetchTwitchStreams(signal);
        if (streams.length > 0 || attempt === retries - 1) {
          // Кешируем даже пустой результат, чтобы не долбить API при ошибках
          cacheSet(cacheKey, streams.map(s => ({ ...s, date: s.date.toISOString() })));
          console.log('[NewsFeed] Загружено стримов:', streams.length);
          return streams;
        }
      } catch (e) {
        if (e.name === 'AbortError') return [];
        console.warn(`[NewsFeed] Попытка ${attempt+1} загрузки стримов не удалась:`, e);
      }
      attempt++;
      // Ждём перед повторной попыткой
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
    console.log('[NewsFeed] Не удалось загрузить стримы после всех попыток');
    return [];
  }

  async function fetchTwitchStreams(signal) {
    const streams = [];
    for (const channel of TWITCH_CHANNELS) {
      if (signal && signal.aborted) break;
      try {
        // Получаем статус стрима
        const statusUrl = `https://decapi.me/twitch/stream/status?user=${channel}`;
        const statusResp = await fetch(statusUrl, { signal });
        if (!statusResp.ok) continue;
        const status = await statusResp.text();
        if (status.trim() !== 'online') continue;

        // Получаем название игры
        const gameUrl = `https://decapi.me/twitch/stream/game?user=${channel}`;
        const gameResp = await fetch(gameUrl, { signal });
        let game = 'стрим';
        if (gameResp.ok) {
          const gameText = await gameResp.text();
          if (gameText.trim()) game = gameText.trim();
        }

        // Получаем зрителей
        let viewers = '';
        const viewersUrl = `https://decapi.me/twitch/stream/viewers?user=${channel}`;
        const viewersResp = await fetch(viewersUrl, { signal });
        if (viewersResp.ok) {
          const viewersText = await viewersResp.text();
          if (viewersText.trim()) viewers = ` ${viewersText.trim()} зрителей`;
        }

        // Превью стрима
        const thumbnail = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel}-320x180.jpg`;

        // Embed-плеер (с parent = наш домен)
        const embedUrl = `https://player.twitch.tv/?channel=${channel}&parent=${location.hostname}&autoplay=false`;

        streams.push({
          type: 'twitch',
          id: channel,
          title: `Стрим: ${channel}${viewers}`,
          game: game,
          author: channel,
          date: new Date(),
          thumbnail: thumbnail,
          embedUrl: embedUrl
        });
        console.log(`[NewsFeed] Найден активный стрим: ${channel}`);
      } catch (e) {
        if (e.name === 'AbortError') break;
        console.warn(`[NewsFeed] Ошибка при проверке канала ${channel}:`, e);
      }
    }
    return streams;
  }

  // ---------- Загрузка постов ----------
  async function loadPosts(signal) {
    const cacheKey = 'posts_news+update_v3';
    const cached = cacheGet(cacheKey);
    if (cached) return cached.map(p => ({ ...p, date: new Date(p.date) }));

    const [newsResp, updatesResp] = await Promise.all([
      fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?state=open&per_page=10&page=1&labels=type:news`, { signal }),
      fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?state=open&per_page=10&page=1&labels=type:update`, { signal })
    ]);
    if (signal && signal.aborted) return [];
    const news = newsResp.ok ? await newsResp.json() : [];
    const updates = updatesResp.ok ? await updatesResp.json() : [];
    const all = deduplicateByNumber([...news, ...updates]).filter(i => i.state === 'open' && CONFIG.ALLOWED_AUTHORS.includes(i.user.login));
    const result = all.map(i => ({ type: 'post', number: i.number, title: i.title, body: i.body, author: i.user.login, date: new Date(i.created_at), labels: i.labels.map(l => l.name), game: i.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null }));
    cacheSet(cacheKey, result.map(p => ({ ...p, date: p.date.toISOString() })));
    return result;
  }

  // ---------- Рендер смешанной ленты (стримы имеют высший приоритет) ----------
  function renderMixed() {
    if (!postsLoaded || !videosLoaded || !twitchLoaded) return;

    // Фильтруем посты с учётом приватности
    const filteredPosts = posts.filter(p => {
      if (!p.labels.includes('private')) return true;
      if (isAdmin()) return true;
      const allowed = extractAllowed(p.body);
      return allowed && allowed.split(',').map(s => s.trim()).includes(currentUser);
    });

    // Стримы идут первыми (они уже отсортированы по дате, но мы просто добавим их в начало)
    let items = [];

    // Добавляем стримы (самые свежие — в начало)
    if (twitchStreams.length > 0) {
      // Сортируем стримы по дате (новые сверху) — хотя они все имеют текущую дату
      twitchStreams.sort((a, b) => b.date - a.date);
      items = items.concat(twitchStreams);
    }

    // Добавляем видео
    const sortedVideos = videos.sort((a, b) => b.date - a.date);
    items = items.concat(sortedVideos);

    // Добавляем посты
    const sortedPosts = filteredPosts.sort((a, b) => b.date - a.date);
    items = items.concat(sortedPosts);

    // Ограничиваем количество отображаемых элементов (например, 8, чтобы стримы точно попали)
    const maxDisplay = 8;
    const showItems = items.slice(0, maxDisplay);

    const grid = createElement('div', 'projects-grid');
    if (showItems.length === 0) {
      grid.innerHTML = '<div class="empty-state"><i class="fas fa-newspaper"></i><p data-lang="newsNoItems">Пока нет новостей</p></div>';
    } else {
      const fragment = document.createDocumentFragment();
      showItems.forEach(item => {
        let card;
        if (item.type === 'video') {
          card = createVideoCard(item);
        } else if (item.type === 'twitch') {
          card = createVideoCard(item); // используем ту же функцию, т.к. структура похожа
        } else {
          card = createPostCard(item);
        }
        fragment.appendChild(card);
      });
      grid.appendChild(fragment);
    }

    container.innerHTML = '';
    container.appendChild(grid);

    // Добавляем кнопку "Добавить новость" для админов
    const header = document.querySelector('.news-header');
    if (header) {
      const existing = header.querySelector('.admin-news-btn');
      if (isAdmin() && hasScope('repo')) {
        if (!existing) {
          const btn = createElement('button', 'button admin-news-btn');
          btn.innerHTML = '<i class="fas fa-plus"></i> Добавить новость';
          btn.addEventListener('click', async () => {
            if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
            window.UIFeedback.openEditorModal('new', { game: null }, 'news');
          });
          header.appendChild(btn);
        }
      } else if (existing) existing.remove();
    }
  }

  // ---------- Создание карточки для видео (YouTube или Twitch) ----------
  function createVideoCard(video) {
    const card = createElement('div', 'project-card-link card-interactive');
    const inner = createElement('div', 'project-card');
    const imgW = createElement('div', 'image-wrapper');
    const img = createElement('img', 'project-image', {}, { src: video.thumbnail, alt: video.title, loading: 'lazy' });
    imgW.appendChild(img);
    inner.appendChild(imgW);

    const titleEl = createElement('h3', '', { cursor: 'default' });
    titleEl.textContent = video.title.length > 70 ? video.title.slice(0,70)+'…' : video.title;
    inner.appendChild(titleEl);

    const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
    const authorName = video.author || (video.type === 'twitch' ? video.id : '');
    const dateStr = video.date instanceof Date ? video.date.toLocaleDateString() : new Date(video.date).toLocaleDateString();
    meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(authorName)} · <i class="fas fa-calendar-alt"></i> ${dateStr}`;
    if (video.type === 'twitch' && video.game) {
      meta.innerHTML += ` · 🎮 ${escapeHtml(video.game)}`;
    }
    inner.appendChild(meta);

    // Кнопка избранного (если есть gist)
    if (currentUser && hasScope('gist')) {
      const favBtn = createElement('div', 'news-bookmark-btn', {}, { title: 'В избранное' });
      favBtn.innerHTML = '<i class="far fa-bookmark"></i>';
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleBookmark(video);
      });
      inner.appendChild(favBtn);
    }

    card.appendChild(inner);

    // При клике на карточку загружаем iframe
    card.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('.news-bookmark-btn')) return;
      const mediaContainer = card.querySelector('.image-wrapper');
      if (!mediaContainer || mediaContainer.querySelector('iframe')) return;

      let iframeSrc;
      if (video.type === 'twitch') {
        iframeSrc = video.embedUrl || `https://player.twitch.tv/?channel=${video.id}&parent=${location.hostname}&autoplay=false`;
      } else {
        iframeSrc = `https://www.youtube.com/embed/${video.id}`;
      }

      const iframe = createElement('iframe', '', {
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        border: 'none', borderRadius: '12px'
      });
      iframe.src = iframeSrc;
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.loading = 'lazy';
      iframe.allow = 'autoplay; encrypted-media; gyroscope; picture-in-picture';
      iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms allow-presentation';
      mediaContainer.innerHTML = '';
      mediaContainer.style.background = '#000';
      mediaContainer.appendChild(iframe);
    });

    return card;
  }

  // ---------- Создание карточки поста ----------
  function createPostCard(post) {
    let previewBody = post.body;
    const allowed = extractAllowed(post.body);
    if (post.labels.includes('private') && allowed && currentUser && allowed.split(',').map(s=>s.trim()).includes(currentUser)) {
      try { previewBody = decryptPrivateBody(post.body, allowed); } catch {}
    }
    const card = createElement('div', 'project-card-link card-interactive');
    const inner = createElement('div', 'project-card');

    const imgMatch = previewBody.match(/!\[.*?\]\((.*?)\)/);
    const imgW = createElement('div', 'image-wrapper');
    const img = createElement('img', 'project-image', {}, { src: imgMatch?.[1] || DEFAULT_IMAGE, alt: post.title, loading: 'lazy' });
    img.onerror = () => img.src = DEFAULT_IMAGE;
    imgW.appendChild(img);
    inner.appendChild(imgW);

    const titleEl = createElement('h3', '', { cursor: 'pointer' });
    titleEl.textContent = post.title.length > 70 ? post.title.slice(0,70)+'…' : post.title;
    inner.appendChild(titleEl);

    const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
    meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(post.author)} · <i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`;
    const summary = extractSummary(previewBody) || stripHtml(previewBody).substring(0,120)+'…';
    const preview = createElement('p', 'text-secondary', { fontSize: '13px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' });
    preview.textContent = summary;
    inner.append(meta, preview);

    if (currentUser && hasScope('gist')) {
      const favBtn = createElement('div', 'news-bookmark-btn', {}, { title: 'В избранное' });
      favBtn.innerHTML = '<i class="far fa-bookmark"></i>';
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleBookmark({ type: 'post', ...post, thumbnail: imgMatch?.[1] || DEFAULT_IMAGE });
      });
      inner.appendChild(favBtn);
    }

    card.appendChild(inner);
    card.addEventListener('click', async (e) => {
      if (!e.target.closest('button') && !e.target.closest('.news-bookmark-btn')) {
        if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
        window.UIFeedback.openFullModal({ type: 'post', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game, labels: post.labels });
      }
    });
    return card;
  }

})();