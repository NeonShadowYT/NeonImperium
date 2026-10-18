// js/features/background-gifs.js
// Управление гифками и фоновыми видео:
//   1. Баннеры с плавным появлением (.feature-banner[data-gif]).
//   2. Переключаемый фон скачивания (#download-section).
//   3. Ленивая загрузка видео в .desc-image (описание Starve Neon).
//   4. Превью YouTube-плейлистов (.video-preview--youtube[data-playlist-id] img без src).

(function() {
    // ---------- 1. Баннеры с видео / гифками ----------
    function initFeatureBanners() {
        const banners = document.querySelectorAll('.feature-banner[data-gif]');
        if (banners.length === 0) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const container = entry.target;
                    if (container.dataset.loaded === 'true') return;

                    const gifSrc = container.dataset.gif;
                    const fallbackEmoji = container.dataset.fallbackEmoji || '';
                    const ext = gifSrc.split('.').pop().toLowerCase();

                    container.innerHTML = '';

                    let mediaElement;
                    if (ext === 'webm' || ext === 'mp4') {
                        const video = document.createElement('video');
                        video.src = gifSrc;
                        video.autoplay = true;
                        video.loop = true;
                        video.muted = true;
                        video.playsInline = true;
                        video.style.width = '100%';
                        video.style.height = '100%';
                        video.style.objectFit = 'cover';
                        video.addEventListener('error', () => {
                            container.innerHTML = `<span class="fallback-emoji">${fallbackEmoji}</span>`;
                            container.classList.add('loaded');
                        });
                        mediaElement = video;
                    } else {
                        const img = document.createElement('img');
                        img.src = gifSrc;
                        img.alt = '';
                        img.loading = 'lazy';
                        img.onerror = () => {
                            container.innerHTML = `<span class="fallback-emoji">${fallbackEmoji}</span>`;
                            container.classList.add('loaded');
                        };
                        mediaElement = img;
                    }
                    container.appendChild(mediaElement);

                    if (mediaElement.tagName === 'VIDEO') {
                        mediaElement.addEventListener('loadeddata', () => container.classList.add('loaded'));
                        if (mediaElement.readyState >= 2) container.classList.add('loaded');
                    } else {
                        mediaElement.addEventListener('load', () => container.classList.add('loaded'));
                        if (mediaElement.complete) container.classList.add('loaded');
                    }

                    container.dataset.loaded = 'true';
                    observer.unobserve(container);
                }
            });
        }, { rootMargin: '200px' });

        banners.forEach(container => observer.observe(container));
    }

    // ---------- 2. Фон скачивания ----------
    function initDownloadBackground() {
        const section = document.getElementById('download-section');
        if (!section) return;

        const gifSources = [
            'images/bg-download-1.webm',
            'images/bg-download-2.webm',
            'images/bg-download-3.webm'
        ];

        if (section.querySelector('.bg-gif-layer')) return;

        const isMobile = window.isMobile === true;

        gifSources.forEach((src, index) => {
            const layer = document.createElement('div');
            layer.className = 'bg-gif-layer' + (index === 0 ? ' active' : '');
            const ext = src.split('.').pop().toLowerCase();
            if (ext === 'webm' || ext === 'mp4') {
                if (!isMobile) {
                    const video = document.createElement('video');
                    video.src = src;
                    video.autoplay = true;
                    video.loop = true;
                    video.muted = true;
                    video.playsInline = true;
                    video.style.width = '100%';
                    video.style.height = '100%';
                    video.style.objectFit = 'cover';
                    layer.appendChild(video);
                }
            } else {
                const img = document.createElement('img');
                img.src = src;
                img.alt = '';
                img.loading = 'lazy';
                layer.appendChild(img);
            }
            section.appendChild(layer);
        });

        const mask = document.createElement('div');
        mask.className = 'bg-gif-mask';
        section.appendChild(mask);

        if (isMobile) return;

        const layers = section.querySelectorAll('.bg-gif-layer');
        let currentIndex = 0;
        setInterval(() => {
            layers[currentIndex].classList.remove('active');
            currentIndex = (currentIndex + 1) % layers.length;
            layers[currentIndex].classList.add('active');
        }, 8000);
    }

    // ---------- 3. Ленивая загрузка видео в .desc-image ----------
    function initDescriptionVideos() {
        const videos = document.querySelectorAll('.desc-image video[data-src]');
        if (videos.length === 0) return;

        const isMobile = window.isMobile === true;

        if (isMobile) {
            videos.forEach(video => {
                video.removeAttribute('src');
                video.querySelectorAll('source').forEach(s => s.remove());
            });
            return;
        }

        if (!('IntersectionObserver' in window)) {
            console.warn('[background-gifs] IntersectionObserver не поддерживается — видео в описании не будут загружены.');
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const video = entry.target;
                if (entry.isIntersecting) {
                    if (!video.dataset.loadedOnce) {
                        const src = video.dataset.src;
                        if (src) {
                            video.src = src;
                            video.preload = 'auto';
                            video.dataset.loadedOnce = 'true';
                            const playPromise = video.play();
                            if (playPromise && typeof playPromise.catch === 'function') {
                                playPromise.catch(() => { /* автоплей может быть запрещён */ });
                            }
                        }
                    } else if (video.paused) {
                        const playPromise = video.play();
                        if (playPromise && typeof playPromise.catch === 'function') {
                            playPromise.catch(() => { /* noop */ });
                        }
                    }
                } else {
                    if (!video.paused) {
                        try { video.pause(); } catch (e) { /* noop */ }
                    }
                }
            });
        }, { rootMargin: '150px', threshold: 0.05 });

        videos.forEach(video => observer.observe(video));

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                videos.forEach(video => {
                    if (!video.paused) {
                        try { video.pause(); } catch (e) { /* noop */ }
                    }
                });
            }
        });
    }

    // ---------- 4. Превью YouTube-плейлистов ----------
    // Ищем .video-preview--youtube[data-playlist-id] с пустым <img>,
    // грузим превью через noembed → allorigins → fallback.
    async function fetchPlaylistThumbnail(playlistId) {
        if (!playlistId) return null;

        // 1. noembed.com (поддерживает YouTube-плейлисты, возвращает thumbnail первого видео)
        try {
            const url = `https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/playlist?list=${playlistId}`)}`;
            const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.thumbnail_url && typeof data.thumbnail_url === 'string') {
                    return data.thumbnail_url;
                }
            }
        } catch (e) { /* noop */ }

        // 2. allorigins — тянем HTML страницы плейлиста, вытаскиваем og:image
        try {
            const url = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://www.youtube.com/playlist?list=${playlistId}`)}`;
            const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (resp.ok) {
                const html = await resp.text();
                // og:image — самый надёжный источник
                const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
                if (ogMatch && ogMatch[1] && ogMatch[1].startsWith('http')) {
                    return ogMatch[1];
                }
                // twitter:image
                const twMatch = html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
                if (twMatch && twMatch[1] && twMatch[1].startsWith('http')) {
                    return twMatch[1];
                }
                // Первый ytimg из JSON-LD или inline-данных
                const ytimgMatch = html.match(/https:\/\/i\.ytimg\.com\/vi\/([a-zA-Z0-9_-]+)\/(?:mq|hq|maxres)default\.jpg/);
                if (ytimgMatch && ytimgMatch[1]) {
                    return `https://i.ytimg.com/vi/${ytimgMatch[1]}/mqdefault.jpg`;
                }
            }
        } catch (e) { /* noop */ }

        return null;
    }

    function initPlaylistThumbnails() {
        const previews = document.querySelectorAll('.video-preview--youtube[data-playlist-id]');
        if (!previews.length) return;

        previews.forEach(async (link) => {
            const img = link.querySelector('img');
            if (!img) return;
            if (img.dataset.thumbProcessed === 'true') return;
            img.dataset.thumbProcessed = 'true';

            const playlistId = link.dataset.playlistId;
            if (!playlistId) return;

            const thumb = await fetchPlaylistThumbnail(playlistId);
            if (thumb) {
                img.src = thumb;
                img.alt = link.getAttribute('aria-label') || 'YouTube playlist';
                img.loading = 'lazy';
                img.onerror = () => { img.style.display = 'none'; };
                img.style.display = '';
            } else {
                // Fallback: скрываем пустой img — останется тёмный фон + play-иконка
                img.style.display = 'none';
            }
        });
    }

    // ---------- Инициализация ----------
    function initAll() {
        initFeatureBanners();
        initDownloadBackground();
        initDescriptionVideos();
        initPlaylistThumbnails();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAll);
    } else {
        initAll();
    }
})();