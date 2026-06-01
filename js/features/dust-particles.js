// js/features/dust-particles.js
// Фоновые динамические частицы (пылинки) с эффектом случайного блуждания

(function() {
    let canvas, ctx, particles = [];
    let animationId = null;
    let width, height;
    let isEnabled = true;

    // Настройки
    const CONFIG = {
        PARTICLE_COUNT: 120,          // количество частиц
        MIN_RADIUS: 1,
        MAX_RADIUS: 3,
        BASE_SPEED: 0.3,              // базовая скорость
        NOISE_STRENGTH: 0.12,         // сила случайного изменения направления
        MAX_SPEED: 0.7,
        MIN_OPACITY: 0.2,
        MAX_OPACITY: 0.7,
        OPACITY_WAVE_SPEED: 0.005     // скорость мерцания
    };

    // Проверка: если пользователь предпочитает сниженную анимацию – отключаем эффект
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) {
        isEnabled = false;
        return;
    }

    function initCanvas() {
        canvas = document.createElement('canvas');
        canvas.id = 'dust-canvas';
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '-1';
        canvas.style.display = 'block';
        document.body.appendChild(canvas);
        ctx = canvas.getContext('2d');

        window.addEventListener('resize', onResize);
        onResize();
    }

    function onResize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        // Пересоздаём частицы при изменении размера (чтобы заполнить новую область)
        initParticles();
    }

    function randomRange(min, max) {
        return min + Math.random() * (max - min);
    }

    function initParticles() {
        particles = [];
        for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED),
                vy: randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED),
                radius: randomRange(CONFIG.MIN_RADIUS, CONFIG.MAX_RADIUS),
                opacity: randomRange(CONFIG.MIN_OPACITY, CONFIG.MAX_OPACITY),
                opacityPhase: Math.random() * Math.PI * 2, // для мерцания
                lifePhase: Math.random() * Math.PI * 2      // для дополнительной вариации
            });
        }
    }

    function updateParticles() {
        for (let p of particles) {
            // Добавляем случайный "шум" к скорости (броуновское движение)
            p.vx += (Math.random() - 0.5) * CONFIG.NOISE_STRENGTH;
            p.vy += (Math.random() - 0.5) * CONFIG.NOISE_STRENGTH;

            // Ограничиваем максимальную скорость
            let speed = Math.hypot(p.vx, p.vy);
            if (speed > CONFIG.MAX_SPEED) {
                p.vx = (p.vx / speed) * CONFIG.MAX_SPEED;
                p.vy = (p.vy / speed) * CONFIG.MAX_SPEED;
            }

            // Двигаем частицу
            p.x += p.vx;
            p.y += p.vy;

            // Телепортация при выходе за границы (бесконечное поле)
            if (p.x < 0) p.x = width;
            if (p.x > width) p.x = 0;
            if (p.y < 0) p.y = height;
            if (p.y > height) p.y = 0;

            // Мерцание: плавное изменение прозрачности
            p.opacityPhase += CONFIG.OPACITY_WAVE_SPEED;
            const opacityFactor = (Math.sin(p.opacityPhase) + 1) / 2; // от 0 до 1
            p.currentOpacity = CONFIG.MIN_OPACITY + opacityFactor * (CONFIG.MAX_OPACITY - CONFIG.MIN_OPACITY);
        }
    }

    function drawParticles() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        
        for (let p of particles) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            // Цвет частицы – светлый (белый) с текущей прозрачностью
            ctx.fillStyle = `rgba(255, 255, 255, ${p.currentOpacity})`;
            ctx.fill();
            // Небольшое свечение (опционально, но красиво)
            ctx.shadowBlur = p.radius * 1.5;
            ctx.shadowColor = `rgba(100, 200, 220, ${p.currentOpacity * 0.5})`;
            ctx.fill();
        }
        // Сбрасываем тень, чтобы не влиять на последующие кадры
        ctx.shadowBlur = 0;
    }

    function animate() {
        if (!isEnabled) return;
        updateParticles();
        drawParticles();
        animationId = requestAnimationFrame(animate);
    }

    function start() {
        if (!isEnabled) return;
        if (animationId) cancelAnimationFrame(animationId);
        initCanvas();
        animate();
    }

    function stop() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        canvas = null;
        ctx = null;
    }

    // Автозапуск, но с учётом видимости вкладки (экономия ресурсов)
    let visible = true;
    function handleVisibilityChange() {
        if (document.hidden) {
            if (animationId) cancelAnimationFrame(animationId);
            animationId = null;
        } else {
            if (!animationId && isEnabled && canvas) {
                animate();
            }
        }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Запуск после полной загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    // Экспортировать API на случай, если понадобится управление извне
    window.DustParticles = {
        start, stop,
        isEnabled: () => isEnabled
    };
})();