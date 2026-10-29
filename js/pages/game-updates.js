// js/pages/game-updates.js — обновления (GitHub + itch.io + YouTube).
//
// ИСПРАВЛЕНИЯ:
//   — corsproxy.io УДАЛЁН (требует ключ, отдаёт 401).
//   — Добавлены corsproxy.dev, cors.sh, thingproxy.
//   — itch.io и YouTube RSS опрашиваются ПАРАЛЛЕЛЬНО со всеми прокси.
//   — Логика itch.io и YouTube полностью совпадает с news-feed.js.
//   — YouTube: фильтр только по title, Shorts отсекаются.

(function() {
    'use strict';

    const {
        cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG,
        createAbortable, stripHtml, extractSummary, loadModule,
        createElement, sanitizeHtml
    } = window.GithubCore;
    const { loadIssues } = window.GithubAPI;
    const { isAdmin, hasScope } = window.GithubAuth;
    const { showToast } = window.UIUtils;

    let currentAbort = null;
    let currentGame = null;
    let backgroundRefreshInFlight = false;

    const ITCH_CACHE_TTL = 30 * 60 * 1000;
    const YT_CACHE_TTL = 30 * 60 * 1000;
    const REQUEST_TIMEOUT = 25000;
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

    const GAME_KEYWORDS = {
        'starve-neon': ['starve', 'neon']
    };

    const ITCH_DEVLOG_SOURCES = {
        'starve-neon': {
            name: 'Starve Neon',
            rssUrl: 'https://neon-shadow.itch.io/starve-neon/devlog.rss',
            rssHubUrl: 'https://rsshub.app/itch/devlogs/neon-shadow/starve-neon',
            devlogPageUrl: 'https://neon-shadow.itch.io/starve-neon/devlog'
        }
    };

    // Актуальные Piped-инстансы (февраль 2026)
    const PIPED_INSTANCES = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.adminforge.de',
        'https://api.piped.private.coffee',
        'https://pipedapi.ducks.party',
        'https://pipedapi.leptons.xyz',
        'https://pipedapi-libre.kavin.rocks',
        'https://pipedapi.nosebs.ru',
        'https://pipedapi.r4fo.com',
        'https://api.piped.yt',
        'https://piped-api.privacy.com.de',
        'https://pipedapi.owo.si',
        'https://pipedapi.drgns.space',
        'https://piped-api.codespace.cz',
        'https://pipedapi.reallyaweso.me',
        'https://pipedapi.darkness.services',
        'https://pipedapi.orangenet.cc'
    ];

    // Актуальные Invidious-инстансы (февраль 2026)
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

    // Обновлённый список прокси (corsproxy.io удалён)
    const CORS_PROXIES = [
        (u) => `https://corsproxy.dev/?url=${encodeURIComponent(u)}`,
        (u) => `https://corsfix.com/?${u}`,
        (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
        (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
        (u) => `https://cors-anywhere.herokuapp.com/${u}`,
        (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
        (u) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(u)}`,
        (u) => `https://cors.eu.org/${u}`,
        (u) => `https://cloudflare-cors-anywhere.queakchannel42.workers.dev/?${u}`
    ];

    function t(key) {
        if (window.I18n && typeof window.I18n.translate === 'function') {
            const v = window.I18n.translate(key);
            if (v && v !== key) return v;
        }
        const map = {
            loading: 'Загрузка...', noUpdates: 'Нет обновлений',
            updatesTitle: 'Обновления', addUpdate: 'Добавить обновление',
            updatesLoadError: 'Ошибка загрузки обновлений', readMore: 'Читать далее',
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

    function normalizePost(p) {
        return { ...p, date: normalizeDate(p.date) };
    }

    function getItchCacheKey(game) { return `itch_posts_updates_v21_${game}`; }
    function getYtCacheKey(game) { return `yt_channel_cache_v21_${game}`; }

    function readCacheWithDates(key, ttl) {
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
            return data.items.map(normalizePost);
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

        if (/Just a moment|Attention Required|cf-browser-verification/i.test(text)) {
            throw new Error('cloudflare challenge');
        }

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

    function isRelevantVideo(video, keywords) {
        if (!video) return false;
        const title = (video.title || '').toLowerCase();
        return keywords.some(kw => title.includes(kw));
    }

    function filterYoutubeVideos(videos) {
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
            console.warn(`[GameUpdates] YouTube: все ${videos.length} отсеклись как Shorts, показываем без Shorts-фильтра`);
            const dedup = [];
            const seen2 = new Set();
            for (const v of videos) {
                if (!v || !v.videoId || seen2.has(v.videoId)) continue;
                seen2.add(v.videoId);
                dedup.push(v);
            }
            return dedup.sort((a, b) => b.date - a.date);
        }
        console.log(`[GameUpdates] YouTube после Shorts-фильтра: ${filtered.length} (Shorts: ${shortsCount})`);
        return filtered.sort((a, b) => b.date - a.date);
    }

    // ============================================================
    // ITCH.IO — одинаково с news-feed.js
    // ============================================================

    function normalizeItchUrl(url) {
        if (!url) return null;
        url = url.trim();
        if (url.startsWith('//')) return 'https:' + url;
        if (url.startsWith('/')) return 'https://img.itch.zone' + url;
        return url;
    }

    function extractImageFromHtml(html) {
        if (!html) return null;
        const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
        return m ? normalizeItchUrl(m[1]) : null;
    }

    function extractItchThumbnailFromEl(itemEl) {
        const mediaContent = itemEl.getElementsByTagName('media:content')[0];
        if (mediaContent) {
            const url = mediaContent.getAttribute('url');
            if (url) return normalizeItchUrl(url);
        }
        const mediaThumb = itemEl.getElementsByTagName('media:thumbnail')[0];
        if (mediaThumb) {
            const url = mediaThumb.getAttribute('url');
            if (url) return normalizeItchUrl(url);
        }
        const enclosure = itemEl.getElementsByTagName('enclosure')[0];
        if (enclosure) {
            const type = enclosure.getAttribute('type') || '';
            if (type.startsWith('image')) {
                const url = enclosure.getAttribute('url');
                if (url) return normalizeItchUrl(url);
            }
        }
        const contentEncoded = itemEl.getElementsByTagName('content:encoded')[0];
        if (contentEncoded) {
            const img = extractImageFromHtml(contentEncoded.textContent);
            if (img) return img;
        }
        const descEl = itemEl.getElementsByTagName('description')[0];
        if (descEl) {
            const img = extractImageFromHtml(descEl.textContent);
            if (img) return img;
        }
        return null;
    }

    function parseItchRssWithDom(text, source) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/xml');
        if (doc.querySelector('parsererror')) throw new Error('XML parser error');

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

            result.push(normalizePost({
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

    async function fetchItchPosts(game, signal, forceRefresh = false, onItem) {
        const source = ITCH_DEVLOG_SOURCES[game];
        if (!source) return [];
        const cacheKey = getItchCacheKey(game);

        if (!forceRefresh) {
            const cached = readCacheWithDates(cacheKey, ITCH_CACHE_TTL);
            if (cached && cached.length) {
                console.log(`[GameUpdates] itch.io из кеша: ${cached.length}`);
                if (typeof onItem === 'function') {
                    cached.forEach(item => {
                        try { onItem(item); } catch { /* noop */ }
                    });
                }
                return cached;
            }
        }

        // ПАРАЛЛЕЛЬНЫЙ перебор всех прокси
        const tasks = CORS_PROXIES.map(proxyFn =>
            fetchViaProxy(proxyFn, source.rssUrl, signal, ['<item', '<rss', '<channel'])
                .then(text => {
                    const posts = parseItchRssWithDom(text, source);
                    if (posts.length > 0) {
                        const host = new URL(proxyFn(source.rssUrl)).hostname;
                        console.log(`[GameUpdates] itch.io OK через ${host}: ${posts.length}`);
                    }
                    return posts;
                })
                .catch(() => [])
        );

        const results = await Promise.allSettled(tasks);
        let posts = [];
        for (const r of results) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) posts = posts.concat(r.value);
        }

        // Резерв: RSSHub
        if (posts.length === 0 && source.rssHubUrl) {
            const rssHubUrls = [
                source.rssHubUrl,
                `https://corsproxy.dev/?url=${encodeURIComponent(source.rssHubUrl)}`,
                `https://corsfix.com/?${source.rssHubUrl}`
            ];
            for (const rssHubUrl of rssHubUrls) {
                try {
                    const res = await fetchWithTimeout(rssHubUrl, signal);
                    let text = await res.text();
                    if (!text || text.length < 100) continue;
                    if (/Just a moment|Attention Required|cf-browser-verification/i.test(text)) continue;
                    if (text.trim().startsWith('{')) {
                        try {
                            const json = JSON.parse(text);
                            if (typeof json.contents === 'string') text = json.contents;
                        } catch { /* noop */ }
                    }
                    if (!/<item|<rss|<channel/.test(text)) continue;
                    const rssHubPosts = parseItchRssWithDom(text, source);
                    if (rssHubPosts.length > 0) {
                        console.log(`[GameUpdates] itch.io RSSHub OK через ${rssHubUrl.split('/')[2]}: ${rssHubPosts.length}`);
                        posts = posts.concat(rssHubPosts);
                        break;
                    }
                } catch (e) {
                    console.warn(`[GameUpdates] itch.io RSSHub failed: ${e.message}`);
                }
            }
        }

        if (posts.length === 0) {
            const stale = readCacheWithDates(cacheKey, Infinity);
            if (stale && stale.length) {
                console.log(`[GameUpdates] itch.io: пусто, fallback stale ${stale.length}`);
                return stale;
            }
            console.warn('[GameUpdates] itch.io: 0, кеш не пишем');
            return [];
        }

        const seen = new Set();
        const unique = posts.filter(p => {
            if (seen.has(p.itchLink)) return false;
            seen.add(p.itchLink);
            return true;
        }).slice(0, MAX_ITCH_POSTS);

        if (unique.length > 0) {
            writeCache(cacheKey, unique);
            if (typeof onItem === 'function') {
                unique.forEach(item => {
                    try { onItem(item); } catch { /* noop */ }
                });
            }
        }
        return unique;
    }

    // ============================================================
    // YOUTUBE RSS
    // ============================================================

    function parseYoutubeRssWithDom(text, game) {
        const keywords = GAME_KEYWORDS[game] || [];
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

            if (!isRelevantVideo({ title }, keywords)) continue;

            items.push(normalizePost({
                type: 'yt-video',
                id: `yt-${videoId}`,
                videoId,
                title,
                author: YT_CHANNEL_NAME,
                date: new Date(publishedEl ? publishedEl.textContent : Date.now()),
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                labels: ['type:yt-video']
            }));
        }
        return items;
    }

    async function fetchYoutubeRss(game, signal) {
        const tasks = [];
        for (const rssUrl of RSS_URLS) {
            for (const proxyFn of CORS_PROXIES) {
                tasks.push(
                    fetchViaProxy(proxyFn, rssUrl, signal, ['<entry', '<feed'])
                        .then(text => {
                            const videos = parseYoutubeRssWithDom(text, game);
                            if (videos.length > 0) {
                                const host = new URL(proxyFn(rssUrl)).hostname;
                                console.log(`[GameUpdates] RSS OK через ${host}: ${videos.length} релевантных`);
                            }
                            return videos;
                        })
                        .catch(() => [])
                );
            }
        }
        const results = await Promise.allSettled(tasks);
        let all = [];
        for (const r of results) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) all = all.concat(r.value);
        }
        return all;
    }

    // ============================================================
    // YOUTUBE PIPED
    // ============================================================

    async function fetchYoutubePipedDirect(base, game, signal) {
        const keywords = GAME_KEYWORDS[game] || [];
        const res = await fetchWithTimeout(`${base}/channel/${YT_CHANNEL_ID}`, signal);
        const data = await res.json();
        const streams = data.relatedStreams || data.items || [];
        return streams.map(item => {
            const videoId = extractVideoId(item.url);
            if (!videoId) return null;
            const title = item.title || '';
            if (!isRelevantVideo({ title }, keywords)) return null;
            return normalizePost({
                type: 'yt-video',
                id: `yt-${videoId}`,
                videoId,
                title,
                author: YT_CHANNEL_NAME,
                date: new Date(item.uploaded || Date.now()),
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                labels: ['type:yt-video'],
                duration: item.duration
            });
        }).filter(Boolean);
    }

    async function fetchYoutubePiped(game, signal) {
        const tasks = PIPED_INSTANCES.map(base =>
            fetchYoutubePipedDirect(base, game, signal)
                .then(v => {
                    if (v.length > 0) console.log(`[GameUpdates] Piped OK: ${base}: ${v.length}`);
                    return v;
                })
                .catch(() => [])
        );

        // Параллельно через прокси для первых 5 инстансов
        for (const base of PIPED_INSTANCES.slice(0, 5)) {
            for (const proxyFn of CORS_PROXIES.slice(0, 4)) {
                tasks.push(
                    fetchViaProxy(proxyFn, `${base}/channel/${YT_CHANNEL_ID}`, signal, ['"relatedStreams"', '"items"', '{"'])
                        .then(text => {
                            const data = JSON.parse(text);
                            const streams = data.relatedStreams || data.items || [];
                            const keywords = GAME_KEYWORDS[game] || [];
                            return streams.map(item => {
                                const videoId = extractVideoId(item.url);
                                if (!videoId) return null;
                                const title = item.title || '';
                                if (!isRelevantVideo({ title }, keywords)) return null;
                                return normalizePost({
                                    type: 'yt-video',
                                    id: `yt-${videoId}`,
                                    videoId,
                                    title,
                                    author: YT_CHANNEL_NAME,
                                    date: new Date(item.uploaded || Date.now()),
                                    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                                    labels: ['type:yt-video'],
                                    duration: item.duration
                                });
                            }).filter(Boolean);
                        })
                        .then(v => {
                            if (v.length > 0) console.log(`[GameUpdates] Piped (proxy) OK: ${base}: ${v.length}`);
                            return v;
                        })
                        .catch(() => [])
                );
            }
        }

        const results = await Promise.allSettled(tasks);
        let all = [];
        for (const r of results) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) all = all.concat(r.value);
        }
        return all;
    }

    // ============================================================
    // YOUTUBE INVIDIOUS
    // ============================================================

    async function fetchYoutubeInvidious(game, signal) {
        const keywords = GAME_KEYWORDS[game] || [];
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
                            const title = item.title || '';
                            if (!isRelevantVideo({ title }, keywords)) return null;
                            return normalizePost({
                                type: 'yt-video', id: `yt-${item.videoId}`, videoId: item.videoId,
                                title, author: YT_CHANNEL_NAME,
                                date: new Date(item.published ? item.published * 1000 : Date.now()),
                                thumbnail: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
                                labels: ['type:yt-video'],
                                duration: item.lengthSeconds
                            });
                        }).filter(Boolean);
                    })
                    .then(v => {
                        if (v.length > 0) console.log(`[GameUpdates] Invidious OK: ${base}: ${v.length}`);
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
                                const title = item.title || '';
                                if (!isRelevantVideo({ title }, keywords)) return null;
                                return normalizePost({
                                    type: 'yt-video', id: `yt-${item.videoId}`, videoId: item.videoId,
                                    title, author: YT_CHANNEL_NAME,
                                    date: new Date(item.published ? item.published * 1000 : Date.now()),
                                    thumbnail: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
                                    labels: ['type:yt-video'],
                                    duration: item.lengthSeconds
                                });
                            }).filter(Boolean);
                        })
                        .then(v => {
                            if (v.length > 0) console.log(`[GameUpdates] Invidious (proxy) OK: ${base}: ${v.length}`);
                            return v;
                        })
                        .catch(() => [])
                );
            }
        }
        const results = await Promise.allSettled(tasks);
        let all = [];
        for (const r of results) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) all = all.concat(r.value);
        }
        return all;
    }

    // ============================================================
    // YOUTUBE — АГРЕГАЦИЯ
    // ============================================================

    async function fetchYoutubeForGame(game, signal, forceRefresh = false, onItem) {
        const cacheKey = getYtCacheKey(game);

        if (!forceRefresh) {
            const cached = readCacheWithDates(cacheKey, YT_CACHE_TTL);
            if (cached && cached.length) {
                console.log(`[GameUpdates] YouTube из кеша: ${cached.length}`);
                if (typeof onItem === 'function') {
                    cached.forEach(item => {
                        try { onItem(item); } catch { /* noop */ }
                    });
                }
                return cached;
            }
        }

        const results = await Promise.allSettled([
            fetchYoutubeRss(game, signal),
            fetchYoutubePiped(game, signal),
            fetchYoutubeInvidious(game, signal)
        ]);

        let videos = [];
        const names = ['RSS', 'Piped', 'Invidious'];
        results.forEach((r, i) => {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                console.log(`[GameUpdates] ${names[i]}: ${r.value.length} видео`);
                videos = videos.concat(r.value);
            } else {
                console.warn(`[GameUpdates] ${names[i]} упал:`, r.reason?.message || r.reason);
            }
        });

        if (videos.length === 0) {
            const stale = readCacheWithDates(cacheKey, Infinity);
            if (stale && stale.length) {
                console.log(`[GameUpdates] YouTube: пусто, fallback stale ${stale.length}`);
                return stale;
            }
            console.warn('[GameUpdates] YouTube: 0, кеш не пишем');
            return [];
        }

        const filtered = filterYoutubeVideos(videos);
        console.log(`[GameUpdates] YouTube итого: ${filtered.length}`);
        if (filtered.length > 0) writeCache(cacheKey, filtered);
        return filtered;
    }

    // ============================================================
    // GITHUB ISSUES
    // ============================================================

    async function fetchGithubUpdates(game, signal, forceRefresh = false) {
        const cacheKey = `game_issues_${game}`;
        let issues = null;
        if (!forceRefresh) issues = await cacheGet(cacheKey);
        if (!issues || !issues.length) {
            issues = await loadIssues({ labels: `game:${game}`, state: 'open', per_page: 100, signal });
            if (issues && issues.length > 0) await cacheSet(cacheKey, issues);
        }
        return issues.filter(i =>
            i.labels.some(l => l.name === 'type:update') &&
            CONFIG.ALLOWED_AUTHORS.includes(i.user.login)
        ).map(i => normalizePost({
            type: 'gh-update',
            number: i.number,
            id: `gh-${i.number}`,
            title: i.title,
            body: i.body,
            date: new Date(i.created_at),
            author: i.user.login,
            game,
            labels: i.labels.map(l => l.name),
            thumbnail: null
        }));
    }

    // ============================================================
    // АГРЕГАЦИЯ
    // ============================================================

    async function fetchAllUpdates(game, signal, forceRefresh = false, onItem) {
        const sources = [
            { name: 'GitHub', fn: () => fetchGithubUpdates(game, signal, forceRefresh), cacheKey: `game_issues_${game}` },
            { name: 'itch.io', fn: () => fetchItchPosts(game, signal, forceRefresh, onItem), cacheKey: getItchCacheKey(game) },
            { name: 'YouTube', fn: () => fetchYoutubeForGame(game, signal, forceRefresh, onItem), cacheKey: getYtCacheKey(game) }
        ];

        const promises = sources.map(source => {
            return source.fn()
                .then(items => {
                    if (!items || !items.length) return;
                    console.log(`[GameUpdates] ${source.name}: ${items.length} элементов`);
                    if (typeof onItem === 'function') {
                        for (const item of items) {
                            try { onItem(item); } catch { /* noop */ }
                        }
                    }
                    if (source.cacheKey) writeCache(source.cacheKey, items);
                    return items;
                })
                .catch(err => {
                    if (!isAborted(err, signal)) {
                        console.warn(`[GameUpdates] ${source.name} упал:`, err.message || err);
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

    // ============================================================
    // КАРТОЧКА
    // ============================================================

    function getAuthorIcon(type) {
        if (type === 'itch-post') return 'fab fa-itch-io';
        if (type === 'yt-video') return 'fab fa-youtube';
        return 'fas fa-user';
    }

    function createUpdateCard(post) {
        const date = normalizeDate(post.date);

        const card = createElement('div', 'project-card-link tilt-card', { cursor: 'pointer' });
        card.dataset.itemId = post.id;
        card.dataset.date = String(date.getTime());
        const inner = createElement('div', 'project-card');

        let imgSrc = post.thumbnail || null;
        if (!imgSrc && post.body) {
            const mdMatch = post.body.match(/!\[.*?\]\((.*?)\)/);
            if (mdMatch) imgSrc = mdMatch[1];
        }
        const imgW = createElement('div', 'image-wrapper');
        const img = createElement('img', 'project-image', {}, {
            src: imgSrc || 'images/default-news.webp',
            alt: post.title, loading: 'lazy'
        });
        img.onerror = () => { img.src = 'images/default-news.webp'; };
        imgW.appendChild(img);

        const title = createElement('h3');
        title.textContent = post.title;

        const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
        const icon = getAuthorIcon(post.type);
        meta.innerHTML = sanitizeHtml(
            `<i class="${icon}"></i> ${escapeHtml(post.author)} <i class="fas fa-calendar-alt"></i> ${date.toLocaleDateString()}`
        );

        const summary = extractSummary(post.body || '') || stripHtml(post.body || '').substring(0, 120);
        const preview = createElement('p', 'text-secondary', {
            fontSize: '13px', overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: '2', WebkitBoxOrient: 'vertical'
        });
        preview.textContent = summary;

        inner.append(imgW, title, meta, preview);

        if (post.type === 'itch-post' && post.itchLink) {
            const a = createElement('a', 'button small', {
                marginTop: '8px', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', width: '100%'
            }, { href: post.itchLink, target: '_blank', rel: 'noopener noreferrer' });
            a.innerHTML = sanitizeHtml(`<i class="fab fa-itch-io"></i> <span>${t('readMore')}</span>`);
            a.addEventListener('click', (e) => e.stopPropagation());
            inner.appendChild(a);
        }

        if (post.type === 'yt-video' && post.videoId) {
            const a = createElement('a', 'button small', {
                marginTop: '8px', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', width: '100%'
            }, { href: `https://www.youtube.com/watch?v=${post.videoId}`, target: '_blank', rel: 'noopener noreferrer' });
            a.innerHTML = sanitizeHtml(`<i class="fab fa-youtube"></i> <span>${t('watch')}</span>`);
            a.addEventListener('click', (e) => e.stopPropagation());
            inner.appendChild(a);
        }

        card.appendChild(inner);

        card.addEventListener('click', async () => {
            if (post.type === 'itch-post' && post.itchLink) {
                window.open(post.itchLink, '_blank', 'noopener,noreferrer');
                return;
            }
            if (post.type === 'yt-video' && post.videoId) {
                window.open(`https://www.youtube.com/watch?v=${post.videoId}`, '_blank', 'noopener,noreferrer');
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

    // ============================================================
    // ВСТАВКА
    // ============================================================

    function insertCardSorted(grid, post) {
        if (!post || !post.id) return;
        if (grid.querySelector(`[data-item-id="${CSS.escape(post.id)}"]`)) return;
        const newCard = createUpdateCard(post);
        const newTs = normalizeDate(post.date).getTime();
        let insertBefore = null;
        for (const child of grid.children) {
            const ts = parseInt(child.dataset.date, 10) || 0;
            if (newTs > ts) { insertBefore = child; break; }
        }
        if (insertBefore) grid.insertBefore(newCard, insertBefore);
        else grid.appendChild(newCard);
    }

    function getOrCreateGrid(container) {
        let grid = container.querySelector('.projects-grid');
        if (!grid) {
            container.innerHTML = '';
            grid = createElement('div', 'projects-grid');
            container.appendChild(grid);
        }
        return grid;
    }

    function renderUpdates(container, game, posts, { replace = false } = {}) {
        const parent = container.parentNode;
        let header = parent.querySelector('.updates-header');

        if (!header) {
            header = createElement('div', 'updates-header', {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '20px'
            });
            header.innerHTML = sanitizeHtml(
                `<div style="display:flex;align-items:center;gap:8px;">` +
                `<i class="fas fa-clock-rotate-left" style="font-size:24px;color:var(--accent);"></i>` +
                `<h2 style="margin:0;" data-lang="updatesTitle">${t('updatesTitle')}</h2></div>`
            );
            parent.insertBefore(header, container);
        }

        if (posts.length === 0) {
            if (replace) {
                container.innerHTML = sanitizeHtml(
                    `<p class="text-secondary" data-lang="noUpdates" style="padding:12px 0;">${t('noUpdates')}</p>`
                );
            }
            return;
        }

        const scrollY = window.scrollY;
        const grid = getOrCreateGrid(container);
        if (replace) grid.replaceChildren();
        for (const p of posts) insertCardSorted(grid, p);

        const existing = header.querySelector('.admin-update-btn');
        if (isAdmin() && hasScope('repo')) {
            if (!existing) {
                const btn = createElement('button', 'button admin-update-btn');
                btn.innerHTML = sanitizeHtml(`<i class="fas fa-plus"></i> ${t('addUpdate')}`);
                btn.addEventListener('click', async () => {
                    if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
                    window.UIFeedback.openEditorModal('new', { game: currentGame }, 'update');
                });
                header.appendChild(btn);
            } else {
                existing.innerHTML = sanitizeHtml(`<i class="fas fa-plus"></i> ${t('addUpdate')}`);
            }
        } else if (existing) existing.remove();

        window.scrollTo({ top: scrollY, behavior: 'instant' });
    }

    // ============================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================

    window.initGameUpdates = function() {
        const container = document.getElementById('game-updates');
        if (container?.dataset.game) {
            currentGame = container.dataset.game;
            window.currentGame = currentGame;
            loadGameUpdates(container, currentGame, false);
        }
        window.addEventListener('github-issue-created', e => {
            const issue = e.detail;
            if (!currentGame) return;
            if (!issue.labels.some(l => l.name === 'type:update' && l.name === `game:${currentGame}`)) return;
            if (!CONFIG.ALLOWED_AUTHORS.includes(issue.user.login)) return;
            cacheRemoveByPrefix(`game_issues_${currentGame}`);
            const cont = document.getElementById('game-updates');
            if (!cont) return;
            const newPost = normalizePost({
                type: 'gh-update',
                number: issue.number, id: `gh-${issue.number}`,
                title: issue.title, body: issue.body,
                date: new Date(issue.created_at), author: issue.user.login,
                game: currentGame, labels: issue.labels.map(l => l.name),
                thumbnail: null
            });
            const grid = getOrCreateGrid(cont);
            insertCardSorted(grid, newPost);
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
                if (btn) btn.innerHTML = sanitizeHtml(`<i class="fas fa-plus"></i> ${t('addUpdate')}`);
            }
        });
    };

    window.refreshGameUpdates = (game) => {
        const cont = document.getElementById('game-updates');
        if (cont && cont.dataset.game === game) loadGameUpdates(cont, game, true);
    };

    async function loadGameUpdates(container, game, forceRefresh = false) {
        if (currentAbort) { currentAbort.controller.abort(); currentAbort = null; }
        const { controller, timeoutId } = createAbortable(35000);
        currentAbort = { controller };

        try {
            if (!forceRefresh) {
                const [cachedGh, cachedItch, cachedYt] = await Promise.all([
                    cacheGet(`game_issues_${game}`),
                    Promise.resolve(readCacheWithDates(getItchCacheKey(game), Infinity)),
                    Promise.resolve(readCacheWithDates(getYtCacheKey(game), Infinity))
                ]);

                if ((cachedGh && cachedGh.length) || (cachedItch && cachedItch.length) || (cachedYt && cachedYt.length)) {
                    const ghPosts = (cachedGh || []).filter(i =>
                        i.labels.some(l => l.name === 'type:update') &&
                        CONFIG.ALLOWED_AUTHORS.includes(i.user.login)
                    ).map(i => normalizePost({
                        type: 'gh-update',
                        number: i.number, id: `gh-${i.number}`,
                        title: i.title, body: i.body,
                        date: new Date(i.created_at),
                        author: i.user.login, game,
                        labels: i.labels.map(l => l.name),
                        thumbnail: null
                    }));
                    const combined = [...(cachedYt || []), ...(cachedItch || []), ...ghPosts]
                        .sort((a, b) => b.date - a.date);

                    if (combined.length) {
                        renderUpdates(container, game, combined, { replace: true });

                        if (!backgroundRefreshInFlight) {
                            backgroundRefreshInFlight = true;
                            (async () => {
                                try {
                                    const fresh = await fetchAllUpdates(
                                        game,
                                        null,
                                        true,
                                        (item) => {
                                            const cont = document.getElementById('game-updates');
                                            if (cont && cont.dataset.game === game) {
                                                const grid = getOrCreateGrid(cont);
                                                insertCardSorted(grid, item);
                                            }
                                        }
                                    );
                                    if (fresh.length) {
                                        const cont = document.getElementById('game-updates');
                                        if (cont && cont.dataset.game === game) {
                                            renderUpdates(cont, game, fresh, { replace: true });
                                        }
                                    }
                                } catch { /* noop */ }
                                finally { backgroundRefreshInFlight = false; }
                            })();
                        }
                        return;
                    }
                }
            }

            container.innerHTML = sanitizeHtml(
                `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p data-lang="loading">${t('loading')}</p></div>`
            );

            const posts = await fetchAllUpdates(
                game,
                controller.signal,
                forceRefresh,
                (item) => {
                    const cont = document.getElementById('game-updates');
                    if (cont && cont.dataset.game === game) {
                        const grid = getOrCreateGrid(cont);
                        insertCardSorted(grid, item);
                    }
                }
            );
            renderUpdates(container, game, posts, { replace: true });
        } catch (err) {
            if (controller.signal.aborted) return;
            console.error('[GameUpdates] load error:', err);
            container.innerHTML = sanitizeHtml(
                `<p class="error-message" data-lang="updatesLoadError">${t('updatesLoadError')}</p>`
            );
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
        }
    }
})();