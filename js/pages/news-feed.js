// js/pages/news-feed.js — лента новостей (index.html).
// YouTube: RSS UULF через прокси (основной) + Piped (резерв).
// itch.io: RSS через прокси (общий кэш с game-updates.js).

(function() {
    'use strict';

    const {
        cacheGet, cacheSet, cacheRemoveByPrefix,
        escapeHtml, createElement, loadModule,
        createAbortable, CONFIG, sanitizeHtml
    } = window.GithubCore;
    const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
    const { showToast } = window.UIUtils;

    const CACHE_KEY = 'news_feed_data_v9';
    const CACHE_TTL = 5 * 60 * 1000;
    const VIDEOS_CACHE_KEY = 'yt_videos_cache_v9';
    const VIDEOS_CACHE_TTL = 30 * 60 * 1000;
    const ITCH_CACHE_KEY = 'itch_posts_v9_starve-neon'; // общий с game-updates.js
    const ITCH_CACHE_TTL = 30 * 60 * 1000;

    const SOURCE_TIMEOUT = 15000;
    const REQUEST_TIMEOUT = 15000;
    const MAX_DISPLAY_ITEMS = 9;
    const MAX_VIDEOS = 6;
    const MAX_ITCH_POSTS = 3;
    const MIN_YT_DURATION = 60;

    const RELEASE_SOURCES = [
        { owner: 'NeonShadowYT', repo: 'WorldGenerator', name: 'WorldGenerator', icon: 'images/tool-world-generator.webp' },
        { owner: 'NeonShadowYT', repo: 'IconCreator', name: 'IconCreator', icon: 'images/tool-icon-creator.webp' }
    ];

    const YT_CHANNEL_ID = 'UC2pH2qNfh2sEAeYEGs1k_Lg';
    const YT_CHANNEL_NAME = 'Neon Shadow';
    const YT_UULF_PLAYLIST_ID = YT_CHANNEL_ID.replace(/^UC/, 'UULF');
    const YT_RSS_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${YT_UULF_PLAYLIST_ID}`;

    const ITCH_DEVLOG_SOURCES = [
        {
            name: 'Starve Neon',
            rssUrl: 'https://neon-shadow.itch.io/starve-neon/devlog.rss',
            devlogPageUrl: 'https://neon-shadow.itch.io/starve-neon/devlog'
        }
    ];

    // ---- Рабочие CORS-прокси (2026) ----
    const CORS_PROXIES = [
        (u) => `https://corsproxy.dev/?url=${encodeURIComponent(u)}`,
        (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
        (u) => `https://cloudflare-cors-anywhere.queakchannel42.workers.dev/?${u}`,
        (u) => `https://corsfix.com/?${u}`,
        (u) => `https://cors.x2u.in/${u}`
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

    function decodeXmlEntities(s) {
        return String(s || '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
    }

    function normalizeDate(d) {
        if (d instanceof Date && !isNaN(d.getTime())) return d;
        const nd = new Date(d);
        return isNaN(nd.getTime()) ? new Date() : nd;
    }

    function normalizeItem(item) {
        return {
            type: item.type || 'post',
            id: item.id || item.number || item.videoId || item.channel || item.link || '',
            title: item.title || 'Без названия',
            author: item.author || 'Unknown',
            date: normalizeDate(item.date),
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

    function sortByDateDesc(arr) {
        return arr.slice().sort((a, b) => b.date - a.date);
    }

    function readCache(key, ttl) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !data.timestamp || !Array.isArray(data.items)) return null;
            if (Date.now() - data.timestamp > ttl) {
                localStorage.removeItem(key);
                return null;
            }
            return data.items;
        } catch { return null; }
    }

    function writeCache(key, items) {
        try {
            localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), items }));
        } catch { /* noop */ }
    }

    function fetchWithTimeout(url, signal, timeout = REQUEST_TIMEOUT) {
        return new Promise((resolve, reject) => {
            const controller = new AbortController();
            const timer = setTimeout(() => {
                try { controller.abort(new Error('timeout')); } catch { controller.abort(); }
            }, timeout);
            if (signal) {
                if (signal.aborted) {
                    clearTimeout(timer);
                    reject(new DOMException('Aborted', 'AbortError'));
                    return;
                }
                signal.addEventListener('abort', () => {
                    try { controller.abort(); } catch { /* noop */ }
                }, { once: true });
            }
            fetch(url, { signal: controller.signal })
                .then(res => {
                    clearTimeout(timer);
                    if (!res.ok) reject(new Error(`HTTP ${res.status}`));
                    else resolve(res);
                })
                .catch(err => { clearTimeout(timer); reject(err); });
        });
    }

    async function fetchViaProxy(proxyFn, targetUrl, signal) {
        const proxyUrl = proxyFn(targetUrl);
        const res = await fetchWithTimeout(proxyUrl, signal);
        let text = await res.text();
        if (!text || text.length < 100) throw new Error('too short');

        if (text.trim().startsWith('{')) {
            try {
                const json = JSON.parse(text);
                if (typeof json.contents === 'string') text = json.contents;
                else if (json.error) throw new Error('proxy error: ' + json.error);
            } catch (e) {
                if (e.message.startsWith('proxy error')) throw e;
            }
        }

        if (!text || text.length < 100) throw new Error('too short after unwrap');
        return text;
    }

    async function raceProxies(targetUrl, parser, signal) {
        const promises = CORS_PROXIES.map(proxyFn =>
            fetchViaProxy(proxyFn, targetUrl, signal).then(text => {
                const result = parser(text);
                if (!result || (Array.isArray(result) && result.length === 0)) {
                    throw new Error('empty parse');
                }
                return result;
            })
        );
        return await Promise.any(promises);
    }

    // ============================================================
    // YOUTUBE
    // ============================================================

    function filterYoutubeVideos(videos) {
        const seen = new Set();
        return videos
            .filter(v => v && v.videoId && !seen.has(v.videoId) && (seen.add(v.videoId), true))
            .filter(v => {
                if (typeof v.duration === 'number' && v.duration > 0 && v.duration < MIN_YT_DURATION) {
                    return false;
                }
                return true;
            })
            .sort((a, b) => b.date - a.date)
            .slice(0, MAX_VIDEOS);
    }

    function parseYoutubeRss(text) {
        const entryBlocks = text.split('<entry>').slice(1);
        const items = entryBlocks.map(block => {
            const videoIdMatch = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
            const titleMatch = block.match(/<title>([^<]*)<\/title>/);
            const publishedMatch = block.match(/<published>([^<]+)<\/published>/);
            if (!videoIdMatch) return null;
            const videoId = videoIdMatch[1];
            return normalizeItem({
                type: 'video', id: videoId,
                title: decodeXmlEntities(titleMatch ? titleMatch[1] : 'Untitled'),
                author: YT_CHANNEL_NAME,
                date: new Date(publishedMatch ? publishedMatch[1] : Date.now()),
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                videoData: { service: 'youtube', id: videoId }
            });
        }).filter(Boolean);
        return items;
    }

    async function fetchYoutubeRss(signal) {
        try {
            return await raceProxies(YT_RSS_URL, parseYoutubeRss, signal);
        } catch (e) {
            if (isAborted(e, signal)) throw e;
            console.warn('[NewsFeed] YouTube RSS прокси не сработали:', e.message || e);
        }
        return [];
    }

    async function fetchYoutubeVideos(signal, forceRefresh = false) {
        if (!forceRefresh) {
            const cached = readCache(VIDEOS_CACHE_KEY, VIDEOS_CACHE_TTL);
            if (cached && cached.length) return cached.map(normalizeItem);
        }

        const videos = await fetchYoutubeRss(signal);

        if (!videos.length) {
            const stale = readCache(VIDEOS_CACHE_KEY, Infinity);
            return stale ? stale.map(normalizeItem) : [];
        }

        const filtered = filterYoutubeVideos(videos);
        if (filtered.length) writeCache(VIDEOS_CACHE_KEY, filtered);
        return filtered;
    }

    // ============================================================
    // ITCH.IO
    // ============================================================

    function normalizeItchUrl(url) {
        if (!url) return null;
        url = url.trim();
        if (url.startsWith('//')) return 'https:' + url;
        if (url.startsWith('/')) return 'https://img.itch.zone' + url;
        return url;
    }

    function extractItchThumbnail(block) {
        let m = block.match(/<media:content[^>]+url=["']([^"']+)["']/i);
        if (m) return normalizeItchUrl(m[1]);
        m = block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
        if (m) return normalizeItchUrl(m[1]);
        m = block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image[^"']*["']/i);
        if (m) return normalizeItchUrl(m[1]);
        const descMatch = block.match(/<description>([\s\S]*?)<\/description>/);
        if (descMatch) {
            const imgMatch = descMatch[1].match(/<img[^>]+src=["']([^"']+)["']/i);
            if (imgMatch) return normalizeItchUrl(imgMatch[1]);
        }
        return null;
    }

    function parseItchRss(text, source) {
        const itemBlocks = text.split('<item>').slice(1);
        const items = itemBlocks.map(block => {
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
                description = (tempDiv.textContent || tempDiv.innerText || '').trim();
            }
            return normalizeItem({
                type: 'itch-post',
                id: `itch-${link}`,
                title, author: source.name, date, body: description,
                thumbnail: extractItchThumbnail(block),
                itchLink: link, itchSource: source.name,
                labels: ['type:itch-post']
            });
        }).filter(Boolean);
        return sortByDateDesc(items).slice(0, MAX_ITCH_POSTS);
    }

    async function fetchItchPosts(signal, forceRefresh = false) {
        if (!forceRefresh) {
            const cached = readCache(ITCH_CACHE_KEY, ITCH_CACHE_TTL);
            if (cached && cached.length) return cached.map(normalizeItem);
        }

        const allPosts = [];
        for (const source of ITCH_DEVLOG_SOURCES) {
            try {
                const posts = await raceProxies(source.rssUrl, (text) => parseItchRss(text, source), signal);
                if (posts && posts.length) allPosts.push(...posts);
            } catch (e) {
                if (isAborted(e, signal)) return [];
                console.warn(`[NewsFeed] itch.io ${source.name}:`, e.message || e);
            }
        }

        if (allPosts.length === 0) {
            const stale = readCache(ITCH_CACHE_KEY, Infinity);
            return stale ? stale.map(normalizeItem) : [];
        }

        const limited = sortByDateDesc(allPosts).slice(0, MAX_ITCH_POSTS);
        writeCache(ITCH_CACHE_KEY, limited);
        return limited;
    }

    // ============================================================
    // GitHub / Twitch / Releases
    // ============================================================

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

    async function loadAllSources(signal, forceRefresh, onItem) {
        const results = await Promise.allSettled([
            loadPosts(signal),
            fetchYoutubeVideos(signal, forceRefresh),
            loadTwitchStreams(signal),
            loadReleases(onItem, signal),
            fetchItchPosts(signal, forceRefresh)
        ]);
        let allItems = [];
        const labels = ['посты', 'YouTube', 'Twitch', 'релизы', 'itch.io'];
        results.forEach((r, i) => {
            if (r.status === 'fulfilled') allItems = allItems.concat(r.value || []);
            else if (!isAborted(r.reason, signal)) {
                console.warn(`[NewsFeed] ${labels[i]}:`, r.reason);
            }
        });
        allItems.sort((a, b) => b.date - a.date);
        return allItems;
    }

    async function fetchNewsFeed({ signal, forceRefresh = false, maxAge = CACHE_TTL, onItem, onUpdate } = {}) {
        const cached = await cacheGet(CACHE_KEY, maxAge);
        const hasCache = cached && Array.isArray(cached.items) && cached.items.length > 0;

        if (hasCache && !forceRefresh) {
            const items = cached.items.map(normalizeItem);
            if (!backgroundRefreshInFlight) {
                backgroundRefreshInFlight = true;
                (async () => {
                    try {
                        const freshItems = await loadAllSources(null, true, null);
                        if (freshItems.length) {
                            const limited = freshItems.slice(0, MAX_DISPLAY_ITEMS);
                            await cacheSet(CACHE_KEY, { items: limited, timestamp: Date.now() });
                            if (typeof onUpdate === 'function') {
                                try { onUpdate(limited); } catch { /* noop */ }
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
                        resolve(fresh
                            ? { items: (fresh.items || []).map(normalizeItem), fromCache: true, isStale: false }
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
            const allItems = await loadAllSources(abortController.signal, forceRefresh, onItem);
            const limited = allItems.slice(0, MAX_DISPLAY_ITEMS);
            await cacheSet(CACHE_KEY, { items: limited, timestamp: Date.now() });
            return { items: limited, fromCache: false, isStale: false };
        } catch (err) {
            if (isAborted(err, abortController.signal)) return { items: [], fromCache: false, isStale: false };
            const stale = await cacheGet(CACHE_KEY, Infinity);
            if (stale && stale.items) return { items: stale.items.map(normalizeItem), fromCache: true, isStale: true };
            throw err;
        } finally {
            isLoading = false;
            abortController = null;
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
        if (!container || !item || !item.id) return;
        let grid = container.querySelector('.projects-grid:not(.skeleton-grid)');
        if (!grid) {
            const sk = container.querySelector('.skeleton-grid');
            if (sk) sk.remove();
            const em = container.querySelector('.empty-state');
            if (em) em.remove();
            grid = createElement('div', 'projects-grid');
            container.appendChild(grid);
        }
        if (grid.children.length >= MAX_DISPLAY_ITEMS) return;
        if (grid.querySelector(`[data-item-id="${item.id}"]`)) return;
        const card = createNewsCard(item);
        card.dataset.itemId = item.id;
        grid.appendChild(card);
    }

    function renderNewsFeed(items, { replace = false } = {}) {
        if (!container) return;
        const displayItems = items.slice(0, MAX_DISPLAY_ITEMS);

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

        let grid = container.querySelector('.projects-grid:not(.skeleton-grid)');
        if (replace && grid) { grid.remove(); grid = null; }

        if (displayItems.length === 0 && (!grid || grid.children.length === 0)) {
            const sk = container.querySelector('.skeleton-grid');
            if (sk) sk.remove();
            container.innerHTML = sanitizeHtml(`
                <div class="empty-state">
                    <i class="fas fa-newspaper"></i>
                    <p data-lang="newsNoItems">${t('newsNoItems')}</p>
                    <button class="button small" id="news-retry-btn"><i class="fas fa-sync"></i> ${t('newsRetryVideo')}</button>
                </div>
            `);
            const btn = container.querySelector('#news-retry-btn');
            if (btn) btn.addEventListener('click', () => refreshNewsFeed());
            return;
        }

        if (!grid) {
            const sk = container.querySelector('.skeleton-grid');
            if (sk) sk.remove();
            const em = container.querySelector('.empty-state');
            if (em) em.remove();
            grid = createElement('div', 'projects-grid');
            container.appendChild(grid);
        }

        const fragment = document.createDocumentFragment();
        let count = 0;
        for (const item of displayItems) {
            if (count >= MAX_DISPLAY_ITEMS) break;
            const card = createNewsCard(item);
            card.dataset.itemId = item.id;
            fragment.appendChild(card);
            count++;
        }
        grid.replaceChildren(fragment);

        container.querySelectorAll('[data-lang]').forEach(el => {
            const k = el.getAttribute('data-lang');
            if (k) el.textContent = t(k);
        });
    }

    function getAuthorIcon(type) {
        switch (type) {
            case 'release':   return 'fas fa-cube';
            case 'itch-post': return 'fab fa-itch-io';
            default:          return 'fas fa-user';
        }
    }

    function createNewsCard(item) {
        const cardWrapper = createElement('div', 'project-card-link card-interactive tilt-card');
        const card = createElement('div', 'project-card');

        const imgWrapper = createElement('div', 'image-wrapper');
        const img = createElement('img', 'project-image', {}, {
            src: item.thumbnail || 'images/default-news.webp',
            alt: item.title, loading: 'lazy'
        });
        img.onerror = () => { img.src = 'images/default-news.webp'; };
        imgWrapper.appendChild(img);
        card.appendChild(imgWrapper);

        const title = createElement('h3');
        title.textContent = item.title;
        card.appendChild(title);

        const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
        const icon = getAuthorIcon(item.type);
        meta.innerHTML = sanitizeHtml(
            `<i class="${icon}"></i> ${escapeHtml(item.author)} <i class="fas fa-calendar-alt"></i> ${item.date.toLocaleDateString()}`
        );
        if (item.type === 'twitch' && item.twitchData) {
            meta.innerHTML += sanitizeHtml(` 🎮 ${escapeHtml(item.twitchData.game)}`);
        }
        if (item.type === 'release' && item.releaseData?.tag) {
            meta.innerHTML += sanitizeHtml(` <i class="fas fa-tag"></i> ${escapeHtml(item.releaseData.tag)}`);
        }
        card.appendChild(meta);

        if ((item.type === 'post' || item.type === 'release' || item.type === 'itch-post') && item.body) {
            const summary = window.GithubCore.extractSummary(item.body)
                || item.body.replace(/\n/g, ' ').substring(0, 120);
            const preview = createElement('p', 'text-secondary', {
                fontSize: '13px', overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: '2', WebkitBoxOrient: 'vertical'
            });
            preview.textContent = summary;
            card.appendChild(preview);
        }

        if (item.type === 'video' && item.id) {
            const a = createElement('a', 'button small', {
                marginTop: '8px', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', width: '100%'
            }, { href: `https://www.youtube.com/watch?v=${item.id}`, target: '_blank', rel: 'noopener noreferrer' });
            a.innerHTML = sanitizeHtml(`<i class="fab fa-youtube"></i> <span>${t('watch')}</span>`);
            a.addEventListener('click', (e) => e.stopPropagation());
            card.appendChild(a);
        }

        if (item.type === 'release' && item.releaseUrl) {
            const a = createElement('a', 'button small', {
                marginTop: '8px', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', width: '100%'
            }, { href: item.releaseUrl, target: '_blank', rel: 'noopener noreferrer' });
            a.innerHTML = sanitizeHtml(`<i class="fab fa-github"></i> <span>${t('openRelease')}</span>`);
            a.addEventListener('click', (e) => e.stopPropagation());
            card.appendChild(a);
        }

        if (item.type === 'itch-post' && item.itchLink) {
            const a = createElement('a', 'button small', {
                marginTop: '8px', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', width: '100%'
            }, { href: item.itchLink, target: '_blank', rel: 'noopener noreferrer' });
            a.innerHTML = sanitizeHtml(`<i class="fab fa-itch-io"></i> <span>${t('readMore')}</span>`);
            a.addEventListener('click', (e) => e.stopPropagation());
            card.appendChild(a);
        }

        const currentUser = getCurrentUser();
        if (currentUser && hasScope('gist') && item.type !== 'release' && item.type !== 'itch-post') {
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
                    url: item.type === 'video' ? `https://www.youtube.com/watch?v=${item.id}` :
                         item.type === 'twitch' ? `https://www.twitch.tv/${item.id}` :
                         `${location.origin}${location.pathname}?post=${item.id}`,
                    title: item.title,
                    type: item.type === 'post' ? 'post' : 'video',
                    thumbnail: item.thumbnail || 'images/default-news.webp',
                    author: item.author, date: item.date,
                    postData: item.type === 'post' ? {
                        id: item.id, title: item.title, body: item.body,
                        author: item.author, date: item.date.toISOString(),
                        labels: item.labels, game: item.game
                    } : undefined,
                    videoData: item.type === 'video' ? { id: item.id, service: 'youtube' } : undefined,
                    twitchData: item.type === 'twitch' ? { channel: item.id } : undefined
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

            if (item.type === 'post') {
                if (!window.UIFeedback) { loadModule('js/features/ui-feedback.js').catch(() => {}); return; }
                window.UIFeedback.openFullModal({
                    type: 'post', id: item.id, title: item.title, body: item.body,
                    author: item.author, date: item.date, game: item.game, labels: item.labels
                });
            } else if (item.type === 'release' && item.releaseUrl) {
                window.open(item.releaseUrl, '_blank', 'noopener,noreferrer');
            } else if (item.type === 'itch-post' && item.itchLink) {
                window.open(item.itchLink, '_blank', 'noopener,noreferrer');
            } else if (item.type === 'video') {
                window.open(`https://www.youtube.com/watch?v=${item.id}`, '_blank', 'noopener,noreferrer');
            } else if (item.type === 'twitch') {
                window.open(`https://www.twitch.tv/${item.id}`, '_blank', 'noopener,noreferrer');
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
                onItem: (item) => appendItemToGrid(item),
                onUpdate: (freshItems) => {
                    renderNewsFeed(freshItems, { replace: true });
                }
            });
            if (result) {
                renderNewsFeed(result.items, { replace: true });
                if (result.isStale) showToast('Данные могут быть устаревшими', 'warning', 5000);
            } else {
                renderNewsFeed([], { replace: true });
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
            const btn = container.querySelector('#news-retry-btn');
            if (btn) btn.addEventListener('click', () => refreshNewsFeed());
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
            onItem: (it) => appendItemToGrid(it),
            onUpdate: (freshItems) => {
                renderNewsFeed(freshItems, { replace: true });
            }
        })
            .then(r => {
                if (r) renderNewsFeed(r.items, { replace: true });
                else renderNewsFeed([], { replace: true });
            })
            .catch(err => {
                console.error('[NewsFeed] Ошибка обновления:', err);
                renderNewsFeed([], { replace: true });
            });
    }

    window.initNewsFeed = initNewsFeed;
    window.refreshNewsFeed = refreshNewsFeed;
})();