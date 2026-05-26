// js/particles-and-noise.js — плавные фоновые частицы с параллаксом + мерцание на кнопках
(function() {
    // ---------- Фоновые частицы с параллаксом ----------
    const PARTICLE_COUNT = 220;
    const MAX_SPEED = 0.28;
    const NOISE_FORCE = 0.008;
    const PARTICLE_SIZE_MIN = 1.2;
    const PARTICLE_SIZE_MAX = 4.2;

    let canvas, ctx, particles = [], animationId = null;
    let width, height;
    let scrollY = 0;
    let lastScrollY = 0;

    function initBackgroundParticles() {
        canvas = document.createElement('canvas');
        canvas.id = 'bg-particles-canvas';
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = '0';
        canvas.style.opacity = '0.55';
        document.body.insertBefore(canvas, document.body.firstChild);

        ctx = canvas.getContext('2d');
        resizeCanvas();
        window.addEventListener('resize', () => {
            resizeCanvas();
            initParticles();
        });
        window.addEventListener('scroll', () => {
            scrollY = window.scrollY;
        }, { passive: true });

        initParticles();
        animateParticles();
    }

    function resizeCanvas() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
    }

    function initParticles() {
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                baseY: Math.random() * height,
                vx: (Math.random() - 0.5) * MAX_SPEED,
                vy: (Math.random() - 0.5) * MAX_SPEED,
                size: PARTICLE_SIZE_MIN + Math.random() * (PARTICLE_SIZE_MAX - PARTICLE_SIZE_MIN),
                opacity: 0.2 + Math.random() * 0.5,
                noisePhaseX: Math.random() * Math.PI * 2,
                noisePhaseY: Math.random() * Math.PI * 2,
                parallaxDepth: 0.3 + Math.random() * 0.5,
            });
        }
    }

    function updateParticles() {
        const time = Date.now() * 0.0008;
        const scrollDelta = scrollY - lastScrollY;
        lastScrollY = scrollY;

        for (let p of particles) {
            const angleX = time * 0.4 + p.noisePhaseX;
            const angleY = time * 0.6 + p.noisePhaseY;
            const ax = Math.sin(angleX) * NOISE_FORCE;
            const ay = Math.cos(angleY) * NOISE_FORCE;
            p.vx += ax;
            p.vy += ay;

            p.vx = Math.min(MAX_SPEED, Math.max(-MAX_SPEED, p.vx));
            p.vy = Math.min(MAX_SPEED, Math.max(-MAX_SPEED, p.vy));

            p.x += p.vx;
            const parallaxShift = scrollDelta * p.parallaxDepth * 0.2;
            p.y += p.vy + parallaxShift;

            if (p.x < -30) p.x = width + 30;
            if (p.x > width + 30) p.x = -30;
            if (p.y < -30) p.y = height + 30;
            if (p.y > height + 30) p.y = -30;
        }
    }

    function drawParticles() {
        ctx.clearRect(0, 0, width, height);
        for (let p of particles) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(90, 180, 210, ${p.opacity * 0.45})`;
            ctx.fill();
            ctx.shadowBlur = 5;
            ctx.shadowColor = 'rgba(61,158,179,0.35)';
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    function animateParticles() {
        updateParticles();
        drawParticles();
        animationId = requestAnimationFrame(animateParticles);
    }

    // ---------- Плавное, едва заметное мерцание на синих кнопках ----------
    const buttonOverlays = new Map();
    let animationFrameButtons = null;
    let resizeObserver = null;
    let mutationObserver = null;

    // Проверяем, должен ли элемент получить эффект
    function shouldProcessButton(el) {
        if (!el || el.closest('.no-button-noise')) return false;
        // По классам
        if (el.classList.contains('button') || el.classList.contains('download-button') ||
            el.classList.contains('lang-btn') || el.classList.contains('feedback-tab') ||
            el.classList.contains('nav-link') || el.classList.contains('platform-btn')) {
            return true;
        }
        // По цвету фона (синий оттенок)
        const style = getComputedStyle(el);
        const bg = style.backgroundColor;
        if (bg) {
            const rgb = bg.match(/\d+/g);
            if (rgb) {
                const r = parseInt(rgb[0]), g = parseInt(rgb[1]), b = parseInt(rgb[2]);
                // Акцентный цвет #3d9eb3 (61,158,179) и близкие тона
                if (r >= 40 && r <= 100 && g >= 120 && g <= 180 && b >= 150 && b <= 200) return true;
            }
        }
        return false;
    }

    // Случайная фаза для каждой кнопки – чтобы анимация не синхронизировалась и не выглядела зацикленной
    function getRandomPhase() {
        return Math.random() * Math.PI * 2;
    }

    // Генерация очень мягких, медленно меняющихся пятен
    function generateSubtleBlobs(width, height, phase, randomSeed) {
        const blobs = [];
        // Используем несколько независимых медленных осцилляторов
        const t1 = phase * 0.05 + randomSeed;
        const t2 = phase * 0.07 + randomSeed * 1.3;
        const t3 = phase * 0.03 + randomSeed * 2.1;
        
        const count = 12;
        for (let i = 0; i < count; i++) {
            const angle1 = t1 + i * 0.8;
            const angle2 = t2 + i * 1.2;
            const angle3 = t3 + i * 1.6;
            
            const x = (Math.sin(angle1) * 0.45 + 0.5) * width;
            const y = (Math.cos(angle2) * 0.45 + 0.5) * height;
            const radius = 10 + Math.sin(angle3) * 5;
            // Очень низкая прозрачность – едва заметное мерцание
            const opacity = 0.03 + Math.sin(angle3) * 0.02;
            blobs.push({ x, y, radius, opacity });
        }
        // Ещё одна группа пятен для разнообразия
        for (let i = 0; i < 8; i++) {
            const angleA = t2 + i * 1.1;
            const angleB = t3 + i * 0.9;
            const x = (Math.sin(angleA) * 0.6 + 0.5) * width;
            const y = (Math.cos(angleB) * 0.5 + 0.5) * height;
            const radius = 15 + Math.sin(t1 + i) * 4;
            const opacity = 0.02 + Math.cos(t2 + i) * 0.015;
            blobs.push({ x, y, radius, opacity });
        }
        return blobs;
    }

    function drawButtonShimmer(overlay) {
        const { canvas, ctx, width: w, height: h, phase, randomSeed } = overlay;
        if (!canvas || w === 0 || h === 0) return;
        ctx.clearRect(0, 0, w, h);
        
        const blobs = generateSubtleBlobs(w, h, phase, randomSeed);
        for (let blob of blobs) {
            ctx.beginPath();
            ctx.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(30, 70, 100, ${blob.opacity})`;
            ctx.fill();
        }
        
        // Лёгкие блики
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (let i = 0; i < 5; i++) {
            const t = phase * 0.1 + i;
            const x = (Math.sin(t) * 0.5 + 0.5) * w;
            const y = (Math.cos(t * 0.8) * 0.5 + 0.5) * h;
            ctx.beginPath();
            ctx.arc(x, y, 8 + Math.sin(t) * 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(120, 210, 240, 0.04)`;
            ctx.fill();
        }
        ctx.restore();
    }

    function updateAllButtonOverlays(phase) {
        for (let [btn, overlay] of buttonOverlays.entries()) {
            if (!btn.isConnected) {
                overlay.canvas.remove();
                buttonOverlays.delete(btn);
                continue;
            }
            const rect = btn.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            
            if (overlay.width !== rect.width || overlay.height !== rect.height) {
                overlay.width = rect.width;
                overlay.height = rect.height;
                overlay.canvas.width = rect.width;
                overlay.canvas.height = rect.height;
                overlay.canvas.style.width = rect.width + 'px';
                overlay.canvas.style.height = rect.height + 'px';
            }
            overlay.phase = phase;
            drawButtonShimmer(overlay);
        }
    }

    function createOverlayForButton(btn) {
        if (buttonOverlays.has(btn)) return;
        if (!shouldProcessButton(btn)) return;
        
        const rect = btn.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        const canvas = document.createElement('canvas');
        canvas.width = rect.width;
        canvas.height = rect.height;
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';
        canvas.style.borderRadius = getComputedStyle(btn).borderRadius;
        canvas.style.zIndex = '1';
        
        btn.style.position = 'relative';
        btn.style.overflow = 'hidden';
        btn.appendChild(canvas);
        
        buttonOverlays.set(btn, {
            canvas,
            ctx: canvas.getContext('2d'),
            width: rect.width,
            height: rect.height,
            phase: 0,
            randomSeed: Math.random() * Math.PI * 2, // уникальный сдвиг для каждой кнопки
        });
    }

    function scanAndCreateOverlays() {
        // Ищем все возможные синие кнопки
        const candidates = document.querySelectorAll('.button, .download-button, .lang-btn, .feedback-tab, .nav-link, .platform-btn, [class*="button"], [class*="btn"]');
        for (let btn of candidates) {
            if (shouldProcessButton(btn)) createOverlayForButton(btn);
        }
        // Дополнительно: любые элементы с синим фоном (активные вкладки, активные кнопки)
        document.querySelectorAll('.active, [aria-selected="true"]').forEach(el => {
            if (shouldProcessButton(el)) createOverlayForButton(el);
        });
    }

    function startButtonAnimation() {
        let globalPhase = 0;
        let lastTimestamp = 0;
        function animate(timestamp) {
            if (!lastTimestamp) lastTimestamp = timestamp;
            const delta = Math.min(50, timestamp - lastTimestamp);
            lastTimestamp = timestamp;
            // Очень медленное изменение глобальной фазы (период ~30 секунд)
            globalPhase += delta * 0.0004;
            if (globalPhase > Math.PI * 2) globalPhase -= Math.PI * 2;
            updateAllButtonOverlays(globalPhase);
            animationFrameButtons = requestAnimationFrame(animate);
        }
        animationFrameButtons = requestAnimationFrame(animate);
    }

    function initButtonNoise() {
        scanAndCreateOverlays();
        mutationObserver = new MutationObserver(() => scanAndCreateOverlays());
        mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        resizeObserver = new ResizeObserver(() => scanAndCreateOverlays());
        resizeObserver.observe(document.body);
        startButtonAnimation();
    }

    // ---------- Запуск ----------
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initBackgroundParticles();
            initButtonNoise();
        });
    } else {
        initBackgroundParticles();
        initButtonNoise();
    }
})();