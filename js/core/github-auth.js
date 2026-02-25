// github-auth.js — авторизация через GitHub, управление профилем

(function() {
    const CONFIG = GithubCore.CONFIG;
    const TOKEN_KEY = 'github_token';
    const USER_CACHE_KEY = 'github_user';
    const LAST_CLEAR_KEY = 'last_cache_clear';
    const CLEAR_COOLDOWN = 10000;

    let navBar, profileContainer, modal, tokenInput, tokenToggle;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        navBar = document.querySelector('.nav-bar');
        if (!navBar) return;

        profileContainer = document.createElement('div');
        profileContainer.className = 'nav-profile';
        profileContainer.setAttribute('role', 'button');
        profileContainer.setAttribute('tabindex', '0');

        const langSwitcher = document.querySelector('.lang-switcher');
        if (langSwitcher) {
            navBar.insertBefore(profileContainer, langSwitcher);
        } else {
            navBar.appendChild(profileContainer);
        }

        createModal();

        const savedToken = localStorage.getItem(TOKEN_KEY);
        const cachedUser = sessionStorage.getItem(USER_CACHE_KEY);
        if (savedToken && cachedUser) {
            try {
                const user = JSON.parse(cachedUser);
                renderProfile(user, savedToken);
                if (CONFIG.ALLOWED_AUTHORS.includes(user.login)) {
                    loadAdminScript();
                }
            } catch {
                validateAndShowProfile(savedToken);
            }
        } else if (savedToken) {
            validateAndShowProfile(savedToken);
        } else {
            showNotLoggedIn();
        }

        window.addEventListener('click', (e) => {
            if (modal && e.target === modal) {
                modal.classList.remove('active');
                const errorMsg = modal.querySelector('.error-message');
                if (errorMsg) errorMsg.remove();
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal?.classList.contains('active')) {
                modal.classList.remove('active');
                const errorMsg = modal.querySelector('.error-message');
                if (errorMsg) errorMsg.remove();
            }
        });

        window.addEventListener('github-login-requested', () => {
            const errorMsg = modal?.querySelector('.error-message');
            if (errorMsg) errorMsg.remove();
            if (modal) modal.classList.add('active');
        });
    }

    function loadAdminScript() {
        if (document.querySelector('script[src="js/features/admin-news.js"]')) return;
        const script = document.createElement('script');
        script.src = 'js/features/admin-news.js';
        script.defer = true;
        document.body.appendChild(script);
    }

    function createModal() {
        modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'github-modal-title');

        modal.innerHTML = `
            <div class="modal-content">
                <h3 id="github-modal-title"><i class="fab fa-github"></i> <span data-lang="githubLoginTitle">Вход через GitHub</span></h3>
                <div class="modal-instructions" style="max-height: 350px; overflow-y: auto; padding-right: 10px;">
                    <p><strong>🔒 <span data-lang="githubSecure">Безопасно и прозрачно:</span></strong> <span data-lang="githubTokenNote">токен хранится в вашем браузере и передаётся только в GitHub API.</span></p>
                    <p><strong>📝 <span data-lang="githubHowTo">Как получить токен (простой способ):</span></strong></p>
                    <ol style="text-align: left; margin: 10px 0 20px 20px;">
                        <li><span data-lang="githubStep1">Перейдите в </span><a href="https://github.com/settings/tokens" target="_blank">Personal access tokens (classic)</a>.</li>
                        <li><span data-lang="githubStep2">Нажмите "Generate new token (classic)".</span></li>
                        <li><span data-lang="githubStep3">Дайте имя, выберите срок (например, 30 дней).</span></li>
                        <li><span data-lang="githubStep4">В разделе "Select scopes" отметьте только </span><strong>repo</strong>.</li>
                        <li><span data-lang="githubStep5">Скопируйте токен и вставьте сюда.</span></li>
                    </ol>
                    <p class="text-secondary" style="font-size: 12px; background: var(--bg-primary); padding: 8px; border-radius: 8px;">
                        ⚠️ <span data-lang="githubWarning">Classic токен даёт доступ ко всем вашим репозиториям. Это нормально для участия в обсуждениях.</span>
                    </p>
                    <p style="margin-top: 15px; text-align: center;">
                        <a href="https://github.com/settings/tokens" target="_blank" rel="noopener" style="color: var(--accent);">
                            <i class="fas fa-external-link-alt"></i> <span data-lang="githubRevokeLink">Управление токенами GitHub (для отзыва)</span>
                        </a>
                    </p>
                </div>
                <div style="position: relative; margin-bottom: 16px;">
                    <input type="password" id="github-token-input" placeholder="github_pat_xxx..." autocomplete="off" style="width: 100%; padding: 12px; padding-right: 40px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 12px; color: var(--text-primary);">
                    <button type="button" id="token-toggle" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: var(--text-secondary); cursor: pointer;" aria-label="Показать/скрыть токен">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
                <div class="modal-buttons">
                    <button class="button" id="modal-cancel" data-lang="feedbackCancel">Отмена</button>
                    <button class="button" id="modal-submit" data-lang="githubLoginBtn">Войти</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        tokenInput = document.getElementById('github-token-input');
        tokenToggle = document.getElementById('token-toggle');
        tokenToggle.addEventListener('click', () => {
            if (tokenInput.type === 'password') {
                tokenInput.type = 'text';
                tokenToggle.innerHTML = '<i class="fas fa-eye-slash"></i>';
                tokenToggle.setAttribute('aria-label', 'Скрыть токен');
            } else {
                tokenInput.type = 'password';
                tokenToggle.innerHTML = '<i class="fas fa-eye"></i>';
                tokenToggle.setAttribute('aria-label', 'Показать токен');
            }
        });

        document.getElementById('modal-submit').addEventListener('click', () => {
            const token = tokenInput.value.trim();
            if (token) validateAndShowProfile(token, true);
        });
        document.getElementById('modal-cancel').addEventListener('click', () => {
            modal.classList.remove('active');
            tokenInput.value = '';
            tokenInput.type = 'password';
            tokenToggle.innerHTML = '<i class="fas fa-eye"></i>';
            tokenToggle.setAttribute('aria-label', 'Показать токен');
            const errorMsg = modal.querySelector('.error-message');
            if (errorMsg) errorMsg.remove();
        });
    }

    async function validateAndShowProfile(token, shouldSave = false) {
        try {
            profileContainer.innerHTML = `<i class="fas fa-circle-notch fa-spin" style="color: var(--accent); margin: 8px;"></i>`;

            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!userResponse.ok) throw new Error(`GitHub API error: ${userResponse.status}`);

            const userData = await userResponse.json();

            try {
                await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
            } catch (repoErr) {
                console.warn('Could not verify repository access:', repoErr);
            }

            if (shouldSave) {
                localStorage.setItem(TOKEN_KEY, token);
                sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData));
            }

            window.dispatchEvent(new CustomEvent('github-login-success', { detail: { login: userData.login } }));

            renderProfile(userData, token);
            if (CONFIG.ALLOWED_AUTHORS.includes(userData.login)) {
                loadAdminScript();
            }

            modal.classList.remove('active');
            tokenInput.value = '';
            tokenInput.type = 'password';
            tokenToggle.innerHTML = '<i class="fas fa-eye"></i>';
            const errorMsg = modal.querySelector('.error-message');
            if (errorMsg) errorMsg.remove();

        } catch (error) {
            console.error('Auth error:', error);
            localStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(USER_CACHE_KEY);
            showLoginError();
            setTimeout(() => {
                modal.classList.add('active');
                let errorMsg = modal.querySelector('.error-message');
                if (!errorMsg) {
                    errorMsg = document.createElement('div');
                    errorMsg.className = 'error-message';
                    errorMsg.style.marginBottom = '15px';
                    errorMsg.style.padding = '10px';
                    errorMsg.style.background = 'rgba(244,67,54,0.1)';
                    errorMsg.style.color = '#f44336';
                    errorMsg.style.borderRadius = '8px';
                    errorMsg.style.textAlign = 'center';
                    errorMsg.setAttribute('data-lang', 'githubAuthError');
                    errorMsg.textContent = 'Ошибка авторизации. Проверьте токен или попробуйте снова.';
                    modal.querySelector('.modal-content').insertBefore(errorMsg, tokenInput.parentNode);
                }
                tokenInput.value = '';
                tokenInput.focus();
            }, 500);
        }
    }

    function renderProfile(user, token) {
        const avatarUrl = user.avatar_url || 'images/default-avatar.webp';
        const login = user.login || 'User';

        profileContainer.innerHTML = `
            <img src="${avatarUrl}" alt="${login}" class="nav-profile-avatar" onerror="this.src='images/default-avatar.webp'" width="32" height="32">
            <span class="nav-profile-login">${login}</span>
            <i class="fas fa-chevron-right nav-profile-chevron"></i>
            <div class="profile-dropdown">
                <div class="profile-dropdown-item" data-action="profile">
                    <i class="fas fa-user"></i> <span data-lang="githubProfile">Профиль</span> (${login})
                </div>
                <div class="profile-dropdown-item" data-action="token-info">
                    <i class="fas fa-key"></i> <span data-lang="githubTokenActive">Токен активен</span>
                </div>
                <div class="profile-dropdown-item" data-action="revoke-token">
                    <i class="fas fa-external-link-alt"></i> <span data-lang="githubRevoke">Управление токенами</span>
                </div>
                <div class="profile-dropdown-divider"></div>
                <div class="profile-dropdown-item" data-action="clear-cache">
                    <i class="fas fa-trash-alt"></i> <span data-lang="githubClearCache">Очистить кеш</span>
                </div>
                <div class="profile-dropdown-item" data-action="logout">
                    <i class="fas fa-sign-out-alt"></i> <span data-lang="githubLogout">Выйти</span>
                </div>
            </div>
        `;

        profileContainer.dataset.githubToken = token;
        profileContainer.dataset.githubLogin = login;

        profileContainer.addEventListener('click', toggleDropdown);
        profileContainer.addEventListener('blur', () => {
            setTimeout(() => profileContainer.classList.remove('active'), 200);
        });

        attachDropdownHandlers();
    }

    function showNotLoggedIn() {
        profileContainer.innerHTML = `
            <span class="nav-profile-login placeholder" data-lang="githubLogin">Войти</span>
            <i class="fas fa-chevron-right nav-profile-chevron"></i>
            <div class="profile-dropdown">
                <div class="profile-dropdown-item" data-action="login">
                    <i class="fab fa-github"></i> <span data-lang="githubLoginVia">Войти через GitHub</span>
                </div>
                <div class="profile-dropdown-item" data-action="about">
                    <i class="fas fa-info-circle"></i> <span data-lang="githubWhy">Зачем это нужно?</span>
                </div>
                <div class="profile-dropdown-divider"></div>
                <div class="profile-dropdown-item" data-action="clear-cache">
                    <i class="fas fa-trash-alt"></i> <span data-lang="githubClearCache">Очистить кеш</span>
                </div>
            </div>
        `;
        profileContainer.addEventListener('click', toggleDropdown);
        attachDropdownHandlers();
    }

    function showLoginError() {
        profileContainer.innerHTML = `
            <span class="nav-profile-login placeholder" data-lang="githubError">Ошибка</span>
            <i class="fas fa-exclamation-triangle" style="color: #f44336;"></i>
            <div class="profile-dropdown">
                <div class="profile-dropdown-item" data-action="login">
                    <i class="fab fa-github"></i> <span data-lang="githubRetry">Попробовать снова</span>
                </div>
                <div class="profile-dropdown-item" data-action="clear-cache">
                    <i class="fas fa-trash-alt"></i> <span data-lang="githubClearCache">Очистить кеш</span>
                </div>
            </div>
        `;
        profileContainer.addEventListener('click', toggleDropdown);
        attachDropdownHandlers();
    }

    function attachDropdownHandlers() {
        profileContainer.querySelectorAll('[data-action]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = e.currentTarget.dataset.action;
                handleDropdownAction(action);
                profileContainer.classList.remove('active');
            });
        });
    }

    function handleDropdownAction(action) {
        const token = localStorage.getItem(TOKEN_KEY);
        const userLogin = profileContainer.dataset.githubLogin;

        switch(action) {
            case 'login':
                modal.classList.add('active');
                tokenInput.focus();
                break;
            case 'about':
                UIUtils.showToast('Вход через GitHub позволяет оставлять идеи, голосовать и участвовать.', 'info');
                break;
            case 'profile':
                if (userLogin) window.open(`https://github.com/${userLogin}`, '_blank');
                break;
            case 'token-info':
                if (token) UIUtils.showToast(`Вы вошли как ${userLogin}. Токен сохранён в браузере.`, 'success');
                break;
            case 'revoke-token':
                window.open('https://github.com/settings/tokens', '_blank');
                UIUtils.showToast('Перейдите в раздел токенов, чтобы удалить ненужные', 'info');
                break;
            case 'clear-cache':
                handleClearCache();
                break;
            case 'logout':
                localStorage.removeItem(TOKEN_KEY);
                sessionStorage.clear();
                window.dispatchEvent(new CustomEvent('github-logout'));
                delete profileContainer.dataset.githubToken;
                delete profileContainer.dataset.githubLogin;
                showNotLoggedIn();
                UIUtils.showToast('Вы вышли из аккаунта.', 'info');
                location.reload();
                break;
        }
    }

    function handleClearCache() {
        const lastClear = localStorage.getItem(LAST_CLEAR_KEY);
        if (lastClear && Date.now() - parseInt(lastClear) < CLEAR_COOLDOWN) {
            const remaining = Math.ceil((CLEAR_COOLDOWN - (Date.now() - parseInt(lastClear))) / 1000);
            UIUtils.showToast(`Очистка кеша доступна раз в 10 секунд. Подождите ${remaining} секунд.`, 'warning');
            return;
        }
        sessionStorage.clear();
        localStorage.setItem(LAST_CLEAR_KEY, Date.now().toString());
        UIUtils.showToast('Кеш очищен, страница будет перезагружена.', 'info');
        setTimeout(() => location.reload(), 1000);
    }

    function toggleDropdown(e) {
        e.stopPropagation();
        profileContainer.classList.toggle('active');
    }

    window.GithubAuth = {
        getCurrentUser: () => {
            const profile = document.querySelector('.nav-profile');
            return profile ? profile.dataset.githubLogin : null;
        },
        getToken: () => localStorage.getItem(TOKEN_KEY),
        isAdmin: () => {
            const user = window.GithubAuth.getCurrentUser();
            return user && GithubCore.CONFIG.ALLOWED_AUTHORS.includes(user);
        }
    };
})();