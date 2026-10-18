// js/pages/news-feed.js – лента новостей с авто-релизами и видео с канала Neon Shadow.
// cacheGet/cacheSet асинхронные. Abort предыдущего запроса НЕ логируется.
//
// ВИДЕО С YOUTUBE (канал Neon Shadow):
//   - Несколько источников опрашиваются ПАРАЛЛЕЛЬНО через Promise.any:
//       a) rss2json (быстрый, но иногда 422)
//       b) RSS через CORS-прокси (allorigins/everyorigin/cors.lol/codetabs/cf-worker)
//       c) HTML страницы канала через те же прокси (парсим ytInitialData)
//   - Первый успешный результат кешируется в localStorage на 30 минут.
//   - При повторном визите видео отдаются мгновенно из кеша.
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
    const VIDEOS_CACHE_KEY = 'yt_videos_cache_neonshadow';
    const VIDEOS_CACHE_TTL = 30 * 60 * 1000;
    const SOURCE_TIMEOUT = 15000;
    const VIDEO_PROXY_TIMEOUT = 12000;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000;
    const MAX_DISPLAY_ITEMS = 9;
    const MAX_VIDEOS = 6;

    const RELEASE_SOURCES = [
        { owner: 'NeonShadowYT', repo: 'WorldGenerator', name: 'WorldGenerator', icon: 'images/tool-world-generator.webp' },
        { owner: 'NeonShadowYT', repo: 'IconCreator', name: 'IconCreator', icon: 'images/tool-icon-creator.webp' }
    ];

    // ---- YouTube ----
    const YT_CHANNEL_ID = 'UC2pH2qNfh2sEAeYEGs1k_Lg';
    const YT_CHANNEL_NAME = 'Neon Shadow';
    const YT_RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL_ID}`;
    const YT_CHANNEL_URL = `https://www.youtube.com/channel/${YT_CHANNEL_ID}/videos`;

    // CORS-прокси. Все запускаются параллельно, побеждает самый быстрый успешный.
    // ВАЖНО: домены должны быть разрешены в connect-src CSP.
    const VIDEO_PROXIES = [
        // allorigins — обычно самый стабильный
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        // codetabs — резерв
        (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        // corsproxy.io — иногда работает без ключа
        (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
        // everyorigin — ещё один запасной
        (url) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(url)}`
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

    // ============================================================
    // Видео с канала Neon Shadow — кеш
    // ============================================================

    function readVideosCache() {
        try {
            const raw = localStorage.getItem(VIDEOS_CACHE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !data.timestamp || !Array.isArray(data.videos)) return null;
            if (Date.now() - data.timestamp > VIDEOS_CACHE_TTL) {
                localStorage.removeItem(VIDEOS_CACHE_KEY);
                return null;
            }
            return normalizeItems(data.videos);
        } catch (e) {
            return null;
        }
    }

    function writeVideosCache(videos) {
        try {
            localStorage.setItem(VIDEOS_CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                videos
            }));
        } catch (e) { /* noop */ }
    }

    // ============================================================
    // Видео — парсинг RSS XML
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

    function parseYoutubeRssXml(xmlText) {
        if (!xmlText || typeof xmlText !== 'string') return [];
        const entryBlocks = xmlText.split('<entry>').slice(1);
        return entryBlocks.slice(0, MAX_VIDEOS).map(block => {
            const videoIdMatch = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
            const titleMatch = block.match(/<title>([^<]*)<\/title>/);
            const publishedMatch = block.match(/<published>([^<]+)<\/published>/);
            const thumbMatch = block.match(/<media:thumbnail\s+url=["']([^"']+)["']/);
            if (!videoIdMatch) return null;
            const videoId = videoIdMatch[1];
            return normalizeItem({
                type: 'video', id: videoId,
                title: decodeXmlEntities(titleMatch ? titleMatch[1] : 'Untitled'),
                author: YT_CHANNEL_NAME,
                date: new Date(publishedMatch ? publishedMatch[1] : Date.now()),
                thumbnail: thumbMatch ? thumbMatch[1] : `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
                videoData: { service: 'youtube', id: videoId }
            });
        }).filter(v => v);
    }

    // ============================================================
    // Видео — парсинг HTML канала (ytInitialData)
    // ============================================================

    function extractYtInitialData(html) {
        const patterns = [
            /var ytInitialData = ({[\s\S]+?});/,
            /window\["ytInitialData"\]\s*=\s*({[\s\S]+?});/,
            /ytInitialData\s*=\s*({[\s\S]+?});/
        ];
        for (const re of patterns) {
            const m = html.match(re);
            if (m && m[1]) {
                try {
                    return JSON.parse(m[1]);
                } catch (e) {
                    const end = m[1].lastIndexOf('}');
                    if (end !== -1) {
                        try { return JSON.parse(m[1].slice(0, end + 1)); } catch (e2) { /* noop */ }
                    }
                }
            }
        }
        return null;
    }

    function collectVideosFromData(obj, out, seen) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            obj.forEach(item => collectVideosFromData(item, out, seen));
            return;
        }

        // Классические videoRenderer / gridVideoRenderer / compactVideoRenderer
        const classic = obj.videoRenderer || obj.gridVideoRenderer || obj.compactVideoRenderer;
        if (classic && classic.videoId && !seen.has(classic.videoId)) {
            seen.add(classic.videoId);
            let title = '';
            if (classic.title?.runs?.[0]) title = classic.title.runs[0].text;
            else if (classic.title?.simpleText) title = classic.title.simpleText;
            let thumbnail = '';
            if (classic.thumbnail?.thumbnails?.length) {
                thumbnail = classic.thumbnail.thumbnails[classic.thumbnail.thumbnails.length - 1].url;
            }
            if (!thumbnail) thumbnail = `https://img.youtube.com/vi/${classic.videoId}/mqdefault.jpg`;
            out.push(normalizeItem({
                type: 'video', id: classic.videoId,
                title, author: YT_CHANNEL_NAME,
                date: new Date(),
                thumbnail,
                videoData: { service: 'youtube', id: classic.videoId }
            }));
        }

        // Новый lockupViewModel
        if (obj.lockupViewModel) {
            const l = obj.lockupViewModel;
            const videoId = l.contentId;
            if (videoId && !seen.has(videoId)) {
                seen.add(videoId);
                let title = '';
                if (l.metadata?.lockupMetadataViewModel?.title?.content) {
                    title = l.metadata.lockupMetadataViewModel.title.content;
                }
                let thumbnail = '';
                if (l.contentImage?.thumbnailViewModel?.image?.sources?.length) {
                    const s = l.contentImage.thumbnailViewModel.image.sources;
                    thumbnail = s[s.length - 1].url;
                }
                if (!thumbnail) thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
                out.push(normalizeItem({
                    type: 'video', id: videoId,
                    title, author: YT_CHANNEL_NAME,
                    date: new Date(),
                    thumbnail,
                    videoData: { service: 'youtube', id: videoId }
                }));
            }
        }

        // richItemRenderer — обёртка
        if (obj.richItemRenderer?.content) {
            collectVideosFromData(obj.richItemRenderer.content, out, seen);
        }

        for (const key of Object.keys(obj)) {
            if (out.length >= MAX_VIDEOS) break;
            collectVideosFromData(obj[key], out, seen);
        }
    }

    // ============================================================
    // Видео — один прокси-запрос
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
            // allorigins /get возвращает JSON { contents: "..." }
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

    // ============================================================
    // Видео — гонка прокси по RSS
    // ============================================================

    async function fetchVideosViaRssProxies(signal) {
        const promises = VIDEO_PROXIES.map(proxyFn =>
            fetchViaProxy(proxyFn, YT_RSS_URL, signal).then(text => {
                const videos = parseYoutubeRssXml(text);
                if (!videos.length) throw new Error('no videos');
                return videos;
            })
        );
        return await Promise.any(promises);
    }

    // ============================================================
    // Видео — гонка прокси по HTML канала
    // ============================================================

    async function fetchVideosViaHtmlProxies(signal) {
        const promises = VIDEO_PROXIES.map(proxyFn =>
            fetchViaProxy(proxyFn, YT_CHANNEL_URL, signal).then(text => {
                const data = extractYtInitialData(text);
                if (!data) throw new Error('no ytInitialData');
                const out = [];
                const seen = new Set();
                collectVideosFromData(data, out, seen);
                const videos = out.slice(0, MAX_VIDEOS);
                if (!videos.length) throw new Error('no videos');
                return videos;
            })
        );
        return await Promise.any(promises);
    }

    // ============================================================
    // Видео — быстрый источник rss2json
    // ============================================================

    async function fetchVideosViaRss2Json(signal) {
        const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(YT_RSS_URL)}`;
        const resp = await fetch(url, {
            signal: signal || AbortSignal.timeout(VIDEO_PROXY_TIMEOUT)
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data.status !== 'ok' || !Array.isArray(data.items)) throw new Error('not ok');
        return data.items.slice(0, MAX_VIDEOS).map(item => {
            const vid = (item.link || '').match(/(?:youtu\.be\/|v=)([^&\n?#]+)/)?.[1];
            if (!vid) return null;
            return normalizeItem({
                type: 'video', id: vid,
                title: item.title || 'Untitled',
                author: YT_CHANNEL_NAME,
                date: new Date(item.pubDate || Date.now()),
                thumbnail: item.thumbnail || `https://img.youtube.com/vi/${vid}/mqdefault.jpg`,
                videoData: { service: 'youtube', id: vid }
            });
        }).filter(v => v);
    }

    // ============================================================
    // Видео — главная функция с кешем и Promise.any
    // ============================================================

    async function loadVideos(signal) {
        // 1. Кеш
        const cached = readVideosCache();
        if (cached && cached.length) {
            console.log(`[NewsFeed] Видео из кеша: ${cached.length}`);
            return cached;
        }

        // 2. Параллельный опрос трёх стратегий
        const strategies = [
            fetchVideosViaRss2Json(signal).catch(e => {
                if (isAborted(e, signal)) throw e;
                throw e;
            }),
            fetchVideosViaRssProxies(signal).catch(e => {
                if (isAborted(e, signal)) throw e;
                throw e;
            }),
            fetchVideosViaHtmlProxies(signal).catch(e => {
                if (isAborted(e, signal)) throw e;
                throw e;
            })
        ];

        try {
            const videos = await Promise.any(strategies);
            if (videos && videos.length) {
                writeVideosCache(videos);
                console.log(`[NewsFeed] Видео из сети: ${videos.length}`);
                return videos;
            }
            return [];
        } catch (e) {
            if (isAborted(e, signal)) return [];
            console.warn('[NewsFeed] Все источники видео недоступны');
            return [];
        }
    }

    // ============================================================
    // Посты и обновления (без изменений)
    // ============================================================

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
                    author: i.user.login, date: new Date(i.created_at), labels: labels,
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

    // ============================================================
    // Twitch (без изменений)
    // ============================================================

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

    // ============================================================
    // Релизы (без изменений)
    // ============================================================

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
                    try { onEach(item); } catch (e) { /* noop */ }
                }
                return item;
            } catch (e) {
                clearTimeout(timeoutId);
                if (isAborted(e, signal) || isAborted(e, controller.signal) || e.name === 'AbortError') return null;
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

    // ============================================================
    // Основной агрегатор
    // ============================================================

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
                            resolve({ items: normalizeItems(fresh.items || []), fromCache: true, isStale: false });
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
            const videosPromise = loadVideos(abortController.signal);
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
                console.warn('[NewsFeed] Возвращаем устаревший кеш');
                return { items: normalizeItems(stale.items || []), fromCache: true, isStale: true };
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
        if (!container || !item || !item.id) return;

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
        if (grid) grid.querySelectorAll('[data-item-id]').forEach(el => existingIds.add(el.dataset.itemId));

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
            alt: item.title, loading: 'lazy'
        });
        img.onerror = () => img.src = 'images/default-news.webp';
        imgWrapper.appendChild(img);
        card.appendChild(imgWrapper);

        const title = createElement('h3');
        title.textContent = item.title.length > 70 ? item.title.slice(0, 70) + '…' : item.title;
        card.appendChild(title);

        const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
        meta.innerHTML = sanitizeHtml(`<i class="fas fa-user"></i> ${escapeHtml(item.author)} · <i class="fas fa-calendar-alt"></i> ${item.date.toLocaleDateString()}`);
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
                fontSize: '13px', overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: '2', WebkitBoxOrient: 'vertical'
            });
            preview.textContent = summary;
            card.appendChild(preview);
        }

        if (item.type === 'release' && item.releaseUrl) {
            const releaseLink = createElement('a', 'button small', {
                marginTop: '8px', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', width: '100%'
            }, { href: item.releaseUrl, target: '_blank', rel: 'noopener noreferrer' });
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
                        if (window.loadStorageModules) await window.loadStorageModules();
                        else {
                            const modules = [
                                'js/features/storage/core.js', 'js/features/storage/metadata.js',
                                'js/features/storage/manager.js', 'js/features/storage/ui.js',
                                'js/features/storage/index.js'
                            ];
                            for (const src of modules) await window.Utils.loadModule(src);
                            if (typeof window._StorageEnsure === 'function') await window._StorageEnsure();
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
                    url: buildWatchUrl(item), title: item.title,
                    type: item.type === 'post' ? 'post' : 'video',
                    thumbnail: item.thumbnail || 'images/default-news.webp',
                    author: item.author, date: item.date,
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
                if (!window.UIFeedback) { loadModule('js/features/ui-feedback.js').catch(() => {}); return; }
                window.UIFeedback.openFullModal({
                    type: 'post', id: item.id, title: item.title, body: item.body,
                    author: item.author, date: item.date, game: item.game, labels: item.labels
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
                if (result.isStale) showToast('Данные могут быть устаревшими. Попробуйте обновить.', 'warning', 5000);
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
        // При ручном обновлении сбрасываем и кеш видео, чтобы получить свежие данные
        try { localStorage.removeItem(VIDEOS_CACHE_KEY); } catch { /* noop */ }
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