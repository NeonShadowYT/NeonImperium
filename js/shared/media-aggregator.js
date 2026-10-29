// js/shared/media-aggregator.js
// Единый модуль для YouTube + itch.io. Общий кеш для всех страниц.
// Кеш хранит ВСЕ видео с канала (без фильтра по названию).
// Фильтр по названию применяется на стороне страницы через options.filterByTitle.
// Нормализация date на выходе — критично, так как Date в JSON превращается в строку.

(function() {
    'use strict';

    const CACHE_TTL = 30 * 60 * 1000;
    const REQUEST_TIMEOUT = 25000;
    const MAX_ITCH_POSTS = 3;
    const MIN_YT_DURATION = 60;

    const YT_CACHE_KEY = 'unified_yt_videos_v3';
    const ITCH_CACHE_KEY = 'unified_itch_posts_v3';

    const YT_CHANNEL_ID = 'UC2pH2qNfh2sEAeYEGs1k_Lg';
    const YT_CHANNEL_NAME = 'Neon Shadow';
    const YT_UULF_PLAYLIST_ID = YT_CHANNEL_ID.replace(/^UC/, 'UULF');
    const YT_UU_PLAYLIST_ID = YT_CHANNEL_ID.replace(/^UC/, 'UU');
    const RSS_URLS = [
        `https://www.youtube.com/feeds/videos.xml?playlist_id=${YT_UULF_PLAYLIST_ID}`,
        `https://www.youtube.com/feeds/videos.xml?playlist_id=${YT_UU_PLAYLIST_ID}`,
        `https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL_ID}`
    ];

    const GAME_KEYWORDS = ['starve', 'neon', 'starve neon', 'neon shadow', 'neonshadow'];

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
        (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
        (u) => `https://cors-anywhere.herokuapp.com/${u}`,
        (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
        (u) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(u)}`,
        (u) => `https://cors.eu.org/${u}`,
        (u) => `https://cloudflare-cors-anywhere.queakchannel42.workers.dev/?${u}`
    ];

    const ITCH_DEVLOG_SOURCES = [
        {
            name: 'Starve Neon',
            rssUrl: 'https://neon-shadow.itch.io/starve-neon/devlog.rss',
            rssHubUrl: 'https://rsshub.app/itch/devlogs/neon-shadow/starve-neon',
            devlogPageUrl: 'https://neon-shadow.itch.io/starve-neon/devlog'
        }
    ];

    // ---------- Нормализация ----------

    function toDate(d) {
        if (d instanceof Date && !isNaN(d.getTime())) return d;
        const nd = new Date(d);
        return isNaN(nd.getTime()) ? new Date() : nd;
    }

    function normalizeRawItems(items) {
        if (!Array.isArray(items)) return [];
        return items.map(item => {
            if (!item) return item;
            return { ...item, date: toDate(item.date) };
        });
    }

    // ---------- Кеш ----------

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
            return normalizeRawItems(data.items);
        } catch { return null; }
    }

    function writeCache(key, items) {
        if (!Array.isArray(items) || items.length === 0) return;
        try {
            localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), items }));
        } catch { /* noop */ }
    }

    // ---------- Сеть ----------

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

    // ---------- Утилиты парсинга ----------

    function decodeXmlEntities(s) {
        return String(s || '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
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

    // ---------- YouTube ----------

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
            items.push({
                type: 'video',
                id: videoId,
                videoId,
                title,
                author: YT_CHANNEL_NAME,
                date: new Date(publishedEl ? publishedEl.textContent : Date.now()),
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                videoData: { service: 'youtube', id: videoId }
            });
        }
        return items;
    }

    async function fetchYoutubeRssAll(signal) {
        const tasks = [];
        for (const rssUrl of RSS_URLS) {
            for (const proxyFn of CORS_PROXIES) {
                tasks.push(
                    fetchViaProxy(proxyFn, rssUrl, signal, ['<entry', '<feed'])
                        .then(text => parseYoutubeRssWithDom(text))
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

    async function fetchYoutubePipedAll(signal) {
        const tasks = [];
        for (const base of PIPED_INSTANCES) {
            tasks.push(
                fetchWithTimeout(`${base}/channel/${YT_CHANNEL_ID}`, signal)
                    .then(r => r.json())
                    .then(data => {
                        const streams = data.relatedStreams || data.items || [];
                        return streams.map(item => {
                            const videoId = extractVideoId(item.url);
                            if (!videoId) return null;
                            return {
                                type: 'video', id: videoId, videoId,
                                title: item.title || 'Untitled',
                                author: YT_CHANNEL_NAME,
                                date: new Date(item.uploaded || Date.now()),
                                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                                videoData: { service: 'youtube', id: videoId },
                                duration: item.duration
                            };
                        }).filter(Boolean);
                    })
                    .catch(() => [])
            );
            for (const proxyFn of CORS_PROXIES.slice(0, 4)) {
                tasks.push(
                    fetchViaProxy(proxyFn, `${base}/channel/${YT_CHANNEL_ID}`, signal, ['"relatedStreams"', '"items"', '{"'])
                        .then(text => {
                            const data = JSON.parse(text);
                            const streams = data.relatedStreams || data.items || [];
                            return streams.map(item => {
                                const videoId = extractVideoId(item.url);
                                if (!videoId) return null;
                                return {
                                    type: 'video', id: videoId, videoId,
                                    title: item.title || 'Untitled',
                                    author: YT_CHANNEL_NAME,
                                    date: new Date(item.uploaded || Date.now()),
                                    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                                    videoData: { service: 'youtube', id: videoId },
                                    duration: item.duration
                                };
                            }).filter(Boolean);
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

    async function fetchYoutubeInvidiousAll(signal) {
        const tasks = [];
        for (const base of INVIDIOUS_INSTANCES) {
            tasks.push(
                fetchWithTimeout(`${base}/api/v1/channels/${YT_CHANNEL_ID}/videos`, signal)
                    .then(r => r.json())
                    .then(data => {
                        const items = Array.isArray(data) ? data : (data.videos || []);
                        return items.map(item => {
                            if (!item.videoId) return null;
                            return {
                                type: 'video', id: item.videoId, videoId: item.videoId,
                                title: item.title || 'Untitled',
                                author: YT_CHANNEL_NAME,
                                date: new Date(item.published ? item.published * 1000 : Date.now()),
                                thumbnail: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
                                videoData: { service: 'youtube', id: item.videoId },
                                duration: item.lengthSeconds
                            };
                        }).filter(Boolean);
                    })
                    .catch(() => [])
            );
            for (const proxyFn of CORS_PROXIES.slice(0, 4)) {
                tasks.push(
                    fetchViaProxy(proxyFn, `${base}/api/v1/channels/${YT_CHANNEL_ID}/videos`, signal, ['"videoId"', '"videos"', '['])
                        .then(text => {
                            const data = JSON.parse(text);
                            const items = Array.isArray(data) ? data : (data.videos || []);
                            return items.map(item => {
                                if (!item.videoId) return null;
                                return {
                                    type: 'video', id: item.videoId, videoId: item.videoId,
                                    title: item.title || 'Untitled',
                                    author: YT_CHANNEL_NAME,
                                    date: new Date(item.published ? item.published * 1000 : Date.now()),
                                    thumbnail: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
                                    videoData: { service: 'youtube', id: item.videoId },
                                    duration: item.lengthSeconds
                                };
                            }).filter(Boolean);
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

    async function fetchYoutubeVideosRaw(signal, forceRefresh = false) {
        if (!forceRefresh) {
            const cached = readCache(YT_CACHE_KEY, CACHE_TTL);
            if (cached && cached.length) {
                console.log('[MediaAggregator] YouTube из кеша:', cached.length);
                return cached;
            }
        }

        console.log('[MediaAggregator] YouTube: параллельный опрос RSS + Piped + Invidious…');
        const results = await Promise.allSettled([
            fetchYoutubeRssAll(signal),
            fetchYoutubePipedAll(signal),
            fetchYoutubeInvidiousAll(signal)
        ]);

        let allVideos = [];
        const names = ['RSS', 'Piped', 'Invidious'];
        results.forEach((r, i) => {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                console.log(`[MediaAggregator] ${names[i]}: ${r.value.length} видео`);
                allVideos = allVideos.concat(r.value);
            }
        });

        if (allVideos.length === 0) {
            const stale = readCache(YT_CACHE_KEY, Infinity);
            if (stale && stale.length) {
                console.log('[MediaAggregator] YouTube: пусто, используется stale-кеш', stale.length);
                return stale;
            }
            return [];
        }

        const seen = new Set();
        const unique = [];
        for (const v of allVideos) {
            if (!v || !v.videoId) continue;
            if (seen.has(v.videoId)) continue;
            seen.add(v.videoId);
            unique.push(v);
        }
        unique.sort((a, b) => b.date - a.date);

        writeCache(YT_CACHE_KEY, unique);
        console.log('[MediaAggregator] YouTube уникальных:', unique.length);
        return normalizeRawItems(unique);
    }

    async function fetchYoutubeVideos(signal, options = {}) {
        const { forceRefresh = false, filterByTitle = false } = options;
        const raw = normalizeRawItems(await fetchYoutubeVideosRaw(signal, forceRefresh));

        let relevant = raw;
        if (filterByTitle) {
            relevant = raw.filter(v => isRelevantVideo(v, GAME_KEYWORDS));
            console.log(`[MediaAggregator] YouTube фильтр по названию: ${relevant.length} из ${raw.length}`);
        }

        const noShorts = [];
        let shortsCount = 0;
        for (const v of relevant) {
            const dur = parseDuration(v.duration);
            if (dur != null && dur > 0 && dur < MIN_YT_DURATION) {
                shortsCount++;
                continue;
            }
            noShorts.push(v);
        }

        if (noShorts.length === 0 && relevant.length > 0) {
            console.warn(`[MediaAggregator] Все ${relevant.length} видео оказались Shorts — возвращаем как есть`);
            return normalizeRawItems(relevant);
        }

        console.log(`[MediaAggregator] YouTube: ${relevant.length} → ${noShorts.length} (Shorts: ${shortsCount})`);
        return normalizeRawItems(noShorts);
    }

    // ---------- ITCH.IO ----------

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

            result.push({
                type: 'itch-post',
                id: `itch-${link}`,
                title,
                author: source.name,
                date,
                body: description,
                thumbnail: extractItchThumbnailFromEl(itemEl),
                itchLink: link,
                itchSource: source.name,
                labels: ['type:itch-post']
            });
        }
        return result.sort((a, b) => b.date - a.date).slice(0, MAX_ITCH_POSTS);
    }

    async function fetchItchPosts(signal, forceRefresh = false) {
        if (!forceRefresh) {
            const cached = readCache(ITCH_CACHE_KEY, CACHE_TTL);
            if (cached && cached.length) {
                console.log('[MediaAggregator] itch.io из кеша:', cached.length);
                return cached;
            }
        }

        console.log('[MediaAggregator] itch.io: параллельный опрос прокси…');
        const allPosts = [];
        for (const source of ITCH_DEVLOG_SOURCES) {
            const tasks = CORS_PROXIES.map(proxyFn =>
                fetchViaProxy(proxyFn, source.rssUrl, signal, ['<item', '<rss', '<channel'])
                    .then(text => parseItchRssWithDom(text, source))
                    .catch(() => [])
            );
            const results = await Promise.allSettled(tasks);
            for (const r of results) {
                if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                    allPosts.push(...r.value);
                }
            }

            if (allPosts.length === 0 && source.rssHubUrl) {
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
                        const posts = parseItchRssWithDom(text, source);
                        if (posts.length > 0) {
                            console.log('[MediaAggregator] itch.io RSSHub OK:', rssHubUrl.split('/')[2]);
                            allPosts.push(...posts);
                            break;
                        }
                    } catch (e) {
                        console.warn('[MediaAggregator] itch.io RSSHub failed:', e.message);
                    }
                }
            }
        }

        if (allPosts.length === 0) {
            const stale = readCache(ITCH_CACHE_KEY, Infinity);
            if (stale && stale.length) {
                console.log('[MediaAggregator] itch.io: пусто, используется stale-кеш', stale.length);
                return stale;
            }
            return [];
        }

        const seen = new Set();
        const unique = allPosts.filter(p => {
            if (seen.has(p.itchLink)) return false;
            seen.add(p.itchLink);
            return true;
        }).sort((a, b) => b.date - a.date).slice(0, MAX_ITCH_POSTS);

        if (unique.length > 0) {
            writeCache(ITCH_CACHE_KEY, unique);
        }
        console.log('[MediaAggregator] itch.io уникальных:', unique.length);
        return normalizeRawItems(unique);
    }

    window.MediaAggregator = {
        fetchYoutubeVideos,
        fetchYoutubeVideosRaw,
        fetchItchPosts,
        GAME_KEYWORDS,
        YT_CACHE_KEY,
        ITCH_CACHE_KEY
    };
})();