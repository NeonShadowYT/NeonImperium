// js/dust-particles.js – Dynamic floating particles with strong visible motion
(function() {
    let canvas, ctx, particles = [];
    let animationId = null;
    let width, height;
    let time = 0;
    
    // === НАСТРОЙКИ ДЛЯ ЗАМЕТНОГО ДВИЖЕНИЯ ===
    const PARTICLE_COUNT = 250;
    const BASE_SIZE = 1.5;
    const SIZE_VARIATION = 1.8;
    const OPACITY_BASE = 0.15;
    const OPACITY_VARIATION = 0.25;
    const DRIFT_AMPLITUDE = 80;           // большая амплитуда
    const SPEED_MULT = 0.008;              // быстрая смена положения
    
    const COLORS = [
        'rgba(61, 158, 179, ',
        'rgba(200, 220, 240, ',
        'rgba(255, 255, 255, '
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
                speedX: 0.005 + Math.random() * 0.012,
                speedY: 0.005 + Math.random() * 0.012,
                radiusX: 25 + Math.random() * DRIFT_AMPLITUDE,
                radiusY: 25 + Math.random() * DRIFT_AMPLITUDE,
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
            // Динамическое движение с разными частотами
            const offsetX = Math.sin(time * p.speedX + p.angleX) * p.radiusX;
            const offsetY = Math.cos(time * p.speedY * 0.9 + p.angleY + p.phase) * p.radiusY;
            
            let x = p.baseX + offsetX;
            let y = p.baseY + offsetY;
            
            // Зацикливание
            if (x < -100) x = width + 100;
            if (x > width + 100) x = -100;
            if (y < -100) y = height + 100;
            if (y > height + 100) y = -100;
            
            // Затухание у краёв
            let edgeFade = 1;
            if (x < 30) edgeFade *= x / 30;
            if (x > width - 30) edgeFade *= (width - x) / 30;
            if (y < 30) edgeFade *= y / 30;
            if (y > height - 30) edgeFade *= (height - y) / 30;
            
            const finalOpacity = p.opacity * edgeFade;
            if (finalOpacity <= 0.02) continue;
            
            ctx.beginPath();
            ctx.arc(x, y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = COLORS[p.colorIdx] + finalOpacity + ')';
            ctx.fill();
            
            // Свечение для крупных
            if (p.size > 2.0 && finalOpacity > 0.1) {
                ctx.shadowBlur = 5;
                ctx.shadowColor = 'rgba(61, 158, 179, 0.5)';
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }
    }
    
    let lastTimestamp = 0;
    function animate(now) {
        // Увеличиваем время плавно, чтобы движение было заметным
        time += 0.025;
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