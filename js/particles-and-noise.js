// js/particles-and-noise.js — плавные фоновые частицы с параллаксом + мерцающий шум на кнопках
(function() {
    // ---------- Фоновые частицы с параллаксом при скролле ----------
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
                // для параллакса
                parallaxDepth: 0.3 + Math.random() * 0.5,
            });
        }
    }

    function updateParticles() {
        const time = Date.now() * 0.0008; // очень медленно
        // Плавное изменение scrollY с интерполяцией (уже есть)
        const scrollDelta = scrollY - lastScrollY;
        lastScrollY = scrollY;

        for (let p of particles) {
            // Шумовое ускорение (очень плавное)
            const angleX = time * 0.4 + p.noisePhaseX;
            const angleY = time * 0.6 + p.noisePhaseY;
            const ax = Math.sin(angleX) * NOISE_FORCE;
            const ay = Math.cos(angleY) * NOISE_FORCE;
            p.vx += ax;
            p.vy += ay;

            // Ограничение скорости
            p.vx = Math.min(MAX_SPEED, Math.max(-MAX_SPEED, p.vx));
            p.vy = Math.min(MAX_SPEED, Math.max(-MAX_SPEED, p.vy));

            p.x += p.vx;
            // Эффект параллакса при скролле: частицы с разной глубиной смещаются по Y
            const parallaxShift = scrollDelta * p.parallaxDepth * 0.2;
            p.y += p.vy + parallaxShift;

            // Телепортация через края
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
            // Лёгкое свечение
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

    // ---------- Плавное мерцание на кнопках (шумовые пятна, очень медленные) ----------
    const buttonOverlays = new Map();
    let animationFrameButtons = null;
    let resizeObserver = null;
    let mutationObserver = null;

    const BUTTON_SELECTORS = [
        '.button', '.download-button', '.reaction-button', '.feedback-tab.active',
        '.lang-btn.active', '.modal-header-actions .action-btn', '.access-switch-btn.active',
        '.comment-submit', '.consent-btn', '.nav-link.active', '#github-download-btn',
        '.platform-btn.active', '.admin-news-btn', '.admin-update-btn', '#modal-submit',
        '#confirm-license-btn', '.telegram-link'
    ];

    function shouldProcessButton(el) {
        if (!el || el.closest('.no-button-noise')) return false;
        // Все элементы с классом button или download-button
        if (el.classList.contains('button') || el.classList.contains('download-button')) return true;
        const style = getComputedStyle(el);
        const bg = style.backgroundColor;
        if (bg) {
            const rgb = bg.match(/\d+/g);
            if (rgb) {
                const r = parseInt(rgb[0]), g = parseInt(rgb[1]), b = parseInt(rgb[2]);
                // Акцентный цвет #3d9eb3 ~ (61,158,179) и близкие
                if (r >= 40 && r <= 100 && g >= 120 && g <= 180 && b >= 150 && b <= 200) return true;
            }
        }
        return false;
    }

    // Генерация плавных "пятен" с низкой частотой обновления
    function generateSoftBlobs(width, height, phase) {
        const blobs = [];
        // Количество пятен: постоянное, но положение плавно меняется
        const count = 18;
        for (let i = 0; i < count; i++) {
            // Очень медленное движение по кругу
            const angle = phase * 0.15 + i * 1.2;
            const radiusFactor = 0.6 + Math.sin(phase * 0.08 + i) * 0.2;
            const x = (Math.sin(angle) * 0.45 + 0.5) * width;
            const y = (Math.cos(angle * 0.7) * 0.45 + 0.5) * height;
            const r = 12 + Math.sin(phase * 0.2 + i) * 6;
            const opacity = 0.08 + Math.sin(phase * 0.1 + i) * 0.04;
            blobs.push({ x, y, radius: r * radiusFactor, opacity });
        }
        // Добавляем несколько статичных пятен с медленно меняющейся прозрачностью
        for (let i = 0; i < 12; i++) {
            blobs.push({
                x: (Math.sin(phase * 0.05 + i) * 0.4 + 0.5) * width,
                y: (Math.cos(phase * 0.07 + i * 1.5) * 0.4 + 0.5) * height,
                radius: 5 + Math.sin(phase * 0.1) * 2,
                opacity: 0.05 + Math.sin(phase * 0.12 + i) * 0.03,
            });
        }
        return blobs;
    }

    function drawButtonShimmer(overlay) {
        const { canvas, ctx, width: w, height: h, phase } = overlay;
        if (!canvas || w === 0 || h === 0) return;
        ctx.clearRect(0, 0, w, h);
        
        const blobs = generateSoftBlobs(w, h, phase);
        for (let blob of blobs) {
            ctx.beginPath();
            ctx.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2);
            // Тёмно-синие оттенки с очень низкой прозрачностью
            ctx.fillStyle = `rgba(20, 50, 70, ${blob.opacity * 0.7})`;
            ctx.fill();
        }
        
        // Лёгкие светлые блики (очень мягкие)
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (let i = 0; i < 6; i++) {
            const t = phase * 0.2 + i;
            const x = (Math.sin(t) * 0.4 + 0.5) * w;
            const y = (Math.cos(t * 0.9) * 0.4 + 0.5) * h;
            ctx.beginPath();
            ctx.arc(x, y, 10 + Math.sin(t) * 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(100, 200, 230, 0.08)`;
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
        });
    }

    function scanAndCreateOverlays() {
        const selector = BUTTON_SELECTORS.join(',');
        const buttons = document.querySelectorAll(selector);
        for (let btn of buttons) {
            createOverlayForButton(btn);
        }
        document.querySelectorAll('[class*="button"]').forEach(el => {
            if (!buttonOverlays.has(el) && shouldProcessButton(el)) createOverlayForButton(el);
        });
    }

    function startButtonAnimation() {
        let startPhase = 0;
        let lastTimestamp = 0;
        function animate(timestamp) {
            if (!lastTimestamp) lastTimestamp = timestamp;
            // Очень медленное изменение фазы (период ~20 секунд)
            const delta = Math.min(50, timestamp - lastTimestamp);
            lastTimestamp = timestamp;
            startPhase += delta * 0.0006;
            if (startPhase > Math.PI * 2) startPhase -= Math.PI * 2;
            updateAllButtonOverlays(startPhase);
            animationFrameButtons = requestAnimationFrame(animate);
        }
        animationFrameButtons = requestAnimationFrame(animate);
    }

    function initButtonNoise() {
        scanAndCreateOverlays();
        mutationObserver = new MutationObserver(() => scanAndCreateOverlays());
        mutationObserver.observe(document.body, { childList: true, subtree: true });
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