// js/features/dust-particles.js
// Фоновые динамические частицы (пылинки) с эффектом случайного блуждания
// Плавное появление, масштабирование при ресайзе без исчезновения

(function() {
    let canvas, ctx, particles = [];
    let animationId = null;
    let width, height;
    let isEnabled = true;

    // Настройки
    const CONFIG = {
        PARTICLE_COUNT: 120,        // увеличено
        MIN_RADIUS: 1.5,
        MAX_RADIUS: 3.5,
        BASE_SPEED: 0.3,
        NOISE_STRENGTH: 0.12,
        MAX_SPEED: 0.7,
        MIN_OPACITY: 0.06,
        MAX_OPACITY: 0.25,
        OPACITY_WAVE_SPEED: 0.005,
        FADE_IN_SPEED: 0.03,
        DENSITY_THRESHOLD: 0.7
    };

    // Акцентный цвет #5ab5c9 (ярче)
    const BASE_R = 90;
    const BASE_G = 181;
    const BASE_B = 201;

    // Проверка на reduced motion
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mediaQuery.matches) {
        isEnabled = false;
        return;
    }

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
        document.body.appendChild(canvas);
        ctx = canvas.getContext('2d');

        window.addEventListener('resize', onResize);
        onResize();
    }

    function onResize() {
        if (!canvas) return;
        const oldWidth = width;
        const oldHeight = height;
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;

        if (oldWidth && oldHeight && particles.length) {
            const scaleX = newWidth / oldWidth;
            const scaleY = newHeight / oldHeight;
            for (const p of particles) {
                p.x *= scaleX;
                p.y *= scaleY;
                p.vx *= scaleX;
                p.vy *= scaleY;
                let speed = Math.hypot(p.vx, p.vy);
                if (speed > CONFIG.MAX_SPEED) {
                    p.vx = (p.vx / speed) * CONFIG.MAX_SPEED;
                    p.vy = (p.vy / speed) * CONFIG.MAX_SPEED;
                }
            }
            const expectedCount = CONFIG.PARTICLE_COUNT;
            const currentCount = particles.length;
            const areaRatio = (newWidth * newHeight) / (oldWidth * oldHeight);
            if (currentCount < expectedCount * CONFIG.DENSITY_THRESHOLD || areaRatio > 1.2) {
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
        const colorFactor = randomRange(0.8, 1.2);
        return {
            x: x !== undefined ? x : Math.random() * width,
            y: y !== undefined ? y : Math.random() * height,
            vx: randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED),
            vy: randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED),
            radius: randomRange(CONFIG.MIN_RADIUS, CONFIG.MAX_RADIUS),
            baseOpacity: randomRange(CONFIG.MIN_OPACITY, CONFIG.MAX_OPACITY),
            opacityPhase: Math.random() * Math.PI * 2,
            fadeProgress: 1,
            colorFactor: colorFactor,
            // Добавляем небольшое мерцание размера
            sizePhase: Math.random() * Math.PI * 2
        };
    }

    function initParticlesFull() {
        particles = [];
        for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
            particles.push(createParticle());
        }
    }

    function updateParticles() {
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];

            // Броуновское движение
            p.vx += (Math.random() - 0.5) * CONFIG.NOISE_STRENGTH;
            p.vy += (Math.random() - 0.5) * CONFIG.NOISE_STRENGTH;

            let speed = Math.hypot(p.vx, p.vy);
            if (speed > CONFIG.MAX_SPEED) {
                p.vx = (p.vx / speed) * CONFIG.MAX_SPEED;
                p.vy = (p.vy / speed) * CONFIG.MAX_SPEED;
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
                p.vx = randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED);
                p.vy = randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED);
                p.opacityPhase = Math.random() * Math.PI * 2;
                p.sizePhase = Math.random() * Math.PI * 2;
                continue;
            }

            if (p.fadeProgress < 1) {
                p.fadeProgress += CONFIG.FADE_IN_SPEED;
                if (p.fadeProgress > 1) p.fadeProgress = 1;
            }

            // Мерцание прозрачности
            p.opacityPhase += CONFIG.OPACITY_WAVE_SPEED;
            const opacityFactor = (Math.sin(p.opacityPhase) + 1) / 2;
            const wave = 0.6 + 0.4 * opacityFactor;
            let targetOpacity = p.baseOpacity * p.fadeProgress * wave;
            p.currentOpacity = targetOpacity;

            // Мерцание размера (небольшое)
            p.sizePhase += 0.02;
            const sizeWave = 1 + 0.15 * Math.sin(p.sizePhase);
            p.currentRadius = p.radius * sizeWave;
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
            ctx.arc(p.x, p.y, p.currentRadius || p.radius, 0, Math.PI * 2);
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

    window.DustParticles = { start, stop, isEnabled: () => isEnabled };
})();