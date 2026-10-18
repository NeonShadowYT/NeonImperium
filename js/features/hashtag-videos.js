// js/features/hashtag-videos.js
// Автоматическая загрузка видео по хештегу #starveneon со страницы YouTube.
// Использует ytInitialData (JSON внутри HTML страницы хештега) через CORS-прокси allorigins.
// Без YouTube API-ключа.
//
// Рендерит карточки в контейнер #hashtag-videos:
//   - превью (thumbnail) — самое важное
//   - название видео
//   - автор (канал) — если удалось извлечь
//   - клик открывает видео на YouTube в новой вкладке

(function() {
    'use strict';

    const HASHTAG = 'starveneon';
    const YT_HASHTAG_URL = `https://www.youtube.com/hashtag/${HASHTAG}`;
    const PROXY_URL = `https://api.allorigins.win/raw?url=${encodeURIComponent(YT_HASHTAG_URL)}`;
    const MAX_VIDEOS = 9;
    const REQUEST_TIMEOUT = 15000;

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
                    console.warn('[HashtagVideos] JSON parse error:', e.message);
                }
            }
        }
        return null;
    }

    // ---- Рекурсивный сбор videoRenderer ----
    function collectVideoRenderers(obj, out) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
            obj.forEach(item => collectVideoRenderers(item, out));
            return;
        }
        if (obj.videoRenderer) {
            out.push(obj.videoRenderer);
        }
        for (const key of Object.keys(obj)) {
            collectVideoRenderers(obj[key], out);
        }
    }

    // ---- Парсинг видео ----
    function parseVideos(data) {
        const renderers = [];
        collectVideoRenderers(data, renderers);

        const videos = [];
        const seen = new Set();

        for (const r of renderers) {
            const videoId = r.videoId;
            if (!videoId || seen.has(videoId)) continue;
            seen.add(videoId);

            let title = '';
            if (r.title && r.title.runs && r.title.runs[0]) {
                title = r.title.runs[0].text;
            } else if (r.title && r.title.simpleText) {
                title = r.title.simpleText;
            }

            let author = '';
            if (r.ownerText && r.ownerText.runs && r.ownerText.runs[0]) {
                author = r.ownerText.runs[0].text;
            } else if (r.longBylineText && r.longBylineText.runs && r.longBylineText.runs[0]) {
                author = r.longBylineText.runs[0].text;
            }

            let thumbnail = '';
            if (r.thumbnail && Array.isArray(r.thumbnail.thumbnails) && r.thumbnail.thumbnails.length) {
                const thumbs = r.thumbnail.thumbnails;
                thumbnail = thumbs[thumbs.length - 1].url; // самая большая
            }
            if (!thumbnail) {
                thumbnail = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
            }

            videos.push({ videoId, title, author, thumbnail });
            if (videos.length >= MAX_VIDEOS) break;
        }

        return videos;
    }

    // ---- Отрисовка ----
    function renderVideos(videos, container) {
        container.innerHTML = '';

        if (!videos.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = `<i class="fas fa-video"></i><p>Видео по хештегу #${HASHTAG} не найдены</p>`;
            container.appendChild(empty);
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

            // Подпись: название + автор поверх нижней части превью
            const caption = document.createElement('div');
            caption.className = 'video-caption';
            caption.style.cssText = `
                position: absolute;
                bottom: 0;
                left: 0;
                right: 0;
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

    // ---- Загрузка ----
    async function loadHashtagVideos(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка видео...</p></div>`;

        try {
            const resp = await fetch(PROXY_URL, {
                signal: AbortSignal.timeout(REQUEST_TIMEOUT)
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const html = await resp.text();
            const data = extractYtInitialData(html);
            if (!data) throw new Error('ytInitialData not found');
            const videos = parseVideos(data);
            renderVideos(videos, container);
        } catch (e) {
            console.warn('[HashtagVideos] Ошибка загрузки:', e.message || e);
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