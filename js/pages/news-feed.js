// js/pages/news-feed.js
// Лента новостей. YouTube — все видео канала (без title-фильтра, кроме Shorts).
// itch.io — те же посты, что и на starve-neon (единый кеш).
// ИСПРАВЛЕНИЕ: нормализация date на выходе loadAllSources + защита в createNewsCard.

(function() {
    'use strict';

    const {
        cacheGet, cacheSet, cacheRemoveByPrefix,
        escapeHtml, createElement, loadModule,
        createAbortable, CONFIG, sanitizeHtml
    } = window.GithubCore;
    const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
    const { showToast } = window.UIUtils;

    const CACHE_KEY = 'news_feed_data_v24';
    const CACHE_TTL = 5 * 60 * 1000;
    const VIDEOS_CACHE_KEY = 'unified_yt_videos_v3';
    const ITCH_CACHE_KEY = 'unified_itch_posts_v3';

    const SOURCE_TIMEOUT = 25000;
    const MAX_DISPLAY_ITEMS = 30;

    const RELEASE_SOURCES = [
        { owner: 'NeonShadowYT', repo: 'WorldGenerator', name: 'WorldGenerator', icon: 'images/tool-world-generator.webp' },
        { owner: 'NeonShadowYT', repo: 'IconCreator', name: 'IconCreator', icon: 'images/tool-icon-creator.webp' }
    ];

    let currentUser = null;
    let isLoading = false;
    let abortController = null;
    let backgroundRefreshInFlight = false;
    let container = null;

    function t(key) {
        if (window.I18n && typeof window.I18n.translate === 'function') {
            const v = window.I18n.translate(key);
            if (v && v !== key) return v;
        }
        const map = {
            openRelease: 'Открыть релиз', newsTitle: 'Последние новости',
            newsDesc: 'Свежие видео и обновления', newsNoItems: 'Пока нет новостей',
            newsRetryVideo: 'Повторить загрузку', addNews: 'Добавить новость',
            dataLoadError: 'Ошибка загрузки данных', addToFavorites: 'В избранное',
            loadError: 'Ошибка загрузки', loadModulesError: 'Ошибка загрузки модулей',
            stream: 'Стрим', viewers: 'зрителей', readMore: 'Читать далее',
            watch: 'Смотреть'
        };
        return map[key] || key;
    }

    function isAborted(err, signal) {
        if (!err) return false;
        if (signal && signal.aborted) return true;
        if (err.name === 'AbortError') return true;
        return String(err.message || '').includes('Aborted');
    }

    function toDate(d) {
        if (d instanceof Date && !isNaN(d.getTime())) return d;
        const nd = new Date(d);
        return isNaN(nd.getTime()) ? new Date() : nd;
    }

    function normalizeItem(item) {
        if (!item) return item;
        return {
            type: item.type || 'post',
            id: item.id || item.number || item.videoId || item.channel || item.link || '',
            title: item.title || 'Без названия',
            author: item.author || 'Unknown',
            date: toDate(item.date),
            thumbnail: item.thumbnail || null,
            body: item.body || null,
            labels: item.labels || [],
            game: item.game || null,
            videoData: item.videoData || null,
            twitchData: item.twitchData || null,
            releaseUrl: item.releaseUrl || null,
            releaseData: item.releaseData || null,
            itchLink: item.itchLink || null,
            itchSource: item.itchSource || null
        };
    }

    function readCache(key, ttl) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !data.timestamp || !Array.isArray(data.items)) return null;
            if (data.items.length === 0) return null;
            if (Date.now() - data.timestamp > ttl) {
                localStorage.removeItem(key);
                return null;
            }
            return data.items;
        } catch { return null; }
    }

    function writeCache(key, items) {
        if (!Array.isArray(items) || items.length === 0) return;
        try {
            localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), items }));
        } catch { /* noop */ }
    }

    // ---------- GitHub Issues ----------

    async function loadPosts(signal) {
        if (window.RateLimits && !window.RateLimits.checkLimit('posts')) return [];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SOURCE_TIMEOUT);
        if (signal) {
            if (signal.aborted) { clearTimeout(timeoutId); return []; }
            signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
        try {
            const news = await window.GithubAPI.loadIssues({
                labels: 'type:news', state: 'open', per_page: 10, signal: controller.signal
            });
            const updates = await window.GithubAPI.loadIssues({
                labels: 'type:update', state: 'open', per_page: 10, signal: controller.signal
            });
            clearTimeout(timeoutId);
            const all = window.GithubCore.deduplicateByNumber([...news, ...updates])
                .filter(i => i.state === 'open' && CONFIG.ALLOWED_AUTHORS.includes(i.user.login));
            return all.map(i => {
                const labels = i.labels.map(l => l.name);
                return normalizeItem({
                    type: 'post', number: i.number, title: i.title, body: i.body,
                    author: i.user.login, date: new Date(i.created_at), labels,
                    game: labels.find(l => l.startsWith('game:'))?.split(':')[1] || null,
                    thumbnail: null
                });
            });
        } catch (err) {
            clearTimeout(timeoutId);
            if (isAborted(err, signal) || isAborted(err, controller.signal)) return [];
            throw err;
        }
    }

    // ---------- Twitch ----------

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
                    streams.push(normalizeItem({
                        type: 'twitch', id: channel,
                        title: `${t('stream')}: ${channel}${info[1] ? ` (${info[1]} ${t('viewers')})` : ''}`,
                        author: channel, date: new Date(),
                        thumbnail: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel}-320x180.jpg`,
                        twitchData: { channel, game: info[2] || 'Игра', viewers: info[1] || 0 }
                    }));
                } catch (e) {
                    if (isAborted(e, signal) || e.name === 'AbortError') break;
                }
            }
            clearTimeout(timeoutId);
            return streams;
        } catch (err) {
            clearTimeout(timeoutId);
            if (isAborted(err, signal) || isAborted(err, controller.signal)) return [];
            return [];
        }
    }

    // ---------- GitHub Releases ----------

    async function loadReleases(onEach, signal) {
        const results = [];
        const tasks = RELEASE_SOURCES.map(async (source) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), SOURCE_TIMEOUT);
            if (signal) {
                if (signal.aborted) { clearTimeout(timeoutId); return null; }
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
                    releaseData: { owner: source.owner, repo: source.repo, tag: r.tag_name, url: r.html_url },
                    labels: ['type:release', `repo:${source.repo}`]
                });
                if (typeof onEach === 'function') {
                    try { onEach(item); } catch { /* noop */ }
                }
                return item;
            } catch (e) {
                clearTimeout(timeoutId);
                if (isAborted(e, signal) || isAborted(controller.signal)) return null;
                return null;
            }
        });
        const settled = await Promise.allSettled(tasks);
        for (const s of settled) {
            if (s.status === 'fulfilled' && s.value) results.push(s.value);
        }
        return results;
    }

    // ---------- Агрегация ----------

    async function loadAllSources(signal, forceRefresh, onItem) {
        const sources = [
            { name: 'посты', fn: () => loadPosts(signal) },
            { name: 'YouTube', fn: () => window.MediaAggregator.fetchYoutubeVideos(signal, { forceRefresh, filterByTitle: false }) },
            { name: 'Twitch', fn: () => loadTwitchStreams(signal) },
            { name: 'релизы', fn: () => loadReleases(onItem, signal) },
            { name: 'itch.io', fn: () => window.MediaAggregator.fetchItchPosts(signal, forceRefresh) }
        ];

        const promises = sources.map(source => {
            return source.fn()
                .then(items => {
                    if (!items || !items.length) return [];
                    const normalized = items.map(normalizeItem);
                    console.log(`[NewsFeed] ${source.name}: ${normalized.length} элементов`);
                    if (typeof onItem === 'function') {
                        for (const item of normalized) {
                            try { onItem(item); } catch { /* noop */ }
                        }
                    }
                    return normalized;
                })
                .catch(err => {
                    if (!isAborted(err, signal)) {
                        console.warn(`[NewsFeed] ${source.name} упал:`, err.message || err);
                    }
                    return [];
                });
        });

        const results = await Promise.allSettled(promises);
        let allItems = [];
        for (const r of results) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                allItems = allItems.concat(r.value);
            }
        }
        allItems.sort((a, b) => b.date - a.date);
        return allItems;
    }

    // ---------- Fetch с кешем ----------

    async function fetchNewsFeed({ signal, forceRefresh = false, maxAge = CACHE_TTL, onUpdate } = {}) {
        const cached = await cacheGet(CACHE_KEY, maxAge);
        const hasCache = cached && Array.isArray(cached.items) && cached.items.length > 0;

        if (hasCache && !forceRefresh) {
            const items = cached.items.map(normalizeItem);
            if (typeof onUpdate === 'function') {
                try { onUpdate(items, { fromCache: true }); } catch { /* noop */ }
            }

            if (!backgroundRefreshInFlight) {
                backgroundRefreshInFlight = true;
                (async () => {
                    try {
                        const freshItems = await loadAllSources(
                            null,
                            true,
                            (item) => {
                                if (typeof onUpdate === 'function') {
                                    try { onUpdate([item], { incremental: true }); } catch { /* noop */ }
                                }
                            }
                        );
                        if (freshItems.length) {
                            const limited = freshItems.slice(0, MAX_DISPLAY_ITEMS);
                            await cacheSet(CACHE_KEY, { items: limited, timestamp: Date.now() });
                            if (typeof onUpdate === 'function') {
                                try { onUpdate(limited, { final: true }); } catch { /* noop */ }
                            }
                        }
                    } catch { /* noop */ }
                    finally { backgroundRefreshInFlight = false; }
                })();
            }
            return { items, fromCache: true, isStale: false };
        }

        if (isLoading) {
            return new Promise((resolve) => {
                const check = async () => {
                    if (!isLoading) {
                        const fresh = await cacheGet(CACHE_KEY, maxAge);
                        resolve(fresh && fresh.items && fresh.items.length
                            ? { items: fresh.items.map(normalizeItem), fromCache: true, isStale: false }
                            : { items: [], fromCache: false, isStale: false });
                    } else {
                        setTimeout(check, 100);
                    }
                };
                check();
            });
        }

        isLoading = true;
        if (abortController) { try { abortController.abort(); } catch { /* noop */ } }
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
            const allItems = await loadAllSources(
                abortController.signal,
                forceRefresh,
                (item) => {
                    if (typeof onUpdate === 'function') {
                        try { onUpdate([item], { incremental: true }); } catch { /* noop */ }
                    }
                }
            );
            const limited = allItems.slice(0, MAX_DISPLAY_ITEMS);
            if (limited.length > 0) {
                await cacheSet(CACHE_KEY, { items: limited, timestamp: Date.now() });
            }
            return { items: limited, fromCache: false, isStale: false };
        } catch (err) {
            if (isAborted(err, abortController.signal)) return { items: [], fromCache: false, isStale: false };
            const stale = await cacheGet(CACHE_KEY, Infinity);
            if (stale && stale.items && stale.items.length) {
                return { items: stale.items.map(normalizeItem), fromCache: true, isStale: true };
            }
            throw err;
        } finally {
            isLoading = false;
            abortController = null;
        }
    }

    // ---------- Skeleton / вставка / рендер ----------

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

    function insertCardSorted(grid, item) {
        if (!item || !item.id) return;
        if (grid.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`)) return;
        const normalized = normalizeItem(item);
        const newCard = createNewsCard(normalized);
        newCard.dataset.itemId = normalized.id;
        newCard.dataset.date = String(normalized.date.getTime());
        const newTs = normalized.date.getTime();
        let insertBefore = null;
        for (const child of grid.children) {
            const ts = parseInt(child.dataset.date, 10) || 0;
            if (newTs > ts) { insertBefore = child; break; }
        }
        if (insertBefore) grid.insertBefore(newCard, insertBefore);
        else grid.appendChild(newCard);
        while (grid.children.length > MAX_DISPLAY_ITEMS) grid.removeChild(grid.lastChild);
    }

    function getOrCreateGrid() {
        if (!container) return null;
        let grid = container.querySelector('.projects-grid:not(.skeleton-grid)');
        if (!grid) {
            const sk = container.querySelector('.skeleton-grid');
            if (sk) sk.remove();
            const em = container.querySelector('.empty-state');
            if (em) em.remove();
            grid = createElement('div', 'projects-grid');
            container.appendChild(grid);
        }
        return grid;
    }

    function renderNewsHeader() {
        if (!container) return;
        let header = container.parentNode?.querySelector('.news-header');
        if (!header) {
            header = createElement('div', 'news-header', {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '20px', flexWrap: 'wrap', gap: '15px'
            });
            const titleDiv = createElement('div');
            titleDiv.innerHTML = sanitizeHtml(`
                <h2><i class="fas fa-newspaper" style="color: var(--accent); margin-right: 8px;"></i>
                <span data-lang="newsTitle">${t('newsTitle')}</span></h2>
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
        } else if (existingBtn) existingBtn.remove();
    }

    function renderEmptyState() {
        if (!container) return;
        const sk = container.querySelector('.skeleton-grid');
        if (sk) sk.remove();
        if (container.querySelector('.empty-state')) return;
        container.innerHTML = sanitizeHtml(`
            <div class="empty-state">
                <i class="fas fa-newspaper"></i>
                <p data-lang="newsNoItems">${t('newsNoItems')}</p>
                <button class="button small" id="news-retry-btn"><i class="fas fa-sync"></i> ${t('newsRetryVideo')}</button>
            </div>
        `);
        const btn = container.querySelector('#news-retry-btn');
        if (btn) btn.addEventListener('click', () => refreshNewsFeed());
    }

    function updateNewsFeed(items, { replace = false, incremental = false, fromCache = false, final = false } = {}) {
        if (!container) return;
        renderNewsHeader();

        if (incremental) {
            const grid = getOrCreateGrid();
            if (!grid) return;
            for (const item of items) insertCardSorted(grid, item);
            return;
        }

        const displayItems = items.slice(0, MAX_DISPLAY_ITEMS);
        if (displayItems.length === 0) {
            if (replace) renderEmptyState();
            return;
        }
        const grid = getOrCreateGrid();
        if (!grid) return;
        if (replace) grid.replaceChildren();
        for (const item of displayItems) insertCardSorted(grid, item);
        container.querySelectorAll('[data-lang]').forEach(el => {
            const k = el.getAttribute('data-lang');
            if (k) el.textContent = t(k);
        });
    }

    // ---------- Карточка ----------

    function getAuthorIcon(type) {
        switch (type) {
            case 'release':   return 'fas fa-cube';
            case 'itch-post': return 'fab fa-itch-io';
            default:          return 'fas fa-user';
        }
    }

    function createNewsCard(item) {
        const safe = normalizeItem(item);
        const cardWrapper = createElement('div', 'project-card-link card-interactive tilt-card');
        const card = createElement('div', 'project-card');

        const imgWrapper = createElement('div', 'image-wrapper');
        const img = createElement('img', 'project-image', {}, {
            src: safe.thumbnail || 'images/default-news.webp',
            alt: safe.title, loading: 'lazy'
        });
        img.onerror = () => { img.src = 'images/default-news.webp'; };
        imgWrapper.appendChild(img);
        card.appendChild(imgWrapper);

        const title = createElement('h3');
        title.textContent = safe.title;
        card.appendChild(title);

        const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
        const icon = getAuthorIcon(safe.type);
        meta.innerHTML = sanitizeHtml(
            `<i class="${icon}"></i> ${escapeHtml(safe.author)} <i class="fas fa-calendar-alt"></i> ${safe.date.toLocaleDateString()}`
        );
        if (safe.type === 'twitch' && safe.twitchData) {
            meta.innerHTML += sanitizeHtml(` 🎮 ${escapeHtml(safe.twitchData.game)}`);
        }
        if (safe.type === 'release' && safe.releaseData?.tag) {
            meta.innerHTML += sanitizeHtml(` <i class="fas fa-tag"></i> ${escapeHtml(safe.releaseData.tag)}`);
        }
        card.appendChild(meta);

        if ((safe.type === 'post' || safe.type === 'release' || safe.type === 'itch-post') && safe.body) {
            const summary = window.GithubCore.extractSummary(safe.body)
                || safe.body.replace(/\n/g, ' ').substring(0, 120);
            const preview = createElement('p', 'text-secondary', {
                fontSize: '13px', overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: '2', WebkitBoxOrient: 'vertical'
            });
            preview.textContent = summary;
            card.appendChild(preview);
        }

        if (safe.type === 'video' && safe.id) {
            const a = createElement('a', 'button small', {
                marginTop: '8px', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', width: '100%'
            }, { href: `https://www.youtube.com/watch?v=${safe.id}`, target: '_blank', rel: 'noopener noreferrer' });
            a.innerHTML = sanitizeHtml(`<i class="fab fa-youtube"></i> <span>${t('watch')}</span>`);
            a.addEventListener('click', (e) => e.stopPropagation());
            card.appendChild(a);
        }

        if (safe.type === 'release' && safe.releaseUrl) {
            const a = createElement('a', 'button small', {
                marginTop: '8px', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', width: '100%'
            }, { href: safe.releaseUrl, target: '_blank', rel: 'noopener noreferrer' });
            a.innerHTML = sanitizeHtml(`<i class="fab fa-github"></i> <span>${t('openRelease')}</span>`);
            a.addEventListener('click', (e) => e.stopPropagation());
            card.appendChild(a);
        }

        if (safe.type === 'itch-post' && safe.itchLink) {
            const a = createElement('a', 'button small', {
                marginTop: '8px', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', width: '100%'
            }, { href: safe.itchLink, target: '_blank', rel: 'noopener noreferrer' });
            a.innerHTML = sanitizeHtml(`<i class="fab fa-itch-io"></i> <span>${t('readMore')}</span>`);
            a.addEventListener('click', (e) => e.stopPropagation());
            card.appendChild(a);
        }

        const currentUser = getCurrentUser();
        if (currentUser && hasScope('gist') && safe.type !== 'release' && safe.type !== 'itch-post') {
            const favBtn = createElement('div', 'news-bookmark-btn', {}, { title: t('addToFavorites') });
            favBtn.innerHTML = '<i class="far fa-bookmark"></i>';
            favBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!window.BookmarkStorage) {
                    try {
                        if (window.loadStorageModules) await window.loadStorageModules();
                        else {
                            const mods = [
                                'js/features/storage/core.js', 'js/features/storage/metadata.js',
                                'js/features/storage/manager.js', 'js/features/storage/ui.js',
                                'js/features/storage/index.js'
                            ];
                            for (const src of mods) await window.Utils.loadModule(src);
                            if (typeof window._StorageEnsure === 'function') await window._StorageEnsure();
                        }
                    } catch { showToast(t('loadModulesError'), 'error'); return; }
                }
                if (!window.BookmarkStorage) { showToast(t('loadModulesError'), 'error'); return; }
                const bookmark = {
                    url: safe.type === 'video' ? `https://www.youtube.com/watch?v=${safe.id}` :
                         safe.type === 'twitch' ? `https://www.twitch.tv/${safe.id}` :
                         `${location.origin}${location.pathname}?post=${safe.id}`,
                    title: safe.title,
                    type: safe.type === 'post' ? 'post' : 'video',
                    thumbnail: safe.thumbnail || 'images/default-news.webp',
                    author: safe.author, date: safe.date,
                    postData: safe.type === 'post' ? {
                        id: safe.id, title: safe.title, body: safe.body,
                        author: safe.author, date: safe.date.toISOString(),
                        labels: safe.labels, game: safe.game
                    } : undefined,
                    videoData: safe.type === 'video' ? { id: safe.id, service: 'youtube' } : undefined,
                    twitchData: safe.type === 'twitch' ? { channel: safe.id } : undefined
                };
                window.BookmarkStorage.addBookmark(bookmark)
                    .then(() => showToast(t('addToFavorites'), 'success'))
                    .catch(err => {
                        if (err.message !== 'duplicate') showToast(t('loadError') + ': ' + err.message, 'error');
                    });
            });
            card.appendChild(favBtn);
        }

        cardWrapper.appendChild(card);

        cardWrapper.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.news-bookmark-btn')) return;

            if (safe.type === 'post') {
                if (!window.UIFeedback) { loadModule('js/features/ui-feedback.js').catch(() => {}); return; }
                window.UIFeedback.openFullModal({
                    type: 'post', id: safe.id, title: safe.title, body: safe.body,
                    author: safe.author, date: safe.date, game: safe.game, labels: safe.labels
                });
            } else if (safe.type === 'release' && safe.releaseUrl) {
                window.open(safe.releaseUrl, '_blank', 'noopener,noreferrer');
            } else if (safe.type === 'itch-post' && safe.itchLink) {
                window.open(safe.itchLink, '_blank', 'noopener,noreferrer');
            } else if (safe.type === 'video') {
                window.open(`https://www.youtube.com/watch?v=${safe.id}`, '_blank', 'noopener,noreferrer');
            } else if (safe.type === 'twitch') {
                window.open(`https://www.twitch.tv/${safe.id}`, '_blank', 'noopener,noreferrer');
            }
        });

        return cardWrapper;
    }

    // ---------- Инициализация ----------

    async function initNewsFeed() {
        if (container) return;
        container = document.getElementById('news-feed');
        if (!container) return;
        currentUser = getCurrentUser();

        const cached = await cacheGet(CACHE_KEY, CACHE_TTL);
        const hasCachedItems = cached && Array.isArray(cached.items) && cached.items.length > 0;

        if (hasCachedItems) {
            updateNewsFeed(cached.items.map(normalizeItem), { replace: true });
        } else {
            container.innerHTML = '';
            container.appendChild(renderSkeleton(6));
        }

        try {
            const result = await fetchNewsFeed({
                forceRefresh: false,
                onUpdate: (items, opts) => {
                    if (opts && opts.incremental) {
                        updateNewsFeed(items, { incremental: true });
                    } else if (opts && opts.final) {
                        updateNewsFeed(items, { replace: true });
                    } else if (opts && opts.fromCache) {
                        // Уже показали
                    } else {
                        updateNewsFeed(items, { replace: true });
                    }
                }
            });
            if (result) {
                if (!hasCachedItems || !result.fromCache) {
                    updateNewsFeed(result.items, { replace: true });
                }
                if (result.isStale) showToast('Данные могут быть устаревшими', 'warning', 5000);
            } else {
                if (!hasCachedItems) updateNewsFeed([], { replace: true });
            }
        } catch (err) {
            console.error('[NewsFeed] Ошибка инициализации:', err);
            if (container && !hasCachedItems) {
                container.innerHTML = sanitizeHtml(`
                    <div class="empty-state">
                        <i class="fas fa-exclamation-triangle"></i>
                        <p>${t('dataLoadError')}</p>
                        <button class="button small" id="news-retry-btn"><i class="fas fa-sync"></i> ${t('newsRetryVideo')}</button>
                    </div>
                `);
                const btn = container.querySelector('#news-retry-btn');
                if (btn) btn.addEventListener('click', () => refreshNewsFeed());
            }
        }

        window.addEventListener('languageChanged', () => {
            if (!container) return;
            renderNewsHeader();
            container.querySelectorAll('[data-lang]').forEach(el => {
                const k = el.getAttribute('data-lang');
                if (k) el.textContent = t(k);
            });
            const btn = container.querySelector('#news-retry-btn');
            if (btn) btn.innerHTML = sanitizeHtml(`<i class="fas fa-sync"></i> ${t('newsRetryVideo')}`);
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
        try {
            localStorage.removeItem(VIDEOS_CACHE_KEY);
            localStorage.removeItem(ITCH_CACHE_KEY);
        } catch { /* noop */ }
        fetchNewsFeed({
            forceRefresh: true,
            onUpdate: (items, opts) => {
                if (opts && opts.incremental) {
                    updateNewsFeed(items, { incremental: true });
                } else if (opts && opts.final) {
                    updateNewsFeed(items, { replace: true });
                } else {
                    updateNewsFeed(items, { replace: true });
                }
            }
        })
            .then(r => {
                if (r) updateNewsFeed(r.items, { replace: true });
                else updateNewsFeed([], { replace: true });
            })
            .catch(err => {
                console.error('[NewsFeed] Ошибка обновления:', err);
                updateNewsFeed([], { replace: true });
            });
    }

    window.initNewsFeed = initNewsFeed;
    window.refreshNewsFeed = refreshNewsFeed;
})();