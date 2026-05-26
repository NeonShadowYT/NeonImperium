// js/particles-and-noise.js — динамические пылинки на фоне + эффект шумовых пятен на кнопках
(function() {
    // ---------- Фоновые частицы (пылинки) ----------
    const PARTICLE_COUNT = 180;
    const MAX_SPEED = 0.6;
    const NOISE_FORCE = 0.02;
    const PARTICLE_SIZE_MIN = 1.5;
    const PARTICLE_SIZE_MAX = 4.5;

    let canvas, ctx, particles = [], animationId = null;
    let width, height;

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
        canvas.style.opacity = '0.65';
        document.body.insertBefore(canvas, document.body.firstChild);

        ctx = canvas.getContext('2d');
        resizeCanvas();
        window.addEventListener('resize', () => {
            resizeCanvas();
            initParticles();
        });

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
                vx: (Math.random() - 0.5) * MAX_SPEED,
                vy: (Math.random() - 0.5) * MAX_SPEED,
                size: PARTICLE_SIZE_MIN + Math.random() * (PARTICLE_SIZE_MAX - PARTICLE_SIZE_MIN),
                opacity: 0.3 + Math.random() * 0.5,
                noisePhaseX: Math.random() * Math.PI * 2,
                noisePhaseY: Math.random() * Math.PI * 2,
            });
        }
    }

    function updateParticles() {
        const time = Date.now() * 0.002;
        for (let p of particles) {
            // Шумовое ускорение (движущийся шум)
            const angleX = time * 0.7 + p.noisePhaseX;
            const angleY = time * 0.9 + p.noisePhaseY;
            const ax = Math.sin(angleX) * NOISE_FORCE;
            const ay = Math.cos(angleY) * NOISE_FORCE;
            p.vx += ax;
            p.vy += ay;
            // Ограничение скорости
            const maxSpd = MAX_SPEED * 1.2;
            p.vx = Math.min(maxSpd, Math.max(-maxSpd, p.vx));
            p.vy = Math.min(maxSpd, Math.max(-maxSpd, p.vy));

            p.x += p.vx;
            p.y += p.vy;

            // Отражение от границ с мягким возвратом
            if (p.x < -20) p.x = width + 20;
            if (p.x > width + 20) p.x = -20;
            if (p.y < -20) p.y = height + 20;
            if (p.y > height + 20) p.y = -20;
        }
    }

    function drawParticles() {
        ctx.clearRect(0, 0, width, height);
        for (let p of particles) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(100, 180, 200, ${p.opacity * 0.5})`;
            ctx.fill();
            // Лёгкое свечение
            ctx.shadowBlur = 6;
            ctx.shadowColor = 'rgba(61,158,179,0.4)';
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    function animateParticles() {
        updateParticles();
        drawParticles();
        animationId = requestAnimationFrame(animateParticles);
    }

    // ---------- Эффект шумовых пятен на кнопках ----------
    const buttonOverlays = new Map(); // key: element, value: { canvas, ctx, width, height, blobs, phase }
    let animationFrameButtons = null;
    let resizeObserver = null;
    let mutationObserver = null;

    // Классы кнопок, которые нужно обработать (все синие)
    const BUTTON_SELECTORS = [
        '.button', '.download-button', '.reaction-button', '.feedback-tab.active',
        '.lang-btn.active', '.modal-header-actions .action-btn', '.access-switch-btn.active',
        '.comment-submit', '.consent-btn', '.nav-link.active', '#github-download-btn',
        '.platform-btn.active', '.admin-news-btn', '.admin-update-btn', '#modal-submit',
        '#confirm-license-btn', '.telegram-link'
    ];

    function shouldProcessButton(el) {
        if (!el || el.closest('.no-button-noise')) return false;
        const style = getComputedStyle(el);
        const bg = style.backgroundColor;
        // Проверяем, синий ли цвет (оттенки акцентного)
        if (bg) {
            const rgb = bg.match(/\d+/g);
            if (rgb) {
                const r = parseInt(rgb[0]), g = parseInt(rgb[1]), b = parseInt(rgb[2]);
                // Акцентный цвет #3d9eb3 ~ (61,158,179) или близкие оттенки
                if (r >= 40 && r <= 100 && g >= 120 && g <= 180 && b >= 150 && b <= 200) return true;
                if (el.classList.contains('button') || el.classList.contains('download-button')) return true;
            }
        }
        // Дополнительно по наличию класса .button или .download-button
        return el.classList.contains('button') || el.classList.contains('download-button') ||
               el.classList.contains('lang-btn') || el.classList.contains('feedback-tab');
    }

    function generateBlobs(width, height, phase) {
        const blobs = [];
        const count = Math.floor(12 + Math.sin(phase) * 4);
        for (let i = 0; i < count; i++) {
            blobs.push({
                x: (Math.sin(phase * 0.7 + i) * 0.5 + 0.5) * width,
                y: (Math.cos(phase * 0.5 + i * 2) * 0.5 + 0.5) * height,
                radius: 8 + Math.sin(phase * 1.2 + i) * 4,
                opacity: 0.12 + Math.sin(phase * 1.8 + i) * 0.07,
            });
        }
        // Добавляем случайные шумовые пятна
        for (let i = 0; i < 25; i++) {
            blobs.push({
                x: (Math.random() * width),
                y: (Math.random() * height),
                radius: 3 + Math.random() * 12,
                opacity: 0.05 + Math.random() * 0.1,
            });
        }
        return blobs;
    }

    function drawButtonNoise(overlay) {
        const { canvas, ctx, width: w, height: h, phase } = overlay;
        if (!canvas || w === 0 || h === 0) return;
        ctx.clearRect(0, 0, w, h);
        
        // Генерируем движущиеся пятна
        const blobs = generateBlobs(w, h, phase);
        for (let blob of blobs) {
            ctx.beginPath();
            ctx.arc(blob.x, blob.y, blob.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(20, 40, 55, ${blob.opacity})`;
            ctx.fill();
        }
        
        // Дополнительный эффект "магических бликов"
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (let i = 0; i < 8; i++) {
            const t = phase * 2 + i;
            const x = (Math.sin(t) * 0.5 + 0.5) * w;
            const y = (Math.cos(t * 1.3) * 0.5 + 0.5) * h;
            ctx.beginPath();
            ctx.arc(x, y, 6 + Math.sin(t) * 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(80, 200, 220, 0.15)`;
            ctx.fill();
        }
        ctx.restore();
    }

    function updateAllButtonOverlays(phase) {
        for (let [btn, overlay] of buttonOverlays.entries()) {
            if (!btn.isConnected) {
                // Кнопка удалена из DOM, очищаем
                overlay.canvas.remove();
                buttonOverlays.delete(btn);
                continue;
            }
            const rect = btn.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            
            // Обновляем размер canvas, если изменился
            if (overlay.width !== rect.width || overlay.height !== rect.height) {
                overlay.width = rect.width;
                overlay.height = rect.height;
                overlay.canvas.width = rect.width;
                overlay.canvas.height = rect.height;
                // Обновляем стили позиционирования
                overlay.canvas.style.width = rect.width + 'px';
                overlay.canvas.style.height = rect.height + 'px';
            }
            overlay.phase = phase;
            drawButtonNoise(overlay);
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
        
        const ctx = canvas.getContext('2d');
        btn.style.position = 'relative';
        btn.style.overflow = 'hidden';
        btn.appendChild(canvas);
        
        buttonOverlays.set(btn, {
            canvas,
            ctx,
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
        // Дополнительно ищем любые элементы с синим фоном, которые могли быть пропущены
        document.querySelectorAll('[class*="button"]').forEach(el => {
            if (!buttonOverlays.has(el) && shouldProcessButton(el)) createOverlayForButton(el);
        });
    }

    function startButtonNoiseAnimation() {
        let startTime = performance.now();
        function animate(timestamp) {
            const phase = (timestamp * 0.003) % (Math.PI * 2);
            updateAllButtonOverlays(phase);
            animationFrameButtons = requestAnimationFrame(animate);
        }
        animationFrameButtons = requestAnimationFrame(animate);
    }

    function initButtonNoise() {
        scanAndCreateOverlays();
        
        // Наблюдаем за добавлением новых кнопок
        mutationObserver = new MutationObserver(() => {
            scanAndCreateOverlays();
        });
        mutationObserver.observe(document.body, { childList: true, subtree: true });
        
        // Наблюдаем за изменением размеров окон
        resizeObserver = new ResizeObserver(() => {
            scanAndCreateOverlays();
        });
        resizeObserver.observe(document.body);
        
        startButtonNoiseAnimation();
    }

    // ---------- Старт всего ----------
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