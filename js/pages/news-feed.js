// js/pages/news-feed.js – единый менеджер новостей с кешированием, скелетоном и отказоустойчивостью
(function() {
    const {
        cacheGet, cacheSet, cacheRemoveByPrefix,
        escapeHtml, createElement, debounce, loadModule,
        createAbortable, CONFIG
    } = window.GithubCore;

    const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
    const { showToast } = window.UIUtils;

    // ---------- Конфигурация ----------
    const CACHE_KEY = 'news_feed_data_v2';
    const CACHE_TTL = 5 * 60 * 1000;           // 5 минут
    const STALE_WHILE_REVALIDATE = true;
    const SOURCE_TIMEOUT = 10000;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;
    const MAX_DISPLAY_ITEMS = 6;

    // ---------- Внутреннее состояние ----------
    let currentItems = [];
    let currentUser = null;
    let isLoading = false;
    let abortController = null;
    let container = null;
    let scheduledRefresh = null;

    // ---------- Вспомогательные функции ----------
    const t = (key) => window.I18n?.translate(key) || key;

    function normalizeItem(item) {
        let date = item.date;
        if (!(date instanceof Date)) {
            date = new Date(date);
            if (isNaN(date.getTime())) {
                date = new Date();
            }
        }
        return {
            type: item.type || 'post',
            id: item.id || item.number || item.videoId || item.channel || '',
            title: item.title || 'Без названия',
            author: item.author || 'Unknown',
            date: date,
            thumbnail: item.thumbnail || null,
            embedUrl: item.embedUrl || null,
            body: item.body || null,
            labels: item.labels || [],
            game: item.game || null,
            videoData: item.videoData || null,
            twitchData: item.twitchData || null,
        };
    }

    function normalizeItems(items) {
        return items.map(item => normalizeItem(item));
    }

    // ---------- Парсинг YouTube (дублируем из common-init, но можно использовать глобальную, если есть) ----------
    function parseYouTubeUrl(url) {
        try {
            const parsed = new URL(url);
            const isYoutube = parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be');
            if (!isYoutube) return null;

            let videoId = null;
            let playlistId = null;
            let start = null;

            if (parsed.hostname.includes('youtu.be')) {
                const pathParts = parsed.pathname.split('/').filter(p => p);
                if (pathParts.length > 0) videoId = pathParts[0];
            }

            const params = new URLSearchParams(parsed.search);
            if (params.has('v')) videoId = params.get('v');
            if (params.has('list')) playlistId = params.get('list');
            if (params.has('t')) start = params.get('t');
            else if (params.has('start')) start = params.get('start');

            if (!videoId && parsed.pathname.includes('/embed/')) {
                const parts = parsed.pathname.split('/embed/');
                if (parts.length > 1) {
                    const idPart = parts[1].split('?')[0];
                    if (idPart && idPart !== 'videoseries') videoId = idPart;
                }
            }
            if (!videoId && parsed.pathname.includes('/watch/')) {
                const parts = parsed.pathname.split('/watch/');
                if (parts.length > 1) {
                    const idPart = parts[1].split('?')[0];
                    if (idPart && idPart !== 'videoseries') videoId = idPart;
                }
            }

            if (!videoId && playlistId) {
                let embedUrl = `https://www.youtube-nocookie.com/embed/videoseries?list=${playlistId}`;
                if (start) embedUrl += `&start=${start}`;
                embedUrl += `&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
                return { embedUrl, videoId: null, playlistId, start };
            }

            if (videoId) {
                let embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
                const queryParams = new URLSearchParams();
                queryParams.set('rel', '0');
                queryParams.set('modestbranding', '1');
                queryParams.set('playsinline', '1');
                queryParams.set('origin', location.origin);
                if (playlistId) queryParams.set('list', playlistId);
                if (start) queryParams.set('start', start);
                const qs = queryParams.toString();
                if (qs) embedUrl += '?' + qs;
                return { embedUrl, videoId, playlistId, start };
            }

            if (parsed.pathname.includes('/playlist')) {
                const listParam = params.get('list');
                if (listParam) {
                    let embedUrl = `https://www.youtube-nocookie.com/embed/videoseries?list=${listParam}`;
                    if (start) embedUrl += `&start=${start}`;
                    embedUrl += `&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
                    return { embedUrl, videoId: null, playlistId: listParam, start };
                }
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    // ---------- Загрузка источников с повторами ----------
    async function fetchWithRetry(fn, context, retries = MAX_RETRIES) {
        let lastError;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err;
                if (attempt < retries) {
                    const delay = RETRY_DELAY * Math.pow(2, attempt);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
        throw lastError;
    }

    // ---------- Загрузка постов (GitHub Issues) ----------
    async function loadPosts(signal) {
        if (window.RateLimits && !window.RateLimits.checkLimit('posts')) {
            console.warn('[NewsFeed] Лимит постов исчерпан, пропускаем запрос');
            return [];
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SOURCE_TIMEOUT);
        const combinedSignal = signal ? new AbortController() : null;
        if (signal) {
            signal.addEventListener('abort', () => controller.abort());
        }

        try {
            const news = await window.GithubAPI.loadIssues({
                labels: 'type:news',
                state: 'open',
                per_page: 10,
                signal: controller.signal
            });
            const updates = await window.GithubAPI.loadIssues({
                labels: 'type:update',
                state: 'open',
                per_page: 10,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const all = window.GithubCore.deduplicateByNumber([...news, ...updates])
                .filter(i => i.state === 'open' && CONFIG.ALLOWED_AUTHORS.includes(i.user.login));

            const currentUser = getCurrentUser();
            return all.map(i => {
                const labels = i.labels.map(l => l.name);
                if (labels.includes('private')) {
                    const allowed = window.GithubCore.extractAllowed(i.body);
                    if (!allowed || !allowed.split(',').map(s => s.trim()).includes(currentUser)) {
                        return null;
                    }
                }
                return normalizeItem({
                    type: 'post',
                    number: i.number,
                    title: i.title,
                    body: i.body,
                    author: i.user.login,
                    date: new Date(i.created_at),
                    labels: labels,
                    game: labels.find(l => l.startsWith('game:'))?.split(':')[1] || null,
                    thumbnail: null
                });
            }).filter(Boolean);
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') throw err;
            console.warn('[NewsFeed] Ошибка загрузки постов:', err);
            throw err;
        }
    }

    // ---------- Загрузка видео (YouTube через RSS) ----------
    async function loadVideos(signal) {
        const YT_CHANNELS = [
            { id: 'UC2pH2qNfh2sEAeYEGs1k_Lg', name: 'Neon Shadow' },
            { id: 'UCxuByf9jKs6ijiJyrMKBzdA', name: 'Оборотень' },
            { id: 'UCQKVSv62dLsK3QnfIke24uQ', name: 'Golden Creeper' },
            { id: 'UCcuqf3fNtZ2UP5MO89kVKLw', name: 'Mitmi' }
        ];

        const all = [];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SOURCE_TIMEOUT);
        const combinedSignal = signal ? new AbortController() : null;
        if (signal) {
            signal.addEventListener('abort', () => controller.abort());
        }

        try {
            for (const ch of YT_CHANNELS) {
                if (controller.signal.aborted) break;
                const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`)}`;
                try {
                    const resp = await fetch(url, { signal: controller.signal });
                    if (!resp.ok) continue;
                    const data = await resp.json();
                    if (data.status !== 'ok') continue;
                    const items = data.items.slice(0, 3).map(item => {
                        const vid = item.link.match(/(?:youtu\.be\/|v=)([^&\n?#]+)/)?.[1];
                        if (!vid) return null;
                        // Используем парсер для получения embed-ссылки с origin
                        const parsed = parseYouTubeUrl(item.link);
                        const embedUrl = parsed ? parsed.embedUrl : null;
                        return normalizeItem({
                            type: 'video',
                            id: vid,
                            title: item.title,
                            author: ch.name,
                            date: new Date(item.pubDate),
                            thumbnail: item.thumbnail || `https://img.youtube.com/vi/${vid}/mqdefault.jpg`,
                            embedUrl: embedUrl || `https://www.youtube-nocookie.com/embed/${vid}?rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`,
                            videoData: { service: 'youtube', id: vid }
                        });
                    }).filter(v => v);
                    all.push(...items);
                } catch (e) {
                    if (e.name === 'AbortError') break;
                    console.warn(`[NewsFeed] Ошибка RSS для канала ${ch.name}:`, e);
                }
            }
            clearTimeout(timeoutId);
            all.sort((a, b) => b.date - a.date);
            return all.slice(0, 12);
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') throw err;
            console.warn('[NewsFeed] Ошибка загрузки видео:', err);
            throw err;
        }
    }

    // ---------- Загрузка стримов Twitch ----------
    async function loadTwitchStreams(signal) {
        const TWITCH_CHANNELS = ['sk0l3ra1', 'neoncyndows'];
        const streams = [];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SOURCE_TIMEOUT);
        if (signal) {
            signal.addEventListener('abort', () => controller.abort());
        }

        try {
            for (const channel of TWITCH_CHANNELS) {
                if (controller.signal.aborted) break;
                try {
                    const url = `https://api.twitchinsights.net/v1/streams?channel=${channel}`;
                    const resp = await fetch(url, { signal: controller.signal });
                    if (!resp.ok) continue;
                    const data = await resp.json();
                    if (data.online !== 1) continue;
                    const info = data.streams[0];
                    if (!info) continue;
                    const game = info[2] || 'Игра';
                    const viewers = info[1] || 0;
                    streams.push(normalizeItem({
                        type: 'twitch',
                        id: channel,
                        title: `${t('stream')}: ${channel}${viewers ? ` (${viewers} ${t('viewers')})` : ''}`,
                        author: channel,
                        date: new Date(),
                        thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel}-320x180.jpg`,
                        embedUrl: `https://player.twitch.tv/?channel=${channel}&parent=${location.hostname}&autoplay=false`,
                        twitchData: { channel, game, viewers }
                    }));
                } catch (e) {
                    if (e.name === 'AbortError') break;
                    console.warn(`[NewsFeed] Ошибка загрузки стрима ${channel}:`, e);
                }
            }
            clearTimeout(timeoutId);
            streams.sort((a, b) => b.date - a.date);
            return streams;
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') throw err;
            console.warn('[NewsFeed] Ошибка загрузки стримов:', err);
            throw err;
        }
    }

    // ---------- Основная функция fetchNewsFeed ----------
    async function fetchNewsFeed({ signal, forceRefresh = false, maxAge = CACHE_TTL } = {}) {
        const cached = cacheGet(CACHE_KEY, maxAge);
        if (cached && !forceRefresh) {
            const items = normalizeItems(cached.items || []);
            console.log(`[NewsFeed] Загрузка из кеша: ${items.length} элементов`);
            if (navigator.onLine) {
                scheduleBackgroundRefresh();
            }
            return { items, fromCache: true, isStale: false };
        }

        if (isLoading) {
            return new Promise((resolve) => {
                const check = () => {
                    if (!isLoading) {
                        const fresh = cacheGet(CACHE_KEY, maxAge);
                        if (fresh) {
                            const items = normalizeItems(fresh.items || []);
                            resolve({ items, fromCache: true, isStale: false });
                        } else {
                            resolve({ items: [], fromCache: false, isStale: false });
                        }
                    } else {
                        setTimeout(check, 100);
                    }
                };
                check();
            });
        }

        isLoading = true;
        if (abortController) {
            abortController.abort();
        }
        abortController = new AbortController();
        const combinedSignal = signal ? new AbortController() : null;
        if (signal) {
            signal.addEventListener('abort', () => abortController.abort());
        }

        try {
            console.log('[NewsFeed] Загрузка из сети...');
            const postsPromise = fetchWithRetry(() => loadPosts(abortController.signal), 'posts');
            const videosPromise = fetchWithRetry(() => loadVideos(abortController.signal), 'videos');
            const twitchPromise = fetchWithRetry(() => loadTwitchStreams(abortController.signal), 'twitch');

            const results = await Promise.allSettled([postsPromise, videosPromise, twitchPromise]);

            let allItems = [];
            let errorCount = 0;
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    allItems = allItems.concat(result.value);
                } else {
                    errorCount++;
                    const source = ['посты', 'видео', 'стримы'][index];
                    console.warn(`[NewsFeed] Не удалось загрузить ${source}:`, result.reason);
                }
            });

            allItems.sort((a, b) => b.date - a.date);
            const limited = allItems.slice(0, 20);

            cacheSet(CACHE_KEY, { items: limited, timestamp: Date.now() });

            console.log(`[NewsFeed] Загружено: ${limited.length} элементов (посты: ${results[0].status === 'fulfilled' ? results[0].value.length : 0}, видео: ${results[1].status === 'fulfilled' ? results[1].value.length : 0}, стримы: ${results[2].status === 'fulfilled' ? results[2].value.length : 0})`);

            currentItems = limited;
            return { items: limited, fromCache: false, isStale: false };
        } catch (err) {
            console.error('[NewsFeed] Критическая ошибка загрузки:', err);
            const stale = cacheGet(CACHE_KEY, Infinity);
            if (stale) {
                const items = normalizeItems(stale.items || []);
                console.warn('[NewsFeed] Возвращаем устаревший кеш');
                return { items, fromCache: true, isStale: true };
            }
            throw err;
        } finally {
            isLoading = false;
            abortController = null;
        }
    }

    // ---------- Фоновое обновление ----------
    let backgroundRefreshScheduled = false;
    function scheduleBackgroundRefresh() {
        if (backgroundRefreshScheduled) return;
        backgroundRefreshScheduled = true;
        setTimeout(async () => {
            try {
                if (!navigator.onLine) return;
                const lastUpdate = cacheGet(CACHE_KEY + '_last_update', Infinity);
                if (lastUpdate && Date.now() - lastUpdate < CACHE_TTL / 2) {
                    backgroundRefreshScheduled = false;
                    return;
                }
                console.log('[NewsFeed] Фоновое обновление...');
                const result = await fetchNewsFeed({ forceRefresh: true });
                if (result && result.items.length > 0) {
                    if (container) {
                        renderNewsFeed(result.items);
                    }
                    cacheSet(CACHE_KEY + '_last_update', Date.now());
                }
            } catch (e) {
                console.warn('[NewsFeed] Фоновое обновление не удалось:', e);
            } finally {
                backgroundRefreshScheduled = false;
            }
        }, 1000);
    }

    // ---------- Рендеринг ----------
    function renderSkeleton(count = 6) {
        const grid = createElement('div', 'projects-grid skeleton-grid');
        for (let i = 0; i < count; i++) {
            const card = createElement('div', 'project-card-link skeleton-card', { animationDelay: `${i * 0.05}s` });
            card.innerHTML = `
                <div class="project-card">
                    <div class="image-wrapper skeleton-image"></div>
                    <div class="skeleton-title"></div>
                    <div class="skeleton-text"></div>
                    <div class="skeleton-text short"></div>
                </div>
            `;
            grid.appendChild(card);
        }
        return grid;
    }

    function renderNewsFeed(items) {
        if (!container) return;

        const displayItems = items.slice(0, MAX_DISPLAY_ITEMS);

        let header = container.parentNode?.querySelector('.news-header');
        if (!header) {
            header = createElement('div', 'news-header', {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '20px',
                flexWrap: 'wrap',
                gap: '15px'
            });
            const titleDiv = createElement('div');
            titleDiv.innerHTML = `
                <h2>
                    <i class="fas fa-newspaper" style="color: var(--accent); margin-right: 8px;"></i>
                    <span data-lang="newsTitle">${t('newsTitle')}</span>
                </h2>
                <p class="text-secondary" data-lang="newsDesc">${t('newsDesc')}</p>
            `;
            header.appendChild(titleDiv);
            container.parentNode.insertBefore(header, container);
        }

        const existingBtn = header.querySelector('.admin-news-btn');
        if (isAdmin() && hasScope('repo')) {
            if (!existingBtn) {
                const btn = createElement('button', 'button admin-news-btn');
                btn.innerHTML = `<i class="fas fa-plus"></i> ${t('addNews')}`;
                btn.addEventListener('click', async () => {
                    if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
                    window.UIFeedback.openEditorModal('new', { game: null }, 'news');
                });
                header.appendChild(btn);
            } else {
                existingBtn.innerHTML = `<i class="fas fa-plus"></i> ${t('addNews')}`;
            }
        } else if (existingBtn) {
            existingBtn.remove();
        }

        if (displayItems.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-newspaper"></i>
                    <p data-lang="newsNoItems">${t('newsNoItems')}</p>
                    <button class="button small" id="news-retry-btn"><i class="fas fa-sync"></i> ${t('newsRetryVideo')}</button>
                </div>
            `;
            const retryBtn = container.querySelector('#news-retry-btn');
            if (retryBtn) retryBtn.addEventListener('click', () => refreshNewsFeed());
            return;
        }

        const grid = createElement('div', 'projects-grid');
        const fragment = document.createDocumentFragment();

        displayItems.forEach(item => {
            const card = createNewsCard(item);
            fragment.appendChild(card);
        });

        grid.appendChild(fragment);
        container.innerHTML = '';
        container.appendChild(grid);

        container.querySelectorAll('[data-lang]').forEach(el => {
            const key = el.getAttribute('data-lang');
            if (key) el.textContent = t(key);
        });
    }

    function createNewsCard(item) {
        const cardWrapper = createElement('div', 'project-card-link card-interactive');

        const card = createElement('div', 'project-card');
        const imgWrapper = createElement('div', 'image-wrapper');
        const img = createElement('img', 'project-image', {}, {
            src: item.thumbnail || 'images/default-news.webp',
            alt: item.title,
            loading: 'lazy'
        });
        img.onerror = () => img.src = 'images/default-news.webp';
        imgWrapper.appendChild(img);
        card.appendChild(imgWrapper);

        const title = createElement('h3');
        title.textContent = item.title.length > 70 ? item.title.slice(0, 70) + '…' : item.title;
        card.appendChild(title);

        const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
        const dateStr = item.date.toLocaleDateString();
        meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(item.author)} · <i class="fas fa-calendar-alt"></i> ${dateStr}`;
        if (item.type === 'twitch' && item.twitchData) {
            meta.innerHTML += ` · 🎮 ${escapeHtml(item.twitchData.game)}`;
        }
        card.appendChild(meta);

        if (item.type === 'post' && item.body) {
            const summary = window.GithubCore.extractSummary(item.body) || item.body.replace(/\n/g, ' ').substring(0, 120) + '…';
            const preview = createElement('p', 'text-secondary', {
                fontSize: '13px',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: '2',
                WebkitBoxOrient: 'vertical'
            });
            preview.textContent = summary;
            card.appendChild(preview);
        }

        const currentUser = getCurrentUser();
        if (currentUser && hasScope('gist')) {
            const favBtn = createElement('div', 'news-bookmark-btn', {}, { title: t('addToFavorites') });
            favBtn.innerHTML = '<i class="far fa-bookmark"></i>';
            favBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!window.BookmarkStorage) {
                    try {
                        if (window.loadStorageModules) {
                            await window.loadStorageModules();
                        } else {
                            const modules = [
                                'js/features/storage/core.js',
                                'js/features/storage/metadata.js',
                                'js/features/storage/manager.js',
                                'js/features/storage/ui.js',
                                'js/features/storage/index.js'
                            ];
                            for (const src of modules) {
                                await window.Utils.loadModule(src);
                            }
                        }
                    } catch (err) {
                        showToast(t('loadModulesError'), 'error');
                        return;
                    }
                }
                if (!window.BookmarkStorage) {
                    showToast(t('loadModulesError'), 'error');
                    return;
                }
                const bookmark = {
                    url: item.type === 'post' ? `${location.origin}${location.pathname}?post=${item.id}` :
                          item.type === 'video' ? `https://youtu.be/${item.id}` :
                          `https://twitch.tv/${item.id}`,
                    title: item.title,
                    type: item.type === 'post' ? 'post' : 'video',
                    thumbnail: item.thumbnail || 'images/default-news.webp',
                    author: item.author,
                    date: item.date,
                    postData: item.type === 'post' ? { id: item.id, title: item.title, body: item.body, author: item.author, date: item.date.toISOString(), labels: item.labels, game: item.game } : undefined,
                    videoData: item.type === 'video' ? { id: item.id, service: 'youtube' } : undefined,
                    twitchData: item.type === 'twitch' ? { channel: item.id } : undefined
                };
                window.BookmarkStorage.addBookmark(bookmark)
                    .then(() => showToast(t('addToFavorites'), 'success'))
                    .catch(err => { if (err.message !== 'duplicate') showToast(t('loadError') + ': ' + err.message, 'error'); });
            });
            card.appendChild(favBtn);
        }

        cardWrapper.appendChild(card);

        cardWrapper.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('.news-bookmark-btn')) return;
            if (item.type === 'post') {
                if (!window.UIFeedback) {
                    loadModule('js/features/ui-feedback.js').catch(() => {});
                    return;
                }
                window.UIFeedback.openFullModal({
                    type: 'post',
                    id: item.id,
                    title: item.title,
                    body: item.body,
                    author: item.author,
                    date: item.date,
                    game: item.game,
                    labels: item.labels
                });
            } else {
                // Видео или стрим – открываем плеер прямо в карточке
                const iframe = createElement('iframe', '', {
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                    border: 'none', borderRadius: '12px'
                });
                let embedUrl = item.embedUrl;
                if (!embedUrl) {
                    if (item.type === 'video' && item.id) {
                        // Пробуем парсер
                        const parsed = parseYouTubeUrl(`https://youtu.be/${item.id}`);
                        embedUrl = parsed ? parsed.embedUrl : `https://www.youtube-nocookie.com/embed/${item.id}?rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
                    } else if (item.type === 'twitch' && item.id) {
                        embedUrl = `https://player.twitch.tv/?channel=${item.id}&parent=${location.hostname}&autoplay=false`;
                    }
                }
                iframe.src = embedUrl;
                iframe.setAttribute('allowfullscreen', 'true');
                iframe.allow = 'autoplay; encrypted-media; gyroscope; picture-in-picture';
                iframe.referrerPolicy = 'strict-origin-when-cross-origin';
                const imgWrapper = card.querySelector('.image-wrapper');
                if (imgWrapper) {
                    imgWrapper.innerHTML = '';
                    imgWrapper.style.background = '#000';
                    imgWrapper.appendChild(iframe);
                }
            }
        });

        return cardWrapper;
    }

    // ---------- Публичный API ----------
    async function initNewsFeed() {
        if (container) return;
        container = document.getElementById('news-feed');
        if (!container) return;

        currentUser = getCurrentUser();

        container.innerHTML = '';
        container.appendChild(renderSkeleton(MAX_DISPLAY_ITEMS));

        try {
            const result = await fetchNewsFeed({ forceRefresh: false });
            if (result) {
                renderNewsFeed(result.items);
                if (result.isStale) {
                    showToast('Данные могут быть устаревшими. Попробуйте обновить.', 'warning', 5000);
                }
            } else {
                renderNewsFeed([]);
            }
        } catch (err) {
            console.error('[NewsFeed] Ошибка инициализации:', err);
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>${t('dataLoadError')}</p>
                    <button class="button small" id="news-retry-btn"><i class="fas fa-sync"></i> ${t('newsRetryVideo')}</button>
                </div>
            `;
            const retryBtn = container.querySelector('#news-retry-btn');
            if (retryBtn) retryBtn.addEventListener('click', () => refreshNewsFeed());
        }

        window.addEventListener('languageChanged', () => {
            if (!container) return;
            const header = container.parentNode?.querySelector('.news-header');
            if (header) {
                const titleSpan = header.querySelector('h2 span');
                if (titleSpan) titleSpan.textContent = t('newsTitle');
                const desc = header.querySelector('.text-secondary');
                if (desc) desc.textContent = t('newsDesc');
                const btn = header.querySelector('.admin-news-btn');
                if (btn) btn.innerHTML = `<i class="fas fa-plus"></i> ${t('addNews')}`;
            }
            container.querySelectorAll('[data-lang]').forEach(el => {
                const key = el.getAttribute('data-lang');
                if (key) el.textContent = t(key);
            });
            const retryBtn = container.querySelector('#news-retry-btn');
            if (retryBtn) retryBtn.innerHTML = `<i class="fas fa-sync"></i> ${t('newsRetryVideo')}`;
        });

        window.addEventListener('github-login-success', () => {
            window.GithubCore.cacheRemoveByPrefix(CACHE_KEY);
            refreshNewsFeed();
        });
        window.addEventListener('github-logout', () => {
            window.GithubCore.cacheRemoveByPrefix(CACHE_KEY);
            refreshNewsFeed();
        });
    }

    function refreshNewsFeed() {
        if (!container) return;
        container.innerHTML = '';
        container.appendChild(renderSkeleton(MAX_DISPLAY_ITEMS));
        fetchNewsFeed({ forceRefresh: true })
            .then(result => {
                if (result) renderNewsFeed(result.items);
                else renderNewsFeed([]);
            })
            .catch(err => {
                console.error('[NewsFeed] Ошибка обновления:', err);
                renderNewsFeed([]);
            });
    }

    window.initNewsFeed = initNewsFeed;
    window.refreshNewsFeed = refreshNewsFeed;
})();