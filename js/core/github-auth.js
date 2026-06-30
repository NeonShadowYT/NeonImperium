// js/core/github-auth.js – аутентификация с performAction для очистки кеша
(function() {
  const { createElement, escapeHtml, cacheGet, cacheSet, cacheRemove, loadModule, performAction } = window.Utils;
  const GitHubClient = window.GitHubClient;
  const client = window.GitHubAPIClient;

  const TOKEN_KEY = 'github_token';
  const USER_CACHE_KEY = 'github_user';
  const SCOPES_CACHE_KEY = 'github_scopes';
  const LAST_CLEAR_KEY = 'last_cache_clear';
  const CLEAR_COOLDOWN = 10000;

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
    modal = createElement('div', 'modal', {}, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'github-modal-title' });
    modal.innerHTML = `
      <div class="modal-content" style="max-width:480px; border-radius:24px; border:1px solid var(--accent); background:var(--bg-card-gradient); box-shadow:0 20px 40px rgba(0,0,0,0.8);">
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:24px;">
          <i class="fab fa-github" style="font-size:32px; color:var(--accent);"></i>
          <h3 id="github-modal-title" style="margin:0; color:var(--accent);">Вход через GitHub</h3>
        </div>
        <div class="modal-instructions" style="max-height:320px; overflow-y:auto; padding-right:8px; font-size:14px; line-height:1.6; color:var(--text-secondary);">
          <p>Чтобы получить токен, перейдите в <a href="https://github.com/settings/tokens" target="_blank">Personal access tokens</a>, создайте classic токен с правами <strong>repo</strong> и <strong>gist</strong>.</p>
        </div>
        <div style="position:relative; margin:20px 0;">
          <input type="password" id="github-token-input" placeholder="github_pat_xxx..." autocomplete="off" style="width:100%; padding:14px 16px; padding-right:44px; background:var(--bg-primary); border:1px solid var(--border); border-radius:16px; color:var(--text-primary); font-family:monospace;">
          <button type="button" id="token-toggle" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); background:transparent; border:none; color:var(--text-secondary); cursor:pointer; font-size:18px;"><i class="fas fa-eye"></i></button>
        </div>
        <div id="modal-error-container"></div>
        <div style="display:flex; gap:12px; justify-content:flex-end;">
          <button class="button" id="modal-cancel" style="background:var(--bg-inner-gradient); color:var(--text-secondary); border:1px solid var(--border);">Отмена</button>
          <button class="button" id="modal-submit" style="background:var(--accent); color:#fff;">Войти</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
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
  }

  function closeModal() {
    modal.classList.remove('active');
    tokenInput.value = '';
    tokenInput.type = 'password';
    tokenToggle.innerHTML = '<i class="fas fa-eye"></i>';
  }

  async function validateAndLogin(token, save = true) {
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
        window.UIUtils?.showToast('Неверный токен', 'error');
      } else {
        window.UIUtils?.showToast('Ошибка соединения: ' + err.message, 'error');
      }
    }
  }

  function renderLoggedInUI(user) {
    const hasRepo = currentScopes.includes('repo');
    const hasGist = currentScopes.includes('gist');
    const storageItem = hasGist
      ? `<div class="profile-dropdown-item" data-action="storage"><i class="fas fa-box-archive"></i> Хранилище</div>`
      : '';
    let cacheRemaining = '?';
    if (window.RateLimits) {
      cacheRemaining = window.RateLimits.getRemaining('cacheClears');
    }
    profileContainer.innerHTML = `
      <img src="${user.avatar_url || 'images/default-avatar.webp'}" alt="${user.login}" class="nav-profile-avatar" onerror="this.src='images/default-avatar.webp'" width="32" height="32">
      <span class="nav-profile-login">${escapeHtml(user.login)}</span>
      <i class="fas fa-chevron-right nav-profile-chevron"></i>
      <div class="profile-dropdown">
        <div class="profile-dropdown-item" data-action="profile"><i class="fas fa-user"></i> Профиль</div>
        <div class="profile-dropdown-item" data-action="token-info"><i class="fas fa-key"></i> Токен активен
          <div style="font-size:11px;margin-left:8px;">
            <span style="color:${hasRepo?'#4caf50':'#ff9800'}"><i class="fas fa-${hasRepo?'check':'exclamation-triangle'}-circle"></i> repo</span>
            <span style="color:${hasGist?'#4caf50':'#ff9800'}"><i class="fas fa-${hasGist?'check':'exclamation-triangle'}-circle"></i> gist</span>
          </div>
        </div>
        ${storageItem}
        <div class="profile-dropdown-item" data-action="rate-panel"><i class="fas fa-chart-bar"></i> Лимиты и кеш</div>
        <div class="profile-dropdown-item" data-action="revoke-token"><i class="fas fa-external-link-alt"></i> Управление токенами</div>
        <div class="profile-dropdown-divider"></div>
        <div class="profile-dropdown-item" data-action="clear-cache">
          <i class="fas fa-trash-alt"></i> Очистить кеш
          <span style="font-size:11px; color:var(--text-secondary); margin-left:8px;">(осталось: <span class="rate-indicator" data-action="cacheClears">${cacheRemaining}</span>)</span>
        </div>
        <div class="profile-dropdown-item" data-action="logout"><i class="fas fa-sign-out-alt"></i> Выйти</div>
      </div>
    `;
    bindDropdownEvents();
  }

  function renderLoggedOutUI() {
    profileContainer.innerHTML = `
      <span class="nav-profile-login placeholder">Войти</span>
      <i class="fas fa-chevron-right nav-profile-chevron"></i>
      <div class="profile-dropdown">
        <div class="profile-dropdown-item" data-action="login"><i class="fab fa-github"></i> Войти через GitHub</div>
        <div class="profile-dropdown-item" data-action="about"><i class="fas fa-info-circle"></i> Зачем это нужно?</div>
        <div class="profile-dropdown-divider"></div>
        <div class="profile-dropdown-item" data-action="rate-panel"><i class="fas fa-chart-bar"></i> Лимиты и кеш</div>
        <div class="profile-dropdown-item" data-action="clear-cache"><i class="fas fa-trash-alt"></i> Очистить кеш</div>
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
    switch (action) {
      case 'login':
        modal.classList.add('active');
        tokenInput.focus();
        break;
      case 'about':
        window.UIUtils?.showToast('Вход нужен для постов и хранилища. Требуются scopes repo и gist.', 'info', 8000);
        break;
      case 'profile':
        if (currentUserLogin) window.open(`https://github.com/${currentUserLogin}`, '_blank');
        break;
      case 'token-info':
        window.UIUtils?.showToast(`Вы ${currentUserLogin}, scopes: ${currentScopes.join(', ') || 'нет'}`, 'info', 6000);
        break;
      case 'storage':
        if (!currentScopes.includes('gist')) return window.UIUtils?.showToast('Нужен gist scope', 'error');
        if (!window.BookmarkStorage) {
          try { await window.Utils.loadModule('js/features/storage.js'); } catch { return window.UIUtils?.showToast('Ошибка загрузки хранилища', 'error'); }
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
      case 'clear-cache': {
        if (!window.RateLimits) await loadModule('js/features/rate-limits.js');
        const lastClear = localStorage.getItem(LAST_CLEAR_KEY);
        if (lastClear && Date.now() - parseInt(lastClear) < CLEAR_COOLDOWN) {
          window.UIUtils?.showToast('Подождите', 'warning');
          return;
        }
        try {
          const result = await performAction('cacheClears', {}, async () => {
            await window.RateLimits.clearAllCache();
            localStorage.setItem(LAST_CLEAR_KEY, Date.now().toString());
            return true;
          });
          if (result.queued) {
            window.UIUtils?.showToast('Очистка кеша поставлена в очередь', 'info');
          } else {
            window.UIUtils?.showToast('Кеш очищен', 'success');
            setTimeout(() => location.reload(), 1000);
          }
        } catch (err) {
          window.UIUtils?.showToast('Ошибка: ' + err.message, 'error');
        }
        break;
      }
      case 'logout':
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.clear();
        updateClientToken(null);
        currentUserLogin = null;
        currentScopes = [];
        renderLoggedOutUI();
        window.dispatchEvent(new CustomEvent('github-logout'));
        window.UIUtils?.showToast('Вы вышли', 'info');
        setTimeout(() => location.reload(), 500);
        break;
    }
  }

  function preloadAdminModules() {
    window.Utils.loadModule('js/features/editor.js').catch(() => {});
    window.Utils.loadModule('js/features/ui-feedback.js').catch(() => {});
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