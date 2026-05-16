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

  function showUpdateNotification() {
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

  // ---------- Обязательное предупреждение 18+ и медицинских рисков перед скачиванием ----------
  function initDownloadConsent() {
    const CONSENT_KEY = 'download_consent_given_v1';
    const consentGiven = localStorage.getItem(CONSENT_KEY) === 'true';

    function showConsentModal(callback) {
      const modal = document.createElement('div');
      modal.className = 'modal modal-fullscreen';
      modal.style.backgroundColor = 'rgba(0,0,0,0.85)';
      modal.innerHTML = `
        <div class="modal-content-full" style="max-width: 550px; text-align: center;">
          <div class="modal-header">
            <h2>⚠️ ВАЖНОЕ ПРЕДУПРЕЖДЕНИЕ</h2>
            <button class="modal-close"><i class="fas fa-times"></i></button>
          </div>
          <div class="modal-body" style="text-align: left;">
            <p><strong>Подтвердите, прежде чем скачать игру:</strong></p>
            <ul style="margin: 15px 0; padding-left: 20px;">
              <li>Я принимаю <strong><a href="license.html" target="_blank">лицензионное соглашение</a></strong> и осознаю, что разработчики не несут ответственности за любой вред здоровью или имуществу.</li>
              <li>Я понимаю, что сторонние моды устанавливаю на свой страх и риск.</li>
            </ul>
            <label style="display: flex; align-items: center; gap: 10px; margin-top: 15px; cursor: pointer;">
              <input type="checkbox" id="consent-checkbox"> Я подтверждаю все вышеуказанные условия и согласен(на) с ними.
            </label>
          </div>
          <div class="modal-footer" style="padding: 20px; display: flex; justify-content: flex-end; gap: 12px;">
            <button class="button" id="consent-cancel">Отмена</button>
            <button class="button" id="consent-confirm" disabled style="background: var(--accent);">Продолжить</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';

      const closeModal = () => {
        modal.remove();
        document.body.style.overflow = '';
      };

      const checkbox = modal.querySelector('#consent-checkbox');
      const confirmBtn = modal.querySelector('#consent-confirm');
      const cancelBtn = modal.querySelector('#consent-cancel');
      const closeBtn = modal.querySelector('.modal-close');

      checkbox.addEventListener('change', () => {
        confirmBtn.disabled = !checkbox.checked;
      });

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
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    function handleDownloadClick(e) {
      let target = e.target.closest('.download-button, #github-download-btn, .cloud-buttons a, .store-buttons a');
      if (!target) return;
      if (target.classList && target.classList.contains('disabled')) {
        e.preventDefault();
        return;
      }
      if (consentGiven) return;

      e.preventDefault();
      const originalHref = target.href;
      if (!originalHref || originalHref === '#') return;

      showConsentModal(() => {
        window.open(originalHref, target.target || '_blank');
      });
    }

    document.body.addEventListener('click', handleDownloadClick);
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
      initDownloadConsent();
    });
  } else {
    initLazyYT();
    initDonateBtn();
    registerServiceWorker();
    initDownloadConsent();
  }
})();