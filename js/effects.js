// effects.js — 3D tilt и параллакс для шапок (только десктоп)

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
    // Используем глобальную isMobile (установлена в config.js/common-init)
    if (window.isMobile) return;

    const cards = document.querySelectorAll('.tilt-card');
    if (cards.length === 0) return;

    cards.forEach(card => {
        // Карточки, у которых уже есть собственный сложный hover-эффект,
        // не трогаем — иначе получаются визуальные глюки.
        if (card.classList.contains('feature-item') ||
            card.classList.contains('update-card') ||
            card.classList.contains('req-item') ||
            card.classList.contains('consumption-card') ||
            card.classList.contains('download-card') ||
            card.classList.contains('features-extra')) return;

        // ГЛАВНОЕ: если внутри есть .project-card (типичная структура
        // <a class="project-card-link tilt-card"><div class="project-card">...),
        // крутим именно внутренний .project-card — он несёт всю визуальную
        // нагрузку (фон, границы, тени). Иначе 3D-поворот внешнего <a>
        // уходит «в пустоту» и визуально не виден.
        const innerCard = card.querySelector(':scope > .project-card');
        const tiltTarget = innerCard || card;

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

            // !important через setProperty — гарантированно побеждает
            // любые CSS-правила вроде .project-card-link:hover .project-card.
            tiltTarget.style.setProperty(
                'transform',
                `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`,
                'important'
            );

            if (img && !isProfile && !card.classList.contains('feature-item') && !card.classList.contains('update-card')) {
                const imgX = (x - centerX) / 25;
                const imgY = (y - centerY) / 25;
                img.style.transform = `translate(${imgX}px, ${imgY}px) scale(1.03)`;
            }
        });

        card.addEventListener('mousemove', handleMove);
        card.addEventListener('mouseleave', () => {
            // removeProperty — CSS-правила снова применяются,
            // hover-эффект `.project-card-link:hover .project-card`
            // плавно возвращает карточку на место.
            tiltTarget.style.removeProperty('transform');
            if (img && !isProfile) {
                img.style.removeProperty('transform');
            }
        });
    });
}

// Параллакс для шапок игр (на десктопе) — исправлен сброс при скролле
function initHeaderParallax() {
    if (window.isMobile) return;

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

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    if (!window.isMobile) {
        initTiltEffect();
        initHeaderParallax();
    }
});