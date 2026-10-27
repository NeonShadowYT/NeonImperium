// js/features/hashtag-videos.js
// Хэштег #starveneon: r.jina.ai + CORS-прокси + Invidious Search + Piped Search.
// Все стратегии запускаются параллельно (Promise.any), Shorts отсекаются по длительности.

(function() {
    'use strict';

    const HASHTAG = 'starveneon';
    const YT_HASHTAG_URL = `https://www.youtube.com/hashtag/${HASHTAG}`;
    const CACHE_KEY = `hashtag_videos_cache_v9_${HASHTAG}`;
    const CACHE_TTL = 30 * 60 * 1000;
    const MAX_VIDEOS = 12;
    const MIN_DURATION_SEC = 60;
    const REQUEST_TIMEOUT = 20000;

    const PIPED_INSTANCES = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.adminforge.de',
        'https://pipedapi.leptons.xyz',
        'https://api.piped.private.coffee',
        'https://pipedapi.drgns.space',
        'https://pipedapi.ducks.party'
    ];
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

    const READER_PROXY = (url) => `https://r.jina.ai/${url}`;
    const CORS_PROXIES = [
        (u) => `https://corsfix.com/?${u}`,
        (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
        (u) => `https://cors.x2u.in/${u}`,
        (u) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(u)}`,
        (u) => `https://cors.eu.org/${u}`
    ];

    function parseDurationToSec(text) {
        if (!text) return 0;
        const parts = String(text).split(':').map(Number);
        if (parts.some(isNaN)) return 0;
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return parts[0] || 0;
    }

    function isRelevantVideo(v) {
        if (!v) return false;
        const text = ((v.title || '') + ' ' + (v.description || '')).toLowerCase();
        return text.includes('starveneon');
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

    function normalizeVideo(v) {
        if (!v || !v.videoId) return null;
        return {
            videoId: v.videoId,
            title: v.title || '',
            author: v.author || '',
            description: v.description || '',
            thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
        };
    }

    function filterRelevant(videos) {
        const seen = new Set();
        const out = [];
        for (const v of videos) {
            if (!v || !v.videoId || seen.has(v.videoId)) continue;
            if (!isRelevantVideo(v)) continue;
            seen.add(v.videoId);
            out.push(v);
            if (out.length >= MAX_VIDEOS) break;
        }
        return out;
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

    // Shorts полностью исключены: shortsLockupViewModel не обрабатываем,
    // а у videoRenderer/lockupViewModel проверяем длительность.
    function collectFromData(obj, out, seen) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(i => collectFromData(i, out, seen)); return; }
        if (out.length >= MAX_VIDEOS * 2) return;

        const classic = obj.videoRenderer || obj.gridVideoRenderer || obj.compactVideoRenderer;
        if (classic && classic.videoId && !seen.has(classic.videoId)) {
            const durationSec = parseDurationToSec(
                classic.lengthText?.simpleText ||
                classic.lengthText?.runs?.[0]?.text ||
                ''
            );
            if (durationSec > 0 && durationSec < MIN_DURATION_SEC) return;
            seen.add(classic.videoId);
            let title = '';
            if (classic.title?.runs?.[0]) title = classic.title.runs[0].text;
            else if (classic.title?.simpleText) title = classic.title.simpleText;
            let author = '';
            if (classic.ownerText?.runs?.[0]) author = classic.ownerText.runs[0].text;
            else if (classic.longBylineText?.runs?.[0]) author = classic.longBylineText.runs[0].text;
            let description = '';
            if (classic.descriptionSnippet?.runs?.[0]) description = classic.descriptionSnippet.runs[0].text;
            out.push(normalizeVideo({ videoId: classic.videoId, title, author, description }));
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
                let description = '';
                if (l.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows) {
                    const rows = l.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows;
                    for (const row of rows) {
                        if (row.metadataParts) {
                            for (const part of row.metadataParts) {
                                if (part.text?.content) description += part.text.content + ' ';
                            }
                        }
                    }
                }
                out.push(normalizeVideo({ videoId, title, author: '', description }));
            }
        }

        if (obj.richItemRenderer?.content) collectFromData(obj.richItemRenderer.content, out, seen);

        for (const key of Object.keys(obj)) {
            if (out.length >= MAX_VIDEOS * 2) break;
            if (key === 'shortsLockupViewModel') continue;
            collectFromData(obj[key], out, seen);
        }
    }

    function parseHashtagHtml(html) {
        const data = extractYtInitialData(html);
        if (!data) return null;
        const out = [];
        const seen = new Set();
        collectFromData(data, out, seen);
        return filterRelevant(out);
    }

    // ---- Стратегия 1: r.jina.ai ----
    async function fetchViaReaderProxy(signal) {
        const url = READER_PROXY(YT_HASHTAG_URL);
        const res = await fetchWithTimeout(url, signal);
        const html = await res.text();
        if (!html || html.length < 1000) throw new Error('too short');
        const videos = parseHashtagHtml(html);
        if (!videos || !videos.length) throw new Error('no relevant videos');
        return videos;
    }

    // ---- Стратегия 2: CORS-прокси ----
    async function fetchViaCorsProxy(proxyFn, signal) {
        const url = proxyFn(YT_HASHTAG_URL);
        const res = await fetchWithTimeout(url, signal);
        let text = await res.text();
        if (text.trim().startsWith('{')) {
            try {
                const json = JSON.parse(text);
                if (typeof json.contents === 'string') text = json.contents;
            } catch { /* noop */ }
        }
        const videos = parseHashtagHtml(text);
        if (!videos || !videos.length) throw new Error('no relevant videos');
        return videos;
    }

    // ---- Стратегия 3: Invidious Search ----
    async function fetchViaInvidious(signal) {
        const promises = INVIDIOUS_INSTANCES.map(async (base) => {
            const url = `${base}/api/v1/search?q=%23${HASHTAG}&type=video`;
            const res = await fetchWithTimeout(url, signal);
            const data = await res.json();
            const videos = (Array.isArray(data) ? data : []).map(item => {
                const videoId = item.videoId;
                if (!videoId) return null;
                const length = typeof item.lengthSeconds === 'number' ? item.lengthSeconds : null;
                if (length !== null && length > 0 && length < MIN_DURATION_SEC) return null;
                return normalizeVideo({
                    videoId,
                    title: item.title || '',
                    author: item.author || '',
                    description: item.description || ''
                });
            }).filter(Boolean);
            if (!videos.length) throw new Error('empty');
            return videos;
        });
        try {
            return await Promise.any(promises);
        } catch {
            throw new Error('all invidious failed');
        }
    }

    // ---- Стратегия 4: Piped Search ----
    async function fetchViaPiped(signal) {
        const promises = PIPED_INSTANCES.map(async (base) => {
            const url = `${base}/search?q=%23${HASHTAG}&filter=videos`;
            const res = await fetchWithTimeout(url, signal);
            const data = await res.json();
            const streams = data.items || [];
            const videos = streams.map(item => {
                const videoId = (item.url || '').replace('/watch?v=', '');
                if (!videoId) return null;
                const duration = typeof item.duration === 'number' ? item.duration : null;
                if (duration !== null && duration > 0 && duration < MIN_DURATION_SEC) return null;
                return normalizeVideo({
                    videoId,
                    title: item.title || '',
                    author: item.uploaderName || '',
                    description: item.shortDescription || ''
                });
            }).filter(Boolean);
            if (!videos.length) throw new Error('empty');
            return videos;
        });
        try {
            return await Promise.any(promises);
        } catch {
            throw new Error('all piped failed');
        }
    }

    async function loadHashtagVideosFromNetwork(signal) {
        const strategies = [
            fetchViaReaderProxy(signal),
            ...CORS_PROXIES.map(p => fetchViaCorsProxy(p, signal)),
            fetchViaInvidious(signal),
            fetchViaPiped(signal)
        ];

        const results = await Promise.allSettled(strategies);
        const collected = [];
        for (const r of results) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                collected.push(...r.value);
            }
        }

        if (!collected.length) throw new Error('No strategy returned videos');

        const filtered = filterRelevant(collected);
        if (!filtered.length) throw new Error('No relevant videos');

        return filtered;
    }

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
                const filtered = filterRelevant(cached);
                if (filtered.length) {
                    renderVideos(filtered, container);
                    return;
                }
            }
        }

        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка видео по #${HASHTAG}...</p></div>`;

        try {
            const videos = await loadHashtagVideosFromNetwork(null);
            if (videos && videos.length) {
                writeCache(videos);
                renderVideos(videos, container);
                return;
            }
            renderVideos([], container);
        } catch (e) {
            console.warn('[HashtagVideos] Все стратегии недоступны:', e && e.message ? e.message : e);
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