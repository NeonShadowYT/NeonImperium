// js/features/background-gifs.js
// Управление гифками: баннеры с плавным появлением, переключаемый фон скачивания.

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

        gifSources.forEach((src, index) => {
            const layer = document.createElement('div');
            layer.className = 'bg-gif-layer' + (index === 0 ? ' active' : '');
            const ext = src.split('.').pop().toLowerCase();
            if (ext === 'webm' || ext === 'mp4') {
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

        const layers = section.querySelectorAll('.bg-gif-layer');
        let currentIndex = 0;
        setInterval(() => {
            layers[currentIndex].classList.remove('active');
            currentIndex = (currentIndex + 1) % layers.length;
            layers[currentIndex].classList.add('active');
        }, 8000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initFeatureBanners();
            initDownloadBackground();
        });
    } else {
        initFeatureBanners();
        initDownloadBackground();
    }
})();