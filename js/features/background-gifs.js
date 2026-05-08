// js/features/background-gifs.js
// Управление гифками: баннеры в карточках и переключаемый фон в секции скачивания

(function() {
    // ---------- 1. Замена эмодзи на гифки в feature-карточках ----------
    function initFeatureBanners() {
        document.querySelectorAll('.feature-banner[data-gif]').forEach(container => {
            const gifSrc = container.dataset.gif;
            const fallbackEmoji = container.dataset.fallbackEmoji || '';
            // Очищаем контейнер
            container.innerHTML = '';
            // Создаём <img> с гифкой
            const img = document.createElement('img');
            img.src = gifSrc;
            img.alt = '';
            img.loading = 'lazy';
            img.onerror = function() {
                // Если гифка не загрузилась – показываем эмодзи
                container.innerHTML = `<span class="fallback-emoji">${fallbackEmoji}</span>`;
            };
            container.appendChild(img);
        });
    }

    // ---------- 2. Переключаемый фон в download-card ----------
    function initDownloadBackground() {
        const section = document.getElementById('download-section');
        if (!section) return;

        // Массив гифок, которые будут циклически сменяться
        const gifSources = [
            'images/bg-download-1.webp',   // замените на свои
            'images/bg-download-2.webp',
            'images/bg-download-3.webp'
        ];

        // Если уже есть слои – не дублируем
        if (section.querySelector('.bg-gif-layer')) return;

        // Создаём слои
        gifSources.forEach((src, index) => {
            const layer = document.createElement('div');
            layer.className = 'bg-gif-layer' + (index === 0 ? ' active' : '');
            const img = document.createElement('img');
            img.src = src;
            img.alt = '';
            img.loading = 'lazy';
            layer.appendChild(img);
            section.appendChild(layer);
        });

        // Маска с градиентом
        const mask = document.createElement('div');
        mask.className = 'bg-gif-mask';
        section.appendChild(mask);

        // Запускаем циклическую смену каждые 8 секунд
        const layers = section.querySelectorAll('.bg-gif-layer');
        let currentIndex = 0;
        setInterval(() => {
            layers[currentIndex].classList.remove('active');
            currentIndex = (currentIndex + 1) % layers.length;
            layers[currentIndex].classList.add('active');
        }, 8000);
    }

    // ---------- Инициализация после загрузки DOM ----------
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