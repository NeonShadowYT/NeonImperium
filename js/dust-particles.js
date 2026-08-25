// js/features/dust-particles.js
// Фоновые динамические частицы (пылинки) с эффектом случайного блуждания
// Плавное появление, масштабирование при ресайзе без исчезновения
// + звездные частицы, появляющиеся при движении мыши (опционально)

(function() {
    let canvas, ctx, particles = [];
    let starParticles = [];
    let animationId = null;
    let width, height;
    let isEnabled = true;
    let mouseX = -1000, mouseY = -1000;
    let starSpawnTimer = 0;

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
        STAR_COUNT: 30,
        STAR_SPAWN_RATE: 0.3, // вероятность спавна звезды при движении мыши
        STAR_LIFETIME: 60,    // кадров
        STAR_SIZE_MIN: 2,
        STAR_SIZE_MAX: 6
    };

    // Акцентный цвет #3d9eb3
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
        onResize(); // установит начальные размеры и создаст частицы

        // Отслеживаем движение мыши для спавна звезд
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseleave', () => { mouseX = -1000; mouseY = -1000; });
    }

    function onMouseMove(e) {
        mouseX = e.clientX;
        mouseY = e.clientY;
        // Спавним звезды с вероятностью
        if (Math.random() < CONFIG.STAR_SPAWN_RATE) {
            spawnStar(mouseX, mouseY);
        }
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
        const colorFactor = randomRange(0.7, 1.3);
        return {
            x: x !== undefined ? x : Math.random() * width,
            y: y !== undefined ? y : Math.random() * height,
            vx: randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED),
            vy: randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED),
            radius: randomRange(CONFIG.MIN_RADIUS, CONFIG.MAX_RADIUS),
            baseOpacity: randomRange(CONFIG.MIN_OPACITY, CONFIG.MAX_OPACITY),
            opacityPhase: Math.random() * Math.PI * 2,
            fadeProgress: 1,
            colorFactor: colorFactor
        };
    }

    function initParticlesFull() {
        particles = [];
        for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
            particles.push(createParticle());
        }
    }

    // ---- Звездные частицы ----
    function spawnStar(x, y) {
        if (starParticles.length > CONFIG.STAR_COUNT) {
            starParticles.shift(); // удаляем старые
        }
        const size = randomRange(CONFIG.STAR_SIZE_MIN, CONFIG.STAR_SIZE_MAX);
        const angle = Math.random() * Math.PI * 2;
        const speed = randomRange(0.5, 2);
        starParticles.push({
            x: x + randomRange(-20, 20),
            y: y + randomRange(-20, 20),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: size,
            life: CONFIG.STAR_LIFETIME + Math.random() * 30,
            maxLife: CONFIG.STAR_LIFETIME + Math.random() * 30,
            color: `hsl(${180 + Math.random() * 40}, 80%, 70%)`
        });
    }

    function updateStars() {
        for (let i = starParticles.length - 1; i >= 0; i--) {
            const s = starParticles[i];
            s.x += s.vx;
            s.y += s.vy;
            s.vx *= 0.98;
            s.vy *= 0.98;
            s.life--;
            if (s.life <= 0) {
                starParticles.splice(i, 1);
            }
        }
    }

    function drawStars() {
        if (!ctx) return;
        for (const s of starParticles) {
            const alpha = s.life / s.maxLife;
            const size = s.size * (0.3 + 0.7 * alpha);
            ctx.save();
            ctx.globalAlpha = alpha * 0.8;
            ctx.translate(s.x, s.y);
            // Рисуем крестик (звёздочку)
            ctx.rotate(Date.now() / 1000 + s.x);
            ctx.fillStyle = s.color || '#fff';
            ctx.shadowColor = 'rgba(61,158,179,0.5)';
            ctx.shadowBlur = 10;
            // Четыре луча
            ctx.fillRect(-size/6, -size/2, size/3, size);
            ctx.fillRect(-size/2, -size/6, size, size/3);
            ctx.restore();
            // Дополнительное свечение
            ctx.save();
            ctx.globalAlpha = alpha * 0.2;
            ctx.beginPath();
            ctx.arc(s.x, s.y, size * 1.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(61,158,179,0.3)';
            ctx.shadowBlur = 20;
            ctx.fill();
            ctx.restore();
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
                continue;
            }

            if (p.fadeProgress < 1) {
                p.fadeProgress += CONFIG.FADE_IN_SPEED;
                if (p.fadeProgress > 1) p.fadeProgress = 1;
            }

            p.opacityPhase += CONFIG.OPACITY_WAVE_SPEED;
            const opacityFactor = (Math.sin(p.opacityPhase) + 1) / 2;
            const wave = 0.6 + 0.4 * opacityFactor;
            let targetOpacity = p.baseOpacity * p.fadeProgress * wave;
            p.currentOpacity = targetOpacity;
        }

        updateStars();
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

        drawStars();
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
        document.removeEventListener('mousemove', onMouseMove);
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