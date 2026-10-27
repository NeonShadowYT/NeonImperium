// js/features/hashtag-videos.js
// Видео по #starveneon. Только Invidious hashtag endpoint + строгий фильтр.
// Piped search и HTML-парсинг УДАЛЕНЫ — они возвращали рекомендованные видео.
// Фильтр: в title или description должна быть подстрока "starveneon".

(function() {
    'use strict';

    const HASHTAG = 'starveneon';
    const CACHE_KEY = `hashtag_videos_cache_v5_${HASHTAG}`;
    const CACHE_TTL = 30 * 60 * 1000;
    const MAX_VIDEOS = 12;
    const REQUEST_TIMEOUT = 15000;

    // Только инстансы, которые реально отдают /api/v1/hashtag/:tag
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

    // CORS-прокси для fallback, если инстанс не отдаёт CORS напрямую
    const CORS_PROXIES = [
        (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u) => `https://corsfix.com/?${u}`,
        (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`
    ];

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
        let thumb = v.thumbnail || null;
        if (thumb && thumb.includes('mqdefault')) {
            thumb = thumb.replace('mqdefault', 'hqdefault');
        }
        // КРИТИЧНО: всегда используем i.ytimg.com, а не прокси Piped
        if (!thumb || thumb.includes('piped-proxy') || thumb.includes('proxy.piped')) {
            thumb = `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
        }
        return {
            videoId: v.videoId,
            title: v.title || '',
            author: v.author || '',
            description: v.description || '',
            thumbnail: thumb
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

    async function fetchViaInvidiousHashtag(signal) {
        const promises = INVIDIOUS_INSTANCES.map(inst =>
            fetchWithTimeout(`${inst}/api/v1/hashtag/${HASHTAG}`, signal)
                .then(res => res.json())
                .then(data => {
                    if (!Array.isArray(data)) throw new Error('not array');
                    const videos = filterRelevant(data.map(v => normalizeVideo({
                        videoId: v.videoId,
                        title: v.title,
                        author: v.author,
                        description: v.description || '',
                        thumbnail: v.videoThumbnails?.[v.videoThumbnails.length - 1]?.url
                    })));
                    if (!videos.length) throw new Error('no relevant videos');
                    return videos;
                })
        );

        // Если прямой запрос не удался (CORS), пробуем через прокси
        const proxyPromises = [];
        for (const inst of INVIDIOUS_INSTANCES) {
            for (const proxyFn of CORS_PROXIES) {
                proxyPromises.push(
                    fetchWithTimeout(proxyFn(`${inst}/api/v1/hashtag/${HASHTAG}`), signal)
                        .then(res => res.json())
                        .then(data => {
                            if (!Array.isArray(data)) throw new Error('not array');
                            const videos = filterRelevant(data.map(v => normalizeVideo({
                                videoId: v.videoId,
                                title: v.title,
                                author: v.author,
                                description: v.description || '',
                                thumbnail: v.videoThumbnails?.[v.videoThumbnails.length - 1]?.url
                            })));
                            if (!videos.length) throw new Error('no relevant videos');
                            return videos;
                        })
                );
            }
        }

        return await Promise.any([...promises, ...proxyPromises]);
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
            const videos = await fetchViaInvidiousHashtag(null);
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