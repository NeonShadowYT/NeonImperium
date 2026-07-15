// js/card-video.js – управление видео-трейлерами в карточках проектов
(function() {
    // Функция для инициализации видео-карточек
    function initVideoCards() {
        const cards = document.querySelectorAll('.project-card.video-card');
        if (cards.length === 0) return;

        // Используем Intersection Observer для ленивой загрузки iframe
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const card = entry.target;
                    const videoId = card.dataset.videoId;
                    if (videoId && !card.dataset.loaded) {
                        const iframe = card.querySelector('.video-container iframe');
                        if (iframe) {
                            // Добавляем параметры для автовоспроизведения при наведении
                            // но сначала ставим src без autoplay, чтобы не грузить сразу
                            iframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&modestbranding=1`;
                            card.dataset.loaded = 'true';
                            // При наведении добавим autoplay
                            card.addEventListener('mouseenter', function() {
                                const iframe = this.querySelector('.video-container iframe');
                                if (iframe && iframe.src) {
                                    // Добавляем autoplay=1 к src
                                    if (!iframe.src.includes('autoplay=1')) {
                                        iframe.src = iframe.src + '&autoplay=1&mute=1';
                                    }
                                }
                            });
                            // При уходе мыши убираем autoplay (но не останавливаем видео)
                            card.addEventListener('mouseleave', function() {
                                const iframe = this.querySelector('.video-container iframe');
                                if (iframe && iframe.src && iframe.src.includes('autoplay=1')) {
                                    // Убираем autoplay, чтобы при следующем наведении видео запускалось заново
                                    iframe.src = iframe.src.replace('&autoplay=1&mute=1', '');
                                }
                            });
                        }
                    }
                    observer.unobserve(card);
                }
            });
        }, { rootMargin: '200px' });

        cards.forEach(card => observer.observe(card));
    }

    // Инициализация при загрузке DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initVideoCards);
    } else {
        initVideoCards();
    }

    // Переинициализация после подгрузки динамического контента (например, новости)
    window.initVideoCards = initVideoCards;
})();