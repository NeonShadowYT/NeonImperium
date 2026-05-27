// js/dust-particles.js – динамические летающие частицы с быстрым движением и респауном
(function() {
    let canvas, ctx, particles = [];
    let animationId = null;
    let width, height;
    let lastTimestamp = 0;
    let deltaTime = 0;

    // === НАСТРОЙКИ (быстрое движение, заметный респаун) ===
    const PARTICLE_COUNT = 150;            // уменьшено для производительности
    const BASE_SIZE = 1.0;
    const SIZE_VARIATION = 2.2;           // от 1 до 3.2 px
    const OPACITY_BASE = 0.15;
    const OPACITY_VARIATION = 0.35;        // прозрачность 0.15..0.5

    // Скорость изменения угла (радиан в секунду)
    const ANGULAR_SPEED_MIN = 1.2;         // быстрое вращение
    const ANGULAR_SPEED_MAX = 3.5;

    // Радиус колебаний (пиксели) – очень большой, чтобы частицы далеко улетали
    const RADIUS_MIN = 80;
    const RADIUS_MAX = 250;

    // Цвета
    const COLORS = [
        'rgba(61, 158, 179, ',   // акцентный
        'rgba(200, 220, 240, ', // светлый
        'rgba(255, 255, 255, '  // белый
    ];

    function initCanvas() {
        canvas = document.createElement('canvas');
        canvas.id = 'dust-canvas';
        ctx = canvas.getContext('2d');

        Object.assign(canvas.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '0',
            display: 'block'
        });

        document.body.insertBefore(canvas, document.body.firstChild);

        const page = document.querySelector('.page');
        if (page) {
            page.style.position = 'relative';
            page.style.zIndex = '1';
        }

        window.addEventListener('resize', onResize);
        onResize();
        startAnimation();
        console.log('[Dust] initialized, particles:', PARTICLE_COUNT);
    }

    function onResize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        initParticles();
    }

    function initParticles() {
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
                // Базовая позиция – случайная точка на экране
                baseX: Math.random() * width,
                baseY: Math.random() * height,
                // Углы и скорости вращения
                angleX: Math.random() * Math.PI * 2,
                angleY: Math.random() * Math.PI * 2,
                speedX: ANGULAR_SPEED_MIN + Math.random() * (ANGULAR_SPEED_MAX - ANGULAR_SPEED_MIN),
                speedY: ANGULAR_SPEED_MIN + Math.random() * (ANGULAR_SPEED_MAX - ANGULAR_SPEED_MIN),
                // Радиусы движения
                radiusX: RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN),
                radiusY: RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN),
                // Размер и прозрачность
                size: BASE_SIZE + Math.random() * SIZE_VARIATION,
                opacity: OPACITY_BASE + Math.random() * OPACITY_VARIATION,
                colorIdx: Math.floor(Math.random() * COLORS.length),
                phase: Math.random() * Math.PI * 2,
                // Флаг, нужно ли респаунить
                respawn: false
            });
        }
    }

    // Респаун частицы – телепортация в новую позицию (на противоположную сторону или случайно)
    function respawnParticle(p) {
        // 70% – противоположная сторона, 30% – случайная позиция
        if (Math.random() < 0.7) {
            p.baseX = (p.baseX < 0) ? width + 20 : (p.baseX > width ? -20 : p.baseX);
            p.baseY = (p.baseY < 0) ? height + 20 : (p.baseY > height ? -20 : p.baseY);
        } else {
            p.baseX = Math.random() * width;
            p.baseY = Math.random() * height;
        }
        // Сбросить углы и фазу, чтобы траектория изменилась
        p.angleX = Math.random() * Math.PI * 2;
        p.angleY = Math.random() * Math.PI * 2;
        p.phase = Math.random() * Math.PI * 2;
        p.speedX = ANGULAR_SPEED_MIN + Math.random() * (ANGULAR_SPEED_MAX - ANGULAR_SPEED_MIN);
        p.speedY = ANGULAR_SPEED_MIN + Math.random() * (ANGULAR_SPEED_MAX - ANGULAR_SPEED_MIN);
        p.radiusX = RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN);
        p.radiusY = RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN);
        p.opacity = OPACITY_BASE + Math.random() * OPACITY_VARIATION;
    }

    function drawParticles(nowSec) {
        if (!ctx || width === 0 || height === 0) return;
        ctx.clearRect(0, 0, width, height);

        for (let p of particles) {
            // Вычисляем смещение по синусоиде с быстрым изменением угла
            let offsetX = Math.sin(p.angleX + nowSec * p.speedX) * p.radiusX;
            let offsetY = Math.cos(p.angleY + nowSec * p.speedY + p.phase) * p.radiusY;

            let x = p.baseX + offsetX;
            let y = p.baseY + offsetY;

            // Затухание при приближении к краю (0..1)
            let edgeFade = 1.0;
            const fadeZone = 50; // зона затухания 50px от края
            if (x < fadeZone) edgeFade *= x / fadeZone;
            if (x > width - fadeZone) edgeFade *= (width - x) / fadeZone;
            if (y < fadeZone) edgeFade *= y / fadeZone;
            if (y > height - fadeZone) edgeFade *= (height - y) / fadeZone;

            // Если частица совсем ушла за пределы (или крайнее затухание), респауним
            if (edgeFade <= 0.05 || x < -200 || x > width + 200 || y < -200 || y > height + 200) {
                respawnParticle(p);
                // Пересчитываем позицию после респауна
                offsetX = Math.sin(p.angleX + nowSec * p.speedX) * p.radiusX;
                offsetY = Math.cos(p.angleY + nowSec * p.speedY + p.phase) * p.radiusY;
                x = p.baseX + offsetX;
                y = p.baseY + offsetY;
                edgeFade = 1.0;
            }

            const finalOpacity = p.opacity * edgeFade;
            if (finalOpacity <= 0.02) continue;

            ctx.beginPath();
            ctx.arc(x, y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = COLORS[p.colorIdx] + finalOpacity + ')';
            ctx.fill();

            // Свечение для крупных частиц
            if (p.size > 1.8 && finalOpacity > 0.2) {
                ctx.shadowBlur = 8;
                ctx.shadowColor = 'rgba(61, 158, 179, 0.7)';
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }
    }

    let animationTime = 0;
    function animate(nowMs) {
        if (!animationId) return;
        // Переводим в секунды для независимости от частоты кадров
        animationTime += 0.025; // плавное увеличение времени
        drawParticles(animationTime);
        animationId = requestAnimationFrame(animate);
    }

    function startAnimation() {
        if (animationId) cancelAnimationFrame(animationId);
        animationTime = 0;
        animate();
    }

    function stopAnimation() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }

    function handleVisibilityChange() {
        if (document.hidden) {
            if (animationId) cancelAnimationFrame(animationId);
            animationId = null;
        } else {
            if (!animationId) startAnimation();
        }
    }

    // Запуск
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCanvas);
    } else {
        initCanvas();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', () => {
        if (animationId) cancelAnimationFrame(animationId);
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    });
})();