// js/pages/news-feed.js — Каскадная загрузка ленты новостей.
// Источники:
//   - GitHub issues (posts + updates)
//   - YouTube: Invidious × 6, Piped × 4, RSS через 20 CORS-прокси, HTML через прокси, rss2json
//   - itch.io devlog: RSS через прокси, HTML через прокси, rss2json
//   - Twitch (twitchinsights)
//   - GitHub Releases
// Кэш: localStorage, TTL для разных типов — свой.
//
// ИКОНКИ АВТОРА:
//   release    → fas fa-cube   (название инструмента, не ник)
//   itch-post  → fab fa-itch-io (название игры, не ник)
//   остальные  → fas fa-user

(function() {
    'use strict';

    const {
        cacheGet, cacheSet, cacheRemoveByPrefix,
        escapeHtml, createElement, loadModule,
        createAbortable, CONFIG, sanitizeHtml
    } = window.GithubCore;

    const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
    const { showToast } = window.UIUtils;

    const CACHE_KEY = 'news_feed_data_v3';
    const CACHE_TTL = 5 * 60 * 1000;
    const VIDEOS_CACHE_KEY = 'yt_videos_cache_neonshadow_v3';
    const VIDEOS_CACHE_TTL = 30 * 60 * 1000;
    const ITCH_CACHE_KEY = 'itch_posts_news_v3';
    const ITCH_CACHE_TTL = 30 * 60 * 1000;

    const SOURCE_TIMEOUT = 15000;
    const REQUEST_TIMEOUT = 12000;
    const MAX_DISPLAY_ITEMS = 9;
    const MAX_VIDEOS = 6;
    const MAX_ITCH_POSTS = 3;

    // ---- GitHub Releases ----
    const RELEASE_SOURCES = [
        { owner: 'NeonShadowYT', repo: 'WorldGenerator', name: 'WorldGenerator', icon: 'images/tool-world-generator.webp' },
        { owner: 'NeonShadowYT', repo: 'IconCreator', name: 'IconCreator', icon: 'images/tool-icon-creator.webp' }
    ];

    // ---- YouTube ----
    const YT_CHANNEL_ID = 'UC2pH2qNfh2sEAeYEGs1k_Lg';
    const YT_CHANNEL_NAME = 'Neon Shadow';
    const YT_RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL_ID}`;
    const YT_CHANNEL_URL = `https://www.youtube.com/channel/${YT_CHANNEL_ID}/videos`;

    const INVIDIOUS_INSTANCES = [
        'https://inv.nadeko.net',
        'https://invidious.nerdvpn.de',
        'https://invidious.privacyredirect.com',
        'https://iv.melmac.space',
        'https://invidious.f5.si',
        'https://yt.artemislena.eu'
    ];

    const PIPED_INSTANCES = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.adminforge.de',
        'https://pipedapi.leptons.xyz',
        'https://api.piped.private.coffee'
    ];

    // ---- itch.io ----
    const ITCH_DEVLOG_SOURCES = [
        {
            name: 'Starve Neon',
            rssUrl: 'https://neon-shadow.itch.io/starve-neon/devlog.rss',
            devlogPageUrl: 'https://neon-shadow.itch.io/starve-neon/devlog'
        }
    ];

    // ---- CORS-прокси (все домены должны быть разрешены в connect-src CSP) ----
    const CORS_PROXIES = [
        (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
        (u) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(u)}`,
        (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
        (u) => `https://cloudflare-cors-anywhere.queakchannel42.workers.dev/?${u}`,
        (u) => `https://cors-anywhere.herokuapp.com/${u}`,
        (u) => `https://proxy.cors.sh/${u}`,
        (u) => `https://cors.bridged.cc/${u}`,
        (u) => `https://test.cors.workers.dev/?${u}`,
        (u) => `https://cors-anywhere.homely8896.workers.dev/${u}`,
        (u) => `https://cors.eu.org/${u}`,
        (u) => `https://cors.x2u.in/${u}`,
        (u) => `https://yacdn.org/proxy/${u}`,
        (u) => `https://cors-proxy.htmldriven.com/?url=${encodeURIComponent(u)}`,
        (u) => `https://corsfix.com/?${u}`,
        (u) => `https://corsproxy.org/?${encodeURIComponent(u)}`,
        (u) => `https://thebugging.com/proxy?url=${encodeURIComponent(u)}`
    ];

    const RSS2JSON = (rssUrl) =>
        `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;

    let currentItems = [];
    let currentUser = null;
    let isLoading = false;
    let abortController = null;
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
            stream: 'Стрим', viewers: 'зрителей', readMore: 'Читать далее'
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

    function normalizeItem(item) {
        let date = item.date;
        if (!(date instanceof Date)) {
            date = new Date(date);
            if (isNaN(date.getTime())) date = new Date();
        }
        return {
            type: item.type || 'post',
            id: item.id || item.number || item.videoId || item.channel || item.link || '',
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
            releaseData: item.releaseData || null,
            itchLink: item.itchLink || null,
            itchSource: item.itchSource || null
        };
    }

    function sortByDateDesc(arr) {
        return arr.slice().sort((a, b) => b.date - a.date);
    }

    // ---- Кэш ----
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

    // ---- Сетевые хелперы ----
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
        if (!text || text.length < 200) throw new Error('too short');
        if (text.trim().startsWith('{')) {
            try {
                const json = JSON.parse(text);
                if (typeof json.contents === 'string') text = json.contents;
            } catch { /* не JSON */ }
        }
        return text;
    }

    async function raceProxies(targetUrl, parser, signal) {
        const promises = CORS_PROXIES.map(proxyFn =>
            fetchViaProxy(proxyFn, targetUrl, signal)
                .then(text => {
                    const result = parser(text);
                    if (!result || (Array.isArray(result) && result.length === 0)) {
                        throw new Error('empty');
                    }
                    return result;
                })
        );
        return await Promise.any(promises);
    }

    // ============================================================
    // YOUTUBE — парсеры
    // ============================================================

    function parseYoutubeRssXml(xmlText) {
        if (!xmlText || typeof xmlText !== 'string') return [];
        const entryBlocks = xmlText.split('<entry>').slice(1);
        const items = entryBlocks.map(block => {
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
        }).filter(Boolean);
        return sortByDateDesc(items).slice(0, MAX_VIDEOS);
    }

    function extractYtInitialData(html) {
        const patterns = [
            /var ytInitialData = ({[\s\S]+?});/,
            /window\["ytInitialData"\]\s*=\s*({[\s\S]+?});/,
            /ytInitialData\s*=\s*({[\s\S]+?});/
        ];
        for (const re of patterns) {
            const m = html.match(re);
            if (m && m[1]) {
                try { return JSON.parse(m[1]); }
                catch {
                    const end = m[1].lastIndexOf('}');
                    if (end !== -1) {
                        try { return JSON.parse(m[1].slice(0, end + 1)); } catch { /* noop */ }
                    }
                }
            }
        }
        return null;
    }

    function collectVideosFromData(obj, out, seen) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(i => collectVideosFromData(i, out, seen)); return; }

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
                type: 'video', id: classic.videoId, title, author: YT_CHANNEL_NAME,
                date: new Date(), thumbnail,
                videoData: { service: 'youtube', id: classic.videoId }
            }));
        }

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
                    type: 'video', id: videoId, title, author: YT_CHANNEL_NAME,
                    date: new Date(), thumbnail,
                    videoData: { service: 'youtube', id: videoId }
                }));
            }
        }

        if (obj.richItemRenderer?.content) collectVideosFromData(obj.richItemRenderer.content, out, seen);

        for (const key of Object.keys(obj)) {
            if (out.length >= MAX_VIDEOS) break;
            collectVideosFromData(obj[key], out, seen);
        }
    }

    function parseYoutubeHtml(html) {
        const data = extractYtInitialData(html);
        if (!data) return null;
        const out = [];
        const seen = new Set();
        collectVideosFromData(data, out, seen);
        return out.slice(0, MAX_VIDEOS);
    }

    function parseRss2JsonYoutube(data) {
        if (!data || data.status !== 'ok' || !Array.isArray(data.items)) return null;
        const items = data.items.map(item => {
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
        }).filter(Boolean);
        return sortByDateDesc(items).slice(0, MAX_VIDEOS);
    }

    function parseInvidiousResponse(data) {
        if (!data || !Array.isArray(data.videos)) return null;
        const items = data.videos.map(v => {
            if (!v.videoId) return null;
            return normalizeItem({
                type: 'video', id: v.videoId,
                title: v.title || 'Untitled',
                author: v.author || YT_CHANNEL_NAME,
                date: new Date((v.published || 0) * 1000 || Date.now()),
                thumbnail: v.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${v.videoId}/mqdefault.jpg`,
                videoData: { service: 'youtube', id: v.videoId }
            });
        }).filter(Boolean);
        return sortByDateDesc(items).slice(0, MAX_VIDEOS);
    }

    function parsePipedResponse(data) {
        if (!data || !Array.isArray(data.relatedStreams)) return null;
        const items = data.relatedStreams.map(s => {
            const vid = (s.url || '').match(/[?&]v=([^&]+)/)?.[1];
            if (!vid) return null;
            return normalizeItem({
                type: 'video', id: vid,
                title: s.title || 'Untitled',
                author: s.uploaderName || YT_CHANNEL_NAME,
                date: new Date(s.uploaded || Date.now()),
                thumbnail: s.thumbnail || `https://img.youtube.com/vi/${vid}/mqdefault.jpg`,
                videoData: { service: 'youtube', id: vid }
            });
        }).filter(Boolean);
        return sortByDateDesc(items).slice(0, MAX_VIDEOS);
    }

    // ============================================================
    // YOUTUBE — стратегии
    // ============================================================

    async function fetchYoutubeViaInvidious(signal) {
        const promises = INVIDIOUS_INSTANCES.map(instance =>
            fetchWithTimeout(`${instance}/api/v1/channels/${YT_CHANNEL_ID}/videos?sort_by=newest`, signal)
                .then(res => res.json())
                .then(data => {
                    const videos = parseInvidiousResponse(data);
                    if (!videos || !videos.length) throw new Error('no videos');
                    return videos;
                })
        );
        return await Promise.any(promises);
    }

    async function fetchYoutubeViaPiped(signal) {
        const promises = PIPED_INSTANCES.map(instance =>
            fetchWithTimeout(`${instance}/channel/${YT_CHANNEL_ID}`, signal)
                .then(res => res.json())
                .then(data => {
                    const videos = parsePipedResponse(data);
                    if (!videos || !videos.length) throw new Error('no videos');
                    return videos;
                })
        );
        return await Promise.any(promises);
    }

    async function fetchYoutubeViaRss(signal) {
        return await raceProxies(YT_RSS_URL, parseYoutubeRssXml, signal);
    }

    async function fetchYoutubeViaHtml(signal) {
        return await raceProxies(YT_CHANNEL_URL, parseYoutubeHtml, signal);
    }

    async function fetchYoutubeViaRss2Json(signal) {
        const res = await fetchWithTimeout(RSS2JSON(YT_RSS_URL), signal);
        const data = await res.json();
        const videos = parseRss2JsonYoutube(data);
        if (!videos || !videos.length) throw new Error('no videos');
        return videos;
    }

    async function fetchYoutubeVideos(signal) {
        const cached = readCache(VIDEOS_CACHE_KEY, VIDEOS_CACHE_TTL);
        if (cached && cached.length) {
            console.log(`[NewsFeed] YouTube из кеша: ${cached.length}`);
            return cached.map(normalizeItem);
        }

        const strategies = [
            fetchYoutubeViaInvidious(signal),
            fetchYoutubeViaPiped(signal),
            fetchYoutubeViaRss(signal),
            fetchYoutubeViaHtml(signal),
            fetchYoutubeViaRss2Json(signal)
        ];

        try {
            const videos = await Promise.any(strategies);
            if (videos && videos.length) {
                writeCache(VIDEOS_CACHE_KEY, videos);
                console.log(`[NewsFeed] YouTube из сети: ${videos.length}`);
                return videos;
            }
            return [];
        } catch (e) {
            if (isAborted(e, signal)) return [];
            console.warn('[NewsFeed] Все источники YouTube недоступны');
            return [];
        }
    }

    // ============================================================
    // ITCH.IO — парсеры
    // ============================================================

    function parseItchDevlogXml(xmlText, source) {
        if (!xmlText || typeof xmlText !== 'string') return [];
        const itemBlocks = xmlText.split('<item>').slice(1);
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
                itchLink: link, itchSource: source.name,
                labels: ['type:itch-post']
            });
        }).filter(Boolean);
        return sortByDateDesc(items).slice(0, MAX_ITCH_POSTS);
    }

    function parseItchDevlogHtml(html, source) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const postElements = doc.querySelectorAll('.post, .devlog_post, article');
            if (postElements.length === 0) return null;

            const items = Array.from(postElements).slice(0, MAX_ITCH_POSTS).map(el => {
                const titleEl = el.querySelector('h2, h3, .post_title');
                const linkEl = el.querySelector('a[href*="/devlog/"]') || el.querySelector('a');
                const dateEl = el.querySelector('time, .post_date, .date');

                const title = titleEl ? titleEl.textContent.trim() : 'Пост';
                const link = linkEl ? linkEl.href : source.devlogPageUrl;
                let date = new Date();
                if (dateEl) {
                    const parsed = new Date(dateEl.getAttribute('datetime') || dateEl.textContent);
                    if (!isNaN(parsed.getTime())) date = parsed;
                }

                return normalizeItem({
                    type: 'itch-post',
                    id: `itch-html-${link}`,
                    title, author: source.name, date, body: '',
                    itchLink: link, itchSource: source.name,
                    labels: ['type:itch-post']
                });
            });
            return sortByDateDesc(items);
        } catch { return null; }
    }

    function parseRss2JsonItch(data, source) {
        if (!data || data.status !== 'ok' || !Array.isArray(data.items)) return null;
        const items = data.items.map(item => normalizeItem({
            type: 'itch-post',
            id: `itch-rss2json-${item.link}`,
            title: item.title || 'Пост',
            author: source.name,
            date: new Date(item.pubDate || Date.now()),
            body: (item.description || '').replace(/<[^>]*>/g, ''),
            itchLink: item.link,
            itchSource: source.name,
            labels: ['type:itch-post']
        }));
        return sortByDateDesc(items).slice(0, MAX_ITCH_POSTS);
    }

    // ============================================================
    // ITCH.IO — стратегии
    // ============================================================

    async function fetchItchSource(source, signal) {
        const strategies = [
            raceProxies(source.rssUrl, (text) => parseItchDevlogXml(text, source), signal),
            raceProxies(source.devlogPageUrl, (html) => parseItchDevlogHtml(html, source), signal),
            fetchWithTimeout(RSS2JSON(source.rssUrl), signal)
                .then(res => res.json())
                .then(data => {
                    const posts = parseRss2JsonItch(data, source);
                    if (!posts || !posts.length) throw new Error('no posts');
                    return posts;
                })
        ];
        return await Promise.any(strategies);
    }

    async function fetchItchPosts(signal) {
        const cached = readCache(ITCH_CACHE_KEY, ITCH_CACHE_TTL);
        if (cached && cached.length) {
            console.log(`[NewsFeed] itch.io из кеша: ${cached.length}`);
            return cached.map(normalizeItem);
        }

        const allPosts = [];
        for (const source of ITCH_DEVLOG_SOURCES) {
            try {
                const posts = await fetchItchSource(source, signal);
                if (posts && posts.length) allPosts.push(...posts);
            } catch (e) {
                if (isAborted(e, signal)) return [];
                console.warn(`[NewsFeed] itch.io ${source.name}:`, e.message || e);
            }
        }

        if (allPosts.length === 0) return [];
        const limited = sortByDateDesc(allPosts).slice(0, MAX_ITCH_POSTS);
        writeCache(ITCH_CACHE_KEY, limited);
        console.log(`[NewsFeed] itch.io из сети: ${limited.length}`);
        return limited;
    }

    // ============================================================
    // GitHub, Twitch, Releases
    // ============================================================

    async function loadPosts(signal) {
        if (window.RateLimits && !window.RateLimits.checkLimit('posts')) {
            console.warn('[NewsFeed] Лимит постов исчерпан');
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
                    author: i.user.login, date: new Date(i.created_at), labels,
                    game: labels.find(l => l.startsWith('game:'))?.split(':')[1] || null,
                    thumbnail: null
                });
            });
        } catch (err) {
            clearTimeout(timeoutId);
            if (isAborted(err, signal) || isAborted(err, controller.signal)) return [];
            console.warn('[NewsFeed] Ошибка постов:', err);
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
                if (isAborted(e, signal) || isAborted(e, controller.signal)) return null;
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
            return { items: (cached.items || []).map(normalizeItem), fromCache: true, isStale: false };
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
            console.log('[NewsFeed] Загрузка из сети...');
            const results = await Promise.allSettled([
                loadPosts(abortController.signal),
                fetchYoutubeVideos(abortController.signal),
                loadTwitchStreams(abortController.signal),
                loadReleases((it) => { if (onItem) try { onItem(it); } catch { /* noop */ } }, abortController.signal),
                fetchItchPosts(abortController.signal)
            ]);

            let allItems = [];
            const labels = ['посты', 'YouTube', 'Twitch', 'релизы', 'itch.io'];
            results.forEach((r, i) => {
                if (r.status === 'fulfilled') allItems = allItems.concat(r.value || []);
                else if (!isAborted(r.reason, abortController.signal)) {
                    console.warn(`[NewsFeed] ${labels[i]} — ошибка:`, r.reason);
                }
            });

            allItems.sort((a, b) => b.date - a.date);
            const limited = allItems.slice(0, MAX_DISPLAY_ITEMS);
            await cacheSet(CACHE_KEY, { items: limited, timestamp: Date.now() });
            console.log(`[NewsFeed] Загружено: ${limited.length}`);
            currentItems = limited;
            return { items: limited, fromCache: false, isStale: false };
        } catch (err) {
            if (isAborted(err, abortController.signal)) {
                return { items: [], fromCache: false, isStale: false };
            }
            console.error('[NewsFeed] Критическая ошибка:', err);
            const stale = await cacheGet(CACHE_KEY, Infinity);
            if (stale) return { items: (stale.items || []).map(normalizeItem), fromCache: true, isStale: true };
            throw err;
        } finally {
            isLoading = false;
            abortController = null;
        }
    }

    // ============================================================
    // UI
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
        } else if (existingBtn) existingBtn.remove();

        let grid = container.querySelector('.projects-grid:not(.skeleton-grid)');
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

        const existingIds = new Set();
        if (grid) grid.querySelectorAll('[data-item-id]').forEach(el => existingIds.add(el.dataset.itemId));

        if (!grid) {
            const sk = container.querySelector('.skeleton-grid');
            if (sk) sk.remove();
            const em = container.querySelector('.empty-state');
            if (em) em.remove();
            grid = createElement('div', 'projects-grid');
            container.appendChild(grid);
        }

        const fragment = document.createDocumentFragment();
        let count = grid.children.length;
        for (const item of displayItems) {
            if (count >= MAX_DISPLAY_ITEMS) break;
            if (existingIds.has(item.id)) continue;
            const card = createNewsCard(item);
            card.dataset.itemId = item.id;
            fragment.appendChild(card);
            count++;
        }
        grid.appendChild(fragment);

        container.querySelectorAll('[data-lang]').forEach(el => {
            const k = el.getAttribute('data-lang');
            if (k) el.textContent = t(k);
        });
    }

    // ---- Иконка автора: для релизов и itch — не "user" ----
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
        title.textContent = item.title.length > 70 ? item.title.slice(0, 70) + '…' : item.title;
        card.appendChild(title);

        const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
        const icon = getAuthorIcon(item.type);
        meta.innerHTML = sanitizeHtml(
            `<i class="${icon}"></i> ${escapeHtml(item.author)} · ` +
            `<i class="fas fa-calendar-alt"></i> ${item.date.toLocaleDateString()}`
        );
        if (item.type === 'twitch' && item.twitchData) {
            meta.innerHTML += sanitizeHtml(` · 🎮 ${escapeHtml(item.twitchData.game)}`);
        }
        if (item.type === 'release' && item.releaseData?.tag) {
            meta.innerHTML += sanitizeHtml(` · <i class="fas fa-tag"></i> ${escapeHtml(item.releaseData.tag)}`);
        }
        card.appendChild(meta);

        if ((item.type === 'post' || item.type === 'release' || item.type === 'itch-post') && item.body) {
            const summary = window.GithubCore.extractSummary(item.body)
                || item.body.replace(/\n/g, ' ').substring(0, 120) + '…';
            const preview = createElement('p', 'text-secondary', {
                fontSize: '13px', overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: '2', WebkitBoxOrient: 'vertical'
            });
            preview.textContent = summary;
            card.appendChild(preview);
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
                    } catch {
                        showToast(t('loadModulesError'), 'error');
                        return;
                    }
                }
                if (!window.BookmarkStorage) {
                    showToast(t('loadModulesError'), 'error');
                    return;
                }
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
    // Инициализация
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
                onItem: (item) => appendItemToGrid(item)
            });
            if (result) {
                renderNewsFeed(result.items);
                if (result.isStale) showToast('Данные могут быть устаревшими', 'warning', 5000);
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
        fetchNewsFeed({ forceRefresh: true, onItem: (it) => appendItemToGrid(it) })
            .then(r => r ? renderNewsFeed(r.items) : renderNewsFeed([]))
            .catch(err => {
                console.error('[NewsFeed] Ошибка обновления:', err);
                renderNewsFeed([]);
            });
    }

    window.initNewsFeed = initNewsFeed;
    window.refreshNewsFeed = refreshNewsFeed;
})();