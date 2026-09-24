// js/features/background-gifs.js
// Управление гифками и фоновыми видео:
//   1. Баннеры с плавным появлением (.feature-banner[data-gif]).
//   2. Переключаемый фон скачивания (#download-section).
//   3. Ленивая загрузка видео в .desc-image (описание Starve Neon).
//      - Видео грузятся только когда попадают в viewport.
//      - Проигрывание останавливается, когда видео уходит из viewport.
//      - На мобильных (window.isMobile) видео НЕ грузятся вообще — показывается poster.

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

        // На мобильных не запускаем фоновые видео скачивания
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

        if (isMobile) return; // На мобильных не переключаем слои

        const layers = section.querySelectorAll('.bg-gif-layer');
        let currentIndex = 0;
        setInterval(() => {
            layers[currentIndex].classList.remove('active');
            currentIndex = (currentIndex + 1) % layers.length;
            layers[currentIndex].classList.add('active');
        }, 8000);
    }

    // ---------- 3. Ленивая загрузка видео в .desc-image ----------
    // Видео в описании Starve Neon: не грузятся, пока не видны.
    // На мобильных не грузятся вообще — используется poster.
    function initDescriptionVideos() {
        const videos = document.querySelectorAll('.desc-image video[data-src]');
        if (videos.length === 0) return;

        const isMobile = window.isMobile === true;

        // На мобильных: не загружаем видео вообще. Poster остаётся как фон.
        if (isMobile) {
            videos.forEach(video => {
                // Убеждаемся, что src не установлен
                video.removeAttribute('src');
                // Обнуляем возможные <source> внутри
                video.querySelectorAll('source').forEach(s => s.remove());
            });
            return;
        }

        // Поддержка IntersectionObserver обязательна; при отсутствии — просто ничего не делаем,
        // чтобы не ломать страницу (в этом случае видео останется с poster и без src).
        if (!('IntersectionObserver' in window)) {
            console.warn('[background-gifs] IntersectionObserver не поддерживается — видео в описании не будут загружены.');
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const video = entry.target;
                if (entry.isIntersecting) {
                    // Загружаем и запускаем видео, если оно ещё не загружено
                    if (!video.dataset.loadedOnce) {
                        const src = video.dataset.src;
                        if (src) {
                            video.src = src;
                            video.preload = 'auto';
                            video.dataset.loadedOnce = 'true';
                            const playPromise = video.play();
                            if (playPromise && typeof playPromise.catch === 'function') {
                                playPromise.catch(() => { /* автоплей может быть запрещён политикой браузера */ });
                            }
                        }
                    } else if (video.paused) {
                        const playPromise = video.play();
                        if (playPromise && typeof playPromise.catch === 'function') {
                            playPromise.catch(() => { /* noop */ });
                        }
                    }
                } else {
                    // Останавливаем воспроизведение, когда уходит из viewport
                    if (!video.paused) {
                        try { video.pause(); } catch (e) { /* noop */ }
                    }
                }
            });
        }, { rootMargin: '150px', threshold: 0.05 });

        videos.forEach(video => observer.observe(video));

        // При уходе со страницы останавливаем воспроизведение (экономия ресурсов)
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

    // ---------- Инициализация ----------
    function initAll() {
        initFeatureBanners();
        initDownloadBackground();
        initDescriptionVideos();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAll);
    } else {
        initAll();
    }
})();