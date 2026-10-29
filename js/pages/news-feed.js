// js/pages/news-feed.js — лента новостей (index.html).
//
// ИСПРАВЛЕНИЯ:
//   1. DOMParser + getElementsByTagName (работает с RSS 1.0/2.0/Atom).
//   2. YouTube: если после Shorts-фильтра 0, но исходных > 0 — показываем все (без фильтра).
//   3. itch.io: getElementsByTagName('item'), извлечение thumbnail из description.
//   4. Piped: duration в секундах (число), parseDuration обрабатывает.
//   5. НЕ кешируем пустоту.
//   6. Вставка карточек по одной по дате (без полной перерисовки).

(function() {
    'use strict';

    const {
        cacheGet, cacheSet, cacheRemoveByPrefix,
        escapeHtml, createElement, loadModule,
        createAbortable, CONFIG, sanitizeHtml
    } = window.GithubCore;
    const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
    const { showToast } = window.UIUtils;

    const CACHE_KEY = 'news_feed_data_v15';
    const CACHE_TTL = 5 * 60 * 1000;
    const VIDEOS_CACHE_KEY = 'yt_videos_cache_v15';
    const VIDEOS_CACHE_TTL = 30 * 60 * 1000;
    const ITCH_CACHE_KEY = 'itch_posts_news_v15';
    const ITCH_CACHE_TTL = 30 * 60 * 1000;

    const SOURCE_TIMEOUT = 25000;
    const REQUEST_TIMEOUT = 25000;
    const MAX_DISPLAY_ITEMS = 9;
    const MAX_VIDEOS = 6;
    const MAX_ITCH_POSTS = 3;
    const MIN_YT_DURATION = 60;

    const YT_CHANNEL_ID = 'UC2pH2qNfh2sEAeYEGs1k_Lg';
    const YT_CHANNEL_NAME = 'Neon Shadow';
    const YT_UULF_PLAYLIST_ID = YT_CHANNEL_ID.replace(/^UC/, 'UULF');
    const YT_UU_PLAYLIST_ID = YT_CHANNEL_ID.replace(/^UC/, 'UU');
    const RSS_URLS = [
        `https://www.youtube.com/feeds/videos.xml?playlist_id=${YT_UULF_PLAYLIST_ID}`,
        `https://www.youtube.com/feeds/videos.xml?playlist_id=${YT_UU_PLAYLIST_ID}`,
        `https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL_ID}`
    ];

    const PIPED_INSTANCES = [
        'https://api.piped.private.coffee',
        'https://pipedapi.ducks.party',
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.leptons.xyz',
        'https://pipedapi-libre.kavin.rocks',
        'https://pipedapi.r4fo.com',
        'https://pipedapi.adminforge.de',
        'https://pipedapi.nosebs.ru',
        'https://api.piped.yt',
        'https://piped-api.privacy.com.de',
        'https://pipedapi.owo.si',
        'https://pipedapi.drgns.space',
        'https://piped-api.codespace.cz',
        'https://pipedapi.reallyaweso.me',
        'https://pipedapi.darkness.services',
        'https://pipedapi.orangenet.cc'
    ];

    const INVIDIOUS_INSTANCES = [
        'https://inv.nadeko.net',
        'https://invidious.nerdvpn.de',
        'https://yewtu.be',
        'https://invidious.privacyredirect.com',
        'https://iv.melmac.space',
        'https://invidious.f5.si',
        'https://yt.artemislena.eu',
        'https://invidious.jing.rocks',
        'https://invidious.perennialte.ch'
    ];

    const CORS_PROXIES = [
        (u) => `https://corsproxy.dev/?url=${encodeURIComponent(u)}`,
        (u) => `https://corsfix.com/?${u}`,
        (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
        (u) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(u)}`,
        (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
        (u) => `https://cors.eu.org/${u}`,
        (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
        (u) => `https://cloudflare-cors-anywhere.queakchannel42.workers.dev/?${u}`
    ];

    const RELEASE_SOURCES = [
        { owner: 'NeonShadowYT', repo: 'WorldGenerator', name: 'WorldGenerator', icon: 'images/tool-world-generator.webp' },
        { owner: 'NeonShadowYT', repo: 'IconCreator', name: 'IconCreator', icon: 'images/tool-icon-creator.webp' }
    ];

    const ITCH_DEVLOG_SOURCES = [
        {
            name: 'Starve Neon',
            rssUrl: 'https://neon-shadow.itch.io/starve-neon/devlog.rss',
            devlogPageUrl: 'https://neon-shadow.itch.io/starve-neon/devlog'
        }
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
            fetch(url, { signal: controller.signal, cache: 'no-store' })
                .then(res => {
                    clearTimeout(timer);
                    if (!res.ok) reject(new Error(`HTTP ${res.status}`));
                    else resolve(res);
                })
                .catch(err => { clearTimeout(timer); reject(err); });
        });
    }

    async function fetchViaProxy(proxyFn, targetUrl, signal, mustContain = ['<entry', '<feed', '<rss', '<item', '<channel']) {
        const proxyUrl = proxyFn(targetUrl);
        const res = await fetchWithTimeout(proxyUrl, signal);
        let text = await res.text();
        if (!text || text.length < 100) throw new Error('too short (' + text.length + 'b)');

        if (text.trim().startsWith('{')) {
            try {
                const json = JSON.parse(text);
                if (typeof json.contents === 'string') text = json.contents;
                else if (json.error) throw new Error('proxy: ' + json.error);
            } catch (e) {
                if (e.message.startsWith('proxy:')) throw e;
            }
        }

        const isValid = mustContain.some(tag => text.includes(tag));
        if (!isValid) {
            throw new Error('no XML tags, got ' + text.length + 'b: ' + text.slice(0, 80).replace(/\s+/g, ' '));
        }

        return text;
    }

    function extractVideoId(url) {
        if (!url) return null;
        const m = String(url).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|\/watch\?v=|\/embed\/|v\/)([a-zA-Z0-9_-]{11})/);
        return m ? m[1] : null;
    }

    function parseDuration(val) {
        if (val == null) return null;
        if (typeof val === 'number' && isFinite(val)) return val > 0 ? val : null;
        if (typeof val !== 'string') return null;
        const trimmed = val.trim();
        if (!trimmed) return null;

        const isoMatch = trimmed.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
        if (isoMatch) {
            const h = parseInt(isoMatch[1] || 0, 10);
            const m = parseInt(isoMatch[2] || 0, 10);
            const s = parseInt(isoMatch[3] || 0, 10);
            const total = h * 3600 + m * 60 + s;
            return total > 0 ? total : null;
        }

        const parts = trimmed.split(':').map(Number);
        if (parts.some(isNaN)) return null;
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 1) return parts[0] > 0 ? parts[0] : null;
        return null;
    }

    /** Отсекаем Shorts. Если после фильтра 0, но исходных > 0 — возвращаем все. */
    function filterShortsAndDuplicates(videos) {
        const seen = new Set();
        const filtered = [];
        let shortsCount = 0;
        for (const v of videos) {
            if (!v || !v.videoId) continue;
            if (seen.has(v.videoId)) continue;
            seen.add(v.videoId);
            const dur = parseDuration(v.duration);
            if (dur != null && dur > 0 && dur < MIN_YT_DURATION) {
                shortsCount++;
                continue;
            }
            filtered.push(v);
        }
        if (filtered.length === 0 && videos.length > 0) {
            console.warn(`[NewsFeed] YouTube: все ${videos.length} видео отсеклись как Shorts (dur<60), показываем без фильтра`);
            return videos.slice(0, MAX_VIDEOS);
        }
        console.log(`[NewsFeed] YouTube: было ${videos.length}, Shorts ${shortsCount}, осталось ${filtered.length}`);
        return filtered.sort((a, b) => b.date - a.date).slice(0, MAX_VIDEOS);
    }

    // ============================================================
    // YOUTUBE RSS — DOMParser + getElementsByTagName
    // ============================================================

    function parseYoutubeRssWithDom(text) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/xml');
        if (doc.querySelector('parsererror')) throw new Error('XML parser error');

        const entries = doc.getElementsByTagName('entry');
        const items = [];
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const videoIdEl = entry.getElementsByTagName('yt:videoId')[0];
            const titleEl = entry.getElementsByTagName('title')[0];
            const publishedEl = entry.getElementsByTagName('published')[0];
            if (!videoIdEl || !videoIdEl.textContent) continue;
            const videoId = videoIdEl.textContent.trim();
            const title = decodeXmlEntities(titleEl ? titleEl.textContent : 'Untitled');
            items.push(normalizeItem({
                type: 'video', id: videoId,
                title,
                author: YT_CHANNEL_NAME,
                date: new Date(publishedEl ? publishedEl.textContent : Date.now()),
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                videoData: { service: 'youtube', id: videoId }
            }));
        }
        return items;
    }

    async function fetchYoutubeRss(signal) {
        const tasks = [];
        for (const rssUrl of RSS_URLS) {
            for (const proxyFn of CORS_PROXIES) {
                tasks.push(
                    fetchViaProxy(proxyFn, rssUrl, signal, ['<entry', '<feed'])
                        .then(text => {
                            const videos = parseYoutubeRssWithDom(text);
                            if (videos.length > 0) {
                                const host = new URL(proxyFn(rssUrl)).hostname;
                                console.log(`[NewsFeed] RSS OK через ${host}: ${videos.length} видео`);
                            }
                            return videos;
                        })
                        .catch(() => [])
                );
            }
        }
        const results = await Promise.allSettled(tasks);
        let videos = [];
        for (const r of results) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) videos = videos.concat(r.value);
        }
        return videos;
    }

    // ============================================================
    // YOUTUBE PIPED
    // ============================================================

    async function fetchYoutubePipedDirect(base, signal) {
        const res = await fetchWithTimeout(`${base}/channel/${YT_CHANNEL_ID}`, signal);
        const data = await res.json();
        const streams = data.relatedStreams || data.items || [];
        return streams.map(item => {
            const videoId = extractVideoId(item.url);
            if (!videoId) return null;
            return normalizeItem({
                type: 'video', id: videoId,
                title: item.title || 'Untitled',
                author: YT_CHANNEL_NAME,
                date: new Date(item.uploaded || Date.now()),
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                videoData: { service: 'youtube', id: videoId },
                duration: item.duration // число секунд
            });
        }).filter(Boolean);
    }

    async function fetchYoutubePiped(signal) {
        const tasks = PIPED_INSTANCES.map(base =>
            fetchYoutubePipedDirect(base, signal)
                .then(v => {
                    if (v.length > 0) console.log(`[NewsFeed] Piped OK: ${base}: ${v.length}`);
                    return v;
                })
                .catch(() => [])
        );
        // Через прокси для первых 5 инстансов
        for (const base of PIPED_INSTANCES.slice(0, 5)) {
            for (const proxyFn of CORS_PROXIES.slice(0, 4)) {
                tasks.push(
                    fetchViaProxy(proxyFn, `${base}/channel/${YT_CHANNEL_ID}`, signal, ['"relatedStreams"', '"items"', '{"'])
                        .then(text => {
                            const data = JSON.parse(text);
                            const streams = data.relatedStreams || data.items || [];
                            return streams.map(item => {
                                const videoId = extractVideoId(item.url);
                                if (!videoId) return null;
                                return normalizeItem({
                                    type: 'video', id: videoId,
                                    title: item.title || 'Untitled',
                                    author: YT_CHANNEL_NAME,
                                    date: new Date(item.uploaded || Date.now()),
                                    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                                    videoData: { service: 'youtube', id: videoId },
                                    duration: item.duration
                                });
                            }).filter(Boolean);
                        })
                        .then(v => {
                            if (v.length > 0) console.log(`[NewsFeed] Piped (proxy) OK: ${base}: ${v.length}`);
                            return v;
                        })
                        .catch(() => [])
                );
            }
        }
        const results = await Promise.allSettled(tasks);
        let videos = [];
        for (const r of results) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) videos = videos.concat(r.value);
        }
        return videos;
    }

    // ============================================================
    // YOUTUBE INVIDIOUS
    // ============================================================

    async function fetchYoutubeInvidious(signal) {
        const tasks = [];
        for (const base of INVIDIOUS_INSTANCES) {
            const apiUrl = `${base}/api/v1/channels/${YT_CHANNEL_ID}/videos`;
            tasks.push(
                fetchWithTimeout(apiUrl, signal)
                    .then(r => r.json())
                    .then(data => {
                        const items = Array.isArray(data) ? data : (data.videos || []);
                        return items.map(item => {
                            if (!item.videoId) return null;
                            return normalizeItem({
                                type: 'video', id: item.videoId,
                                title: item.title || 'Untitled',
                                author: YT_CHANNEL_NAME,
                                date: new Date(item.published ? item.published * 1000 : Date.now()),
                                thumbnail: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
                                videoData: { service: 'youtube', id: item.videoId },
                                duration: item.lengthSeconds
                            });
                        }).filter(Boolean);
                    })
                    .then(v => {
                        if (v.length > 0) console.log(`[NewsFeed] Invidious OK: ${base}: ${v.length}`);
                        return v;
                    })
                    .catch(() => [])
            );
            for (const proxyFn of CORS_PROXIES.slice(0, 4)) {
                tasks.push(
                    fetchViaProxy(proxyFn, apiUrl, signal, ['"videoId"', '"videos"', '['])
                        .then(text => {
                            const data = JSON.parse(text);
                            const items = Array.isArray(data) ? data : (data.videos || []);
                            return items.map(item => {
                                if (!item.videoId) return null;
                                return normalizeItem({
                                    type: 'video', id: item.videoId,
                                    title: item.title || 'Untitled',
                                    author: YT_CHANNEL_NAME,
                                    date: new Date(item.published ? item.published * 1000 : Date.now()),
                                    thumbnail: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
                                    videoData: { service: 'youtube', id: item.videoId },
                                    duration: item.lengthSeconds
                                });
                            }).filter(Boolean);
                        })
                        .then(v => {
                            if (v.length > 0) console.log(`[NewsFeed] Invidious (proxy) OK: ${base}: ${v.length}`);
                            return v;
                        })
                        .catch(() => [])
                );
            }
        }
        const results = await Promise.allSettled(tasks);
        let videos = [];
        for (const r of results) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) videos = videos.concat(r.value);
        }
        return videos;
    }

    // ============================================================
    // YOUTUBE — АГРЕГАЦИЯ
    // ============================================================

    async function fetchYoutubeVideos(signal, forceRefresh = false) {
        if (!forceRefresh) {
            const cached = readCache(VIDEOS_CACHE_KEY, VIDEOS_CACHE_TTL);
            if (cached && cached.length) {
                console.log(`[NewsFeed] YouTube из кеша: ${cached.length}`);
                return cached.map(normalizeItem);
            }
        }

        console.log('[NewsFeed] YouTube: опрос RSS + Piped + Invidious…');
        const results = await Promise.allSettled([
            fetchYoutubeRss(signal),
            fetchYoutubePiped(signal),
            fetchYoutubeInvidious(signal)
        ]);

        let videos = [];
        const names = ['RSS', 'Piped', 'Invidious'];
        results.forEach((r, i) => {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                console.log(`[NewsFeed] ${names[i]}: ${r.value.length} видео`);
                videos = videos.concat(r.value);
            } else {
                console.warn(`[NewsFeed] ${names[i]} упал:`, r.reason?.message || r.reason);
            }
        });

        if (videos.length === 0) {
            const stale = readCache(VIDEOS_CACHE_KEY, Infinity);
            if (stale && stale.length) {
                console.log(`[NewsFeed] YouTube: пусто, fallback stale ${stale.length}`);
                return stale.map(normalizeItem);
            }
            console.warn('[NewsFeed] YouTube: 0 видео, кеш не пишем');
            return [];
        }

        const filtered = filterShortsAndDuplicates(videos);
        if (filtered.length > 0) writeCache(VIDEOS_CACHE_KEY, filtered);
        return filtered;
    }

    // ============================================================
    // ITCH.IO — DOMParser + getElementsByTagName
    // ============================================================

    function normalizeItchUrl(url) {
        if (!url) return null;
        url = url.trim();
        if (url.startsWith('//')) return 'https:' + url;
        if (url.startsWith('/')) return 'https://img.itch.zone' + url;
        return url;
    }

    function extractItchThumbnailFromEl(itemEl) {
        const mediaContent = itemEl.getElementsByTagName('media:content')[0];
        if (mediaContent) { const url = mediaContent.getAttribute('url'); if (url) return normalizeItchUrl(url); }
        const mediaThumb = itemEl.getElementsByTagName('media:thumbnail')[0];
        if (mediaThumb) { const url = mediaThumb.getAttribute('url'); if (url) return normalizeItchUrl(url); }
        const enclosure = itemEl.getElementsByTagName('enclosure')[0];
        if (enclosure) {
            const type = enclosure.getAttribute('type') || '';
            if (type.startsWith('image')) { const url = enclosure.getAttribute('url'); if (url) return normalizeItchUrl(url); }
        }
        const descEl = itemEl.getElementsByTagName('description')[0];
        if (descEl) {
            const imgMatch = descEl.textContent.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (imgMatch) return normalizeItchUrl(imgMatch[1]);
        }
        return null;
    }

    function parseItchRssWithDom(text, source) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/xml');
        if (doc.querySelector('parsererror')) throw new Error('XML parser error');

        // getElementsByTagName работает с любыми префиксами (rdf:item, item и т.д.)
        const items = doc.getElementsByTagName('item');
        const result = [];
        for (let i = 0; i < items.length; i++) {
            const itemEl = items[i];
            const titleEl = itemEl.getElementsByTagName('title')[0];
            const linkEl = itemEl.getElementsByTagName('link')[0];
            const pubDateEl = itemEl.getElementsByTagName('pubDate')[0];
            const descEl = itemEl.getElementsByTagName('description')[0];

            const title = decodeXmlEntities(titleEl ? titleEl.textContent : 'Без названия');
            const link = linkEl ? linkEl.textContent.trim() : (source.devlogPageUrl || '#');
            let date = pubDateEl ? new Date(pubDateEl.textContent) : new Date();
            if (isNaN(date.getTime())) date = new Date();

            let description = '';
            if (descEl) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = descEl.textContent;
                description = (tempDiv.textContent || tempDiv.innerText || '').trim();
            }

            result.push(normalizeItem({
                type: 'itch-post',
                id: `itch-${link}`,
                title, author: source.name, date, body: description,
                thumbnail: extractItchThumbnailFromEl(itemEl),
                itchLink: link, itchSource: source.name,
                labels: ['type:itch-post']
            }));
        }
        return result.sort((a, b) => b.date - a.date).slice(0, MAX_ITCH_POSTS);
    }

    async function fetchItchPosts(signal, forceRefresh = false) {
        if (!forceRefresh) {
            const cached = readCache(ITCH_CACHE_KEY, ITCH_CACHE_TTL);
            if (cached && cached.length) {
                console.log(`[NewsFeed] itch.io из кеша: ${cached.length}`);
                return cached.map(normalizeItem);
            }
        }

        const allPosts = [];
        for (const source of ITCH_DEVLOG_SOURCES) {
            const tasks = CORS_PROXIES.map(proxyFn =>
                fetchViaProxy(proxyFn, source.rssUrl, signal, ['<item', '<rss', '<channel'])
                    .then(text => {
                        const posts = parseItchRssWithDom(text, source);
                        if (posts.length > 0) {
                            const host = new URL(proxyFn(source.rssUrl)).hostname;
                            console.log(`[NewsFeed] itch.io OK через ${host}: ${posts.length}`);
                        }
                        return posts;
                    })
                    .catch(() => [])
            );
            const results = await Promise.allSettled(tasks);
            for (const r of results) {
                if (r.status === 'fulfilled' && Array.isArray(r.value)) allPosts.push(...r.value);
            }
        }

        if (allPosts.length === 0) {
            const stale = readCache(ITCH_CACHE_KEY, Infinity);
            if (stale && stale.length) {
                console.log(`[NewsFeed] itch.io: пусто, fallback stale ${stale.length}`);
                return stale.map(normalizeItem);
            }
            console.warn('[NewsFeed] itch.io: 0 постов, кеш не пишем');
            return [];
        }

        const seen = new Set();
        const unique = allPosts.filter(p => {
            if (seen.has(p.itchLink)) return false;
            seen.add(p.itchLink);
            return true;
        }).sort((a, b) => b.date - a.date).slice(0, MAX_ITCH_POSTS);

        if (unique.length > 0) writeCache(ITCH_CACHE_KEY, unique);
        return unique;
    }

    // ============================================================
    // GITHUB ISSUES
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

    // ============================================================
    // TWITCH
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
    // GITHUB RELEASES
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

    // ============================================================
    // АГРЕГАЦИЯ
    // ============================================================

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
            if (r.status === 'fulfilled') {
                const count = r.value?.length || 0;
                console.log(`[NewsFeed] ${labels[i]}: ${count} элементов`);
                allItems = allItems.concat(r.value || []);
            } else if (!isAborted(r.reason, signal)) {
                console.warn(`[NewsFeed] ${labels[i]} упал:`, r.reason?.message || r.reason);
            }
        });
        allItems.sort((a, b) => b.date - a.date);
        return allItems;
    }

    // ============================================================
    // FETCH С КЕШЕМ
    // ============================================================

    async function fetchNewsFeed({ signal, forceRefresh = false, maxAge = CACHE_TTL, onUpdate } = {}) {
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
            const allItems = await loadAllSources(abortController.signal, forceRefresh, null);
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

    // ============================================================
    // SKELETON / ВСТАВКА / РЕНДЕР
    // ============================================================

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
        const newCard = createNewsCard(item);
        newCard.dataset.itemId = item.id;
        newCard.dataset.date = String(item.date.getTime());
        const newTs = item.date.getTime();
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

    function updateNewsFeed(items, { replace = false } = {}) {
        if (!container) return;
        const displayItems = items.slice(0, MAX_DISPLAY_ITEMS);
        renderNewsHeader();
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

    // ============================================================
    // КАРТОЧКА
    // ============================================================

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

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================

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
                onUpdate: (freshItems) => {
                    updateNewsFeed(freshItems, { replace: false });
                }
            });
            if (result) {
                updateNewsFeed(result.items, { replace: true });
                if (result.isStale) showToast('Данные могут быть устаревшими', 'warning', 5000);
            } else {
                updateNewsFeed([], { replace: true });
            }
        } catch (err) {
            console.error('[NewsFeed] Ошибка инициализации:', err);
            if (container) {
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
            onUpdate: (freshItems) => {
                updateNewsFeed(freshItems, { replace: false });
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