// js/features/effects.js
(function() {
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

    function initTiltEffect() {
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
                if (img && !isProfile) {
                    const imgX = (x - centerX) / 25;
                    const imgY = (y - centerY) / 25;
                    img.style.transform = `translate(${imgX}px, ${imgY}px) scale(1.03)`;
                }
            });
            card.addEventListener('mousemove', handleMove);
            card.addEventListener('mouseleave', () => {
                card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
                if (img && !isProfile) img.style.transform = 'translate(0, 0) scale(1)';
            });
        });
    }

    function initHeaderParallax() {
        const headers = document.querySelectorAll('.game-header');
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
            header.addEventListener('mouseleave', () => header.style.backgroundPosition = 'center');
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        if ('ontouchstart' in window) return;
        initTiltEffect();
        initHeaderParallax();
    });
})();