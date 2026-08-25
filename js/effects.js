// effects.js — 3D tilt, параллакс для шапок и эффект "жидкого стекла" (только десктоп)

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

// 3D Tilt для карточек (только на десктопе)
function initTiltEffect() {
    const cards = document.querySelectorAll('.tilt-card');
    if (cards.length === 0) return;

    cards.forEach(card => {
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
        
        card.addEventListener('mousemove', handleMove);
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
            if (img && !isProfile) {
                img.style.transform = 'translate(0, 0) scale(1)';
            }
        });
    });
}

// Параллакс для шапок игр (на десктопе)
function initHeaderParallax() {
    const headers = document.querySelectorAll('.game-header');
    if (headers.length === 0) return;

    let scrollTimer = null;

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
    });

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
        
        header.addEventListener('mousemove', handleMove);
        header.addEventListener('mouseleave', () => {
            header.style.backgroundPosition = 'center';
        });
    });
}

// НОВАЯ ФУНКЦИЯ: эффект "жидкого стекла" – обновляем CSS-переменные для карточек
function initGlassEffect() {
    // Селекторы карточек, на которые будет действовать эффект
    const selectors = [
        '.card', '.project-card', '.desc-block', '.req-item',
        '.consumption-card', '.feedback-item', '.update-card',
        '.feature-item', '.trailer-card', '.developer-card',
        '.download-card', '.license-section-card', '.license-hero'
    ];
    const selectorString = selectors.join(', ');

    // Функция обновления переменных для элемента
    function updateGlassVariables(e) {
        const target = e.target.closest(selectorString);
        if (!target) {
            // Если мышь не над карточкой, можно сбросить переменные на body (опционально)
            // Но лучше ничего не делать, чтобы не было миганий
            return;
        }
        const rect = target.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        target.style.setProperty('--mouse-x', x + '%');
        target.style.setProperty('--mouse-y', y + '%');
    }

    // Throttled версия
    const throttledUpdate = throttleAnimation(updateGlassVariables);

    // Добавляем обработчик на документ, но только если поддерживается pointer-events
    document.addEventListener('mousemove', throttledUpdate);
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    const isTouch = 'ontouchstart' in window;
    
    if (!isTouch) {
        initTiltEffect();
        initHeaderParallax();
        initGlassEffect(); // добавляем новый эффект
    }
});