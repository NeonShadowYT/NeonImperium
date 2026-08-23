// js/core/github-auth.js – с локализацией, обновление меню при смене языка
// Исправлено расположение элементов в модалке: ссылка и чекбокс слева, кнопки справа

(function() {
  const { createElement, escapeHtml, cacheGet, cacheSet, cacheRemove, loadModule, xorEncrypt, xorDecrypt, generateRandomKey } = window.Utils;
  const GitHubClient = window.GitHubClient;
  const client = window.GitHubAPIClient;

  const TOKEN_KEY = 'github_token';               // sessionStorage
  const TOKEN_LOCAL_KEY = 'github_token_local';   // localStorage (обфусцированный)
  const USER_CACHE_KEY = 'github_user';
  const SCOPES_CACHE_KEY = 'github_scopes';
  const LAST_LOGIN_ATTEMPT_KEY = 'last_login_attempt';
  const LOGIN_COOLDOWN = 10000;
  const REMEMBER_ME_KEY = 'remember_me'; // флаг в localStorage

  const OBFUSCATION_SALT = 'neon-github-token-salt-2024';

  let currentUserLogin = null;
  let currentScopes = [];
  let modal, tokenInput, tokenToggle, profileContainer, rememberCheckbox;
  let modalCreated = false;

  document.addEventListener('DOMContentLoaded', () => {
    const navBar = document.querySelector('.nav-bar');
    if (!navBar) return;

    profileContainer = createElement('div', 'nav-profile', {}, { role: 'button', tabindex: '0' });
    const langSwitcher = document.querySelector('.lang-switcher');
    navBar.insertBefore(profileContainer, langSwitcher || null);

    if (window.I18n && window.I18n.getCurrentLang()) {
      createLoginModal();
    } else {
      document.addEventListener('languageLoaded', createLoginModal);
    }

    restoreSession();

    window.addEventListener('github-login-requested', () => {
      if (!modal) createLoginModal();
      modal.classList.add('active');
      if (tokenInput) tokenInput.focus();
    });

    window.addEventListener('languageChanged', () => {
      refreshProfileMenu();
      updateLoginModalTexts();
    });
    window.addEventListener('languageLoaded', () => {
      refreshProfileMenu();
      updateLoginModalTexts();
    });

    window.dispatchEvent(new CustomEvent('github-auth-ready'));
  });

  function updateClientToken(token) {
    if (client && client.updateToken) {
      client.updateToken(token);
    } else if (window.GitHubAPIClient && window.GitHubAPIClient.updateToken) {
      window.GitHubAPIClient.updateToken(token);
    }
    if (window._githubClientInstance && window._githubClientInstance.setToken) {
      window._githubClientInstance.setToken(token);
    }
  }

  async function restoreSession() {
    let token = sessionStorage.getItem(TOKEN_KEY);
    if (token) {
      try {
        const userData = await silentValidateToken(token);
        if (userData) {
          currentUserLogin = userData.user.login;
          currentScopes = userData.scopes;
          sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData.user));
          sessionStorage.setItem(SCOPES_CACHE_KEY, JSON.stringify(userData.scopes));
          renderLoggedInUI(userData.user);
          if (window.GithubCore?.CONFIG?.ALLOWED_AUTHORS?.includes(userData.user.login)) preloadAdminModules();
          window.dispatchEvent(new CustomEvent('github-login-success', {
            detail: { login: userData.user.login, scopes: userData.scopes }
          }));
          return;
        }
      } catch (err) {
        if (err.message === 'unauthorized' || err.message?.includes('401')) {
          sessionStorage.removeItem(TOKEN_KEY);
        }
      }
    }

    const remember = localStorage.getItem(REMEMBER_ME_KEY) === 'true';
    if (remember) {
      const obfuscated = localStorage.getItem(TOKEN_LOCAL_KEY);
      if (obfuscated) {
        const decrypted = xorDecrypt(obfuscated, OBFUSCATION_SALT);
        if (decrypted) {
          token = decrypted;
          try {
            const userData = await silentValidateToken(token);
            if (userData) {
              sessionStorage.setItem(TOKEN_KEY, token);
              currentUserLogin = userData.user.login;
              currentScopes = userData.scopes;
              sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData.user));
              sessionStorage.setItem(SCOPES_CACHE_KEY, JSON.stringify(userData.scopes));
              renderLoggedInUI(userData.user);
              if (window.GithubCore?.CONFIG?.ALLOWED_AUTHORS?.includes(userData.user.login)) preloadAdminModules();
              window.dispatchEvent(new CustomEvent('github-login-success', {
                detail: { login: userData.user.login, scopes: userData.scopes }
              }));
              return;
            }
          } catch (err) {
            if (err.message === 'unauthorized' || err.message?.includes('401')) {
              localStorage.removeItem(TOKEN_LOCAL_KEY);
              localStorage.removeItem(REMEMBER_ME_KEY);
              sessionStorage.removeItem(TOKEN_KEY);
            }
          }
        }
      }
    }

    renderLoggedOutUI();
  }

  async function silentValidateToken(token) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (resp.status === 401) throw new Error('unauthorized');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const scopesHeader = resp.headers.get('X-OAuth-Scopes');
      const scopes = scopesHeader ? scopesHeader.split(',').map(s => s.trim()) : [];
      const user = await resp.json();
      return { user, scopes };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  function createLoginModal() {
    if (modalCreated) return;
    modalCreated = true;

    const t = window.I18n?.translate || (k => k);
    modal = createElement('div', 'modal', {}, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'github-modal-title' });
    modal.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      z-index: 2000;
      align-items: center;
      justify-content: center;
      animation: modalFadeIn 0.3s cubic-bezier(0.2, 0.9, 0.4, 1);
      padding: 20px;
      box-sizing: border-box;
    `;
    modal.innerHTML = `
      <div class="modal-content" style="
        max-width: 480px;
        width: 100%;
        max-height: 90vh;
        overflow-y: auto;
        background: var(--glass-bg);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-radius: var(--radius-lg);
        border: 1px solid var(--glass-border);
        box-shadow: var(--shadow), 0 0 40px rgba(61,158,179,0.05);
        padding: 32px 28px;
        position: relative;
        overflow: hidden;
      ">
        <div style="
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          background: linear-gradient(90deg, transparent, var(--accent), var(--accent-light), var(--accent), transparent);
          background-size: 200% 100%;
          animation: shimmer 3s infinite linear;
        "></div>

        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 16px;">
          <div style="
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: rgba(61,158,179,0.12);
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid var(--accent);
            box-shadow: var(--neon-glow);
          ">
            <i class="fab fa-github" style="font-size: 28px; color: var(--accent);"></i>
          </div>
          <h3 id="github-modal-title" style="
            margin: 0;
            color: var(--text-primary);
            font-size: 26px;
            letter-spacing: 0.5px;
            text-shadow: var(--neon-text-glow);
          ">${t('githubLoginTitle')}</h3>
        </div>

        <!-- Аккордеон "Зачем это нужно?" -->
        <div style="margin-bottom: 16px;">
          <button id="why-need-toggle" style="
            background: transparent;
            border: 1px solid var(--glass-border);
            border-radius: var(--radius-pill);
            padding: 8px 16px;
            color: var(--accent);
            cursor: pointer;
            font-family: var(--font-family);
            font-size: 14px;
            transition: all 0.2s;
            width: 100%;
            text-align: left;
            display: flex;
            align-items: center;
            gap: 8px;
          ">
            <i class="fas fa-info-circle"></i> <span data-lang="whyNeed">${t('whyNeed')}</span>
            <span style="margin-left: auto; transition: transform 0.3s ease;">▾</span>
          </button>
          <div id="why-need-content" style="
            display: none;
            margin-top: 12px;
            padding: 14px 16px;
            background: rgba(0,0,0,0.2);
            border-radius: var(--radius-sm);
            border-left: 3px solid var(--accent);
            font-size: 14px;
            line-height: 1.6;
            color: var(--text-secondary);
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 200px;
            overflow-y: auto;
          ">
            ${t('loginDescription')}
          </div>
        </div>

        <!-- Поле ввода токена -->
        <div style="position: relative; margin-bottom: 12px;">
          <input
            type="password"
            id="github-token-input"
            placeholder="github_pat_xxx..."
            autocomplete="off"
            style="
              width: 100%;
              padding: 14px 16px;
              padding-right: 48px;
              background: rgba(0,0,0,0.25);
              border: 1px solid var(--glass-border);
              border-radius: var(--radius-pill);
              color: var(--text-primary);
              font-family: monospace;
              font-size: 15px;
              transition: border-color 0.3s, box-shadow 0.3s;
              outline: none;
            "
          >
          <button
            type="button"
            id="token-toggle"
            style="
              position: absolute;
              right: 12px;
              top: 50%;
              transform: translateY(-50%);
              background: transparent;
              border: none;
              color: var(--text-secondary);
              cursor: pointer;
              font-size: 18px;
              padding: 4px 8px;
              transition: color 0.2s;
            "
          >
            <i class="fas fa-eye"></i>
          </button>
        </div>

        <!-- Ссылка на создание токена и чекбокс (слева) -->
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
          <a href="https://github.com/settings/tokens/new" target="_blank" style="color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent); font-size: 13px; align-self: flex-start;">
            <i class="fas fa-external-link-alt"></i> <span data-lang="createToken">${t('createToken')}</span>
          </a>
          <label class="custom-checkbox" style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: var(--text-secondary); font-size: 14px;">
            <input type="checkbox" id="remember-me-checkbox" style="display: none;">
            <span class="checkmark" style="display: inline-block; width: 20px; height: 20px; background: rgba(0,0,0,0.25); border: 2px solid var(--glass-border); border-radius: 6px; position: relative; transition: all 0.2s; flex-shrink: 0;"></span>
            <span data-lang="rememberMe">${t('rememberMe')}</span>
          </label>
        </div>

        <div id="modal-error-container" style="margin-bottom: 16px;"></div>

        <!-- Кнопки справа -->
        <div style="display: flex; gap: 12px; justify-content: flex-end;">
          <button class="button" id="modal-cancel" style="
            background: var(--glass-bg);
            backdrop-filter: blur(4px);
            color: var(--text-secondary);
            border: 1px solid var(--glass-border);
            padding: 10px 24px;
            border-radius: var(--radius-pill);
            font-family: var(--font-family);
            cursor: pointer;
            transition: all var(--transition);
          " data-lang="feedbackCancel">${t('feedbackCancel')}</button>
          <button class="button" id="modal-submit" style="
            background: var(--accent);
            color: #fff;
            padding: 10px 28px;
            border-radius: var(--radius-pill);
            border: none;
            font-family: var(--font-family);
            cursor: pointer;
            transition: all var(--transition);
            box-shadow: 0 0 20px rgba(61,158,179,0.2);
            position: relative;
            overflow: hidden;
          ">
            <span style="position: relative; z-index: 1;" data-lang="githubLoginBtn">${t('githubLoginBtn')}</span>
            <span style="
              position: absolute;
              inset: 0;
              background: radial-gradient(circle at var(--ripple-x, 50%) var(--ripple-y, 50%), rgba(255,255,255,0.2) 0%, transparent 60%);
              opacity: 0;
              transition: opacity 0.4s;
              pointer-events: none;
            "></span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // ---- Обработчики ----
    // Аккордеон
    const toggleBtn = modal.querySelector('#why-need-toggle');
    const content = modal.querySelector('#why-need-content');
    if (toggleBtn && content) {
      toggleBtn.addEventListener('click', () => {
        const isOpen = content.style.display === 'block';
        content.style.display = isOpen ? 'none' : 'block';
        const icon = toggleBtn.querySelector('span:last-child');
        if (icon) icon.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
      });
    }

    // Кастомный чекбокс
    const checkbox = modal.querySelector('#remember-me-checkbox');
    const checkmark = modal.querySelector('.checkmark');
    if (checkbox && checkmark) {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          checkmark.style.background = 'var(--accent)';
          checkmark.style.borderColor = 'var(--accent)';
          checkmark.innerHTML = '<i class="fas fa-check" style="color:#fff; font-size:14px; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);"></i>';
        } else {
          checkmark.style.background = 'rgba(0,0,0,0.25)';
          checkmark.style.borderColor = 'var(--glass-border)';
          checkmark.innerHTML = '';
        }
      });
    }

    if (!document.getElementById('modal-animations-style')) {
      const style = document.createElement('style');
      style.id = 'modal-animations-style';
      style.textContent = `
        @keyframes modalFadeIn {
          0% { opacity: 0; transform: scale(0.96) translateY(-10px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .modal.active {
          display: flex !important;
          animation: modalFadeIn 0.3s cubic-bezier(0.2, 0.9, 0.4, 1);
        }
        .modal .modal-content {
          animation: modalFadeIn 0.3s cubic-bezier(0.2, 0.9, 0.4, 1);
        }
        #github-token-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px rgba(61,158,179,0.2), 0 0 20px rgba(61,158,179,0.05);
        }
        #modal-submit:hover {
          background: var(--accent-light);
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(61,158,179,0.4);
        }
        #modal-submit:active {
          transform: scale(0.96);
        }
        #modal-submit:active span:last-child {
          opacity: 1;
          transition: opacity 0s;
        }
        #modal-cancel:hover {
          background: rgba(61,158,179,0.12);
          border-color: var(--accent);
          color: var(--text-primary);
        }
        #why-need-toggle:hover {
          border-color: var(--accent);
          background: rgba(61,158,179,0.05);
        }
        #why-need-content {
          transition: opacity 0.3s, transform 0.3s;
        }
        /* Стилизация скроллбара */
        .modal .modal-content::-webkit-scrollbar {
          width: 6px;
        }
        .modal .modal-content::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.1);
          border-radius: 10px;
        }
        .modal .modal-content::-webkit-scrollbar-thumb {
          background: var(--accent);
          border-radius: 10px;
        }
        .modal .modal-content {
          scrollbar-width: thin;
          scrollbar-color: var(--accent) rgba(0,0,0,0.1);
        }
        /* Ссылка создания токена */
        .modal .modal-content a[href*="settings/tokens"] {
          color: var(--accent);
          text-decoration: none;
          border-bottom: 1px dotted var(--accent);
          transition: color 0.2s, border-color 0.2s;
        }
        .modal .modal-content a[href*="settings/tokens"]:hover {
          color: var(--accent-light);
          border-color: var(--accent-light);
        }
      `;
      document.head.appendChild(style);
    }

    tokenInput = document.getElementById('github-token-input');
    tokenToggle = document.getElementById('token-toggle');
    rememberCheckbox = document.getElementById('remember-me-checkbox');
    tokenToggle.addEventListener('click', () => {
      const isPassword = tokenInput.type === 'password';
      tokenInput.type = isPassword ? 'text' : 'password';
      tokenToggle.innerHTML = isPassword ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
    });
    document.getElementById('modal-submit').addEventListener('click', () => {
      const token = tokenInput.value.trim();
      if (token) validateAndLogin(token);
    });
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    window.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('active')) closeModal(); });

    const submitBtn = document.getElementById('modal-submit');
    submitBtn.addEventListener('mousemove', (e) => {
      const rect = submitBtn.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      submitBtn.style.setProperty('--ripple-x', x + '%');
      submitBtn.style.setProperty('--ripple-y', y + '%');
    });

    updateLoginModalTexts();
  }

  function updateLoginModalTexts() {
    if (!modal) return;
    const t = window.I18n?.translate || (k => k);
    const elements = modal.querySelectorAll('[data-lang]');
    elements.forEach(el => {
      const key = el.getAttribute('data-lang');
      if (key) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          if (el.placeholder !== undefined) el.placeholder = t(key);
        } else {
          el.textContent = t(key);
        }
      }
    });
    const title = modal.querySelector('#github-modal-title');
    if (title) title.textContent = t('githubLoginTitle');
    const content = modal.querySelector('#why-need-content');
    if (content) content.innerHTML = t('loginDescription');
    // Обновляем ссылку
    const tokenLink = modal.querySelector('a[href*="settings/tokens/new"] span[data-lang="createToken"]');
    if (tokenLink) tokenLink.textContent = t('createToken');
  }

  function closeModal() {
    modal.classList.remove('active');
    tokenInput.value = '';
    tokenInput.type = 'password';
    tokenToggle.innerHTML = '<i class="fas fa-eye"></i>';
    if (rememberCheckbox) {
      rememberCheckbox.checked = false;
      const checkmark = modal.querySelector('.checkmark');
      if (checkmark) {
        checkmark.style.background = 'rgba(0,0,0,0.25)';
        checkmark.style.borderColor = 'var(--glass-border)';
        checkmark.innerHTML = '';
      }
    }
    const content = modal.querySelector('#why-need-content');
    if (content) content.style.display = 'none';
    const icon = modal.querySelector('#why-need-toggle span:last-child');
    if (icon) icon.style.transform = 'rotate(0deg)';
  }

  async function validateAndLogin(token, save = true) {
    const t = window.I18n?.translate || (k => k);
    const lastAttempt = localStorage.getItem(LAST_LOGIN_ATTEMPT_KEY);
    if (lastAttempt && Date.now() - parseInt(lastAttempt) < LOGIN_COOLDOWN) {
      window.UIUtils?.showToast('Подождите немного перед повторной попыткой входа', 'error');
      return;
    }
    localStorage.setItem(LAST_LOGIN_ATTEMPT_KEY, Date.now().toString());

    if (!token) return;
    profileContainer.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="color:var(--accent);margin:8px;"></i>';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const userData = await silentValidateToken(token);
      if (!userData) throw new Error('empty');
      currentUserLogin = userData.user.login;
      currentScopes = userData.scopes;

      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData.user));
      sessionStorage.setItem(SCOPES_CACHE_KEY, JSON.stringify(userData.scopes));

      const remember = rememberCheckbox && rememberCheckbox.checked;
      if (remember) {
        const obfuscated = xorEncrypt(token, OBFUSCATION_SALT);
        localStorage.setItem(TOKEN_LOCAL_KEY, obfuscated);
        localStorage.setItem(REMEMBER_ME_KEY, 'true');
      } else {
        localStorage.removeItem(TOKEN_LOCAL_KEY);
        localStorage.removeItem(REMEMBER_ME_KEY);
      }

      updateClientToken(token);
      renderLoggedInUI(userData.user);
      closeModal();
      window.dispatchEvent(new CustomEvent('github-login-success', {
        detail: { login: userData.user.login, scopes: userData.scopes }
      }));
      if (window.GithubCore?.CONFIG?.ALLOWED_AUTHORS?.includes(userData.user.login)) preloadAdminModules();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        window.UIUtils?.showToast('Таймаут соединения. Попробуйте снова.', 'error');
      } else if (err.message === 'unauthorized' || err.message?.includes('401')) {
        localStorage.removeItem(TOKEN_LOCAL_KEY);
        localStorage.removeItem(REMEMBER_ME_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(USER_CACHE_KEY);
        sessionStorage.removeItem(SCOPES_CACHE_KEY);
        updateClientToken(null);
        renderLoggedOutUI();
        window.UIUtils?.showToast(t('githubError'), 'error');
      } else {
        window.UIUtils?.showToast('Ошибка соединения: ' + err.message, 'error');
      }
    }
  }

  function renderLoggedInUI(user) {
    const t = window.I18n?.translate || (k => k);
    const hasRepo = currentScopes.includes('repo');
    const hasGist = currentScopes.includes('gist');
    const storageItem = hasGist
      ? `<div class="profile-dropdown-item" data-action="storage"><i class="fas fa-box-archive"></i> ${t('storage')}</div>`
      : '';
    profileContainer.innerHTML = `
      <img src="${user.avatar_url || 'images/default-avatar.webp'}" alt="${user.login}" class="nav-profile-avatar" onerror="this.src='images/default-avatar.webp'" width="32" height="32">
      <span class="nav-profile-login">${escapeHtml(user.login)}</span>
      <i class="fas fa-chevron-right nav-profile-chevron"></i>
      <div class="profile-dropdown">
        <div class="profile-dropdown-item" data-action="profile"><i class="fas fa-user"></i> ${t('profileTitle')}</div>
        <div class="profile-dropdown-item" data-action="token-info"><i class="fas fa-key"></i> ${t('tokenActive')}
          <div style="font-size:11px;margin-left:8px;">
            <span style="color:${hasRepo?'#4caf50':'#ff9800'}"><i class="fas fa-${hasRepo?'check':'exclamation-triangle'}-circle"></i> repo</span>
            <span style="color:${hasGist?'#4caf50':'#ff9800'}"><i class="fas fa-${hasGist?'check':'exclamation-triangle'}-circle"></i> gist</span>
          </div>
        </div>
        ${storageItem}
        <div class="profile-dropdown-item" data-action="rate-panel"><i class="fas fa-chart-bar"></i> ${t('ratePanel')}</div>
        <div class="profile-dropdown-divider"></div>
        <div class="profile-dropdown-item" data-action="logout"><i class="fas fa-sign-out-alt"></i> ${t('logout')}</div>
      </div>
    `;
    bindDropdownEvents();
  }

  function renderLoggedOutUI() {
    const t = window.I18n?.translate || (k => k);
    profileContainer.innerHTML = `
      <span class="nav-profile-login placeholder">${t('loginViaGitHub')}</span>
      <i class="fas fa-chevron-right nav-profile-chevron"></i>
      <div class="profile-dropdown">
        <div class="profile-dropdown-item" data-action="login"><i class="fab fa-github"></i> ${t('loginViaGitHub')}</div>
        <div class="profile-dropdown-item" data-action="about"><i class="fas fa-info-circle"></i> ${t('whyNeed')}</div>
        <div class="profile-dropdown-divider"></div>
        <div class="profile-dropdown-item" data-action="rate-panel"><i class="fas fa-chart-bar"></i> ${t('ratePanel')}</div>
      </div>
    `;
    bindDropdownEvents();
  }

  function bindDropdownEvents() {
    profileContainer.removeEventListener('click', toggleDropdown);
    profileContainer.addEventListener('click', toggleDropdown);
    profileContainer.querySelectorAll('[data-action]').forEach(item => {
      item.addEventListener('click', e => {
        e.stopPropagation();
        handleAction(item.dataset.action);
        profileContainer.classList.remove('active');
      });
    });
  }

  function toggleDropdown(e) {
    e.stopPropagation();
    profileContainer.classList.toggle('active');
  }

  async function handleAction(action) {
    const t = window.I18n?.translate || (k => k);
    switch (action) {
      case 'login':
        if (!modal) createLoginModal();
        modal.classList.add('active');
        if (tokenInput) tokenInput.focus();
        break;
      case 'about':
        window.UIUtils?.showToast(t('githubWarning'), 'info', 8000);
        break;
      case 'profile':
        if (currentUserLogin) window.open(`https://github.com/${currentUserLogin}`, '_blank');
        break;
      case 'token-info':
        window.UIUtils?.showToast(`Вы ${currentUserLogin}, scopes: ${currentScopes.join(', ') || 'нет'}`, 'info', 6000);
        break;
      case 'storage':
        if (!currentScopes.includes('gist')) {
          window.UIUtils?.showToast(t('needGistScope'), 'error');
          return;
        }
        if (!window.BookmarkStorage) {
          try {
            if (typeof window.loadStorageModules === 'function') {
              await window.loadStorageModules();
            } else {
              await window.Utils.loadModule('js/features/storage/index.js');
            }
          } catch (e) {
            console.warn('Storage load error:', e);
            window.UIUtils?.showToast(t('loadModulesError'), 'error');
            return;
          }
        }
        if (!window.BookmarkStorage) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (window.BookmarkStorage && typeof window.BookmarkStorage.openStorageModal === 'function') {
          window.BookmarkStorage.openStorageModal();
        } else {
          window.UIUtils?.showToast(t('loadModulesError'), 'error');
        }
        break;
      case 'rate-panel':
        if (window.RateLimits) {
          window.RateLimits.openRatePanel();
        } else {
          window.UIUtils?.showToast('Модуль лимитов ещё не загружен', 'error');
        }
        break;
      case 'revoke-token':
        window.open('https://github.com/settings/tokens', '_blank');
        break;
      case 'logout':
        localStorage.removeItem(TOKEN_LOCAL_KEY);
        localStorage.removeItem(REMEMBER_ME_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(USER_CACHE_KEY);
        sessionStorage.removeItem(SCOPES_CACHE_KEY);
        updateClientToken(null);
        currentUserLogin = null;
        currentScopes = [];
        renderLoggedOutUI();
        window.dispatchEvent(new CustomEvent('github-logout'));
        window.UIUtils?.showToast(t('logout'), 'info');
        break;
    }
  }

  function preloadAdminModules() {
    window.Utils.loadModule('js/features/editor.js').catch(() => {});
    window.Utils.loadModule('js/features/ui-feedback.js').catch(() => {});
  }

  function refreshProfileMenu() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token && currentUserLogin) {
      const user = sessionStorage.getItem(USER_CACHE_KEY);
      if (user) {
        try {
          const userObj = JSON.parse(user);
          renderLoggedInUI(userObj);
          return;
        } catch (e) {}
      }
    }
    renderLoggedOutUI();
  }

  window.GithubAuth = {
    getCurrentUser: () => currentUserLogin,
    getToken: () => sessionStorage.getItem(TOKEN_KEY),
    getScopes: () => currentScopes,
    hasScope: scope => currentScopes.includes(scope),
    isAdmin: () => currentUserLogin && window.GithubCore?.CONFIG?.ALLOWED_AUTHORS?.includes(currentUserLogin),
    updateToken: updateClientToken
  };
})();