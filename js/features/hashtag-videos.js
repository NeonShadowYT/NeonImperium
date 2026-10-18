// js/features/hashtag-videos.js
// Автоматическая загрузка видео по хештегу #starveneon со страницы YouTube.
// Без API-ключа. Использует ytInitialData из HTML и несколько CORS-прокси.
//
// Поддерживаемые компоненты YouTube:
//   videoRenderer, gridVideoRenderer, compactVideoRenderer (классические)
//   lockupViewModel (новые страницы каналов/хештегов)
//   shortsLockupViewModel (Shorts)
//
// Прокси перебираются по очереди: allorigins → corsproxy.io → codetabs → cloudflare-cors-anywhere.
// Первый успешный ответ используется.

(function() {
    'use strict';

    const HASHTAG = 'starveneon';
    const YT_HASHTAG_URL = `https://www.youtube.com/hashtag/${HASHTAG}`;
    const MAX_VIDEOS = 9;
    const REQUEST_TIMEOUT = 20000;

    // Список CORS-прокси (в порядке приоритета).
    // Формат: функция, принимающая targetUrl, возвращает прокси-URL.
    const CORS_PROXIES = [
        {
            name: 'allorigins',
            build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
        },
        {
            name: 'corsproxy.io',
            build: (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`
        },
        {
            name: 'codetabs',
            build: (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
        },
        {
            name: 'cloudflare-cors-anywhere',
            build: (url) => `https://cloudflare-cors-anywhere.voor.nu/?${url}`
        }
    ];

    // ---- Извлечение ytInitialData из HTML ----
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
                    // Попробуем найти более точную границу JSON (до "</script>")
                    const end = m[1].lastIndexOf('}');
                    if (end !== -1) {
                        try {
                            return JSON.parse(m[1].slice(0, end + 1));
                        } catch (e2) { /* noop */ }
                    }
                }
            }
        }
        return null;
    }

    // ---- Рекурсивный обход JSON и сбор видео ----
    function collectVideos(obj, out, seen) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            obj.forEach(item => collectVideos(item, out, seen));
            return;
        }

        // 1. Классические videoRenderer / gridVideoRenderer / compactVideoRenderer
        const classic = obj.videoRenderer || obj.gridVideoRenderer || obj.compactVideoRenderer;
        if (classic && classic.videoId) {
            addClassicVideo(classic, out, seen);
        }

        // 2. lockupViewModel (новые страницы каналов/хештегов)
        if (obj.lockupViewModel) {
            addLockupVideo(obj.lockupViewModel, out, seen);
        }

        // 3. shortsLockupViewModel (Shorts)
        if (obj.shortsLockupViewModel) {
            addShortsVideo(obj.shortsLockupViewModel, out, seen);
        }

        // Рекурсивно обходим все ключи
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
            const thumbs = r.thumbnail.thumbnails;
            thumbnail = thumbs[thumbs.length - 1].url;
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

        // Автор в lockupViewModel обычно отсутствует, но может быть в metadataRows
        let author = '';
        const rows = l.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
        if (Array.isArray(rows)) {
            for (const row of rows) {
                if (Array.isArray(row.metadataParts)) {
                    for (const part of row.metadataParts) {
                        if (part.text?.content && !part.text.content.includes('view') && !part.text.content.includes('ago')) {
                            author = part.text.content;
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
        if (!videoId) return;
        if (seen.has(videoId)) return;
        seen.add(videoId);

        let title = '';
        if (s.overlayMetadata?.primaryText?.content) title = s.overlayMetadata.primaryText.content;

        let thumbnail = '';
        const thumbSources = s.thumbnailViewModel?.thumbnailViewModel?.image?.sources;
        if (Array.isArray(thumbSources) && thumbSources.length) {
            thumbnail = thumbSources[thumbSources.length - 1].url;
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

    // ---- Загрузка через прокси ----
    async function fetchHashtagHtml() {
        let lastError = null;
        for (const proxy of CORS_PROXIES) {
            const proxyUrl = proxy.build(YT_HASHTAG_URL);
            try {
                const resp = await fetch(proxyUrl, {
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT)
                });
                if (!resp.ok) {
                    lastError = new Error(`${proxy.name}: HTTP ${resp.status}`);
                    continue;
                }
                const html = await resp.text();
                if (!html || html.length < 1000) {
                    lastError = new Error(`${proxy.name}: слишком короткий ответ`);
                    continue;
                }
                return html;
            } catch (e) {
                lastError = new Error(`${proxy.name}: ${e.message || e}`);
            }
        }
        throw lastError || new Error('Все CORS-прокси недоступны');
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
    async function loadHashtagVideos(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка видео по #${HASHTAG}...</p></div>`;

        try {
            const html = await fetchHashtagHtml();
            const data = extractYtInitialData(html);
            if (!data) throw new Error('ytInitialData не найден');
            const videos = parseVideos(data);
            renderVideos(videos, container);
        } catch (e) {
            console.warn('[HashtagVideos] Ошибка:', e.message || e);
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
            if (retry) retry.addEventListener('click', () => loadHashtagVideos(containerId));
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