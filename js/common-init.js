// js/common-init.js – оптимизированная инициализация с принудительной загрузкой модулей
(function() {
  // Проверка на мобильное устройство и низкую производительность
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                   (window.innerWidth < 768) ||
                   ('ontouchstart' in window);
  const isLowPerf = isMobile || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) ||
                    (navigator.deviceMemory && navigator.deviceMemory < 4);

  if (isLowPerf) {
    document.documentElement.dataset.lowPerf = 'true';
    document.documentElement.classList.add('reduce-motion');
  }

  // Предзагрузка шрифтов и preconnect
  function addPreconnects() {
    const links = [
      'https://api.github.com',
      'https://cdnjs.cloudflare.com',
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com'
    ];
    links.forEach(url => {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = url;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    });
  }
  addPreconnects();

  // Загрузка marked с fallback
  async function ensureMarked() {
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') return;
    const cdnList = [
      'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
      'https://unpkg.com/marked@11.1.1/marked.min.js'
    ];
    for (const src of cdnList) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = src;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        if (typeof marked !== 'undefined' && typeof marked.parse === 'function') return;
      } catch (e) { /* continue */ }
    }
    window.marked = { parse: (txt) => Promise.resolve(txt.replace(/\n/g, '<br>')) };
  }

  // Инициализация ленивых YouTube-плееров
  function initLazyYT() {
    const containers = document.querySelectorAll('.lazy-yt');
    if (!('IntersectionObserver' in window)) {
      containers.forEach(el => loadYouTube(el));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          loadYouTube(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '200px' });
    containers.forEach(el => observer.observe(el));
  }

  function loadYouTube(container) {
    if (container.dataset.loaded) return;
    const src = container.dataset.src;
    if (!src) return;
    const videoId = extractVideoId(src);
    if (!videoId) {
      showFallback(container, src);
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`;
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allowfullscreen', '');
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; gyroscope; picture-in-picture';
    iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;border-radius:12px;';
    container.innerHTML = '';
    container.style.cssText = 'position:relative;padding-bottom:56.25%;background:#000;border-radius:12px;overflow:hidden;';
    container.appendChild(iframe);
    container.dataset.loaded = 'true';
    iframe.onerror = () => showFallback(container, src);
    const timeout = setTimeout(() => {
      if (!iframe.contentWindow) showFallback(container, src);
    }, 10000);
    iframe.addEventListener('load', () => clearTimeout(timeout));
  }

  function extractVideoId(url) {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
      /youtube\.com\/embed\/([^&\n?#]+)/
    ];
    for (const p of patterns) {
      const match = url.match(p);
      if (match) return match[1];
    }
    return null;
  }

  function showFallback(container, url) {
    const t = window.I18n?.translate || (k => k);
    container.innerHTML = `
      <div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg-primary);border-radius:12px;padding:20px;text-align:center;gap:12px;box-sizing:border-box;">
        <i class="fab fa-youtube" style="font-size:32px;color:var(--accent);"></i>
        <p style="color:var(--text-secondary);font-size:14px;margin:0;">${t('videoLoadFailed')}</p>
        <button class="button small" onclick="window.open('${url || '#'}', '_blank')" style="background:var(--accent);color:#fff;">
          <i class="fas fa-external-link-alt"></i> ${t('open')}
        </button>
      </div>
    `;
    container.dataset.loaded = 'true';
  }

  // Фоновые частицы – только если не низкая производительность
  function loadDustParticles() {
    if (isLowPerf) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const script = document.createElement('script');
    script.src = 'js/dust-particles.js';
    script.defer = true;
    script.onerror = () => console.warn('Dust particles failed to load');
    document.head.appendChild(script);
  }

  // Service Worker регистрация
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        console.log('SW registered');
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateNotification();
            }
          });
        });
        if (reg.waiting) showUpdateNotification();
      })
      .catch(err => console.warn('SW registration failed:', err));
  }

  function showUpdateNotification() {
    if (sessionStorage.getItem('update_notification_shown')) return;
    sessionStorage.setItem('update_notification_shown', '1');
    const t = window.I18n?.translate || (k => k);
    const note = document.createElement('div');
    note.style.cssText = 'position:fixed;bottom:90px;right:24px;z-index:10001;background:var(--accent);color:#fff;padding:12px 20px;border-radius:40px;box-shadow:0 6px 14px rgba(0,0,0,0.4);font-family:"Russo One",sans-serif;display:flex;align-items:center;gap:12px;';
    note.innerHTML = `<span>${t('newVersionAvailable')}</span><button id="update-btn" style="background:white;color:var(--accent);border:none;padding:6px 16px;border-radius:20px;cursor:pointer;font-family:inherit;">${t('updateBtn')}</button>`;
    document.body.appendChild(note);
    document.getElementById('update-btn').addEventListener('click', () => window.location.reload());
  }

  // Загрузка и инициализация модулей (последовательно)
  function loadModules() {
    const modules = [
      'js/features/rate-limits.js',
      'js/features/background-gifs.js',
      'js/effects.js'
    ];
    let promise = Promise.resolve();
    modules.forEach(src => {
      promise = promise.then(() => {
        return new Promise((resolve) => {
          const script = document.createElement('script');
          script.src = src;
          script.defer = true;
          script.async = true;
          script.onload = resolve;
          script.onerror = () => { console.warn('Failed to load', src); resolve(); };
          document.head.appendChild(script);
        });
      });
    });
    promise.then(() => {
      if (window.RateLimits && typeof window.RateLimits.init === 'function') {
        window.RateLimits.init();
        console.log('[common-init] RateLimits initialized');
      } else {
        console.warn('[common-init] RateLimits not available');
      }
    });
  }

  // Инициализация страничных модулей (новости, обновления, релизы)
  function initPageModules() {
    if (window.initNewsFeed) window.initNewsFeed();
    if (window.initFeedback) window.initFeedback();
    if (window.initGameUpdates) window.initGameUpdates();
    if (window.initPlatform) window.initPlatform();
  }

  // Обновление элементов с data-lang
  function updateLanguageElements() {
    const t = window.I18n?.translate || (k => k);
    document.querySelectorAll('[data-lang]').forEach(el => {
      const key = el.getAttribute('data-lang');
      const text = t(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.placeholder !== undefined) el.placeholder = text;
        else el.textContent = text;
      } else {
        el.textContent = text;
      }
    });
  }

  // Главная инициализация
  function init() {
    ensureMarked().then(() => {});
    initLazyYT();
    loadDustParticles();
    registerServiceWorker();
    loadModules();

    // Ждём загрузку языка, затем инициализируем страничные модули
    if (window.I18n && window.I18n.getCurrentLang && window.I18n.getCurrentLang() !== null) {
      setTimeout(initPageModules, 100);
    } else {
      document.addEventListener('languageLoaded', initPageModules);
      setTimeout(initPageModules, 2000); // fallback
    }

    document.addEventListener('languageLoaded', updateLanguageElements);
    window.addEventListener('languageChanged', updateLanguageElements);

    // Перезагружаем данные при логине/выходе
    window.addEventListener('github-login-success', initPageModules);
    window.addEventListener('github-logout', initPageModules);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();