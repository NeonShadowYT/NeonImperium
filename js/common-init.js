// js/common-init.js – инициализация после загрузки переводов
// Использует DomUtils, Animations, VideoManager
(function() {
  // ---- Единое определение мобильного устройства ----
  const isMobile = (() => {
    const hasTouch = window.matchMedia('(pointer: coarse)').matches || 
                    window.matchMedia('(hover: none)').matches ||
                    ('ontouchstart' in window);
    const isNarrow = window.innerWidth <= 768;
    return hasTouch || isNarrow;
  })();

  window.isMobile = isMobile;

  (function addMobileClass() {
    if (document.body) {
      document.body.classList.toggle('is-mobile', isMobile);
    } else {
      const observer = new MutationObserver(() => {
        if (document.body) {
          document.body.classList.toggle('is-mobile', isMobile);
          observer.disconnect();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  })();

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

  function loadDustParticles() {
    if (window.isMobile) {
      console.log('[common-init] Dust particles disabled on mobile');
      return;
    }
    if (document.querySelector('script[src="js/dust-particles.js"]')) return;
    const script = document.createElement('script');
    script.src = 'js/dust-particles.js';
    script.defer = true;
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

  async function loadStorageModules() {
    const modules = [
      'js/features/storage/core.js',
      'js/features/storage/metadata.js',
      'js/features/storage/manager.js',
      'js/features/storage/ui.js',
      'js/features/storage/index.js'
    ];
    for (const src of modules) {
      if (!document.querySelector(`script[src="${src}"]`)) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = src;
          script.defer = true;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
    }
  }

  function transformLangSwitcherToDropdown() {
    const switcher = document.querySelector('.lang-switcher');
    if (!switcher) return;
    switcher.innerHTML = '';

    const currentLang = window.I18n?.getCurrentLang() || 'ru';

    const dropdown = document.createElement('div');
    dropdown.className = 'lang-dropdown';

    const btn = document.createElement('button');
    btn.className = 'lang-dropdown-btn';
    btn.textContent = currentLang.toUpperCase();
    dropdown.appendChild(btn);

    const menu = document.createElement('div');
    menu.className = 'lang-dropdown-menu';
    const languages = [
      { code: 'ru', label: 'Русский' },
      { code: 'en', label: 'English' }
    ];
    languages.forEach(lang => {
      const item = document.createElement('div');
      item.className = 'lang-dropdown-item' + (lang.code === currentLang ? ' active' : '');
      item.textContent = lang.label;
      item.dataset.langCode = lang.code;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        window.I18n?.setLanguage(lang.code);
        menu.classList.remove('open');
        btn.textContent = lang.code.toUpperCase();
        menu.querySelectorAll('.lang-dropdown-item').forEach(el => el.classList.toggle('active', el.dataset.langCode === lang.code));
      });
      menu.appendChild(item);
    });
    dropdown.appendChild(menu);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', () => {
      menu.classList.remove('open');
    });

    switcher.appendChild(dropdown);
  }

  function initPageModules() {
    if (window.initNewsFeed) window.initNewsFeed();
    if (window.initFeedback) window.initFeedback();
    if (window.initGameUpdates) window.initGameUpdates();
    if (window.initPlatform) window.initPlatform();
    const user = window.GithubAuth?.getCurrentUser();
    if (user && window.GithubCore?.CONFIG?.ALLOWED_AUTHORS?.includes(user)) {
      loadStorageModules().catch(() => {});
    }
  }

  function waitForLanguageAndInit() {
    if (window.I18n && window.I18n.getCurrentLang && window.I18n.getCurrentLang() !== null) {
      const testKey = window.I18n.translate('siteTitle');
      if (testKey !== 'siteTitle') {
        initPageModules();
        transformLangSwitcherToDropdown();
        return;
      }
    }
    document.addEventListener('languageLoaded', () => {
      initPageModules();
      transformLangSwitcherToDropdown();
    }, { once: true });
    setTimeout(() => {
      if (window.I18n && window.I18n.getCurrentLang && window.I18n.getCurrentLang() !== null) {
        const testKey = window.I18n.translate('siteTitle');
        if (testKey !== 'siteTitle') {
          initPageModules();
          transformLangSwitcherToDropdown();
        }
      }
    }, 500);
  }

  function initNonLanguageDependent() {
    loadPageScripts();
    ensureMarked().then(() => {});
    // Инициализация видео через VideoManager
    if (window.VideoManager) {
      window.VideoManager.initLazyVideo();
      window.VideoManager.initDescVideoControls();
    } else {
      // Fallback: загружаем видео менеджер, если ещё не загружен
      const script = document.createElement('script');
      script.src = 'js/features/video-manager.js';
      script.defer = true;
      script.onload = () => {
        if (window.VideoManager) {
          window.VideoManager.initLazyVideo();
          window.VideoManager.initDescVideoControls();
        }
      };
      document.head.appendChild(script);
    }
    loadDustParticles();
    registerServiceWorker();
    initDownloadConsent();
    initRateLimits();
    // Загружаем Storage core
    const storageCore = document.createElement('script');
    storageCore.src = 'js/features/storage/core.js';
    storageCore.defer = true;
    document.head.appendChild(storageCore);
    const storageMetadata = document.createElement('script');
    storageMetadata.src = 'js/features/storage/metadata.js';
    storageMetadata.defer = true;
    document.head.appendChild(storageMetadata);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (window.isMobile) document.body.classList.add('is-mobile');
      initNonLanguageDependent();
      waitForLanguageAndInit();
    });
  } else {
    if (window.isMobile) document.body.classList.add('is-mobile');
    initNonLanguageDependent();
    waitForLanguageAndInit();
  }

  window.loadStorageModules = loadStorageModules;
})();