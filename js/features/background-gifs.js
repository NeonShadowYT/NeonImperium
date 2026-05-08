// js/features/background-gifs.js
// Управление гифками: баннеры в карточках и переключаемый фон в секции скачивания

(function() {
    // ---------- 1. Замена эмодзи на гифки в feature-карточках ----------
    function initFeatureBanners() {
        document.querySelectorAll('.feature-banner[data-gif]').forEach(container => {
            const gifSrc = container.dataset.gif;
            const fallbackEmoji = container.dataset.fallbackEmoji || '';
            const ext = gifSrc.split('.').pop().toLowerCase();
            container.innerHTML = '';

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
                });
                container.appendChild(video);
            } else {
                const img = document.createElement('img');
                img.src = gifSrc;
                img.alt = '';
                img.loading = 'lazy';
                img.onerror = () => {
                    container.innerHTML = `<span class="fallback-emoji">${fallbackEmoji}</span>`;
                };
                container.appendChild(img);
            }
        });
    }

    // ---------- 2. Переключаемый фон в download-card ----------
    function initDownloadBackground() {
        const section = document.getElementById('download-section');
        if (!section) return;

        const gifSources = [
            'images/bg-download-1.webm',   // замените на свои файлы
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