// js/features/hashtag-videos.js
// Загрузка видео по хештегу #starveneon.
// Несколько CORS-прокси опрашиваются ПАРАЛЛЕЛЬНО (Promise.any).
// Первый успешный результат кешируется в localStorage на 30 минут.
//
// CSP: требует разрешения для всех доменов из PROXIES в connect-src.

(function() {
    'use strict';

    const HASHTAG = 'starveneon';
    const YT_HASHTAG_URL = `https://www.youtube.com/hashtag/${HASHTAG}`;
    const CACHE_KEY = `hashtag_videos_cache_${HASHTAG}`;
    const CACHE_TTL = 30 * 60 * 1000; // 30 минут
    const MAX_VIDEOS = 9;
    const REQUEST_TIMEOUT = 12000;

    // ---- Список CORS-прокси ----
    // Порядок не важен: все запускаются одновременно, побеждает самый быстрый.
    // Каждый прокси — функция, принимающая targetUrl и возвращающая URL запроса.
    const PROXIES = [
        // 1. allorigins (raw) — иногда падает с 522, но пробуем
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        // 2. allorigins (get) — другой endpoint, может работать, когда raw падает
        (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
        // 3. everyorigin — бесплатный, без ключа
        (url) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(url)}`,
        // 4. cors.lol — бесплатный, простой
        (url) => `https://api.cors.lol/?url=${encodeURIComponent(url)}`,
        // 5. codetabs — бесплатный (требует разрешения в CSP)
        (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        // 6. cloudflare-cors-anywhere — worker (требует разрешения в CSP)
        (url) => `https://cloudflare-cors-anywhere.queakchannel42.workers.dev/?${url}`
    ];

    // ---- Кеш ----
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
        } catch (e) {
            return null;
        }
    }

    function writeCache(videos) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                videos
            }));
        } catch (e) { /* noop */ }
    }

    // ---- Извлечение ytInitialData ----
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

    // ---- Парсинг видео ----
    function collectVideos(obj, out, seen) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            obj.forEach(item => collectVideos(item, out, seen));
            return;
        }

        // Классические компоненты
        const classic = obj.videoRenderer || obj.gridVideoRenderer || obj.compactVideoRenderer;
        if (classic && classic.videoId) addClassicVideo(classic, out, seen);

        // Новый lockupViewModel (страницы каналов/хештегов)
        if (obj.lockupViewModel) addLockupVideo(obj.lockupViewModel, out, seen);

        // Shorts
        if (obj.shortsLockupViewModel) addShortsVideo(obj.shortsLockupViewModel, out, seen);

        // richItemRenderer (обёртка для hashtag-страниц)
        if (obj.richItemRenderer && obj.richItemRenderer.content) {
            collectVideos(obj.richItemRenderer.content, out, seen);
        }

        for (const key of Object.keys(obj)) {
            collectVideos(obj[key], out, seen);
        }
    }

    function addClassicVideo(r, out, seen) {
        if (!r.videoId || seen.has(r.videoId)) return;
        seen.add(r.videoId);

        let title = '';
        if (r.title && r.title.runs && r.title.runs[0]) title = r.title.runs[0].text;
        else if (r.title && r.title.simpleText) title = r.title.simpleText;

        let author = '';
        if (r.ownerText && r.ownerText.runs && r.ownerText.runs[0]) author = r.ownerText.runs[0].text;
        else if (r.longBylineText && r.longBylineText.runs && r.longBylineText.runs[0]) author = r.longBylineText.runs[0].text;

        let thumbnail = '';
        if (r.thumbnail && Array.isArray(r.thumbnail.thumbnails) && r.thumbnail.thumbnails.length) {
            thumbnail = r.thumbnail.thumbnails[r.thumbnail.thumbnails.length - 1].url;
        }
        if (!thumbnail) thumbnail = `https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`;

        out.push({ videoId: r.videoId, title, author, thumbnail });
    }

    function addLockupVideo(l, out, seen) {
        const videoId = l.contentId;
        if (!videoId || seen.has(videoId)) return;
        seen.add(videoId);

        let title = '';
        if (l.metadata?.lockupMetadataViewModel?.title?.content) {
            title = l.metadata.lockupMetadataViewModel.title.content;
        }

        let thumbnail = '';
        if (l.contentImage?.thumbnailViewModel?.image?.sources?.length) {
            const sources = l.contentImage.thumbnailViewModel.image.sources;
            thumbnail = sources[sources.length - 1].url;
        }
        if (!thumbnail) thumbnail = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

        let author = '';
        const rows = l.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
        if (Array.isArray(rows)) {
            for (const row of rows) {
                if (Array.isArray(row.metadataParts)) {
                    for (const part of row.metadataParts) {
                        const txt = part.text?.content;
                        if (txt && !/\d+\s*(view|ago)/i.test(txt)) {
                            author = txt;
                            break;
                        }
                    }
                }
                if (author) break;
            }
        }

        out.push({ videoId, title, author, thumbnail });
    }

    function addShortsVideo(s, out, seen) {
        let videoId = '';
        if (s.entityId) {
            const m = s.entityId.match(/shorts-shelf-item-(.+)/);
            if (m) videoId = m[1];
        }
        if (!videoId || seen.has(videoId)) return;
        seen.add(videoId);

        let title = '';
        if (s.overlayMetadata?.primaryText?.content) title = s.overlayMetadata.primaryText.content;

        let thumbnail = '';
        const sources = s.thumbnailViewModel?.thumbnailViewModel?.image?.sources;
        if (Array.isArray(sources) && sources.length) {
            thumbnail = sources[sources.length - 1].url;
        }
        if (!thumbnail) thumbnail = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

        out.push({ videoId, title, author: '', thumbnail });
    }

    function parseVideos(data) {
        const out = [];
        const seen = new Set();
        collectVideos(data, out, seen);
        return out.slice(0, MAX_VIDEOS);
    }

    // ---- Загрузка через один прокси ----
    async function fetchViaProxy(proxyFn, signal) {
        const proxyUrl = proxyFn(YT_HASHTAG_URL);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

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

            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}`);
            }

            const text = await resp.text();
            if (!text || text.length < 500) {
                throw new Error('Response too short');
            }

            // allorigins /get возвращает JSON { contents: "..." }
            // Нужно распаковать, если это так.
            let html = text;
            if (text.trim().startsWith('{')) {
                try {
                    const json = JSON.parse(text);
                    if (json.contents && typeof json.contents === 'string') {
                        html = json.contents;
                    }
                } catch (e) { /* не JSON, оставляем как есть */ }
            }

            const data = extractYtInitialData(html);
            if (!data) {
                throw new Error('ytInitialData not found');
            }

            const videos = parseVideos(data);
            if (!videos.length) {
                throw new Error('No videos parsed');
            }

            return videos;
        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    }

    // ---- Параллельная гонка прокси ----
    async function raceProxies(signal) {
        const promises = PROXIES.map(proxyFn =>
            fetchViaProxy(proxyFn, signal).catch(err => {
                // Возвращаем rejected promise, чтобы Promise.any его проигнорировал
                throw err;
            })
        );

        // Promise.any вернёт первый успешный результат, остальные будут проигнорированы.
        // Если все упадут — AggregateError.
        return await Promise.any(promises);
    }

    // ---- Отрисовка ----
    function renderVideos(videos, container) {
        container.innerHTML = '';

        if (!videos.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-video"></i>
                    <p>Видео по хештегу #${HASHTAG} не найдены</p>
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
            img.onerror = () => { img.style.display = 'none'; };
            a.appendChild(img);

            const play = document.createElement('span');
            play.className = 'video-preview__play';
            play.setAttribute('aria-hidden', 'true');
            play.innerHTML = '<i class="fas fa-play"></i>';
            a.appendChild(play);

            const caption = document.createElement('div');
            caption.className = 'video-caption';
            caption.style.cssText = `
                position: absolute;
                bottom: 0; left: 0; right: 0;
                padding: 8px 10px;
                background: linear-gradient(transparent, rgba(0,0,0,0.85));
                color: #fff;
                font-size: 12px;
                line-height: 1.3;
                pointer-events: none;
                z-index: 3;
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

        // 1. Кеш
        if (!forceRefresh) {
            const cached = readCache();
            if (cached && cached.length) {
                renderVideos(cached, container);
                return;
            }
        }

        // 2. Скелетон загрузки
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка видео по #${HASHTAG}...</p></div>`;

        try {
            const videos = await raceProxies();
            writeCache(videos);
            renderVideos(videos, container);
        } catch (e) {
            console.warn('[HashtagVideos] Все прокси недоступны:', e.message || e);
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Не удалось загрузить видео по хештегу #${HASHTAG}.</p>
                    <button class="button small" id="hashtag-videos-retry">
                        <i class="fas fa-sync"></i> Повторить
                    </button>
                </div>
            `;
            const retry = container.querySelector('#hashtag-videos-retry');
            if (retry) retry.addEventListener('click', () => loadHashtagVideos(containerId, true));
        }
    }

    // ---- Автозапуск ----
    function init() {
        const container = document.getElementById('hashtag-videos');
        if (container) {
            loadHashtagVideos('hashtag-videos');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.HashtagVideos = { loadHashtagVideos };
})();