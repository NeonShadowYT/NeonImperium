// js/dust-particles.js – Dynamic dust particles background with smooth motion
(function() {
    let canvas, ctx, particles = [];
    let animationId = null;
    let width, height;
    let time = 0;
    
    // Configuration
    const PARTICLE_COUNT = 180;
    const BASE_SIZE = 1.5;
    const SIZE_VARIATION = 1.2;
    const OPACITY_BASE = 0.08;
    const OPACITY_VARIATION = 0.15;
    const DRIFT_AMPLITUDE = 45;      // max drift distance in pixels
    const DRIFT_SPEED = 0.0015;      // global drift speed multiplier
    
    // Colors
    const COLORS = [
        'rgba(61, 158, 179, ',   // accent with opacity
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
        
        // Ensure body content is above canvas
        const page = document.querySelector('.page');
        if (page) {
            page.style.position = 'relative';
            page.style.zIndex = '1';
        }
        
        window.addEventListener('resize', onResize);
        onResize();
        startAnimation();
    }
    
    function onResize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        
        // Reinitialize particles on resize to fit new dimensions
        initParticles();
    }
    
    function initParticles() {
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
                // Base position (where particle tends to return)
                baseX: Math.random() * width,
                baseY: Math.random() * height,
                // Individual drift parameters – уникальные для каждой частицы
                driftAngleX: Math.random() * Math.PI * 2,
                driftAngleY: Math.random() * Math.PI * 2,
                driftSpeedX: 0.0008 + Math.random() * 0.004,
                driftSpeedY: 0.0008 + Math.random() * 0.004,
                driftRadiusX: 15 + Math.random() * DRIFT_AMPLITUDE,
                driftRadiusY: 15 + Math.random() * DRIFT_AMPLITUDE,
                // Size and opacity
                size: BASE_SIZE + Math.random() * SIZE_VARIATION,
                opacity: OPACITY_BASE + Math.random() * OPACITY_VARIATION,
                colorIndex: Math.floor(Math.random() * COLORS.length),
                phaseShift: Math.random() * Math.PI * 2
            });
        }
    }
    
    function drawParticles() {
        if (!ctx || width === 0 || height === 0) return;
        
        ctx.clearRect(0, 0, width, height);
        
        for (let p of particles) {
            // Smooth non-looping motion using sine waves with different frequencies
            // Each particle has its own speed and phase, creating organic floating effect
            const offsetX = Math.sin(time * p.driftSpeedX + p.driftAngleX + p.phaseShift) * p.driftRadiusX;
            const offsetY = Math.cos(time * p.driftSpeedY + p.driftAngleY + p.phaseShift * 0.7) * p.driftRadiusY;
            
            let x = p.baseX + offsetX;
            let y = p.baseY + offsetY;
            
            // Wrap around edges softly (if drifts outside, teleport to opposite edge)
            if (x < -50) x = width + 50;
            if (x > width + 50) x = -50;
            if (y < -50) y = height + 50;
            if (y > height + 50) y = -50;
            
            // Apply soft fade near edges to prevent harsh cutoffs
            let edgeFade = 1;
            if (x < 20) edgeFade *= x / 20;
            if (x > width - 20) edgeFade *= (width - x) / 20;
            if (y < 20) edgeFade *= y / 20;
            if (y > height - 20) edgeFade *= (height - y) / 20;
            
            const finalOpacity = p.opacity * edgeFade;
            if (finalOpacity <= 0.01) continue;
            
            ctx.beginPath();
            ctx.arc(x, y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = COLORS[p.colorIndex] + finalOpacity + ')';
            ctx.fill();
            
            // Optional: tiny glow for some particles
            if (p.size > 2 && finalOpacity > 0.15) {
                ctx.shadowBlur = 3;
                ctx.shadowColor = 'rgba(61, 158, 179, 0.3)';
                ctx.fill();
                ctx.shadowBlur = 0;
            }
        }
    }
    
    function animate(currentTime) {
        // Time accumulates slowly to avoid visible looping (periods are very long)
        time += 0.016; // roughly per frame, continuous
        drawParticles();
        animationId = requestAnimationFrame(animate);
    }
    
    function startAnimation() {
        if (animationId) cancelAnimationFrame(animationId);
        animate();
    }
    
    function stopAnimation() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }
    
    // Visibility API: pause animation when tab is inactive to save resources
    function handleVisibilityChange() {
        if (document.hidden) {
            if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
            }
        } else {
            if (!animationId) startAnimation();
        }
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCanvas);
    } else {
        initCanvas();
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Cleanup on page unload (optional)
    window.addEventListener('beforeunload', () => {
        if (animationId) cancelAnimationFrame(animationId);
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    });
})();