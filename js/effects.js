// effects.js — 3D tilt, параллакс и динамическое свечение края карточки (только десктоп)
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

function initEdgeGlow(card) {
    if (card.dataset.glowReady) return card.querySelector('.edge-glow'); // уже есть
    card.style.position = 'relative';
    const glow = document.createElement('div');
    glow.className = 'edge-glow';
    glow.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;border-radius:inherit;opacity:0;transition:opacity 0.2s;z-index:1;';
    card.appendChild(glow);
    card.dataset.glowReady = '1';

    const handleMove = throttleAnimation((e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const px = (x / rect.width) * 100;
        const py = (y / rect.height) * 100;
        glow.style.background = `radial-gradient(circle 400px at ${px}% ${py}%, var(--accent-light) 0%, transparent 70%)`;
        glow.style.opacity = '0.6';
    });

    card.addEventListener('mousemove', handleMove);
    card.addEventListener('mouseleave', () => {
        glow.style.opacity = '0';
    });
    return glow;
}

// 3D Tilt для карточек
function initTiltEffect() {
    const cards = document.querySelectorAll('.tilt-card');
    if (cards.length === 0) return;

    cards.forEach(card => {
        // исключаем некоторые внутренние элементы
        if (card.closest('.profile-card') || card.classList.contains('feature-item') ||
            card.classList.contains('update-card') || card.classList.contains('req-item') ||
            card.classList.contains('consumption-card') || card.classList.contains('download-card') ||
            card.classList.contains('features-extra')) return;

        // свечение края
        initEdgeGlow(card);

        const img = card.querySelector('.project-image, .video-thumbnail, .game-icon, .feature-icon');
        const isProfile = card.closest('.profile-card');

        const handleMove = throttleAnimation((e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const rotateX = (y - centerY) / 18;
            const rotateY = (centerX - x) / 18;

            card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.01)`;

            if (img && card.matches('.project-card-link, .project-card') && !isProfile) {
                const imgX = (x - centerX) / 20;
                const imgY = (y - centerY) / 20;
                img.style.transform = `translate(${imgX}px, ${imgY}px) scale(1.03)`;
            }
        });

        card.addEventListener('mousemove', handleMove);
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg) scale(1)';
            if (img && !isProfile) img.style.transform = 'translate(0,0) scale(1)';
        });
    });
}

// Параллакс для шапок игр
function initHeaderParallax() {
    const headers = document.querySelectorAll('.game-header');
    if (headers.length === 0) return;

    headers.forEach(header => {
        const handleMove = throttleAnimation((e) => {
            const rect = header.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            let moveX = (x - centerX) / 25;
            let moveY = (y - centerY) / 25;
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

document.addEventListener('DOMContentLoaded', () => {
    if ('ontouchstart' in window) return;
    initTiltEffect();
    initHeaderParallax();
});