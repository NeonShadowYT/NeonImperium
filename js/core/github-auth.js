// js/core/github-auth.js
// Аутентификация через GitHub.
//   — silentValidateToken: прямой fetch (валидация ДО клиента).
//   — openStorage: делегирует в window.loadStorageModules().
//   — Хранение токена: TokenStore (sessionStorage + IndexedDB AES-GCM).
//   — refreshProfileMenu: async, использует TokenStore.load().
//   — UI-тексты: через window.DomUtils.setElementText.

(function() {
    'use strict';

    const ApiCache = window.ApiCache || {};
    const { cacheRemoveByPrefix } = ApiCache;

    const USER_CACHE_KEY = 'github_user';
    const SCOPES_CACHE_KEY = 'github_scopes';
    const LAST_LOGIN_ATTEMPT_KEY = 'last_login_attempt';
    const REMEMBER_ME_KEY = 'remember_me';
    const LOGIN_COOLDOWN = 10000;
    const VALIDATE_TIMEOUT = 8000;
    const STORAGE_WAIT_ATTEMPTS = 40;
    const STORAGE_WAIT_INTERVAL = 50;

    let currentUserLogin = null;
    let currentScopes = [];

    let profileContainer = null;
    let modal = null;
    let tokenInput = null;
    let tokenToggle = null;
    let rememberCheckbox = null;
    let modalCreated = false;

    // ============================================================
    // Helpers
    // ============================================================

    function getT() {
        return (window.I18n && typeof window.I18n.translate === 'function')
            ? window.I18n.translate
            : (k => k);
    }

    function escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    function showToast(message, type, duration) {
        if (window.UIUtils && typeof window.UIUtils.showToast === 'function') {
            window.UIUtils.showToast(message, type, duration);
        } else {
            console.log(`[Toast:${type}]`, message);
        }
    }

    function isAdminUser(login) {
        if (!login) return false;
        const cfg = window.GithubCore && window.GithubCore.CONFIG;
        return !!(cfg && Array.isArray(cfg.ALLOWED_AUTHORS) && cfg.ALLOWED_AUTHORS.includes(login));
    }

    function isUnauthorized(err) {
        if (!err) return false;
        if (err.status === 401) return true;
        const msg = String(err.message || '');
        return msg.includes('401') || msg === 'unauthorized';
    }

    function updateClientToken(token) {
        if (window.GitHubAPIClient && typeof window.GitHubAPIClient.updateToken === 'function') {
            window.GitHubAPIClient.updateToken(token);
        }
    }

    // ============================================================
    // Инициализация
    // ============================================================

    function init() {
        const navBar = document.querySelector('.nav-bar');
        if (!navBar) {
            console.warn('[GithubAuth] .nav-bar не найден, пропускаем инициализацию');
            return;
        }

        profileContainer = document.createElement('div');
        profileContainer.className = 'nav-profile';
        profileContainer.setAttribute('role', 'button');
        profileContainer.setAttribute('tabindex', '0');

        const langSwitcher = document.querySelector('.lang-switcher');
        navBar.insertBefore(profileContainer, langSwitcher || null);

        if (window.I18n && typeof window.I18n.getCurrentLang === 'function' && window.I18n.getCurrentLang()) {
            createLoginModal();
        } else {
            document.addEventListener('languageLoaded', createLoginModal, { once: true });
        }

        restoreSession().catch(err => {
            console.warn('[GithubAuth] restoreSession error:', err);
            renderLoggedOutUI();
        });

        window.addEventListener('github-login-requested', openLoginModal);
        window.addEventListener('languageChanged', onLanguageChanged);
        window.addEventListener('languageLoaded', onLanguageChanged);

        window.dispatchEvent(new CustomEvent('github-auth-ready'));
    }

    function onLanguageChanged() {
        refreshProfileMenu();
        updateLoginModalTexts();
    }

    // ============================================================
    // Session restore
    // ============================================================

    async function restoreSession() {
        let token = null;
        try {
            token = window.TokenStore ? await window.TokenStore.load() : null;
        } catch (e) {
            console.warn('[GithubAuth] TokenStore.load error:', e);
            token = null;
        }

        if (token) {
            try {
                const data = await silentValidateToken(token);
                if (data) {
                    applyUserSession(data, token);
                    return;
                }
            } catch (err) {
                if (isUnauthorized(err)) {
                    await clearStoredToken();
                }
            }
        }

        renderLoggedOutUI();
    }

    function applyUserSession(data, token) {
        currentUserLogin = data.user.login;
        currentScopes = data.scopes;

        try {
            sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(data.user));
            sessionStorage.setItem(SCOPES_CACHE_KEY, JSON.stringify(data.scopes));
        } catch { /* noop */ }

        updateClientToken(token);
        renderLoggedInUI(data.user);

        if (isAdminUser(data.user.login)) preloadAdminModules();

        window.dispatchEvent(new CustomEvent('github-login-success', {
            detail: { login: data.user.login, scopes: data.scopes }
        }));
    }

    async function silentValidateToken(token) {
        if (!token) throw new Error('empty_token');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            try { controller.abort(new Error('timeout')); }
            catch { controller.abort(); }
        }, VALIDATE_TIMEOUT);

        try {
            const resp = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (resp.status === 401) {
                const err = new Error('unauthorized');
                err.status = 401;
                throw err;
            }
            if (!resp.ok) {
                const err = new Error(`HTTP ${resp.status}`);
                err.status = resp.status;
                throw err;
            }

            const scopesHeader = resp.headers.get('X-OAuth-Scopes');
            const scopes = scopesHeader
                ? scopesHeader.split(',').map(s => s.trim()).filter(Boolean)
                : [];
            const user = await resp.json();
            return { user, scopes };
        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    }

    async function clearStoredToken() {
        try {
            if (window.TokenStore && typeof window.TokenStore.clear === 'function') {
                await window.TokenStore.clear();
            }
        } catch { /* noop */ }
        try {
            localStorage.removeItem(REMEMBER_ME_KEY);
        } catch { /* noop */ }
    }

    // ============================================================
    // Login modal
    // ============================================================

    function openLoginModal() {
        if (!modal) createLoginModal();
        if (modal) {
            modal.classList.add('active');
            if (tokenInput) tokenInput.focus();
        }
    }

    function createLoginModal() {
        if (modalCreated || !profileContainer) return;
        modalCreated = true;

        const t = getT();
        modal = document.createElement('div');
        modal.className = 'auth-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'auth-modal-title');

        modal.innerHTML = buildLoginModalHTML(t);
        document.body.appendChild(modal);

        tokenInput = modal.querySelector('#github-token-input');
        tokenToggle = modal.querySelector('#token-toggle');
        rememberCheckbox = modal.querySelector('#remember-me-checkbox');

        bindLoginModalEvents();
        updateLoginModalTexts();
    }

    function buildLoginModalHTML(t) {
        return `
            <div class="auth-modal-content">
                <div class="auth-modal-top-bar"></div>

                <div class="auth-modal-header">
                    <div class="auth-modal-icon">
                        <i class="fab fa-github"></i>
                    </div>
                    <h3 id="auth-modal-title" class="auth-modal-title" data-lang="githubLoginTitle">${t('githubLoginTitle')}</h3>
                </div>

                <div class="auth-modal-accordion">
                    <button type="button" id="why-need-toggle" class="auth-modal-accordion-toggle" aria-expanded="false">
                        <i class="fas fa-info-circle"></i>
                        <span data-lang="whyNeed">${t('whyNeed')}</span>
                        <span class="auth-modal-accordion-chevron">▾</span>
                    </button>
                    <div id="why-need-content" class="auth-modal-accordion-content" data-lang="loginDescription">${t('loginDescription')}</div>
                </div>

                <div class="auth-modal-token-row">
                    <input type="password" id="github-token-input"
                        class="auth-modal-token-input"
                        placeholder="github_pat_xxx..." autocomplete="off">
                    <button type="button" id="token-toggle" class="auth-modal-token-toggle" aria-label="Показать/скрыть токен">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>

                <div class="auth-modal-links">
                    <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer" class="auth-modal-link">
                        <i class="fas fa-external-link-alt"></i>
                        <span data-lang="createToken">${t('createToken')}</span>
                    </a>
                    <label class="auth-modal-remember">
                        <input type="checkbox" id="remember-me-checkbox">
                        <span class="auth-modal-checkmark" id="remember-checkmark"></span>
                        <span data-lang="rememberMe">${t('rememberMe')}</span>
                    </label>
                </div>

                <div id="modal-error-container" class="auth-modal-error"></div>

                <div class="auth-modal-actions">
                    <button type="button" id="modal-cancel" class="auth-modal-btn auth-modal-btn-cancel" data-lang="feedbackCancel">${t('feedbackCancel')}</button>
                    <button type="button" id="modal-submit" class="auth-modal-btn auth-modal-btn-submit">
                        <span data-lang="githubLoginBtn">${t('githubLoginBtn')}</span>
                    </button>
                </div>
            </div>
        `;
    }

    function bindLoginModalEvents() {
        const toggleBtn = modal.querySelector('#why-need-toggle');
        const content = modal.querySelector('#why-need-content');
        if (toggleBtn && content) {
            toggleBtn.addEventListener('click', () => {
                const isOpen = content.classList.toggle('visible');
                toggleBtn.setAttribute('aria-expanded', String(isOpen));
                const icon = toggleBtn.querySelector('.auth-modal-accordion-chevron');
                if (icon) icon.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
            });
        }

        const checkbox = modal.querySelector('#remember-me-checkbox');
        const checkmark = modal.querySelector('#remember-checkmark');
        if (checkbox && checkmark) {
            checkbox.addEventListener('change', () => {
                checkmark.classList.toggle('checked', checkbox.checked);
            });
        }

        if (tokenToggle && tokenInput) {
            tokenToggle.addEventListener('click', () => {
                const isPassword = tokenInput.type === 'password';
                tokenInput.type = isPassword ? 'text' : 'password';
                tokenToggle.innerHTML = isPassword
                    ? '<i class="fas fa-eye-slash"></i>'
                    : '<i class="fas fa-eye"></i>';
            });
        }

        const submitBtn = modal.querySelector('#modal-submit');
        const cancelBtn = modal.querySelector('#modal-cancel');

        if (submitBtn) {
            submitBtn.addEventListener('click', () => {
                const token = tokenInput.value.trim();
                if (token) validateAndLogin(token);
            });
            submitBtn.addEventListener('mousemove', e => {
                const rect = submitBtn.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 100;
                const y = ((e.clientY - rect.top) / rect.height) * 100;
                submitBtn.style.setProperty('--ripple-x', x + '%');
                submitBtn.style.setProperty('--ripple-y', y + '%');
            });
        }
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

        modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    }

    function updateLoginModalTexts() {
        if (!modal) return;
        const t = getT();
        const setText = (window.DomUtils && window.DomUtils.setElementText)
            ? window.DomUtils.setElementText
            : (el, text) => { el.textContent = text == null ? '' : String(text); };

        modal.querySelectorAll('[data-lang]').forEach(el => {
            const key = el.getAttribute('data-lang');
            if (!key) return;
            setText(el, t(key));
        });
    }

    function closeModal() {
        if (!modal) return;
        modal.classList.remove('active');
        if (tokenInput) {
            tokenInput.value = '';
            tokenInput.type = 'password';
        }
        if (tokenToggle) tokenToggle.innerHTML = '<i class="fas fa-eye"></i>';
        if (rememberCheckbox) {
            rememberCheckbox.checked = false;
            const checkmark = modal.querySelector('#remember-checkmark');
            if (checkmark) checkmark.classList.remove('checked');
        }
        const content = modal.querySelector('#why-need-content');
        if (content) content.classList.remove('visible');
        const toggleBtn = modal.querySelector('#why-need-toggle');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
        const icon = modal.querySelector('.auth-modal-accordion-chevron');
        if (icon) icon.style.transform = 'rotate(0deg)';
    }

    // ============================================================
    // Login
    // ============================================================

    async function validateAndLogin(token) {
        if (!token) return;
        const t = getT();

        let lastAttempt = 0;
        try { lastAttempt = parseInt(localStorage.getItem(LAST_LOGIN_ATTEMPT_KEY) || '0', 10); }
        catch { /* noop */ }

        if (lastAttempt && Date.now() - lastAttempt < LOGIN_COOLDOWN) {
            showToast('Подождите немного перед повторной попыткой входа', 'error');
            return;
        }

        try { localStorage.setItem(LAST_LOGIN_ATTEMPT_KEY, String(Date.now())); }
        catch { /* noop */ }

        if (!profileContainer) return;
        profileContainer.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="color:var(--accent);margin:8px;"></i>';

        try {
            const userData = await silentValidateToken(token);
            if (!userData) throw new Error('empty_response');

            currentUserLogin = userData.user.login;
            currentScopes = userData.scopes;

            try {
                sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData.user));
                sessionStorage.setItem(SCOPES_CACHE_KEY, JSON.stringify(userData.scopes));
            } catch { /* noop */ }

            const remember = rememberCheckbox && rememberCheckbox.checked;
            if (window.TokenStore) {
                await window.TokenStore.save(token);
                if (remember) {
                    const ok = await window.TokenStore.saveRemembered(token);
                    if (!ok) {
                        showToast('Не удалось сохранить сессию (IndexedDB недоступен)', 'warning', 5000);
                    }
                    try { localStorage.setItem(REMEMBER_ME_KEY, 'true'); }
                    catch { /* noop */ }
                } else {
                    await window.TokenStore.clearRemembered();
                    try { localStorage.removeItem(REMEMBER_ME_KEY); }
                    catch { /* noop */ }
                }
            }

            updateClientToken(token);
            renderLoggedInUI(userData.user);
            closeModal();

            window.dispatchEvent(new CustomEvent('github-login-success', {
                detail: { login: userData.user.login, scopes: userData.scopes }
            }));

            if (isAdminUser(userData.user.login)) preloadAdminModules();
        } catch (err) {
            if (err.name === 'AbortError' || err.message === 'timeout') {
                showToast('Таймаут соединения. Попробуйте снова.', 'error');
            } else if (isUnauthorized(err)) {
                await clearStoredToken();
                try {
                    sessionStorage.removeItem(USER_CACHE_KEY);
                    sessionStorage.removeItem(SCOPES_CACHE_KEY);
                } catch { /* noop */ }
                updateClientToken(null);
                renderLoggedOutUI();
                showToast(t('githubError') || 'Ошибка авторизации', 'error');
            } else {
                showToast('Ошибка соединения: ' + err.message, 'error');
            }
        }
    }

    // ============================================================
    // UI
    // ============================================================

    function renderLoggedInUI(user) {
        if (!profileContainer) return;
        const t = getT();
        const hasRepo = currentScopes.includes('repo');
        const hasGist = currentScopes.includes('gist');
        const storageItem = hasGist
            ? `<div class="profile-dropdown-item" data-action="storage"><i class="fas fa-box-archive"></i> ${t('storage')}</div>`
            : '';
        const avatarUrl = user.avatar_url || 'images/starve-neon-icon.webp';

        profileContainer.innerHTML = `
            <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(user.login)}" class="nav-profile-avatar" onerror="this.src='images/starve-neon-icon.webp'" width="32" height="32">
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
        if (!profileContainer) return;
        const t = getT();
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
        if (!profileContainer) return;
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
        if (e.target.closest('.profile-dropdown-item')) return;
        e.stopPropagation();
        profileContainer.classList.toggle('active');
    }

    async function handleAction(action) {
        const t = getT();
        switch (action) {
            case 'login':
                openLoginModal();
                break;
            case 'about':
                showToast(t('githubWarning'), 'info', 8000);
                break;
            case 'profile':
                if (currentUserLogin) {
                    window.open(`https://github.com/${currentUserLogin}`, '_blank', 'noopener,noreferrer');
                }
                break;
            case 'token-info':
                showToast(
                    `Вы ${currentUserLogin}, scopes: ${currentScopes.join(', ') || 'нет'}`,
                    'info', 6000
                );
                break;
            case 'storage':
                await openStorage();
                break;
            case 'rate-panel':
                if (window.RateLimits && typeof window.RateLimits.openRatePanel === 'function') {
                    window.RateLimits.openRatePanel();
                } else {
                    showToast('Модуль лимитов ещё не загружен', 'error');
                }
                break;
            case 'logout':
                await doLogout();
                break;
        }
    }

    async function openStorage() {
        if (!currentScopes.includes('gist')) {
            showToast(getT()('needGistScope'), 'error');
            return;
        }

        try {
            if (typeof window.loadStorageModules !== 'function') {
                for (let i = 0; i < STORAGE_WAIT_ATTEMPTS; i++) {
                    if (typeof window.loadStorageModules === 'function') break;
                    await new Promise(r => setTimeout(r, STORAGE_WAIT_INTERVAL));
                }
            }

            if (typeof window.loadStorageModules !== 'function') {
                console.warn('[GithubAuth] window.loadStorageModules недоступен');
                showToast(getT()('loadModulesError'), 'error');
                return;
            }

            await window.loadStorageModules();

            if (!window.BookmarkStorage ||
                typeof window.BookmarkStorage.openStorageModal !== 'function') {
                showToast(getT()('loadModulesError'), 'error');
                return;
            }

            window.BookmarkStorage.openStorageModal();
        } catch (e) {
            console.warn('[GithubAuth] Storage load error:', e);
            showToast(getT()('loadModulesError'), 'error');
        }
    }

    async function doLogout() {
        await clearStoredToken();
        try {
            sessionStorage.removeItem(USER_CACHE_KEY);
            sessionStorage.removeItem(SCOPES_CACHE_KEY);
        } catch { /* noop */ }

        if (typeof cacheRemoveByPrefix === 'function') {
            cacheRemoveByPrefix('gh_api_');
        }

        updateClientToken(null);
        currentUserLogin = null;
        currentScopes = [];
        renderLoggedOutUI();

        window.dispatchEvent(new CustomEvent('github-logout'));
        showToast(getT()('logout'), 'info');
    }

    function preloadAdminModules() {
        if (!window.Utils || typeof window.Utils.loadModule !== 'function') return;
        window.Utils.loadModule('js/features/editor.js').catch(() => {});
        window.Utils.loadModule('js/features/ui-feedback.js').catch(() => {});
    }

    /**
     * Обновляет UI профиля после смены языка.
     * Использует TokenStore.load() для получения токена (может быть в IndexedDB).
     */
    async function refreshProfileMenu() {
        let token = null;
        try {
            if (window.TokenStore && typeof window.TokenStore.load === 'function') {
                token = await window.TokenStore.load();
            } else {
                token = sessionStorage.getItem('github_token');
            }
        } catch { token = null; }

        if (token && currentUserLogin) {
            let user = null;
            try { user = JSON.parse(sessionStorage.getItem(USER_CACHE_KEY)); } catch { /* noop */ }
            if (user) {
                renderLoggedInUI(user);
                return;
            }
        }
        renderLoggedOutUI();
    }

    // ============================================================
    // Публичный API
    // ============================================================

    window.GithubAuth = {
        getCurrentUser: () => currentUserLogin,

        /**
         * Возвращает активный токен.
         * @returns {Promise<string|null>}
         */
        getToken: async () => {
            try {
                const s = sessionStorage.getItem('github_token');
                if (s) return s;
            } catch { /* noop */ }

            if (window.TokenStore && typeof window.TokenStore.load === 'function') {
                try {
                    return await window.TokenStore.load();
                } catch { /* noop */ }
            }
            return null;
        },

        getScopes: () => currentScopes.slice(),
        hasScope: scope => currentScopes.includes(scope),
        isAdmin: () => isAdminUser(currentUserLogin),
        updateToken: updateClientToken
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();