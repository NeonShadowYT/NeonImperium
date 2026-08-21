// effects.js — 3D tilt и параллакс для шапок (только десктоп, с учётом prefers-reduced-motion)

// Утилита для тротлинга через requestAnimationFrame (без изменений)
function throttleAnimation(fn) {
    let running = false;
    return function(e) {
        if (running) return;
        running = true;
        requestAnimationFrame(() => {
            fn(e);
            running = false;
        });
    };
}

// Проверка, нужно ли включать эффекты
function shouldEnableEffects() {
    // Отключаем при prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    // Отключаем на сенсорных устройствах (мобильные/планшеты)
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return false;
    // Опционально: отключаем на слабых устройствах (например, малом числе ядер)
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) return false;
    return true;
}

const effectsEnabled = shouldEnableEffects();

// 3D Tilt для карточек (только если эффекты разрешены)
function initTiltEffect() {
    if (!effectsEnabled) return;
    const cards = document.querySelectorAll('.tilt-card');
    if (cards.length === 0) return;

    cards.forEach(card => {
        // Исключаем элементы, где tilt не нужен
        if (card.classList.contains('feature-item') ||
            card.classList.contains('update-card') ||
            card.classList.contains('req-item') ||
            card.classList.contains('consumption-card') ||
            card.classList.contains('download-card') ||
            card.classList.contains('features-extra')) return;
        
        const img = card.querySelector('.project-image, .video-thumbnail, .game-icon, .feature-icon');
        const isProfile = card.closest('.profile-card') || card.classList.contains('profile-card');
        
        const handleMove = throttleAnimation((e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const rotateX = (y - centerY) / 20;
            const rotateY = (centerX - x) / 20;
            
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
            
            if (img && !isProfile && !card.classList.contains('feature-item') && !card.classList.contains('update-card')) {
                const imgX = (x - centerX) / 25;
                const imgY = (y - centerY) / 25;
                img.style.transform = `translate(${imgX}px, ${imgY}px) scale(1.03)`;
            }
        });
        
        // Добавляем passive: true для улучшения производительности скролла (mousemove не блокирует)
        card.addEventListener('mousemove', handleMove, { passive: true });
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
            if (img && !isProfile) {
                img.style.transform = 'translate(0, 0) scale(1)';
            }
        }, { passive: true });
    });
}

// Параллакс для шапок игр (только десктоп)
function initHeaderParallax() {
    if (!effectsEnabled) return;
    const headers = document.querySelectorAll('.game-header');
    if (headers.length === 0) return;

    let scrollTimer = null;

    // Сброс позиции при скролле с debounce
    window.addEventListener('scroll', function() {
        if (scrollTimer) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(function() {
            headers.forEach(header => {
                header.style.backgroundPosition = '';
                header.style.backgroundSize = '';
                header.style.backgroundSize = '110%';
                header.style.backgroundPosition = 'center';
            });
        }, 100);
    }, { passive: true }); // passive: true

    headers.forEach(header => {
        const handleMove = throttleAnimation((e) => {
            const rect = header.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            let moveX = (x - centerX) / 30;
            let moveY = (y - centerY) / 30;
            const maxOffset = 20;
            moveX = Math.max(-maxOffset, Math.min(maxOffset, moveX));
            moveY = Math.max(-maxOffset, Math.min(maxOffset, moveY));
            
            header.style.backgroundPosition = `calc(50% + ${moveX}px) calc(50% + ${moveY}px)`;
        });
        
        header.addEventListener('mousemove', handleMove, { passive: true });
        header.addEventListener('mouseleave', () => {
            header.style.backgroundPosition = 'center';
        }, { passive: true });
    });
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    // Проверка уже выполнена в shouldEnableEffects, но для надёжности дублируем
    if (effectsEnabled) {
        initTiltEffect();
        initHeaderParallax();
    }
});