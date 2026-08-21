// js/common-init.js – инициализация после загрузки переводов
(function() {
  function addPreconnects() {
    const links = [
      'https://api.github.com',
      'https://api.rss2json.com',
      'https://cdnjs.cloudflare.com'
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

  function loadPageScripts() {
    const path = location.pathname;
    let page = path.split('/').pop().replace('.html', '');
    if (page === '' || page === 'index') page = 'index';
    const scriptMap = {
      'index': 'js/pages/news-feed.js',
      'starve-neon': 'js/pages/feedback.js,js/pages/game-updates.js,js/platform.js,js/features/background-gifs.js',
      'alpha-01': 'js/pages/feedback.js,js/pages/game-updates.js',
      'gc-adven': 'js/pages/feedback.js,js/pages/game-updates.js',
      'license': ''
    };
    const scripts = scriptMap[page] ? scriptMap[page].split(',') : [];
    for (const src of scripts) {
      if (src && !document.querySelector(`script[src="${src}"]`)) {
        const s = document.createElement('script');
        s.src = src;
        s.defer = true;
        document.head.appendChild(s);
      }
    }
  }

  function ensureMarked() {
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') return Promise.resolve();

    const cdnList = [
      'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
      'https://unpkg.com/marked@11.1.1/marked.min.js',
      'https://cdn.skypack.dev/marked',
      'https://esm.sh/marked'
    ];

    function loadScript(src, timeout = 10000) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        const timer = setTimeout(() => reject(new Error(`Timeout loading ${src}`)), timeout);
        script.onload = () => { clearTimeout(timer); resolve(); };
        script.onerror = () => { clearTimeout(timer); reject(new Error(`Failed to load ${src}`)); };
        document.head.appendChild(script);
      });
    }

    async function tryLoad(index) {
      if (index >= cdnList.length) {
        console.warn('All CDNs failed, using minimal fallback');
        window.marked = {
          parse: (txt) => Promise.resolve(txt.replace(/\n/g, '<br>')),
          setOptions: () => {}
        };
        return;
      }
      try {
        await loadScript(cdnList[index]);
        if (typeof marked !== 'undefined' && typeof marked.parse === 'function') return;
        else throw new Error('marked not defined or parse missing');
      } catch (err) {
        console.warn(`Failed to load marked from ${cdnList[index]}, trying next`);
        return tryLoad(index + 1);
      }
    }

    return tryLoad(0);
  }

  function preloadFont() {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.href = 'fonts/RussoOne.woff2';
    link.crossOrigin = 'anonymous';
    link.type = 'font/woff2';
    document.head.appendChild(link);
  }

  function initLazyYT() {
    function showYouTubeFallback(container, videoUrl) {
      const t = window.I18n?.translate || (k => k);
      container.innerHTML = `
        <div class="yt-fallback" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:var(--bg-primary);border-radius:12px;padding:20px;text-align:center;gap:12px;animation:fadeInUp 0.4s ease;">
          <i class="fab fa-youtube" style="font-size:32px;color:var(--accent);"></i>
          <p style="color:var(--text-secondary);font-size:14px;margin:0;">${t('videoLoadFailed')}</p>
          <button class="button small" onclick="window.open('${videoUrl || '#'}', '_blank')" style="background:var(--accent);color:#fff;">
            <i class="fas fa-external-link-alt"></i> ${t('open')}
          </button>
        </div>
      `;
      container.classList.add('loaded');
    }

    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const src = el.dataset.src;
          if (!src) return;

          let videoId = '';
          const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
            /youtube\.com\/embed\/([^&\n?#]+)/
          ];
          for (const p of patterns) {
            const match = src.match(p);
            if (match) { videoId = match[1]; break; }
          }
          if (!videoId) {
            showYouTubeFallback(el, src);
            return;
          }

          const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`;
          const iframe = document.createElement('iframe');
          iframe.src = embedUrl;
          iframe.setAttribute('frameborder', '0');
          iframe.setAttribute('allowfullscreen', '');
          iframe.loading = 'lazy';
          iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms allow-presentation';
          iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.border = 'none';
          iframe.style.borderRadius = '12px';

          let errorOccurred = false;
          iframe.onerror = function() {
            if (!errorOccurred) {
              errorOccurred = true;
              showYouTubeFallback(el, src);
            }
          };
          const timeout = setTimeout(() => {
            if (!iframe.contentWindow && !errorOccurred) {
              errorOccurred = true;
              showYouTubeFallback(el, src);
            }
          }, 10000);

          iframe.onload = function() {
            clearTimeout(timeout);
            el.classList.add('loaded');
            obs.unobserve(el);
          };

          el.addEventListener('remove', function() {
            clearTimeout(timeout);
          });

          el.innerHTML = '';
          el.style.position = 'relative';
          el.style.paddingBottom = '56.25%';
          el.style.background = '#000';
          el.style.borderRadius = '12px';
          el.style.overflow = 'hidden';
          iframe.style.position = 'absolute';
          iframe.style.top = '0';
          iframe.style.left = '0';
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          el.appendChild(iframe);
          el.classList.add('loaded');
        });
      }, { rootMargin: '200px' });

      document.querySelectorAll('.lazy-yt').forEach((el) => {
        if (el.querySelector('iframe')) return;
        obs.observe(el);
      });
    } else {
      document.querySelectorAll('.lazy-yt').forEach((el) => {
        if (el.querySelector('iframe')) return;
        const src = el.dataset.src;
        if (!src) return;
        const videoId = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/)?.[1];
        if (!videoId) {
          el.innerHTML = `<div class="yt-fallback">⚠️ ${window.I18n?.translate('videoLoadFailed') || 'Video load failed'}</div>`;
          return;
        }
        const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1`;
        const iframe = document.createElement('iframe');
        iframe.src = embedUrl;
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allowfullscreen', '');
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.borderRadius = '12px';
        el.innerHTML = '';
        el.style.position = 'relative';
        el.style.paddingBottom = '56.25%';
        el.style.background = '#000';
        el.style.borderRadius = '12px';
        el.style.overflow = 'hidden';
        iframe.style.position = 'absolute';
        iframe.style.top = '0';
        iframe.style.left = '0';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        el.appendChild(iframe);
        el.classList.add('loaded');
      });
    }
  }

  function loadDustParticles() {
    if (document.querySelector('script[src="js/dust-particles.js"]')) return;
    const script = document.createElement('script');
    script.src = 'js/dust-particles.js';
    script.defer = true;
    script.onload = () => {};
    script.onerror = () => console.warn('Failed to load dust particles');
    document.head.appendChild(script);
  }

  function showUpdateNotification() {
    if (sessionStorage.getItem('update_notification_shown')) return;
    sessionStorage.setItem('update_notification_shown', '1');
    const t = window.I18n?.translate || (k => k);
    const note = document.createElement('div');
    note.id = 'update-notification';
    note.style.cssText =
      'position: fixed; bottom: 90px; right: 24px; z-index: 10001;' +
      'background: var(--accent); color: #fff; padding: 12px 20px;' +
      'border-radius: 40px; box-shadow: 0 6px 14px rgba(0,0,0,0.4);' +
      'font-family: "Russo One", sans-serif; display: flex; align-items: center; gap: 12px;';
    note.innerHTML = `<span>${t('newVersionAvailable')}</span><button id="update-btn" style="background:white;color:var(--accent);border:none;padding:6px 16px;border-radius:20px;cursor:pointer;font-family:inherit;">${t('updateBtn')}</button>`;
    document.body.appendChild(note);
    document.getElementById('update-btn').addEventListener('click', () => { window.location.reload(); });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js')
      .then(registration => {
        console.log('Service Worker зарегистрирован, scope:', registration.scope);
        if (registration.waiting) showUpdateNotification();
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) showUpdateNotification();
          });
        });
      })
      .catch(error => console.error('Ошибка регистрации Service Worker:', error));
  }

  function initDownloadConsent() {
    const CONSENT_KEY = 'download_consent_given_v1';
    const consentGiven = localStorage.getItem(CONSENT_KEY) === 'true';
    const t = window.I18n?.translate || (k => k);
    function showConsentModal(callback) {
      const modal = document.createElement('div');
      modal.className = 'modal modal-fullscreen';
      modal.style.backgroundColor = 'rgba(0,0,0,0.85)';
      modal.innerHTML = `
        <div class="modal-content-full" style="max-width: 550px; text-align: center;">
          <div class="modal-header"><h2>⚠️ ВАЖНОЕ ПРЕДУПРЕЖДЕНИЕ</h2><button class="modal-close"><i class="fas fa-times"></i></button></div>
          <div class="modal-body" style="text-align: left;">
            <p><strong>${t('licenseConfirmDesc')}</strong></p>
            <ul style="margin: 15px 0; padding-left: 20px;">
              <li>${t('licenseAccept')} <strong><a href="license.html" target="_blank">${t('licenseLink')}</a></strong>.</li>
              <li>${t('licenseModDisclaimer')}</li>
            </ul>
            <label style="display: flex; align-items: center; gap: 10px; margin-top: 15px; cursor: pointer;">
              <input type="checkbox" id="consent-checkbox"> ${t('licenseConfirmCheckbox')}
            </label>
          </div>
          <div class="modal-footer" style="padding: 20px; display: flex; justify-content: flex-end; gap: 12px;">
            <button class="button" id="consent-cancel">${t('feedbackCancel')}</button>
            <button class="button" id="consent-confirm" disabled style="background: var(--accent);">${t('licenseConfirmButton')}</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      const closeModal = () => { modal.remove(); document.body.style.overflow = ''; };
      const checkbox = modal.querySelector('#consent-checkbox');
      const confirmBtn = modal.querySelector('#consent-confirm');
      const cancelBtn = modal.querySelector('#consent-cancel');
      const closeBtn = modal.querySelector('.modal-close');
      checkbox.addEventListener('change', () => { confirmBtn.disabled = !checkbox.checked; });
      const onConfirm = () => {
        if (!checkbox.checked) return;
        localStorage.setItem(CONSENT_KEY, 'true');
        localStorage.setItem('consent_timestamp', Date.now().toString());
        closeModal();
        if (callback) callback();
      };
      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click', closeModal);
      closeBtn.addEventListener('click', closeModal);
      modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    }
    function handleDownloadClick(e) {
      let target = e.target.closest('.download-button, #github-download-btn, .cloud-buttons a, .store-buttons a');
      if (!target) return;
      if (target.classList && target.classList.contains('disabled')) { e.preventDefault(); return; }
      if (consentGiven) return;
      e.preventDefault();
      const originalHref = target.href;
      if (!originalHref || originalHref === '#') return;
      showConsentModal(() => { window.open(originalHref, target.target || '_blank'); });
    }
    document.body.addEventListener('click', handleDownloadClick);
  }

  function initRateLimits() {
    if (window.RateLimits) {
      window.RateLimits.init();
      window.addEventListener('github-auth-ready', () => {
        const profile = document.querySelector('.nav-profile');
        if (profile) {
          const dropdown = profile.querySelector('.profile-dropdown');
          if (dropdown && !dropdown.querySelector('[data-action="rate-panel"]')) {
            const item = document.createElement('div');
            item.className = 'profile-dropdown-item';
            item.dataset.action = 'rate-panel';
            const t = window.I18n?.translate || (k => k);
            item.innerHTML = `<i class="fas fa-chart-bar"></i> ${t('ratePanel')}`;
            const divider = dropdown.querySelector('.profile-dropdown-divider');
            if (divider) {
              dropdown.insertBefore(item, divider);
            } else {
              dropdown.appendChild(item);
            }
          }
        }
      });
    } else {
      const script = document.createElement('script');
      script.src = 'js/features/rate-limits.js';
      script.defer = true;
      script.onload = () => {
        if (window.RateLimits) {
          window.RateLimits.init();
          window.dispatchEvent(new CustomEvent('github-auth-ready'));
        }
      };
      document.head.appendChild(script);
    }
  }

  // Функция обновления всех динамических элементов при смене языка
  function refreshDynamicUI() {
    if (window.FeedbackPage?.refresh) window.FeedbackPage.refresh();
    if (window.refreshGameUpdates && window.currentGame) window.refreshGameUpdates(window.currentGame);
    if (window.refreshNewsFeed) window.refreshNewsFeed();
    if (window.initPlatform) window.initPlatform();
  }

  // Подписываемся на смену языка
  window.addEventListener('languageChanged', () => {
    refreshDynamicUI();
  });

  // ==== НОВОЕ: запуск модулей только после загрузки переводов ====
  function initPageModules() {
    if (window.initNewsFeed) window.initNewsFeed();
    if (window.initFeedback) window.initFeedback();
    if (window.initGameUpdates) window.initGameUpdates();
    if (window.initPlatform) window.initPlatform();
  }

  function waitForLanguage() {
    // Если переводы уже загружены – запускаем сразу
    if (window.I18n && window.I18n.getCurrentLang && window.I18n.getCurrentLang() !== null) {
      // Проверяем, что translations загружены (если есть хоть один ключ)
      const testKey = window.I18n.translate('siteTitle');
      if (testKey !== 'siteTitle') {
        initPageModules();
        return;
      }
    }
    // Слушаем событие загрузки языка
    document.addEventListener('languageLoaded', initPageModules, { once: true });
    // Запасной вариант: если событие уже было, но мы его пропустили
    if (window.I18n && window.I18n.getCurrentLang && window.I18n.getCurrentLang() !== null) {
      setTimeout(() => {
        const testKey = window.I18n.translate('siteTitle');
        if (testKey !== 'siteTitle') {
          initPageModules();
        }
      }, 100);
    }
  }

  // Инициализация, не зависящая от переводов
  function initNonLanguageDependent() {
    preloadFont();
    loadPageScripts();
    ensureMarked().then(() => {
      // ничего не делаем
    });
    initLazyYT();
    loadDustParticles();
    registerServiceWorker();
    initDownloadConsent();
    initRateLimits();
  }

  // Запуск
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initNonLanguageDependent();
      waitForLanguage();
    });
  } else {
    initNonLanguageDependent();
    waitForLanguage();
  }
})();