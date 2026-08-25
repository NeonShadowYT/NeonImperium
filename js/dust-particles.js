// js/features/dust-particles.js
// Фоновые динамические частицы (пылинки + редкие звёздочки) с эффектом случайного блуждания.
// Звёздочки имеют тусклый голубовато-серый цвет и малую яркость.
// На мобильных устройствах отключаются (проверка window.isMobile).

(function() {
    // Проверяем, мобильное устройство (глобальная переменная, установленная в common-init)
    if (window.isMobile) {
        console.log('[DustParticles] Disabled on mobile');
        return;
    }

    let canvas, ctx, particles = [];
    let animationId = null;
    let width, height;
    let isEnabled = true;

    // Настройки
    const CONFIG = {
        PARTICLE_COUNT: 80,
        MIN_RADIUS: 1,
        MAX_RADIUS: 2.5,
        BASE_SPEED: 0.25,
        NOISE_STRENGTH: 0.08,
        MAX_SPEED: 0.6,
        MIN_OPACITY: 0.04,
        MAX_OPACITY: 0.18,
        OPACITY_WAVE_SPEED: 0.003,
        FADE_IN_SPEED: 0.02,
        DENSITY_THRESHOLD: 0.7,

        // Настройки звёздочек – теперь очень тусклые
        STAR_RATIO: 0.08,
        STAR_RADIUS_MIN: 2.5,
        STAR_RADIUS_MAX: 4,
        STAR_CYCLE_DURATION: 15000,
        STAR_DIM_DURATION: 5000,
        STAR_TWINKLE_SPEED: 0.02,
        STAR_BRIGHTNESS_MAX: 0.25,   // была 0.9
        STAR_BRIGHTNESS_MIN: 0.08    // была 0.3
    };

    // Акцентный цвет #3d9eb3 (для пылинок)
    const BASE_R = 61;
    const BASE_G = 158;
    const BASE_B = 179;

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

    function createParticle(x, y, isStar = false) {
        const colorFactor = randomRange(0.7, 1.3);
        return {
            x: x !== undefined ? x : Math.random() * width,
            y: y !== undefined ? y : Math.random() * height,
            vx: randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED),
            vy: randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED),
            radius: isStar
                ? randomRange(CONFIG.STAR_RADIUS_MIN, CONFIG.STAR_RADIUS_MAX)
                : randomRange(CONFIG.MIN_RADIUS, CONFIG.MAX_RADIUS),
            baseOpacity: isStar
                ? randomRange(CONFIG.STAR_BRIGHTNESS_MIN, CONFIG.STAR_BRIGHTNESS_MAX)
                : randomRange(CONFIG.MIN_OPACITY, CONFIG.MAX_OPACITY),
            opacityPhase: Math.random() * Math.PI * 2,
            fadeProgress: 1,
            colorFactor: colorFactor,
            isStar: isStar || false,
            starPhase: Math.random(),
            starTimer: 0,
            currentRadius: 0,
            currentOpacity: 0
        };
    }

    function initParticlesFull() {
        particles = [];
        const total = CONFIG.PARTICLE_COUNT;
        const starCount = Math.floor(total * CONFIG.STAR_RATIO);
        for (let i = 0; i < total; i++) {
            const isStar = i < starCount;
            particles.push(createParticle(undefined, undefined, isStar));
        }
        for (let i = particles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [particles[i], particles[j]] = [particles[j], particles[i]];
        }
    }

    function updateParticles() {
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];

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
                if (p.isStar) {
                    p.starPhase = Math.random();
                    p.starTimer = 0;
                }
                continue;
            }

            if (p.fadeProgress < 1) {
                p.fadeProgress += CONFIG.FADE_IN_SPEED;
                if (p.fadeProgress > 1) p.fadeProgress = 1;
            }

            p.opacityPhase += CONFIG.OPACITY_WAVE_SPEED;
            const opacityFactor = (Math.sin(p.opacityPhase) + 1) / 2;
            const wave = 0.6 + 0.4 * opacityFactor;

            if (p.isStar) {
                const cycleDuration = CONFIG.STAR_CYCLE_DURATION + CONFIG.STAR_DIM_DURATION;
                p.starTimer += 16;
                const elapsed = p.starTimer % cycleDuration;
                let isStarActive = elapsed < CONFIG.STAR_CYCLE_DURATION;

                if (isStarActive) {
                    p.currentRadius = p.radius * (0.9 + 0.1 * Math.sin(p.opacityPhase));
                    let brightness = p.baseOpacity * wave;
                    brightness = Math.min(1, brightness);
                    p.currentOpacity = brightness * p.fadeProgress;
                } else {
                    const dimProgress = (elapsed - CONFIG.STAR_CYCLE_DURATION) / CONFIG.STAR_DIM_DURATION;
                    const shrink = 1 - dimProgress * 0.8;
                    p.currentRadius = p.radius * 0.3 * shrink;
                    const dimOpacity = p.baseOpacity * 0.3 * (1 - dimProgress * 0.5);
                    p.currentOpacity = dimOpacity * p.fadeProgress;
                }

                if (elapsed >= cycleDuration - 1) {
                    p.starTimer = 0;
                }
            } else {
                p.currentRadius = p.radius;
                p.currentOpacity = p.baseOpacity * p.fadeProgress * wave;
            }
        }
    }

    function drawParticles() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        ctx.shadowBlur = 0;

        for (const p of particles) {
            if (p.currentOpacity <= 0.001) continue;

            if (p.isStar) {
                const brightness = p.currentOpacity;
                const r = 180 + 40 * brightness;
                const g = 200 + 30 * brightness;
                const b = 220 + 35 * brightness;
                ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${p.currentOpacity})`;
                ctx.lineWidth = 1.2;
                const rad = p.currentRadius;
                ctx.beginPath();
                ctx.moveTo(0, -rad);
                ctx.lineTo(0, rad);
                ctx.moveTo(-rad, 0);
                ctx.lineTo(rad, 0);
                ctx.stroke();
                ctx.lineWidth = 0.6;
                const d = rad * 0.4;
                ctx.moveTo(-d, -d);
                ctx.lineTo(d, d);
                ctx.moveTo(d, -d);
                ctx.lineTo(-d, d);
                ctx.stroke();
            } else {
                const r = Math.min(255, Math.floor(BASE_R * p.colorFactor));
                const g = Math.min(255, Math.floor(BASE_G * p.colorFactor));
                const b = Math.min(255, Math.floor(BASE_B * p.colorFactor));
                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.currentOpacity})`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.currentRadius, 0, Math.PI * 2);
                ctx.fill();
            }
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