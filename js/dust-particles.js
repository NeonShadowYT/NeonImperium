// js/dust-particles.js – динамические летающие частицы с быстрым движением
(function() {
    let canvas, ctx, particles = [];
    let animationId = null;
    let width, height;
    let animationTime = 0;

    const PARTICLE_COUNT = 180;             // чуть больше для плотности
    const BASE_SIZE = 1.5;
    const SIZE_VARIATION = 2.5;
    const OPACITY_BASE = 0.35;              // значительно увеличена
    const OPACITY_VARIATION = 0.4;

    const ANGULAR_SPEED_MIN = 3.0;
    const ANGULAR_SPEED_MAX = 9.0;

    const RADIUS_MIN = 100;
    const RADIUS_MAX = 350;

    // Яркие заметные цвета
    const COLORS = [
        'rgba(61, 158, 179, ',
        'rgba(255, 255, 255, ',
        'rgba(210, 230, 250, '
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
            zIndex: '9999',                 // выше всего
            display: 'block'
        });

        document.body.insertBefore(canvas, document.body.firstChild);

        // Убедимся, что контент не перекрывает canvas
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
                baseX: Math.random() * width,
                baseY: Math.random() * height,
                angleX: Math.random() * Math.PI * 2,
                angleY: Math.random() * Math.PI * 2,
                speedX: ANGULAR_SPEED_MIN + Math.random() * (ANGULAR_SPEED_MAX - ANGULAR_SPEED_MIN),
                speedY: ANGULAR_SPEED_MIN + Math.random() * (ANGULAR_SPEED_MAX - ANGULAR_SPEED_MIN),
                radiusX: RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN),
                radiusY: RADIUS_MIN + Math.random() * (RADIUS_MAX - RADIUS_MIN),
                size: BASE_SIZE + Math.random() * SIZE_VARIATION,
                opacity: OPACITY_BASE + Math.random() * OPACITY_VARIATION,
                colorIdx: Math.floor(Math.random() * COLORS.length),
                phase: Math.random() * Math.PI * 2
            });
        }
    }

    function respawnParticle(p) {
        if (Math.random() < 0.7) {
            p.baseX = (p.baseX < 0) ? width + 20 : (p.baseX > width ? -20 : p.baseX);
            p.baseY = (p.baseY < 0) ? height + 20 : (p.baseY > height ? -20 : p.baseY);
        } else {
            p.baseX = Math.random() * width;
            p.baseY = Math.random() * height;
        }
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
            let offsetX = Math.sin(p.angleX + nowSec * p.speedX) * p.radiusX;
            let offsetY = Math.cos(p.angleY + nowSec * p.speedY + p.phase) * p.radiusY;

            let x = p.baseX + offsetX;
            let y = p.baseY + offsetY;

            const fadeZone = 60;
            let edgeFade = 1.0;
            if (x < fadeZone) edgeFade *= x / fadeZone;
            if (x > width - fadeZone) edgeFade *= (width - x) / fadeZone;
            if (y < fadeZone) edgeFade *= y / fadeZone;
            if (y > height - fadeZone) edgeFade *= (height - y) / fadeZone;

            if (edgeFade <= 0.05 || x < -200 || x > width + 200 || y < -200 || y > height + 200) {
                respawnParticle(p);
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

            // Сильное свечение для всех частиц, чтобы они были заметны
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(61, 158, 179, 0.9)';
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    function animate(nowMs) {
        if (!animationId) return;
        animationTime += 0.02;
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