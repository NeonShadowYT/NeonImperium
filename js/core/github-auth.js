// js/core/github-auth.js — аутентификация GitHub, улучшенное состояние и UI
(function() {
    const { CONFIG, createElement, cacheGet, cacheSet, cacheRemove } = GithubCore;
    const TOKEN_KEY = 'github_token';
    const USER_CACHE_KEY = 'github_user';
    const SCOPES_CACHE_KEY = 'github_scopes';
    const LAST_CLEAR_KEY = 'last_cache_clear';
    const CLEAR_COOLDOWN = 10000;

    let currentUserLogin = null;
    let currentScopes = [];
    let modal, tokenInput, tokenToggle, profileContainer;

    // ---------- Инициализация после DOM ----------
    document.addEventListener('DOMContentLoaded', () => {
        const navBar = document.querySelector('.nav-bar');
        if (!navBar) return;
        profileContainer = createElement('div', 'nav-profile', {}, { role: 'button', tabindex: '0' });
        const langSwitcher = document.querySelector('.lang-switcher');
        navBar.insertBefore(profileContainer, langSwitcher || null);
        createLoginModal();
        restoreSession();
    });

    // ---------- Восстановление сессии ----------
    function restoreSession() {
        const token = localStorage.getItem(TOKEN_KEY);
        const cachedUser = sessionStorage.getItem(USER_CACHE_KEY);
        const cachedScopes = sessionStorage.getItem(SCOPES_CACHE_KEY);
        if (token && cachedUser) {
            try {
                const user = JSON.parse(cachedUser);
                currentUserLogin = user.login;
                currentScopes = cachedScopes ? JSON.parse(cachedScopes) : [];
                renderLoggedInUI(user);
                if (CONFIG.ALLOWED_AUTHORS.includes(user.login)) preloadAdminModules();
            } catch {
                validateAndLogin(token);
            }
        } else if (token) {
            validateAndLogin(token);
        } else {
            renderLoggedOutUI();
        }
    }

    // ---------- Модалка входа ----------
    function createLoginModal() {
        modal = createElement('div', 'modal', {}, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'github-modal-title' });
        modal.innerHTML = `
            <div class="modal-content" style="max-width:480px; border-radius:24px; border:1px solid var(--accent); background:var(--bg-card-gradient); box-shadow:0 20px 40px rgba(0,0,0,0.8);">
                <div style="display:flex; align-items:center; gap:12px; margin-bottom:24px;">
                    <i class="fab fa-github" style="font-size:32px; color:var(--accent);"></i>
                    <h3 id="github-modal-title" style="margin:0; color:var(--accent);">Вход через GitHub</h3>
                </div>
                <div class="modal-instructions" style="max-height:320px; overflow-y:auto; padding-right:8px; font-size:14px; line-height:1.6; color:var(--text-secondary);">
                    <!-- инструкции (сокращены для краткости, оставлены полные) -->
                    <p>Чтобы получить токен, перейдите в <a href="https://github.com/settings/tokens" target="_blank">Personal access tokens</a>, создайте classic токен с правами repo и gist.</p>
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
            if (token) validateAndLogin(token, true);
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

    // ---------- Проверка токена и вход ----------
    async function validateAndLogin(token, save = false) {
        if (!token) {
            return window.UIUtils?.showToast('Введите токен', 'error');
        }
        profileContainer.innerHTML = '<i class="fas fa-circle-notch fa-spin" style="color:var(--accent);margin:8px;"></i>';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
            const resp = await fetch('https://api.github.com/user', {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' },
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!resp.ok) throw new Error(resp.status === 401 ? 'unauthorized' : `HTTP ${resp.status}`);
            const scopesHeader = resp.headers.get('X-OAuth-Scopes');
            const scopes = scopesHeader ? scopesHeader.split(',').map(s => s.trim()) : [];
            const user = await resp.json();
            currentUserLogin = user.login;
            currentScopes = scopes;
            if (save) {
                localStorage.setItem(TOKEN_KEY, token);
                sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
                sessionStorage.setItem(SCOPES_CACHE_KEY, JSON.stringify(scopes));
            }
            renderLoggedInUI(user);
            closeModal();
            window.dispatchEvent(new CustomEvent('github-login-success', { detail: { login: user.login, scopes } }));
            if (CONFIG.ALLOWED_AUTHORS.includes(user.login)) preloadAdminModules();
            // Проверка скоупов
            const missing = [];
            if (!scopes.includes('repo')) missing.push('repo');
            if (!scopes.includes('gist')) missing.push('gist');
            if (missing.length) window.UIUtils?.showToast(`Отсутствуют разрешения: ${missing.join(', ')}`, 'warning', 8000);
        } catch (err) {
            clearTimeout(timeoutId);
            localStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(USER_CACHE_KEY);
            sessionStorage.removeItem(SCOPES_CACHE_KEY);
            if (err.name === 'AbortError') window.UIUtils?.showToast('Таймаут', 'error');
            else if (err.message === 'unauthorized') window.UIUtils?.showToast('Неверный токен', 'error');
            else window.UIUtils?.showToast('Ошибка: ' + err.message, 'error');
            renderLoggedOutUI();
        }
    }

    // ---------- UI: залогинен ----------
    function renderLoggedInUI(user) {
        const hasRepo = currentScopes.includes('repo');
        const hasGist = currentScopes.includes('gist');
        profileContainer.innerHTML = `
            <img src="${user.avatar_url || 'images/default-avatar.webp'}" alt="${user.login}" class="nav-profile-avatar" onerror="this.src='images/default-avatar.webp'" width="32" height="32">
            <span class="nav-profile-login">${user.login}</span>
            <i class="fas fa-chevron-right nav-profile-chevron"></i>
            <div class="profile-dropdown">
                <div class="profile-dropdown-item" data-action="profile"><i class="fas fa-user"></i> Профиль</div>
                <div class="profile-dropdown-item" data-action="token-info"><i class="fas fa-key"></i> Токен активен
                    <div style="font-size:11px;margin-left:8px;">
                        <span style="color:${hasRepo?'#4caf50':'#ff9800'}"><i class="fas fa-${hasRepo?'check':'exclamation-triangle'}-circle"></i> repo</span>
                        <span style="color:${hasGist?'#4caf50':'#ff9800'}"><i class="fas fa-${hasGist?'check':'exclamation-triangle'}-circle"></i> gist</span>
                    </div>
                </div>
                <div class="profile-dropdown-item" data-action="storage"><i class="fas fa-box-archive"></i> Хранилище ${!hasGist ? '<span style="color:#ff9800">⚠️</span>' : ''}</div>
                <div class="profile-dropdown-item" data-action="revoke-token"><i class="fas fa-external-link-alt"></i> Управление токенами</div>
                <div class="profile-dropdown-divider"></div>
                <div class="profile-dropdown-item" data-action="clear-cache"><i class="fas fa-trash-alt"></i> Очистить кеш</div>
                <div class="profile-dropdown-item" data-action="logout"><i class="fas fa-sign-out-alt"></i> Выйти</div>
            </div>
        `;
        bindDropdownEvents();
    }

    // ---------- UI: не залогинен ----------
    function renderLoggedOutUI() {
        profileContainer.innerHTML = `
            <span class="nav-profile-login placeholder">Войти</span>
            <i class="fas fa-chevron-right nav-profile-chevron"></i>
            <div class="profile-dropdown">
                <div class="profile-dropdown-item" data-action="login"><i class="fab fa-github"></i> Войти через GitHub</div>
                <div class="profile-dropdown-item" data-action="about"><i class="fas fa-info-circle"></i> Зачем это нужно?</div>
                <div class="profile-dropdown-divider"></div>
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
            case 'login': modal.classList.add('active'); tokenInput.focus(); break;
            case 'about': window.UIUtils?.showToast('Вход нужен для постов и хранилища. Требуются scopes repo и gist.', 'info', 8000); break;
            case 'profile': if (currentUserLogin) window.open(`https://github.com/${currentUserLogin}`, '_blank'); break;
            case 'token-info': window.UIUtils?.showToast(`Вы ${currentUserLogin}, scopes: ${currentScopes.join(', ') || 'нет'}`, 'info', 6000); break;
            case 'storage':
                if (!currentScopes.includes('gist')) return window.UIUtils?.showToast('Нужен gist scope', 'error');
                GithubCore.loadModule('js/features/storage.js').then(() => window.BookmarkStorage?.openStorageModal());
                break;
            case 'revoke-token': window.open('https://github.com/settings/tokens', '_blank'); break;
            case 'clear-cache':
                const lastClear = localStorage.getItem(LAST_CLEAR_KEY);
                if (lastClear && Date.now() - parseInt(lastClear) < CLEAR_COOLDOWN) {
                    window.UIUtils?.showToast('Подождите', 'warning');
                    return;
                }
                sessionStorage.clear();
                localStorage.setItem(LAST_CLEAR_KEY, Date.now().toString());
                window.UIUtils?.showToast('Кеш очищен', 'info');
                setTimeout(() => location.reload(), 1000);
                break;
            case 'logout':
                localStorage.removeItem(TOKEN_KEY);
                sessionStorage.clear();
                currentUserLogin = null;
                currentScopes = [];
                renderLoggedOutUI();
                window.dispatchEvent(new CustomEvent('github-logout'));
                window.UIUtils?.showToast('Вы вышли', 'info');
                setTimeout(() => location.reload(), 500);
                break;
        }
    }

    // ---------- Предзагрузка админских модулей ----------
    function preloadAdminModules() {
        GithubCore.loadModule('js/features/editor.js').catch(() => {});
        GithubCore.loadModule('js/features/ui-feedback.js').catch(() => {});
        // также загрузим game-updates если требуется
    }

    // ---------- Публичное API ----------
    window.GithubAuth = {
        getCurrentUser: () => currentUserLogin,
        getToken: () => localStorage.getItem(TOKEN_KEY),
        getScopes: () => currentScopes,
        hasScope: scope => currentScopes.includes(scope),
        isAdmin: () => currentUserLogin && CONFIG.ALLOWED_AUTHORS.includes(currentUserLogin)
    };
})();