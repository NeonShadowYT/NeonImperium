// effects.js — 3D tilt и параллакс для шапок

// Простой throttle через requestAnimationFrame
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

// 3D Tilt для карточек (кроме шапок)
function initTiltEffect() {
    const cards = document.querySelectorAll('.tilt-card');
    if (cards.length === 0) return;

    cards.forEach(card => {
        // Пропускаем карточки, для которых tilt слишком сильный (они обрабатываются через CSS)
        if (card.classList.contains('feature-item') ||
            card.classList.contains('update-card') ||
            card.classList.contains('req-item') ||
            card.classList.contains('consumption-card') ||
            card.classList.contains('download-card') ||
            card.classList.contains('features-extra')) return;
        
        const img = card.querySelector('.project-image, .avatar, .video-thumbnail, .game-icon, .feature-icon');
        
        const handleMove = throttleAnimation((e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const rotateX = (y - centerY) / 20;
            const rotateY = (centerX - x) / 20;
            
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.01)`;
            
            if (img && !card.classList.contains('feature-item') && !card.classList.contains('update-card')) {
                const imgX = (x - centerX) / 25;
                const imgY = (y - centerY) / 25;
                // Увеличиваем scale для лучшего заполнения при смещении
                img.style.transform = `translate(${imgX}px, ${imgY}px) scale(1.05)`;
            }
        });
        
        card.addEventListener('mousemove', handleMove);
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
            if (img) {
                img.style.transform = 'translate(0, 0) scale(1)';
            }
        });
    });
}

// Параллакс для шапок игр (отдельно, без tilt-card)
function initHeaderParallax() {
    const headers = document.querySelectorAll('.game-header');
    if (headers.length === 0) return;

    // Отключаем на тач-устройствах
    if ('ontouchstart' in window) return;

    headers.forEach(header => {
        // Сохраняем исходный background-size
        const originalSize = 'cover';
        
        const handleMove = throttleAnimation((e) => {
            const rect = header.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const moveX = (x - centerX) / 30;
            const moveY = (y - centerY) / 30;
            
            // Увеличиваем размер фона, чтобы избежать видимости краёв
            header.style.backgroundSize = '110%';
            header.style.backgroundPosition = `calc(50% + ${moveX}px) calc(50% + ${moveY}px)`;
        });
        
        header.addEventListener('mousemove', handleMove);
        
        header.addEventListener('mouseleave', () => {
            header.style.backgroundSize = originalSize;
            header.style.backgroundPosition = 'center';
        });
    });
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    // Отключаем на тач-устройствах
    if ('ontouchstart' in window) return;
    
    initTiltEffect();
    initHeaderParallax();
});