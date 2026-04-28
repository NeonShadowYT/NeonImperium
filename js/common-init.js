// js/common-init.js – shared lazy‑loading, donation button, Service Worker registration with update notification
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

  // Уведомление о новой версии: показываем только один раз за сессию
  function showUpdateNotification() {
    // Если уже показывали в этой сессии, не показываем снова
    if (sessionStorage.getItem('update_notification_shown')) return;
    sessionStorage.setItem('update_notification_shown', '1');

    const note = document.createElement('div');
    note.id = 'update-notification';
    note.style.cssText =
      'position: fixed; bottom: 90px; right: 24px; z-index: 10001;' +
      'background: var(--accent); color: #fff; padding: 12px 20px;' +
      'border-radius: 40px; box-shadow: 0 6px 14px rgba(0,0,0,0.4);' +
      'font-family: "Russo One", sans-serif; display: flex; align-items: center; gap: 12px;';
    note.innerHTML =
      '<span>Доступна новая версия.</span>' +
      '<button id="update-btn" style="background:white;color:var(--accent);border:none;padding:6px 16px;border-radius:20px;cursor:pointer;font-family:inherit;">Обновить</button>';
    document.body.appendChild(note);
    document.getElementById('update-btn').addEventListener('click', () => {
      window.location.reload();
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js')
      .then(registration => {
        console.log('Service Worker зарегистрирован, scope:', registration.scope);
        // При обнаружении ожидающего нового воркера показываем уведомление
        if (registration.waiting) {
          showUpdateNotification();
        }
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateNotification();
            }
          });
        });
      })
      .catch(error => console.error('Ошибка регистрации Service Worker:', error));
  }

  window.addEventListener('unhandledrejection', function(event) {
    if (event.reason && event.reason.message && event.reason.message.includes('Failed to fetch')) {
      event.preventDefault();
    }
  }, { capture: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initLazyYT();
      initDonateBtn();
      registerServiceWorker();
    });
  } else {
    initLazyYT();
    initDonateBtn();
    registerServiceWorker();
  }
})();