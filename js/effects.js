// js/effects.js — 3D tilt и свечение от курсора (только десктоп)
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

function initGlowEffect() {
    if ('ontouchstart' in window) return; // только десктоп

    const glowCards = document.querySelectorAll('.card, .project-card, .feature-item, .feedback-item, .profile-card, .update-card, .poll');
    glowCards.forEach(card => {
        // базовый стиль для эффекта
        card.style.position = card.style.position || 'relative';

        const handleMove = throttleAnimation((e) => {
            const rect = card.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            card.style.setProperty('--glow-x', `${x}%`);
            card.style.setProperty('--glow-y', `${y}%`);
        });

        const handleLeave = () => {
            card.style.removeProperty('--glow-x');
            card.style.removeProperty('--glow-y');
        };

        card.addEventListener('mousemove', handleMove);
        card.addEventListener('mouseleave', handleLeave);
    });
}

// 3D Tilt для карточек (только на десктопе)
function initTiltEffect() {
    if ('ontouchstart' in window) return;

    const cards = document.querySelectorAll('.tilt-card');
    cards.forEach(card => {
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

        const handleLeave = () => {
            card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
            if (img && !isProfile) {
                img.style.transform = 'translate(0, 0) scale(1)';
            }
        };

        card.addEventListener('mousemove', handleMove);
        card.addEventListener('mouseleave', handleLeave);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initTiltEffect();
    initGlowEffect();
});