// effects.js – оптимизированный: эффекты только на десктопах без reduced-motion
(function() {
  // Проверка на необходимость включения эффектов
  function shouldEnableEffects() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) return false;
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) return false;
    if (navigator.deviceMemory && navigator.deviceMemory < 4) return false;
    return true;
  }

  const effectsEnabled = shouldEnableEffects();
  if (!effectsEnabled) return;

  // Тротлинг через requestAnimationFrame
  function throttleAnimation(fn) {
    let running = false;
    return function(e) {
      if (running) return;
      running = true;
      requestAnimationFrame(() => {
        fn(e);
        running = false;
      });
    };
  }

  // 3D Tilt для карточек (только на десктопе)
  function initTiltEffect() {
    const cards = document.querySelectorAll('.tilt-card:not(.no-tilt)');
    if (!cards.length) return;
    cards.forEach(card => {
      const img = card.querySelector('.project-image, .video-thumbnail, .game-icon');
      const isProfile = card.closest('.profile-card') || card.classList.contains('profile-card');
      const handleMove = throttleAnimation((e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = (y - centerY) / 20;
        const rotateY = (centerX - x) / 20;
        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
        if (img && !isProfile) {
          const imgX = (x - centerX) / 25;
          const imgY = (y - centerY) / 25;
          img.style.transform = `translate(${imgX}px, ${imgY}px) scale(1.03)`;
        }
      });
      card.addEventListener('mousemove', handleMove, { passive: true });
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
        if (img && !isProfile) img.style.transform = 'translate(0,0) scale(1)';
      }, { passive: true });
    });
  }

  // Параллакс для шапок (только десктоп)
  function initHeaderParallax() {
    const headers = document.querySelectorAll('.game-header');
    if (!headers.length) return;
    let scrollTimer;
    window.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        headers.forEach(h => {
          h.style.backgroundPosition = 'center';
          h.style.backgroundSize = '110%';
        });
      }, 100);
    }, { passive: true });

    headers.forEach(header => {
      const handleMove = throttleAnimation((e) => {
        const rect = header.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        let moveX = (x - centerX) / 30;
        let moveY = (y - centerY) / 30;
        const maxOffset = 20;
        moveX = Math.max(-maxOffset, Math.min(maxOffset, moveX));
        moveY = Math.max(-maxOffset, Math.min(maxOffset, moveY));
        header.style.backgroundPosition = `calc(50% + ${moveX}px) calc(50% + ${moveY}px)`;
      });
      header.addEventListener('mousemove', handleMove, { passive: true });
      header.addEventListener('mouseleave', () => {
        header.style.backgroundPosition = 'center';
      }, { passive: true });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (effectsEnabled) {
      initTiltEffect();
      initHeaderParallax();
    }
  });
})();