// js/features/dust-particles.js
// Фоновые динамические частицы (пылинки) с эффектом случайного блуждания
// Акцентный цвет, плавное появление, постепенное добавление частиц

(function() {
    let canvas, ctx, particles = [];
    let animationId = null;
    let width, height;
    let isEnabled = true;
    let spawnRemaining = 0;        // сколько частиц ещё нужно создать
    let spawnPerFrame = 2;         // добавляем по 2 частицы за кадр

    // Настройки
    const CONFIG = {
        PARTICLE_COUNT: 80,          // уменьшили для производительности
        MIN_RADIUS: 1,
        MAX_RADIUS: 2.5,
        BASE_SPEED: 0.25,
        NOISE_STRENGTH: 0.08,
        MAX_SPEED: 0.6,
        MIN_OPACITY: 0.04,           // едва заметные
        MAX_OPACITY: 0.18,           // максимум тоже неяркий
        OPACITY_WAVE_SPEED: 0.003,   // медленное мерцание
        FADE_IN_SPEED: 0.02          // скорость появления (за ~50 кадров)
    };

    // Базовый цвет акцента (из CSS: #3d9eb3)
    const BASE_R = 61;
    const BASE_G = 158;
    const BASE_B = 179;

    // Проверка: если пользователь предпочитает сниженную анимацию – отключаем эффект
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
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        // Пересоздаём частицы с постепенным добавлением
        resetParticles();
    }

    function randomRange(min, max) {
        return min + Math.random() * (max - min);
    }

    // Создаёт одну частицу со случайными параметрами
    function createParticle(x, y) {
        // Случайный множитель яркости цвета (0.7…1.3)
        const colorFactor = randomRange(0.7, 1.3);
        return {
            x: x !== undefined ? x : Math.random() * width,
            y: y !== undefined ? y : Math.random() * height,
            vx: randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED),
            vy: randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED),
            radius: randomRange(CONFIG.MIN_RADIUS, CONFIG.MAX_RADIUS),
            baseOpacity: randomRange(CONFIG.MIN_OPACITY, CONFIG.MAX_OPACITY),
            opacityPhase: Math.random() * Math.PI * 2,
            // Плавное появление
            fadeProgress: 0,          // от 0 до 1
            colorFactor: colorFactor
        };
    }

    // Полная перезагрузка (при ресайзе)
    function resetParticles() {
        particles = [];
        spawnRemaining = CONFIG.PARTICLE_COUNT;
        // Если анимация запущена, частицы будут добавляться в update
    }

    // Добавляет несколько частиц за кадр
    function spawnParticlesGradually() {
        if (spawnRemaining <= 0) return;
        const toSpawn = Math.min(spawnPerFrame, spawnRemaining);
        for (let i = 0; i < toSpawn; i++) {
            particles.push(createParticle());
        }
        spawnRemaining -= toSpawn;
    }

    function updateParticles() {
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];

            // Шум (броуновское движение)
            p.vx += (Math.random() - 0.5) * CONFIG.NOISE_STRENGTH;
            p.vy += (Math.random() - 0.5) * CONFIG.NOISE_STRENGTH;

            // Ограничение скорости
            let speed = Math.hypot(p.vx, p.vy);
            if (speed > CONFIG.MAX_SPEED) {
                p.vx = (p.vx / speed) * CONFIG.MAX_SPEED;
                p.vy = (p.vy / speed) * CONFIG.MAX_SPEED;
            }

            // Движение
            p.x += p.vx;
            p.y += p.vy;

            // Телепортация за границы – при этом сбрасываем fade (частица как бы новая)
            let respawn = false;
            if (p.x < 0) { p.x = width; respawn = true; }
            if (p.x > width) { p.x = 0; respawn = true; }
            if (p.y < 0) { p.y = height; respawn = true; }
            if (p.y > height) { p.y = 0; respawn = true; }

            if (respawn) {
                // Заново наращиваем прозрачность
                p.fadeProgress = 0;
                // Небольшой случайный сдвиг скорости для разнообразия
                p.vx = randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED);
                p.vy = randomRange(-CONFIG.BASE_SPEED, CONFIG.BASE_SPEED);
                p.opacityPhase = Math.random() * Math.PI * 2;
                continue;
            }

            // Плавное появление (fade-in)
            if (p.fadeProgress < 1) {
                p.fadeProgress += CONFIG.FADE_IN_SPEED;
                if (p.fadeProgress > 1) p.fadeProgress = 1;
            }

            // Мерцание (колебание прозрачности)
            p.opacityPhase += CONFIG.OPACITY_WAVE_SPEED;
            const opacityFactor = (Math.sin(p.opacityPhase) + 1) / 2; // 0..1
            // Итоговая прозрачность = базовая * fadeProgress * (0.5 + 0.5*opacityFactor)
            // Делаем мерцание менее контрастным
            const wave = 0.6 + 0.4 * opacityFactor; // диапазон 0.6..1.0
            let targetOpacity = p.baseOpacity * p.fadeProgress * wave;
            // Сглаживаем (можно сразу присвоить, но для красоты оставляем)
            p.currentOpacity = targetOpacity;
        }
    }

    function drawParticles() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);
        // Отключаем тени для производительности
        ctx.shadowBlur = 0;

        for (const p of particles) {
            // Пропускаем, если ещё не видна (прогресс 0)
            if (p.currentOpacity <= 0.001) continue;

            // Вычисляем цвет с учётом colorFactor
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

        // Постепенно добавляем новые частицы
        if (spawnRemaining > 0) {
            spawnParticlesGradually();
        }

        updateParticles();
        drawParticles();

        animationId = requestAnimationFrame(animate);
    }

    function start() {
        if (!isEnabled) return;
        if (animationId) cancelAnimationFrame(animationId);
        initCanvas();
        resetParticles();
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

    // Пауза при невидимой вкладке (экономия ресурсов)
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

    // Запуск после загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.DustParticles = {
        start, stop,
        isEnabled: () => isEnabled
    };
})();