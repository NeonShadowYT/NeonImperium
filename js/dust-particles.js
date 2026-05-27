// js/dust-particles.js – Dynamic floating particles with strong visible motion
(function() {
    let canvas, ctx, particles = [];
    let animationId = null;
    let width, height;
    let time = 0;
    
    // === НАСТРОЙКИ ДЛЯ ЗАМЕТНОГО ДВИЖЕНИЯ ===
    const PARTICLE_COUNT = 200;          // оптимальное количество
    const BASE_SIZE = 1.2;
    const SIZE_VARIATION = 2.0;
    const OPACITY_BASE = 0.12;
    const OPACITY_VARIATION = 0.3;
    const DRIFT_AMPLITUDE = 120;         // увеличенная амплитуда
    
    // Новые диапазоны скоростей для быстрого движения
    const SPEED_MIN = 0.02;              // раньше было 0.005
    const SPEED_MAX = 0.06;              // раньше было 0.017
    
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
                baseX: Math.random() * width,
                baseY: Math.random() * height,
                angleX: Math.random() * Math.PI * 2,
                angleY: Math.random() * Math.PI * 2,
                speedX: SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN),
                speedY: SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN),
                radiusX: 30 + Math.random() * DRIFT_AMPLITUDE,
                radiusY: 30 + Math.random() * DRIFT_AMPLITUDE,
                size: BASE_SIZE + Math.random() * SIZE_VARIATION,
                opacity: OPACITY_BASE + Math.random() * OPACITY_VARIATION,
                colorIdx: Math.floor(Math.random() * COLORS.length),
                phase: Math.random() * Math.PI * 2
            });
        }
    }
    
    function drawParticles() {
        if (!ctx || width === 0 || height === 0) return;
        ctx.clearRect(0, 0, width, height);
        
        for (let p of particles) {
            // Быстрое движение с разными частотами и фазами
            const offsetX = Math.sin(time * p.speedX * 1.2 + p.angleX) * p.radiusX;
            const offsetY = Math.cos(time * p.speedY * 0.9 + p.angleY + p.phase) * p.radiusY;
            
            let x = p.baseX + offsetX;
            let y = p.baseY + offsetY;
            
            // Зацикливание с мягким перескоком
            if (x < -150) x = width + 150;
            if (x > width + 150) x = -150;
            if (y < -150) y = height + 150;
            if (y > height + 150) y = -150;
            
            // Затухание у краёв для плавного появления/исчезновения
            let edgeFade = 1;
            if (x < 40) edgeFade *= x / 40;
            if (x > width - 40) edgeFade *= (width - x) / 40;
            if (y < 40) edgeFade *= y / 40;
            if (y > height - 40) edgeFade *= (height - y) / 40;
            
            const finalOpacity = p.opacity * edgeFade;
            if (finalOpacity <= 0.02) continue;
            
            ctx.beginPath();
            ctx.arc(x, y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = COLORS[p.colorIdx] + finalOpacity + ')';
            ctx.fill();
            
            // Лёгкое свечение для крупных частиц
            if (p.size > 1.8 && finalOpacity > 0.15) {
                ctx.shadowBlur = 6;
                ctx.shadowColor = 'rgba(61, 158, 179, 0.6)';
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }
    }
    
    function animate(now) {
        // Увеличиваем время плавно, движение получается заметным
        time += 0.025;  // около 1.5 в секунду при 60fps
        drawParticles();
        animationId = requestAnimationFrame(animate);
    }
    
    function startAnimation() {
        if (animationId) cancelAnimationFrame(animationId);
        time = 0;
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
    
    // Опционально: отключаем пылинки на слабых мобильных устройствах (по желанию)
    function isLowPerformanceDevice() {
        // Можно добавить проверку на touch или slow connection
        return false; // всегда включено
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (!isLowPerformanceDevice()) initCanvas();
        });
    } else {
        if (!isLowPerformanceDevice()) initCanvas();
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', () => {
        if (animationId) cancelAnimationFrame(animationId);
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    });
})();