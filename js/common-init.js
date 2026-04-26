// js/common-init.js – shared lazy‑loading & donation button with error suppression
(function () {
  function initLazyYT() {
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const src = el.dataset.src;
          if (!src) return;
          const iframe = document.createElement('iframe');
          iframe.src = src;
          iframe.setAttribute('frameborder', '0');
          iframe.setAttribute('allowfullscreen', '');
          iframe.loading = 'lazy';
          el.appendChild(iframe);
          el.classList.add('loaded');
          obs.unobserve(el);
        });
      }, { rootMargin: '200px' });
      document.querySelectorAll('.lazy-yt').forEach((el) => obs.observe(el));
    } else {
      document.querySelectorAll('.lazy-yt').forEach((el) => {
        const src = el.dataset.src;
        if (!src) return;
        const iframe = document.createElement('iframe');
        iframe.src = src;
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allowfullscreen', '');
        el.appendChild(iframe);
      });
    }
  }

  function initDonateBtn() {
    const btn = document.getElementById('donate-button');
    if (!btn) return;
    let itchLoaded = false;
    function loadItch() {
      if (itchLoaded) return;
      itchLoaded = true;
      const s = document.createElement('script');
      s.src = 'https://static.itch.io/api.js';
      s.onload = () => {
        if (typeof Itch !== 'undefined') {
          Itch.attachBuyButton(btn, {
            user: 'neon-imperium',
            game: 'starve-neon',
            width: 700,
            height: 500
          });
        }
      };
      document.head.appendChild(s);
    }
    btn.addEventListener('click', loadItch, { once: true });

    function updateText() {
      const span = btn.querySelector('span[data-lang="donateButton"]');
      if (!span) return;
      const lang = localStorage.getItem('preferredLanguage') || 'ru';
      span.textContent =
        window.translations?.[lang]?.donateButton ??
        (lang === 'en' ? 'Support' : 'Поддержать');
    }
    window.addEventListener('languageChanged', updateText);
    updateText();
  }

  // Подавляем ошибки CORS в консоли для фоновых запросов хранилища
  window.addEventListener('unhandledrejection', function(event) {
    if (event.reason && event.reason.message && event.reason.message.includes('Failed to fetch')) {
      event.preventDefault();
    }
  }, { capture: true });

  // Предзагрузка критических скриптов
  const preloadScripts = [
    'js/core/github-core.js',
    'js/features/ui-utils.js',
    'js/core/github-api.js',
    'js/core/github-auth.js',
    'js/features/ui-feedback.js'
  ];
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initLazyYT();
      initDonateBtn();
      // Ленивая предзагрузка неблокирующих скриптов
      preloadScripts.forEach(src => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'script';
        link.href = src;
        document.head.appendChild(link);
      });
    });
  } else {
    initLazyYT();
    initDonateBtn();
  }
})();