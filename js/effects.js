// effects.js — 3D tilt, параллакс и анимация появления при скролле

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

// Новая функция: анимация появления при скролле (для элементов .fade-up)
function initScrollAnimations() {
    const fadeElements = document.querySelectorAll('.fade-up');
    if (fadeElements.length === 0) return;

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
        fadeElements.forEach(el => observer.observe(el));
    } else {
        // Fallback: показываем сразу
        fadeElements.forEach(el => el.classList.add('visible'));
    }
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    const isTouch = 'ontouchstart' in window;
    
    if (!isTouch) {
        initTiltEffect();
        initHeaderParallax();
    }
    
    // Всегда запускаем анимацию появления
    initScrollAnimations();
});