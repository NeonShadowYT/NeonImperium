// js/dust-particles.js – адаптивные пылинки с пониженным потреблением
(function() {
  let canvas, ctx, particles = [];
  let animationId = null;
  let width, height;
  let isEnabled = true;

  // Проверка prefers-reduced-motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    isEnabled = false;
    return;
  }

  // Определяем мобильное устройство и производительность
  const isMobile = window.innerWidth < 768 || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const cores = navigator.hardwareConcurrency || 4;
  const isLowPerf = cores < 4 || (navigator.deviceMemory && navigator.deviceMemory < 4);

  // Количество частиц в зависимости от производительности
  let PARTICLE_COUNT = isMobile ? 25 : (isLowPerf ? 35 : 70);
  if (isMobile && isLowPerf) PARTICLE_COUNT = 15;

  const MIN_RADIUS = isMobile ? 0.6 : 1;
  const MAX_RADIUS = isMobile ? 1.5 : 2.2;
  const BASE_SPEED = isMobile ? 0.12 : 0.2;
  const NOISE_STRENGTH = isMobile ? 0.03 : 0.06;
  const MAX_SPEED = isMobile ? 0.35 : 0.5;
  const MIN_OPACITY = 0.01;
  const MAX_OPACITY = isMobile ? 0.08 : 0.15;
  const OPACITY_WAVE_SPEED = 0.002;
  const FADE_IN_SPEED = 0.015;

  // Ограничение размера канваса
  const MAX_CANVAS_WIDTH = isMobile ? 600 : 1600;
  const MAX_CANVAS_HEIGHT = isMobile ? 400 : 1200;

  // Цвет акцента
  const BASE_R = 61, BASE_G = 158, BASE_B = 179;

  function initCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'dust-canvas';
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:-1;display:block;will-change:transform;';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    window.addEventListener('resize', onResize, { passive: true });
    onResize();
  }

  function onResize() {
    if (!canvas) return;
    let newWidth = Math.min(window.innerWidth, MAX_CANVAS_WIDTH);
    let newHeight = Math.min(window.innerHeight, MAX_CANVAS_HEIGHT);
    const oldWidth = width, oldHeight = height;
    if (oldWidth && oldHeight && particles.length) {
      const scaleX = newWidth / oldWidth;
      const scaleY = newHeight / oldHeight;
      for (const p of particles) {
        p.x *= scaleX;
        p.y *= scaleY;
        p.vx *= scaleX;
        p.vy *= scaleY;
        let speed = Math.hypot(p.vx, p.vy);
        if (speed > MAX_SPEED) {
          p.vx = (p.vx / speed) * MAX_SPEED;
          p.vy = (p.vy / speed) * MAX_SPEED;
        }
      }
    } else {
      width = newWidth;
      height = newHeight;
      canvas.width = width;
      canvas.height = height;
      initParticles();
      return;
    }
    width = newWidth;
    height = newHeight;
    canvas.width = width;
    canvas.height = height;
  }

  function randomRange(min, max) { return min + Math.random() * (max - min); }

  function createParticle(x, y) {
    return {
      x: x !== undefined ? x : Math.random() * width,
      y: y !== undefined ? y : Math.random() * height,
      vx: randomRange(-BASE_SPEED, BASE_SPEED),
      vy: randomRange(-BASE_SPEED, BASE_SPEED),
      radius: randomRange(MIN_RADIUS, MAX_RADIUS),
      baseOpacity: randomRange(MIN_OPACITY, MAX_OPACITY),
      opacityPhase: Math.random() * Math.PI * 2,
      fadeProgress: 1,
      colorFactor: randomRange(0.7, 1.3),
      currentOpacity: 0
    };
  }

  function initParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(createParticle());
    }
  }

  function updateParticles() {
    for (const p of particles) {
      p.vx += (Math.random() - 0.5) * NOISE_STRENGTH;
      p.vy += (Math.random() - 0.5) * NOISE_STRENGTH;
      let speed = Math.hypot(p.vx, p.vy);
      if (speed > MAX_SPEED) {
        p.vx = (p.vx / speed) * MAX_SPEED;
        p.vy = (p.vy / speed) * MAX_SPEED;
      }
      p.x += p.vx;
      p.y += p.vy;

      // Телепортация через границы
      if (p.x < 0) { p.x = width; p.fadeProgress = 0; }
      if (p.x > width) { p.x = 0; p.fadeProgress = 0; }
      if (p.y < 0) { p.y = height; p.fadeProgress = 0; }
      if (p.y > height) { p.y = 0; p.fadeProgress = 0; }

      if (p.fadeProgress < 1) {
        p.fadeProgress += FADE_IN_SPEED;
        if (p.fadeProgress > 1) p.fadeProgress = 1;
      }

      p.opacityPhase += OPACITY_WAVE_SPEED;
      const wave = 0.6 + 0.4 * ((Math.sin(p.opacityPhase) + 1) / 2);
      p.currentOpacity = p.baseOpacity * p.fadeProgress * wave;
    }
  }

  function drawParticles() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      if (p.currentOpacity < 0.001) continue;
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
    if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null; ctx = null;
  }

  // Остановка при скрытии вкладки
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (animationId) { cancelAnimationFrame(animationId); animationId = null; }
    } else {
      if (!animationId && isEnabled && canvas) animate();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.DustParticles = { start, stop, isEnabled: () => isEnabled };
})();