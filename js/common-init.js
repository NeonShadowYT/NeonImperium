// js/common-init.js – оптимизированная инициализация
// Добавлены: отключение тяжёлых эффектов на мобильных, ленивая загрузка модулей,
// улучшенная загрузка marked, адаптивные настройки

(function() {
  // Проверка на мобильное устройство и низкую производительность
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
                   (window.innerWidth < 768) ||
                   ('ontouchstart' in window);
  const isLowPerf = isMobile || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4) ||
                    (navigator.deviceMemory && navigator.deviceMemory < 4);

  // Если низкая производительность – отключаем тяжёлые эффекты глобально
  if (isLowPerf) {
    document.documentElement.dataset.lowPerf = 'true';
    // Отключаем CSS-анимации (можно через класс)
    document.documentElement.classList.add('reduce-motion');
    // Также можно выставить prefers-reduced-motion через медиа-запрос
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
    // Fallback – минимальный парсер
    window.marked = { parse: (txt) => Promise.resolve(txt.replace(/\n/g, '<br>')) };
  }

  // Инициализация ленивых YouTube-плееров с улучшенной обработкой
  function initLazyYT() {
    const containers = document.querySelectorAll('.lazy-yt');
    if (!('IntersectionObserver' in window)) {
      // Fallback – грузим сразу
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
    // Обработка ошибок загрузки iframe
    iframe.onerror = () => showFallback(container, src);
    // Таймаут на случай, если iframe не грузится
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
    // Проверяем prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const script = document.createElement('script');
    script.src = 'js/dust-particles.js';
    script.defer = true;
    script.onerror = () => console.warn('Dust particles failed to load');
    document.head.appendChild(script);
  }

  // Service Worker регистрация с обновлением
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js')
      .then(reg => {
        console.log('SW registered');
        // Проверка обновлений
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateNotification();
            }
          });
        });
        // Если уже есть ожидающий worker
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

  // Инициализация после DOM
  function init() {
    ensureMarked().then(() => {});
    initLazyYT();
    loadDustParticles();
    registerServiceWorker();

    // Инициализация остальных модулей через requestIdleCallback (если доступно)
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => {
        // Загрузка не критичных скриптов
        const modules = ['js/features/background-gifs.js', 'js/effects.js'];
        modules.forEach(src => {
          const s = document.createElement('script');
          s.src = src;
          s.defer = true;
          s.async = true;
          document.head.appendChild(s);
        });
      });
    } else {
      setTimeout(() => {
        const modules = ['js/features/background-gifs.js', 'js/effects.js'];
        modules.forEach(src => {
          const s = document.createElement('script');
          s.src = src;
          s.defer = true;
          s.async = true;
          document.head.appendChild(s);
        });
      }, 1000);
    }

    // Подписка на события загрузки языка
    document.addEventListener('languageLoaded', () => {
      // Обновление элементов с data-lang
      updateLanguageElements();
    });
  }

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();