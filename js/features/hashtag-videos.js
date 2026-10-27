// js/features/hashtag-videos.js
// Загрузка видео по #starveneon (включая Shorts).
//
// ОСНОВНОЕ:
//   1. Invidious hashtag endpoint: /api/v1/hashtag/starveneon — возвращает
//      только видео с этим хэштегом (без мусора starve.io).
//   2. Piped search с фильтром.
//   3. Прямой парсинг HTML страницы хэштега через CORS-прокси
//      (включая shortsLockupViewModel).
//
// Empty state компактный — без огромной иконки и лишнего пустого пространства.

(function() {
    'use strict';

    const HASHTAG = 'starveneon';
    const YT_HASHTAG_URL = `https://www.youtube.com/hashtag/${HASHTAG}`;
    const CACHE_KEY = `hashtag_videos_cache_v3_${HASHTAG}`;
    const CACHE_TTL = 30 * 60 * 1000;
    const MAX_VIDEOS = 12;
    const REQUEST_TIMEOUT = 15000;
    const RETRY_DELAY = 800;

    const INVIDIOUS_INSTANCES = [
        'https://inv.nadeko.net',
        'https://invidious.nerdvpn.de',
        'https://invidious.privacyredirect.com',
        'https://iv.melmac.space',
        'https://invidious.f5.si',
        'https://yt.artemislena.eu',
        'https://invidious.jing.rocks',
        'https://invidious.perennialte.ch'
    ];

    const PIPED_INSTANCES = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.adminforge.de',
        'https://pipedapi.leptons.xyz',
        'https://api.piped.private.coffee',
        'https://pipedapi.drgns.space',
        'https://pipedapi.ducks.party'
    ];

    const CORS_PROXIES = [
        (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
        (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
        (u) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(u)}`,
        (u) => `https://cors.eu.org/${u}`,
        (u) => `https://cors.x2u.in/${u}`,
        (u) => `https://yacdn.org/proxy/${u}`,
        (u) => `https://corsfix.com/?${u}`,
        (u) => `https://cloudflare-cors-anywhere.queakchannel42.workers.dev/?${u}`,
        (u) => `https://test.cors.workers.dev/?${u}`,
        (u) => `https://corsproxy.org/?${encodeURIComponent(u)}`
    ];

    // ---- Кэш ----
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
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                timestamp: Date.now(), videos
            }));
        } catch { /* noop */ }
    }

    // ---- Сеть ----
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

    // ---- Утилиты ----
    function normalizeVideo(v) {
        if (!v || !v.videoId) return null;
        let thumb = v.thumbnail || null;
        if (thumb && thumb.includes('mqdefault')) {
            thumb = thumb.replace('mqdefault', 'hqdefault');
        }
        if (!thumb) thumb = `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
        return {
            videoId: v.videoId,
            title: v.title || 'Без названия',
            author: v.author || '',
            thumbnail: thumb
        };
    }

    function dedupe(videos) {
        const seen = new Set();
        const out = [];
        for (const v of videos) {
            if (!v || !v.videoId || seen.has(v.videoId)) continue;
            seen.add(v.videoId);
            out.push(v);
            if (out.length >= MAX_VIDEOS) break;
        }
        return out;
    }

    // ---- Стратегия 1: Invidious hashtag endpoint ----
    async function fetchViaInvidiousHashtag(signal) {
        const promises = INVIDIOUS_INSTANCES.map(inst =>
            fetchWithTimeout(`${inst}/api/v1/hashtag/${HASHTAG}`, signal)
                .then(res => res.json())
                .then(data => {
                    if (!Array.isArray(data)) throw new Error('not array');
                    const videos = data
                        .map(v => normalizeVideo({
                            videoId: v.videoId,
                            title: v.title,
                            author: v.author,
                            thumbnail: v.videoThumbnails?.[v.videoThumbnails.length - 1]?.url
                        }))
                        .filter(Boolean);
                    if (!videos.length) throw new Error('no videos');
                    return dedupe(videos);
                })
        );
        return await Promise.any(promises);
    }

    // ---- Стратегия 2: Invidious search (fallback, если hashtag endpoint недоступен) ----
    async function fetchViaInvidiousSearch(signal) {
        const promises = INVIDIOUS_INSTANCES.map(inst =>
            fetchWithTimeout(`${inst}/api/v1/search?q=%23${HASHTAG}&type=video&sort_by=upload_date`, signal)
                .then(res => res.json())
                .then(data => {
                    if (!Array.isArray(data)) throw new Error('not array');
                    const videos = data
                        .filter(v => v.type === 'video' && v.videoId)
                        .map(v => normalizeVideo({
                            videoId: v.videoId,
                            title: v.title,
                            author: v.author,
                            thumbnail: v.videoThumbnails?.[v.videoThumbnails.length - 1]?.url
                        }))
                        .filter(Boolean);
                    if (!videos.length) throw new Error('no videos');
                    return dedupe(videos);
                })
        );
        return await Promise.any(promises);
    }

    // ---- Стратегия 3: Piped search ----
    async function fetchViaPiped(signal) {
        const promises = PIPED_INSTANCES.map(inst =>
            fetchWithTimeout(`${inst}/search?q=%23${HASHTAG}&filter=videos`, signal)
                .then(res => res.json())
                .then(data => {
                    if (!data || !Array.isArray(data.items)) throw new Error('no items');
                    const videos = data.items
                        .map(item => {
                            const vid = (item.url || '').match(/[?&]v=([^&]+)/)?.[1];
                            if (!vid) return null;
                            return normalizeVideo({
                                videoId: vid,
                                title: item.title,
                                author: item.uploaderName,
                                thumbnail: item.thumbnail
                            });
                        })
                        .filter(Boolean);
                    if (!videos.length) throw new Error('no videos');
                    return dedupe(videos);
                })
        );
        return await Promise.any(promises);
    }

    // ---- Стратегия 4: прямой парсинг HTML хэштега через прокси ----
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

    function collectFromData(obj, out, seen) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(i => collectFromData(i, out, seen)); return; }
        if (out.length >= MAX_VIDEOS) return;

        const classic = obj.videoRenderer || obj.gridVideoRenderer || obj.compactVideoRenderer;
        if (classic && classic.videoId && !seen.has(classic.videoId)) {
            seen.add(classic.videoId);
            let title = '';
            if (classic.title?.runs?.[0]) title = classic.title.runs[0].text;
            else if (classic.title?.simpleText) title = classic.title.simpleText;
            let thumbnail = null;
            if (classic.thumbnail?.thumbnails?.length) {
                thumbnail = classic.thumbnail.thumbnails[classic.thumbnail.thumbnails.length - 1].url;
            }
            let author = '';
            if (classic.ownerText?.runs?.[0]) author = classic.ownerText.runs[0].text;
            else if (classic.longBylineText?.runs?.[0]) author = classic.longBylineText.runs[0].text;
            out.push(normalizeVideo({ videoId: classic.videoId, title, author, thumbnail }));
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
                let thumbnail = null;
                if (l.contentImage?.thumbnailViewModel?.image?.sources?.length) {
                    const s = l.contentImage.thumbnailViewModel.image.sources;
                    thumbnail = s[s.length - 1].url;
                }
                out.push(normalizeVideo({ videoId, title, author: '', thumbnail }));
            }
        }

        if (obj.shortsLockupViewModel) {
            const s = obj.shortsLockupViewModel;
            let videoId = '';
            if (s.entityId) {
                const m = s.entityId.match(/shorts-shelf-item-(.+)/);
                if (m) videoId = m[1];
            }
            if (videoId && !seen.has(videoId)) {
                seen.add(videoId);
                let title = '';
                if (s.overlayMetadata?.primaryText?.content) {
                    title = s.overlayMetadata.primaryText.content;
                }
                let thumbnail = null;
                const sources = s.thumbnailViewModel?.thumbnailViewModel?.image?.sources;
                if (Array.isArray(sources) && sources.length) {
                    thumbnail = sources[sources.length - 1].url;
                }
                out.push(normalizeVideo({ videoId, title, author: '', thumbnail }));
            }
        }

        if (obj.richItemRenderer?.content) collectFromData(obj.richItemRenderer.content, out, seen);

        for (const key of Object.keys(obj)) {
            if (out.length >= MAX_VIDEOS) break;
            collectFromData(obj[key], out, seen);
        }
    }

    async function fetchViaHashtagProxies(signal) {
        const promises = CORS_PROXIES.map(proxyFn =>
            fetchViaProxy(proxyFn, YT_HASHTAG_URL, signal)
                .then(html => {
                    const data = extractYtInitialData(html);
                    if (!data) throw new Error('no ytInitialData');
                    const out = [];
                    const seen = new Set();
                    collectFromData(data, out, seen);
                    if (!out.length) throw new Error('no videos');
                    return dedupe(out);
                })
        );
        return await Promise.any(promises);
    }

    // ---- Отрисовка ----
    function renderVideos(videos, container) {
        container.innerHTML = '';

        if (!videos.length) {
            container.innerHTML = `
                <div style="text-align:center;padding:20px 16px;color:var(--text-secondary);font-size:14px;">
                    <i class="fas fa-video" style="font-size:26px;opacity:0.5;display:block;margin-bottom:8px;"></i>
                    Видео по хештегу #${HASHTAG} не найдены
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
            img.onerror = () => {
                img.src = `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
            };
            a.appendChild(img);

            const play = document.createElement('span');
            play.className = 'video-preview__play';
            play.setAttribute('aria-hidden', 'true');
            play.innerHTML = '<i class="fas fa-play"></i>';
            a.appendChild(play);

            const caption = document.createElement('div');
            caption.style.cssText = `
                position: absolute; bottom: 0; left: 0; right: 0;
                padding: 8px 10px;
                background: linear-gradient(transparent, rgba(0,0,0,0.85));
                color: #fff; font-size: 12px; line-height: 1.3;
                pointer-events: none; z-index: 3;
            `;

            const titleEl = document.createElement('div');
            titleEl.textContent = v.title || 'Без названия';
            titleEl.style.cssText = 'font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            caption.appendChild(titleEl);

            if (v.author) {
                const authorEl = document.createElement('div');
                authorEl.textContent = v.author;
                authorEl.style.cssText = 'opacity:0.85; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                caption.appendChild(authorEl);
            }

            a.appendChild(caption);
            grid.appendChild(a);
        });

        container.appendChild(grid);
    }

    // ---- Основная функция ----
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

        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка видео по #${HASHTAG}...</p></div>`;

        // Пробуем несколько раз с разными стратегиями
        const strategies = [
            fetchViaInvidiousHashtag(null),
            fetchViaInvidiousSearch(null),
            fetchViaPiped(null),
            fetchViaHashtagProxies(null)
        ];

        try {
            // Promise.any — кто первый, того и видео
            const videos = await Promise.any(strategies);
            if (videos && videos.length) {
                writeCache(videos);
                renderVideos(videos, container);
                return;
            }
            renderVideos([], container);
        } catch (e) {
            console.warn('[HashtagVideos] Все стратегии недоступны:', e && e.message ? e.message : e);
            // Компактный error state
            container.innerHTML = `
                <div style="text-align:center;padding:20px 16px;color:var(--text-secondary);">
                    <i class="fas fa-exclamation-triangle" style="font-size:26px;opacity:0.5;display:block;margin-bottom:8px;color:#ff9800;"></i>
                    <p style="margin:0 0 10px;font-size:14px;">Не удалось загрузить видео по #${HASHTAG}</p>
                    <button class="button small" id="hashtag-videos-retry" type="button">
                        <i class="fas fa-sync"></i> Повторить
                    </button>
                </div>
            `;
            const retry = container.querySelector('#hashtag-videos-retry');
            if (retry) retry.addEventListener('click', () => loadHashtagVideos(containerId, true));
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