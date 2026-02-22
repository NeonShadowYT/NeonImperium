// effects.js — 3D tilt и параллакс для шапок + гироскоп для мобильных

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

// Параллакс на основе гироскопа для мобильных устройств
function initGyroParallax() {
    // Проверяем, что устройство поддерживает ориентацию и это тач-устройство
    if (!('ontouchstart' in window) || !window.DeviceOrientationEvent) return;

    const headers = document.querySelectorAll('.game-header');
    if (headers.length === 0) return;

    // Для iOS 13+ требуется запрос разрешения
    const requestPermission = (typeof DeviceOrientationEvent.requestPermission === 'function');
    
    function startGyro() {
        window.addEventListener('deviceorientation', throttleAnimation((event) => {
            // Используем gamma (влево-вправо) для X, beta (вперёд-назад) для Y
            let gamma = event.gamma || 0; // диапазон от -90 до 90, обычно в играх -30..30
            let beta = event.beta || 0;   // от -180 до 180, для наклона телефона

            // Ограничиваем значения, чтобы смещение не было слишком сильным
            const maxAngle = 30; // градусы
            gamma = Math.max(-maxAngle, Math.min(maxAngle, gamma));
            beta = Math.max(-maxAngle, Math.min(maxAngle, beta));

            // Преобразуем угол в смещение пикселей (макс 20px)
            const maxOffset = 20;
            const moveX = (gamma / maxAngle) * maxOffset;
            const moveY = (beta / maxAngle) * maxOffset;

            headers.forEach(header => {
                header.style.backgroundPosition = `calc(50% + ${moveX}px) calc(50% + ${moveY}px)`;
            });
        }));
    }

    if (requestPermission) {
        // iOS: показываем кнопку или просто запрашиваем разрешение при взаимодействии
        // Здесь мы просто пытаемся запросить разрешение при загрузке (может не сработать без жеста)
        DeviceOrientationEvent.requestPermission()
            .then(response => {
                if (response === 'granted') {
                    startGyro();
                }
            })
            .catch(console.error);
    } else {
        // Android и остальные
        startGyro();
    }
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    const isTouch = 'ontouchstart' in window;
    
    if (!isTouch) {
        // Десктоп: tilt и мышиный параллакс
        initTiltEffect();
        initHeaderParallax();
    } else {
        // Мобильные: гироскоп-параллакс
        initGyroParallax();
    }
});