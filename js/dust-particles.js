// js/features/dust-particles.js
// Фоновые динамические частицы (пылинки) с адаптивной производительностью

(function() {
    let canvas, ctx, particles = [];
    let animationId = null;
    let width, height;
    let isEnabled = true;

    // Проверка prefers-reduced-motion
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) {
        isEnabled = false;
        return;
    }

    // === Адаптивные настройки ===
    // Определяем, мобильное ли устройство (ширина < 768 или touch)
    const isMobile = window.innerWidth < 768 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    // Учитываем количество ядер (если доступно)
    const cores = navigator.hardwareConcurrency || 4;
    const isLowPerf = cores < 4;

    // Базовое количество частиц
    let PARTICLE_COUNT = isMobile ? 30 : (isLowPerf ? 40 : 80);
    // Для очень слабых устройств уменьшаем ещё
    if (isMobile && isLowPerf) PARTICLE_COUNT = 20;

    // Радиусы
    const MIN_RADIUS = isMobile ? 0.8 : 1;
    const MAX_RADIUS = isMobile ? 1.8 : 2.5;

    // Скорости
    const BASE_SPEED = isMobile ? 0.15 : 0.25;
    const NOISE_STRENGTH = isMobile ? 0.04 : 0.08;
    const MAX_SPEED = isMobile ? 0.4 : 0.6;

    // Прозрачность
    const MIN_OPACITY = 0.02;
    const MAX_OPACITY = isMobile ? 0.12 : 0.18;
    const OPACITY_WAVE_SPEED = 0.003;
    const FADE_IN_SPEED = 0.02;

    // Максимальная ширина/высота канваса для уменьшения разрешения на мобильных
    const MAX_CANVAS_WIDTH = isMobile ? 800 : 1600;
    const MAX_CANVAS_HEIGHT = isMobile ? 600 : 1200;

    // Акцентный цвет #3d9eb3
    const BASE_R = 61;
    const BASE_G = 158;
    const BASE_B = 179;

    function initCanvas() {
        if (canvas) return;
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
        // will-change для GPU-ускорения
        canvas.style.willChange = 'transform';
        document.body.appendChild(canvas);
        ctx = canvas.getContext('2d');

        window.addEventListener('resize', onResize, { passive: true });
        onResize();
    }

    function onResize() {
        if (!canvas) return;
        const oldWidth = width;
        const oldHeight = height;

        // Ограничиваем размер канваса для экономии памяти
        let newWidth = window.innerWidth;
        let newHeight = window.innerHeight;
        if (newWidth > MAX_CANVAS_WIDTH) newWidth = MAX_CANVAS_WIDTH;
        if (newHeight > MAX_CANVAS_HEIGHT) newHeight = MAX_CANVAS_HEIGHT;

        if (oldWidth && oldHeight && particles.length) {
            const scaleX = newWidth / oldWidth;
            const scaleY = newHeight / oldHeight;
            for (const p of particles) {
                p.x *= scaleX;
                p.y *= scaleY;
                p.vx *= scaleX;
                p.vy *= scaleY;
                let speed = Math.hypot(p.vx, p.vy);
                if (speed > MAX_SPEED) {
                    p.vx = (p.vx / speed) * MAX_SPEED;
                    p.vy = (p.vy / speed) * MAX_SPEED;
                }
            }
            // Если после ресайза частиц стало слишком мало, добавляем
            const expectedCount = PARTICLE_COUNT;
            const currentCount = particles.length;
            if (currentCount < expectedCount * 0.7) {
                const needed = Math.min(expectedCount - currentCount, Math.floor(expectedCount * 0.3));
                for (let i = 0; i < needed; i++) {
                    particles.push(createParticle(
                        Math.random() * newWidth,
                        Math.random() * newHeight
                    ));
                }
            }
        } else {
            width = newWidth;
            height = newHeight;
            canvas.width = width;
            canvas.height = height;
            initParticlesFull();
            return;
        }

        width = newWidth;
        height = newHeight;
        canvas.width = width;
        canvas.height = height;
    }

    function randomRange(min, max) {
        return min + Math.random() * (max - min);
    }

    function createParticle(x, y) {
        const colorFactor = randomRange(0.7, 1.3);
        return {
            x: x !== undefined ? x : Math.random() * width,
            y: y !== undefined ? y : Math.random() * height,
            vx: randomRange(-BASE_SPEED, BASE_SPEED),
            vy: randomRange(-BASE_SPEED, BASE_SPEED),
            radius: randomRange(MIN_RADIUS, MAX_RADIUS),
            baseOpacity: randomRange(MIN_OPACITY, MAX_OPACITY),
            opacityPhase: Math.random() * Math.PI * 2,
            fadeProgress: 1,
            colorFactor: colorFactor,
            currentOpacity: 0
        };
    }

    function initParticlesFull() {
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push(createParticle());
        }
    }

    function updateParticles() {
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];

            p.vx += (Math.random() - 0.5) * NOISE_STRENGTH;
            p.vy += (Math.random() - 0.5) * NOISE_STRENGTH;

            let speed = Math.hypot(p.vx, p.vy);
            if (speed > MAX_SPEED) {
                p.vx = (p.vx / speed) * MAX_SPEED;
                p.vy = (p.vy / speed) * MAX_SPEED;
            }

            p.x += p.vx;
            p.y += p.vy;

            let respawn = false;
            if (p.x < 0) { p.x = width; respawn = true; }
            if (p.x > width) { p.x = 0; respawn = true; }
            if (p.y < 0) { p.y = height; respawn = true; }
            if (p.y > height) { p.y = 0; respawn = true; }

            if (respawn) {
                p.fadeProgress = 0;
                p.vx = randomRange(-BASE_SPEED, BASE_SPEED);
                p.vy = randomRange(-BASE_SPEED, BASE_SPEED);
                p.opacityPhase = Math.random() * Math.PI * 2;
                continue;
            }

            if (p.fadeProgress < 1) {
                p.fadeProgress += FADE_IN_SPEED;
                if (p.fadeProgress > 1) p.fadeProgress = 1;
            }

            p.opacityPhase += OPACITY_WAVE_SPEED;
            const opacityFactor = (Math.sin(p.opacityPhase) + 1) / 2;
            const wave = 0.6 + 0.4 * opacityFactor;
            p.currentOpacity = p.baseOpacity * p.fadeProgress * wave;
        }
    }

    function drawParticles() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        ctx.shadowBlur = 0;

        for (const p of particles) {
            if (p.currentOpacity <= 0.001) continue;

            const r = Math.min(255, Math.floor(BASE_R * p.colorFactor));
            const g = Math.min(255, Math.floor(BASE_G * p.colorFactor));
            const b = Math.min(255, Math.floor(BASE_B * p.colorFactor));
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.currentOpacity})`;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
        }
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

    function handleVisibilityChange() {
        if (document.hidden) {
            if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
            }
        } else {
            if (!animationId && isEnabled && canvas) {
                animate();
            }
        }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    // Экспортируем API для возможного ручного управления
    window.DustParticles = { start, stop, isEnabled: () => isEnabled };
})();