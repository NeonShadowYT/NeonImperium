// js/features/hashtag-videos.js
// Хэштег #starveneon.
//
// ИСПРАВЛЕНИЯ:
//   — Добавлены дополнительные прокси для Piped и Invidious.
//   — Запросы к hashtag выполняются через все доступные прокси параллельно.
//   — Fallback на канал срабатывает ТОЛЬКО если ВСЕ источники хештега пусты.
//   — Фильтр по title (без description) — как в обновлениях starve-neon.
//   — Отсекаются Shorts (длительность < 60 сек).

(function() {
    'use strict';

    const HASHTAG = 'starveneon';
    const YT_CHANNEL_ID = 'UC2pH2qNfh2sEAeYEGs1k_Lg';
    const YT_CHANNEL_NAME = 'Neon Shadow';
    const CACHE_KEY = `hashtag_videos_cache_v12_${HASHTAG}`;
    const CACHE_TTL = 30 * 60 * 1000;
    const MAX_VIDEOS = 12;
    const MIN_DURATION_SEC = 60;
    const REQUEST_TIMEOUT = 30000;

    // ---- Piped-инстансы ----
    const PIPED_INSTANCES = [
        'https://api.piped.private.coffee',
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.leptons.xyz',
        'https://pipedapi.nosebs.ru',
        'https://pipedapi-libre.kavin.rocks',
        'https://pipedapi.adminforge.de',
        'https://piped-api.privacy.com.de',
        'https://api.piped.yt',
        'https://pipedapi.drgns.space',
        'https://pipedapi.owo.si',
        'https://pipedapi.ducks.party',
        'https://piped-api.codespace.cz',
        'https://pipedapi.reallyaweso.me',
        'https://pipedapi.darkness.services',
        'https://pipedapi.orangenet.cc'
    ];

    // ---- Invidious-инстансы ----
    const INVIDIOUS_INSTANCES = [
        'https://inv.nadeko.net',
        'https://invidious.nerdvpn.de',
        'https://yewtu.be',
        'https://invidious.privacyredirect.com',
        'https://iv.melmac.space',
        'https://invidious.f5.si'
    ];

    // ---- Прокси (порядок: сначала стабильные) ----
    const CORS_PROXIES = [
        (u) => `https://corsproxy.dev/?url=${encodeURIComponent(u)}`,
        (u) => `https://corsfix.com/?${u}`,
        (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
        (u) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(u)}`,
        (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
        (u) => `https://cors.eu.org/${u}`,
        (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
        (u) => `https://cloudflare-cors-anywhere.queakchannel42.workers.dev/?${u}`
    ];

    // ---- Ключевые слова для fallback с канала ----
    const FALLBACK_KEYWORDS = ['starve', 'neon'];

    // ============================================================
    // УТИЛИТЫ
    // ============================================================

    function isRelevant(v, keywords) {
        if (!v || !v.title) return false;
        const titleLower = v.title.toLowerCase();
        return keywords.some(kw => titleLower.includes(kw));
    }

    function toNumber(value) {
        if (typeof value === 'number' && isFinite(value)) return value;
        if (typeof value === 'string') {
            const n = parseInt(value, 10);
            if (!isNaN(n)) return n;
        }
        return null;
    }

    function readCache() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !data.timestamp || !Array.isArray(data.videos)) return null;
            if (Date.now() - data.timestamp > CACHE_TTL) {
                localStorage.removeItem(CACHE_KEY);
                return null;
            }
            return data.videos;
        } catch { return null; }
    }

    function writeCache(videos) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), videos }));
        } catch { /* noop */ }
    }

    function fetchWithTimeout(url, timeout = REQUEST_TIMEOUT) {
        return new Promise((resolve, reject) => {
            const controller = new AbortController();
            const timer = setTimeout(() => {
                try { controller.abort(new Error('timeout')); } catch { controller.abort(); }
            }, timeout);
            fetch(url, {
                signal: controller.signal,
                cache: 'no-store'
            })
                .then(res => {
                    clearTimeout(timer);
                    if (!res.ok) reject(new Error(`HTTP ${res.status}`));
                    else resolve(res);
                })
                .catch(err => { clearTimeout(timer); reject(err); });
        });
    }

    async function fetchWithProxy(proxyFn, targetUrl, timeout = REQUEST_TIMEOUT) {
        const proxyUrl = proxyFn(targetUrl);
        const res = await fetchWithTimeout(proxyUrl, timeout);
        const text = await res.text();
        if (!text || text.length < 50) throw new Error('too short');
        try {
            return JSON.parse(text);
        } catch {
            // some proxies wrap in { contents: "..." }
            const json = JSON.parse(text);
            if (typeof json.contents === 'string') return JSON.parse(json.contents);
            throw new Error('invalid json');
        }
    }

    function normalizeVideo(v) {
        if (!v || !v.videoId) return null;
        return {
            videoId: v.videoId,
            title: v.title || '',
            author: v.author || YT_CHANNEL_NAME,
            description: v.description || '',
            thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
        };
    }

    function filterVideos(videos, keywords) {
        const seen = new Set();
        const out = [];
        for (const v of videos) {
            if (!v || !v.videoId || seen.has(v.videoId)) continue;
            if (!isRelevant(v, keywords)) continue;
            seen.add(v.videoId);
            out.push(v);
            if (out.length >= MAX_VIDEOS) break;
        }
        return out;
    }

    // ============================================================
    // Piped: поиск по хэштегу
    // ============================================================

    async function fetchHashtagFromPipedDirect(base) {
        const url = `${base}/search?q=%23${HASHTAG}&filter=videos`;
        const res = await fetchWithTimeout(url);
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        return items.map(item => {
            const videoId = (item.url || '').replace('/watch?v=', '');
            if (!videoId) return null;
            const duration = toNumber(item.duration);
            if (duration !== null && duration > 0 && duration < MIN_DURATION_SEC) return null;
            return normalizeVideo({
                videoId,
                title: item.title || '',
                author: item.uploaderName || '',
                description: item.shortDescription || ''
            });
        }).filter(Boolean);
    }

    async function fetchHashtagFromPiped(base) {
        try {
            return await fetchHashtagFromPipedDirect(base);
        } catch {
            // try via proxies
            for (const proxyFn of CORS_PROXIES) {
                try {
                    const data = await fetchWithProxy(proxyFn, `${base}/search?q=%23${HASHTAG}&filter=videos`);
                    const items = Array.isArray(data.items) ? data.items : [];
                    return items.map(item => {
                        const videoId = (item.url || '').replace('/watch?v=', '');
                        if (!videoId) return null;
                        const duration = toNumber(item.duration);
                        if (duration !== null && duration > 0 && duration < MIN_DURATION_SEC) return null;
                        return normalizeVideo({
                            videoId,
                            title: item.title || '',
                            author: item.uploaderName || '',
                            description: item.shortDescription || ''
                        });
                    }).filter(Boolean);
                } catch { /* try next */ }
            }
            return [];
        }
    }

    // ============================================================
    // Invidious: поиск по хэштегу
    // ============================================================

    async function fetchHashtagFromInvidiousDirect(base) {
        const url = `${base}/api/v1/hashtag/${HASHTAG}`;
        const res = await fetchWithTimeout(url);
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.results || []);
        return items.map(item => {
            const videoId = item.videoId;
            if (!videoId) return null;
            const length = toNumber(item.lengthSeconds);
            if (length !== null && length > 0 && length < MIN_DURATION_SEC) return null;
            return normalizeVideo({
                videoId,
                title: item.title || '',
                author: item.author || '',
                description: item.description || ''
            });
        }).filter(Boolean);
    }

    async function fetchHashtagFromInvidious(base) {
        try {
            return await fetchHashtagFromInvidiousDirect(base);
        } catch {
            for (const proxyFn of CORS_PROXIES) {
                try {
                    const data = await fetchWithProxy(proxyFn, `${base}/api/v1/hashtag/${HASHTAG}`);
                    const items = Array.isArray(data) ? data : (data.results || []);
                    return items.map(item => {
                        const videoId = item.videoId;
                        if (!videoId) return null;
                        const length = toNumber(item.lengthSeconds);
                        if (length !== null && length > 0 && length < MIN_DURATION_SEC) return null;
                        return normalizeVideo({
                            videoId,
                            title: item.title || '',
                            author: item.author || '',
                            description: item.description || ''
                        });
                    }).filter(Boolean);
                } catch { /* try next */ }
            }
            return [];
        }
    }

    // ============================================================
    // Fallback: канал
    // ============================================================

    async function fetchChannelFromPiped(base) {
        const url = `${base}/channel/${YT_CHANNEL_ID}`;
        const res = await fetchWithTimeout(url);
        const data = await res.json();
        const streams = data.relatedStreams || data.items || [];
        return streams.map(item => {
            const videoId = (item.url || '').replace('/watch?v=', '');
            if (!videoId) return null;
            const duration = toNumber(item.duration);
            if (duration !== null && duration > 0 && duration < MIN_DURATION_SEC) return null;
            return normalizeVideo({
                videoId,
                title: item.title || '',
                author: item.uploaderName || YT_CHANNEL_NAME,
                description: item.shortDescription || ''
            });
        }).filter(Boolean);
    }

    async function fetchChannelFromInvidious(base) {
        const url = `${base}/api/v1/channels/${YT_CHANNEL_ID}/videos`;
        const res = await fetchWithTimeout(url);
        const data = await res.json();
        const items = Array.isArray(data) ? data : (data.videos || []);
        return items.map(item => {
            const videoId = item.videoId;
            if (!videoId) return null;
            const length = toNumber(item.lengthSeconds);
            if (length !== null && length > 0 && length < MIN_DURATION_SEC) return null;
            return normalizeVideo({
                videoId,
                title: item.title || '',
                author: item.author || YT_CHANNEL_NAME,
                description: item.description || ''
            });
        }).filter(Boolean);
    }

    // ============================================================
    // АГРЕГАЦИЯ
    // ============================================================

    async function loadHashtagVideosFromNetwork() {
        console.log('[HashtagVideos] Старт: хэштег + канал, источников:', PIPED_INSTANCES.length + INVIDIOUS_INSTANCES.length);

        // 1) Пытаемся получить по хэштегу — параллельно, ждём ВСЕ ответы
        const hashtagTasks = [
            ...PIPED_INSTANCES.map(base => fetchHashtagFromPiped(base).catch(() => [])),
            ...INVIDIOUS_INSTANCES.map(base => fetchHashtagFromInvidious(base).catch(() => []))
        ];
        const hashtagResults = await Promise.allSettled(hashtagTasks);

        let collected = [];
        hashtagResults.forEach((r) => {
            if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length) {
                collected.push(...r.value);
            }
        });

        let filtered = filterVideos(collected, [HASHTAG]);
        if (filtered.length) {
            console.log(`[HashtagVideos] По хэштегу найдено: ${filtered.length}`);
            return filtered;
        }

        console.log('[HashtagVideos] По хэштегу пусто, fallback на канал…');

        // 2) Fallback на канал — ТОЛЬКО если все источники хештега пусты
        const channelTasks = [
            ...PIPED_INSTANCES.map(base => fetchChannelFromPiped(base).catch(() => [])),
            ...INVIDIOUS_INSTANCES.map(base => fetchChannelFromInvidious(base).catch(() => []))
        ];
        const channelResults = await Promise.allSettled(channelTasks);

        const channelVideos = [];
        channelResults.forEach((r) => {
            if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length) {
                channelVideos.push(...r.value);
            }
        });

        filtered = filterVideos(channelVideos, FALLBACK_KEYWORDS);
        if (filtered.length) {
            console.log(`[HashtagVideos] Fallback на канал: ${filtered.length} видео`);
            return filtered;
        }

        console.warn('[HashtagVideos] Ни по хэштегу, ни по каналу видео не найдено');
        return [];
    }

    // ============================================================
    // РЕНДЕР
    // ============================================================

    function renderVideos(videos, container) {
        container.innerHTML = '';

        if (!videos.length) {
            container.innerHTML = `
                <div style="text-align:center;padding:20px 16px;color:var(--text-secondary);font-size:14px;">
                    <i class="fas fa-video" style="font-size:26px;opacity:0.5;display:block;margin-bottom:8px;"></i>
                    Видео по запросу не найдены
                </div>
            `;
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'video-grid';

        videos.forEach(v => {
            const a = document.createElement('a');
            a.className = 'video-preview video-preview--youtube';
            a.href = `https://www.youtube.com/watch?v=${v.videoId}`;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.setAttribute('aria-label', `Смотреть ${v.title || 'видео'} на YouTube`);

            const img = document.createElement('img');
            img.src = v.thumbnail;
            img.alt = v.title || '';
            img.loading = 'lazy';
            img.onerror = () => { img.src = `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`; };
            a.appendChild(img);

            const play = document.createElement('span');
            play.className = 'video-preview__play';
            play.setAttribute('aria-hidden', 'true');
            play.innerHTML = '<i class="fas fa-play"></i>';
            a.appendChild(play);

            const caption = document.createElement('div');
            caption.style.cssText = 'position:absolute;bottom:0;left:0;right:0;padding:8px 10px;background:linear-gradient(transparent,rgba(0,0,0,0.85));color:#fff;font-size:12px;line-height:1.3;pointer-events:none;z-index:3;';

            const titleEl = document.createElement('div');
            titleEl.textContent = v.title || 'Без названия';
            titleEl.style.cssText = 'font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            caption.appendChild(titleEl);

            if (v.author) {
                const authorEl = document.createElement('div');
                authorEl.textContent = v.author;
                authorEl.style.cssText = 'opacity:0.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                caption.appendChild(authorEl);
            }

            a.appendChild(caption);
            grid.appendChild(a);
        });

        container.appendChild(grid);
    }

    async function loadHashtagVideos(containerId, forceRefresh = false) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!forceRefresh) {
            const cached = readCache();
            if (cached && cached.length) {
                renderVideos(cached, container);
                return;
            }
        }

        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка видео...</p></div>`;

        try {
            const videos = await loadHashtagVideosFromNetwork();
            if (videos.length) {
                writeCache(videos);
                renderVideos(videos, container);
            } else {
                renderVideos([], container);
            }
        } catch (e) {
            console.warn('[HashtagVideos] Ошибка:', e.message || e);
            renderVideos([], container);
        }
    }

    function init() {
        const container = document.getElementById('hashtag-videos');
        if (container) loadHashtagVideos('hashtag-videos');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    window.HashtagVideos = { loadHashtagVideos };
})();