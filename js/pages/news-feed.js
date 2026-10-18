// js/pages/news-feed.js – единый менеджер новостей с кешированием, скелетоном, отказоустойчивостью
// и авто-новостями из GitHub Releases (прогрессивная отрисовка).
//
// ВАЖНО про abort: refreshNewsFeed может быть вызван во время initNewsFeed
// (например, github-login-success при restoreSession). Предыдущий fetch
// отменяется через abortController.abort(), что в Firefox даёт TypeError:
// NetworkError. Такие ошибки НЕ логируем — это ожидаемый abort.
(function() {
    const {
        cacheGet, cacheSet, cacheRemoveByPrefix,
        escapeHtml, createElement, debounce, loadModule,
        createAbortable, CONFIG, sanitizeHtml
    } = window.GithubCore;

    const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
    const { showToast } = window.UIUtils;

    const CACHE_KEY = 'news_feed_data_v2';
    const CACHE_TTL = 5 * 60 * 1000;
    const SOURCE_TIMEOUT = 10000;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;
    const MAX_DISPLAY_ITEMS = 9;

    const RELEASE_SOURCES = [
        {
            owner: 'NeonShadowYT',
            repo: 'WorldGenerator',
            name: 'WorldGenerator',
            icon: 'images/tool-world-generator.webp'
        },
        {
            owner: 'NeonShadowYT',
            repo: 'IconCreator',
            name: 'IconCreator',
            icon: 'images/tool-icon-creator.webp'
        }
    ];

    let currentItems = [];
    let currentUser = null;
    let isLoading = false;
    let abortController = null;
    let container = null;
    let _onItemCallback = null;

    function t(key) {
        if (window.I18n && typeof window.I18n.translate === 'function') {
            const v = window.I18n.translate(key);
            if (v && v !== key) return v;
        }
        switch (key) {
            case 'openRelease': return 'Открыть релиз';
            case 'newsTitle': return 'Последние новости';
            case 'newsDesc': return 'Свежие видео и обновления';
            case 'newsNoItems': return 'Пока нет новостей';
            case 'newsRetryVideo': return 'Повторить загрузку видео';
            case 'addNews': return 'Добавить новость';
            case 'dataLoadError': return 'Ошибка загрузки данных';
            case 'addToFavorites': return 'В избранное';
            case 'loadError': return 'Ошибка загрузки';
            case 'loadModulesError': return 'Ошибка загрузки модулей';
            case 'stream': return 'Стрим';
            case 'viewers': return 'зрителей';
            default: return key;
        }
    }

    // Тихая проверка: был ли abort. В Firefox abort body-read даёт NetworkError,
    // не AbortError. Оба случая — ожидаемые, не логируем.
    function isAborted(err, signal) {
        if (!err) return false;
        if (signal && signal.aborted) return true;
        if (err.name === 'AbortError') return true;
        const msg = String(err.message || '');
        if (msg.includes('Aborted')) return true;
        if (msg.includes('NetworkError') && signal && signal.aborted) return true;
        return false;
    }

    function normalizeItem(item) {
        let date = item.date;
        if (!(date instanceof Date)) {
            date = new Date(date);
            if (isNaN(date.getTime())) date = new Date();
        }
        return {
            type: item.type || 'post',
            id: item.id || item.number || item.videoId || item.channel || '',
            title: item.title || 'Без названия',
            author: item.author || 'Unknown',
            date: date,
            thumbnail: item.thumbnail || null,
            body: item.body || null,
            labels: item.labels || [],
            game: item.game || null,
            videoData: item.videoData || null,
            twitchData: item.twitchData || null,
            releaseUrl: item.releaseUrl || null,
            releaseData: item.releaseData || null
        };
    }

    function normalizeItems(items) {
        return items.map(item => normalizeItem(item));
    }

    function buildWatchUrl(item) {
        if (item.type === 'release' && item.releaseUrl) return item.releaseUrl;
        if (item.type === 'video') return `https://www.youtube.com/watch?v=${item.id}`;
        if (item.type === 'twitch') return `https://www.twitch.tv/${item.id}`;
        if (item.type === 'post') return `${location.origin}${location.pathname}?post=${item.id}`;
        return '#';
    }

    function openExternal(url) {
        if (!url || url === '#') return;
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    async function fetchWithRetry(fn, context, retries = MAX_RETRIES) {
        let lastError;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err;
                // Abort / NetworkError — не retry, сразу пробрасываем
                if (err && (err.name === 'AbortError' || String(err.message || '').includes('Aborted'))) {
                    throw err;
                }
                if (attempt < retries) {
                    const delay = RETRY_DELAY * Math.pow(2, attempt);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
        throw lastError;
    }

    async function loadPosts(signal) {
        if (window.RateLimits && !window.RateLimits.checkLimit('posts')) {
            console.warn('[NewsFeed] Лимит постов исчерпан, пропускаем запрос');
            return [];
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SOURCE_TIMEOUT);
        if (signal) {
            if (signal.aborted) { clearTimeout(timeoutId); return []; }
            signal.addEventListener('abort', () => controller.abort(), { once: true });
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

            return all.map(i => {
                const labels = i.labels.map(l => l.name);
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
            });
        } catch (err) {
            clearTimeout(timeoutId);
            if (isAborted(err, signal) || isAborted(err, controller.signal)) return [];
            console.warn('[NewsFeed] Ошибка загрузки постов:', err);
            throw err;
        }
    }

    async function loadVideos(signal) {
        // YouTube RSS через allorigins напрямую (rss2json периодически отдаёт 422).
        const YT_CHANNELS = [
            { id: 'UC2pH2qNfh2sEAeYEGs1k_Lg', name: 'Neon Shadow' }
        ];

        const all = [];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SOURCE_TIMEOUT);
        if (signal) {
            if (signal.aborted) { clearTimeout(timeoutId); return []; }
            signal.addEventListener('abort', () => controller.abort(), { once: true });
        }

        try {
            for (const ch of YT_CHANNELS) {
                if (controller.signal.aborted) break;
                try {
                    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`;
                    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(rssUrl)}`;
                    const resp = await fetch(proxyUrl, { signal: controller.signal });
                    if (!resp.ok) continue;
                    const xmlText = await resp.text();
                    // Простой regex-парсинг: DOMParser с namespace у XML часто глючит.
                    const entryBlocks = xmlText.split('<entry>').slice(1);
                    const items = entryBlocks.slice(0, 3).map(block => {
                        const videoIdMatch = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
                        const titleMatch = block.match(/<title>([^<]*)<\/title>/);
                        const publishedMatch = block.match(/<published>([^<]+)<\/published>/);
                        const thumbMatch = block.match(/<media:thumbnail\s+url=["']([^"']+)["']/);
                        if (!videoIdMatch) return null;
                        const videoId = videoIdMatch[1];
                        return normalizeItem({
                            type: 'video',
                            id: videoId,
                            title: (titleMatch ? titleMatch[1] : 'Untitled')
                                .replace(/&amp;/g, '&')
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>')
                                .replace(/&quot;/g, '"')
                                .replace(/&#39;/g, "'"),
                            author: ch.name,
                            date: new Date(publishedMatch ? publishedMatch[1] : Date.now()),
                            thumbnail: thumbMatch ? thumbMatch[1] : `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
                            videoData: { service: 'youtube', id: videoId }
                        });
                    }).filter(v => v);
                    all.push(...items);
                } catch (e) {
                    if (isAborted(e, signal) || e.name === 'AbortError') break;
                    console.warn(`[NewsFeed] Ошибка RSS ${ch.name}: ${e.message || e}`);
                }
            }
            clearTimeout(timeoutId);
            all.sort((a, b) => b.date - a.date);
            return all.slice(0, 12);
        } catch (err) {
            clearTimeout(timeoutId);
            if (isAborted(err, signal) || isAborted(err, controller.signal)) return [];
            console.warn('[NewsFeed] Ошибка загрузки видео:', err);
            throw err;
        }
    }

    async function loadTwitchStreams(signal) {
        const TWITCH_CHANNELS = ['sk0l3ra1', 'neoncyndows'];
        const streams = [];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SOURCE_TIMEOUT);
        if (signal) {
            if (signal.aborted) { clearTimeout(timeoutId); return []; }
            signal.addEventListener('abort', () => controller.abort(), { once: true });
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
                        twitchData: { channel, game, viewers }
                    }));
                } catch (e) {
                    if (isAborted(e, signal) || e.name === 'AbortError') break;
                    // Тихая ошибка TwitchInsights — не критично
                }
            }
            clearTimeout(timeoutId);
            streams.sort((a, b) => b.date - a.date);
            return streams;
        } catch (err) {
            clearTimeout(timeoutId);
            if (isAborted(err, signal) || isAborted(err, controller.signal)) return [];
            console.warn('[NewsFeed] Ошибка загрузки стримов:', err);
            throw err;
        }
    }

    async function loadReleases(onEach, signal) {
        const results = [];
        const tasks = RELEASE_SOURCES.map(async (source) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), SOURCE_TIMEOUT);
            if (signal) {
                if (signal.aborted) {
                    clearTimeout(timeoutId);
                    return null;
                }
                signal.addEventListener('abort', () => controller.abort(), { once: true });
            }
            try {
                const url = `https://api.github.com/repos/${source.owner}/${source.repo}/releases?per_page=1`;
                const headers = { 'Accept': 'application/vnd.github.v3+json' };
                try {
                    const token = sessionStorage.getItem('github_token');
                    if (token) headers['Authorization'] = `Bearer ${token}`;
                } catch { /* noop */ }
                const resp = await fetch(url, { headers, signal: controller.signal });
                clearTimeout(timeoutId);
                if (!resp.ok) return null;
                const releases = await resp.json();
                if (!Array.isArray(releases) || releases.length === 0) return null;
                const r = releases[0];
                const item = normalizeItem({
                    type: 'release',
                    id: `release:${source.repo}:${r.tag_name}`,
                    title: `${source.name} ${r.name || r.tag_name}`,
                    body: r.body || '',
                    author: source.name,
                    date: new Date(r.published_at || r.created_at || Date.now()),
                    thumbnail: source.icon,
                    releaseUrl: r.html_url,
                    releaseData: {
                        owner: source.owner,
                        repo: source.repo,
                        tag: r.tag_name,
                        url: r.html_url
                    },
                    labels: ['type:release', `repo:${source.repo}`]
                });
                if (typeof onEach === 'function') {
                    try { onEach(item); } catch (e) { /* noop */ }
                }
                return item;
            } catch (e) {
                clearTimeout(timeoutId);
                // Abort / NetworkError при abort — тихо
                if (isAborted(e, signal) || isAborted(e, controller.signal) || e.name === 'AbortError') {
                    return null;
                }
                console.warn(`[NewsFeed] Ошибка загрузки релизов ${source.repo}: ${e.message || e}`);
                return null;
            }
        });
        const settled = await Promise.allSettled(tasks);
        for (const s of settled) {
            if (s.status === 'fulfilled' && s.value) results.push(s.value);
        }
        return results;
    }

    async function fetchNewsFeed({ signal, forceRefresh = false, maxAge = CACHE_TTL, onItem } = {}) {
        const cached = await cacheGet(CACHE_KEY, maxAge);
        if (cached && !forceRefresh) {
            const items = normalizeItems(cached.items || []);
            console.log(`[NewsFeed] Загрузка из кеша: ${items.length} элементов`);
            return { items, fromCache: true, isStale: false };
        }

        if (isLoading) {
            return new Promise((resolve) => {
                const check = async () => {
                    if (!isLoading) {
                        const fresh = await cacheGet(CACHE_KEY, maxAge);
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
        _onItemCallback = typeof onItem === 'function' ? onItem : null;
        // Тихий abort предыдущего fetch — ожидаемо при refresh во время init.
        if (abortController) {
            try { abortController.abort(); } catch { /* noop */ }
        }
        abortController = new AbortController();
        if (signal) {
            if (signal.aborted) {
                isLoading = false;
                abortController = null;
                return { items: [], fromCache: false, isStale: false };
            }
            signal.addEventListener('abort', () => abortController.abort(), { once: true });
        }

        try {
            console.log('[NewsFeed] Загрузка из сети...');
            const postsPromise = fetchWithRetry(() => loadPosts(abortController.signal), 'posts');
            const videosPromise = fetchWithRetry(() => loadVideos(abortController.signal), 'videos');
            const twitchPromise = fetchWithRetry(() => loadTwitchStreams(abortController.signal), 'twitch');
            const releasesPromise = loadReleases(
                (releaseItem) => {
                    if (_onItemCallback) {
                        try { _onItemCallback(releaseItem); } catch (e) { /* noop */ }
                    }
                },
                abortController.signal
            );

            const results = await Promise.allSettled([postsPromise, videosPromise, twitchPromise, releasesPromise]);

            let allItems = [];
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    allItems = allItems.concat(result.value);
                } else {
                    const source = ['посты', 'видео', 'стримы', 'релизы'][index];
                    // Тихий abort — не логируем
                    if (!isAborted(result.reason, abortController.signal)) {
                        console.warn(`[NewsFeed] Не удалось загрузить ${source}:`, result.reason);
                    }
                }
            });

            allItems.sort((a, b) => b.date - a.date);
            const limited = allItems.slice(0, MAX_DISPLAY_ITEMS);

            await cacheSet(CACHE_KEY, { items: limited, timestamp: Date.now() });

            console.log(`[NewsFeed] Загружено: ${limited.length} элементов`);

            currentItems = limited;
            return { items: limited, fromCache: false, isStale: false };
        } catch (err) {
            if (isAborted(err, abortController.signal)) {
                return { items: [], fromCache: false, isStale: false };
            }
            console.error('[NewsFeed] Критическая ошибка загрузки:', err);
            const stale = await cacheGet(CACHE_KEY, Infinity);
            if (stale) {
                const items = normalizeItems(stale.items || []);
                console.warn('[NewsFeed] Возвращаем устаревший кеш');
                return { items, fromCache: true, isStale: true };
            }
            throw err;
        } finally {
            isLoading = false;
            abortController = null;
            _onItemCallback = null;
        }
    }

    function renderSkeleton(count = 6) {
        const grid = createElement('div', 'projects-grid skeleton-grid');
        for (let i = 0; i < count; i++) {
            const card = createElement('div', 'project-card-link skeleton-card', { animationDelay: `${i * 0.05}s` });
            card.innerHTML = sanitizeHtml(`
                <div class="project-card">
                    <div class="image-wrapper skeleton-image"></div>
                    <div class="skeleton-title"></div>
                    <div class="skeleton-text"></div>
                    <div class="skeleton-text short"></div>
                </div>
            `);
            grid.appendChild(card);
        }
        return grid;
    }

    function appendItemToGrid(item) {
        if (!container) return;
        if (!item || !item.id) return;

        let grid = container.querySelector('.projects-grid:not(.skeleton-grid)');
        if (!grid) {
            const skeleton = container.querySelector('.skeleton-grid');
            if (skeleton) skeleton.remove();
            const empty = container.querySelector('.empty-state');
            if (empty) empty.remove();
            grid = createElement('div', 'projects-grid');
            container.appendChild(grid);
        }

        if (grid.children.length >= MAX_DISPLAY_ITEMS) return;
        if (grid.querySelector(`[data-item-id="${item.id}"]`)) return;

        const card = createNewsCard(item);
        card.dataset.itemId = item.id;
        grid.appendChild(card);
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
            titleDiv.innerHTML = sanitizeHtml(`
                <h2>
                    <i class="fas fa-newspaper" style="color: var(--accent); margin-right: 8px;"></i>
                    <span data-lang="newsTitle">${t('newsTitle')}</span>
                </h2>
                <p class="text-secondary" data-lang="newsDesc">${t('newsDesc')}</p>
            `);
            header.appendChild(titleDiv);
            container.parentNode.insertBefore(header, container);
        }

        const existingBtn = header.querySelector('.admin-news-btn');
        if (isAdmin() && hasScope('repo')) {
            if (!existingBtn) {
                const btn = createElement('button', 'button admin-news-btn');
                btn.innerHTML = sanitizeHtml(`<i class="fas fa-plus"></i> ${t('addNews')}`);
                btn.addEventListener('click', async () => {
                    if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
                    window.UIFeedback.openEditorModal('new', { game: null }, 'news');
                });
                header.appendChild(btn);
            } else {
                existingBtn.innerHTML = sanitizeHtml(`<i class="fas fa-plus"></i> ${t('addNews')}`);
            }
        } else if (existingBtn) {
            existingBtn.remove();
        }

        let grid = container.querySelector('.projects-grid:not(.skeleton-grid)');

        if (displayItems.length === 0 && (!grid || grid.children.length === 0)) {
            const skeleton = container.querySelector('.skeleton-grid');
            if (skeleton) skeleton.remove();
            container.innerHTML = sanitizeHtml(`
                <div class="empty-state">
                    <i class="fas fa-newspaper"></i>
                    <p data-lang="newsNoItems">${t('newsNoItems')}</p>
                    <button class="button small" id="news-retry-btn"><i class="fas fa-sync"></i> ${t('newsRetryVideo')}</button>
                </div>
            `);
            const retryBtn = container.querySelector('#news-retry-btn');
            if (retryBtn) retryBtn.addEventListener('click', () => refreshNewsFeed());
            return;
        }

        const existingIds = new Set();
        if (grid) {
            grid.querySelectorAll('[data-item-id]').forEach(el => existingIds.add(el.dataset.itemId));
        }

        if (!grid) {
            const skeleton = container.querySelector('.skeleton-grid');
            if (skeleton) skeleton.remove();
            const empty = container.querySelector('.empty-state');
            if (empty) empty.remove();
            grid = createElement('div', 'projects-grid');
            container.appendChild(grid);
        }

        const fragment = document.createDocumentFragment();
        let currentCount = grid.children.length;
        for (const item of displayItems) {
            if (currentCount >= MAX_DISPLAY_ITEMS) break;
            if (existingIds.has(item.id)) continue;
            const card = createNewsCard(item);
            card.dataset.itemId = item.id;
            fragment.appendChild(card);
            currentCount++;
        }
        grid.appendChild(fragment);

        container.querySelectorAll('[data-lang]').forEach(el => {
            const key = el.getAttribute('data-lang');
            if (key) el.textContent = t(key);
        });
    }

    function createNewsCard(item) {
        const cardWrapper = createElement('div', 'project-card-link card-interactive tilt-card');

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
        meta.innerHTML = sanitizeHtml(`<i class="fas fa-user"></i> ${escapeHtml(item.author)} · <i class="fas fa-calendar-alt"></i> ${dateStr}`);
        if (item.type === 'twitch' && item.twitchData) {
            meta.innerHTML += sanitizeHtml(` · 🎮 ${escapeHtml(item.twitchData.game)}`);
        }
        if (item.type === 'release' && item.releaseData?.tag) {
            meta.innerHTML += sanitizeHtml(` · <i class="fas fa-tag"></i> ${escapeHtml(item.releaseData.tag)}`);
        }
        card.appendChild(meta);

        if ((item.type === 'post' || item.type === 'release') && item.body) {
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

        if (item.type === 'release' && item.releaseUrl) {
            const releaseLink = createElement('a', 'button small', {
                marginTop: '8px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                width: '100%'
            }, {
                href: item.releaseUrl,
                target: '_blank',
                rel: 'noopener noreferrer'
            });
            releaseLink.innerHTML = sanitizeHtml(`<i class="fab fa-github" aria-hidden="true"></i> <span>${t('openRelease')}</span>`);
            releaseLink.addEventListener('click', (e) => e.stopPropagation());
            card.appendChild(releaseLink);
        }

        const currentUser = getCurrentUser();
        if (currentUser && hasScope('gist') && item.type !== 'release') {
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
                            if (typeof window._StorageEnsure === 'function') {
                                await window._StorageEnsure();
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
                    url: buildWatchUrl(item),
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
            if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.news-bookmark-btn')) return;

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
            } else if (item.type === 'release' && item.releaseUrl) {
                openExternal(item.releaseUrl);
            } else {
                openExternal(buildWatchUrl(item));
            }
        });

        return cardWrapper;
    }

    async function initNewsFeed() {
        if (container) return;
        container = document.getElementById('news-feed');
        if (!container) return;

        currentUser = getCurrentUser();

        container.innerHTML = '';
        container.appendChild(renderSkeleton(6));

        try {
            const result = await fetchNewsFeed({
                forceRefresh: false,
                onItem: (item) => appendItemToGrid(item)
            });
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
            container.innerHTML = sanitizeHtml(`
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>${t('dataLoadError')}</p>
                    <button class="button small" id="news-retry-btn"><i class="fas fa-sync"></i> ${t('newsRetryVideo')}</button>
                </div>
            `);
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
                if (btn) btn.innerHTML = sanitizeHtml(`<i class="fas fa-plus"></i> ${t('addNews')}`);
            }
            container.querySelectorAll('[data-lang]').forEach(el => {
                const key = el.getAttribute('data-lang');
                if (key) el.textContent = t(key);
            });
            const retryBtn = container.querySelector('#news-retry-btn');
            if (retryBtn) retryBtn.innerHTML = sanitizeHtml(`<i class="fas fa-sync"></i> ${t('newsRetryVideo')}`);
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
        container.appendChild(renderSkeleton(6));
        fetchNewsFeed({
            forceRefresh: true,
            onItem: (item) => appendItemToGrid(item)
        })
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