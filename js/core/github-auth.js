// js/core/github-auth.js – с локализацией, обновление меню при смене языка
(function() {
  const { createElement, escapeHtml, cacheGet, cacheSet, cacheRemove, loadModule } = window.Utils;
  const GitHubClient = window.GitHubClient;
  const client = window.GitHubAPIClient;

  const TOKEN_KEY = 'github_token';
  const USER_CACHE_KEY = 'github_user';
  const SCOPES_CACHE_KEY = 'github_scopes';
  const LAST_LOGIN_ATTEMPT_KEY = 'last_login_attempt';
  const LOGIN_COOLDOWN = 10000;

  let currentUserLogin = null;
  let currentScopes = [];
  let modal, tokenInput, tokenToggle, profileContainer;

  document.addEventListener('DOMContentLoaded', () => {
    const navBar = document.querySelector('.nav-bar');
    if (!navBar) return;

    profileContainer = createElement('div', 'nav-profile', {}, { role: 'button', tabindex: '0' });
    const langSwitcher = document.querySelector('.lang-switcher');
    navBar.insertBefore(profileContainer, langSwitcher || null);
    createLoginModal();
    restoreSession();

    window.addEventListener('github-login-requested', () => {
      if (modal) modal.classList.add('active');
      else {
        if (!modal) createLoginModal();
        modal.classList.add('active');
        if (tokenInput) tokenInput.focus();
      }
    });

    // Обновление интерфейса при смене языка
    window.addEventListener('languageChanged', () => {
      refreshProfileMenu();
    });
    // Также при загрузке переводов
    window.addEventListener('languageLoaded', () => {
      refreshProfileMenu();
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
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      renderLoggedOutUI();
      return;
    }

    updateClientToken(token);

    const cachedUser = sessionStorage.getItem(USER_CACHE_KEY);
    const cachedScopes = sessionStorage.getItem(SCOPES_CACHE_KEY);
    if (cachedUser) {
      try {
        const user = JSON.parse(cachedUser);
        currentUserLogin = user.login;
        currentScopes = cachedScopes ? JSON.parse(cachedScopes) : [];
        renderLoggedInUI(user);
        if (window.GithubCore?.CONFIG?.ALLOWED_AUTHORS?.includes(user.login)) preloadAdminModules();
        return;
      } catch (e) {}
    }

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
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(USER_CACHE_KEY);
        sessionStorage.removeItem(SCOPES_CACHE_KEY);
        updateClientToken(null);
        renderLoggedOutUI();
        window.UIUtils?.showToast('Токен недействителен. Войдите снова.', 'error');
        return;
      }
      renderLoggedOutUI();
      return;
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
    `;
    modal.innerHTML = `
      <div class="modal-content" style="
        max-width: 480px;
        width: 90%;
        background: var(--glass-bg);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-radius: var(--radius-lg);
        border: 1px solid var(--glass-border);
        box-shadow: var(--shadow), 0 0 40px rgba(61,158,179,0.05);
        padding: 32px 28px;
        position: relative;
        overflow: hidden;
        transition: transform 0.3s, opacity 0.3s;
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

        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 20px;">
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

        <div style="
          margin-bottom: 24px;
          padding: 14px 16px;
          background: rgba(0,0,0,0.2);
          border-radius: var(--radius-sm);
          border-left: 3px solid var(--accent);
          font-size: 14px;
          line-height: 1.5;
          color: var(--text-secondary);
        ">
          <p style="margin: 0 0 6px 0;">
            <i class="fas fa-info-circle" style="color: var(--accent); margin-right: 8px;"></i>
            ${t('githubTokenNote')}
          </p>
          <p style="margin: 0; font-size: 13px;">
            <a href="https://github.com/settings/tokens" target="_blank" style="color: var(--accent); text-decoration: none; border-bottom: 1px dotted var(--accent);">
              <i class="fas fa-external-link-alt"></i> Создать токен
            </a>
          </p>
        </div>

        <div style="position: relative; margin-bottom: 24px;">
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

        <div id="modal-error-container" style="margin-bottom: 16px;"></div>

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
          ">${t('feedbackCancel')}</button>
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
            <span style="position: relative; z-index: 1;">${t('githubLoginBtn')}</span>
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
      `;
      document.head.appendChild(style);
    }

    tokenInput = document.getElementById('github-token-input');
    tokenToggle = document.getElementById('token-toggle');
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
  }

  function closeModal() {
    modal.classList.remove('active');
    tokenInput.value = '';
    tokenInput.type = 'password';
    tokenToggle.innerHTML = '<i class="fas fa-eye"></i>';
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
      if (save) {
        localStorage.setItem(TOKEN_KEY, token);
        sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData.user));
        sessionStorage.setItem(SCOPES_CACHE_KEY, JSON.stringify(userData.scopes));
        updateClientToken(token);
      }
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
        localStorage.removeItem(TOKEN_KEY);
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
        <div class="profile-dropdown-item" data-action="revoke-token"><i class="fas fa-external-link-alt"></i> ${t('manageTokens')}</div>
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
        modal.classList.add('active');
        tokenInput.focus();
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
        if (!currentScopes.includes('gist')) return window.UIUtils?.showToast(t('needGistScope'), 'error');
        if (!window.BookmarkStorage) {
          try { await window.Utils.loadModule('js/features/storage.js'); } catch { return window.UIUtils?.showToast(t('loadModulesError'), 'error'); }
        }
        window.BookmarkStorage?.openStorageModal();
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
        localStorage.removeItem(TOKEN_KEY);
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

  // ==== НОВОЕ: перерисовка меню при загрузке/смене языка ====
  function refreshProfileMenu() {
    // Если пользователь залогинен – перерисовываем залогиненное меню, иначе – выходное
    const token = localStorage.getItem(TOKEN_KEY);
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
    getToken: () => localStorage.getItem(TOKEN_KEY),
    getScopes: () => currentScopes,
    hasScope: scope => currentScopes.includes(scope),
    isAdmin: () => currentUserLogin && window.GithubCore?.CONFIG?.ALLOWED_AUTHORS?.includes(currentUserLogin),
    updateToken: updateClientToken
  };
})();