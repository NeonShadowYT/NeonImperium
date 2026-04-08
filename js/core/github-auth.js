// github-auth.js – авторизация через GitHub (использует Core)
(function() {
    const TOKEN_KEY = 'github_token';
    const USER_CACHE_KEY = 'github_user';
    const LAST_CLEAR_KEY = 'last_cache_clear';
    const CLEAR_COOLDOWN = 10000;
    const ALLOWED_AUTHORS = ['NeonShadowYT', 'GoldenCreeper567'];

    let navBar, profileContainer, modal, tokenInput, tokenToggle;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        navBar = document.querySelector('.nav-bar');
        if (!navBar) return;

        let rightBlock = navBar.querySelector('.nav-right');
        if (!rightBlock) {
            rightBlock = document.createElement('div');
            rightBlock.className = 'nav-right';
            const langSwitcher = document.querySelector('.lang-switcher');
            if (langSwitcher) navBar.insertBefore(rightBlock, langSwitcher);
            else navBar.appendChild(rightBlock);
        }

        profileContainer = document.createElement('div');
        profileContainer.className = 'nav-profile';
        profileContainer.setAttribute('role', 'button');
        profileContainer.setAttribute('tabindex', '0');
        profileContainer.setAttribute('aria-haspopup', 'true');
        rightBlock.appendChild(profileContainer);

        createModal();

        const savedToken = localStorage.getItem(TOKEN_KEY);
        const cachedUser = sessionStorage.getItem(USER_CACHE_KEY);

        if (savedToken && cachedUser) {
            try {
                const user = JSON.parse(cachedUser);
                renderProfile(user, savedToken);
                if (ALLOWED_AUTHORS.includes(user.login)) loadAdminScript();
            } catch {
                validateAndShowProfile(savedToken);
            }
        } else if (savedToken) {
            validateAndShowProfile(savedToken);
        } else {
            showNotLoggedIn();
        }

        window.addEventListener('github-login-requested', () => {
            clearModalError();
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
        modal.innerHTML = `
            <div class="modal-content">
                <h3 id="github-modal-title"><i class="fab fa-github"></i> <span data-lang="githubLoginTitle">Вход через GitHub</span></h3>
                <div class="modal-instructions" style="max-height:350px; overflow-y:auto; padding-right:10px;">
                    <p><strong>🔒 <span data-lang="githubSecure">Безопасно и прозрачно:</span></strong> <span data-lang="githubTokenNote">токен хранится в вашем браузере и передаётся только в GitHub API.</span></p>
                    <p><strong>📝 <span data-lang="githubHowTo">Как получить токен (простой способ):</span></strong></p>
                    <ol style="text-align:left; margin:10px 0 20px 20px;">
                        <li><span data-lang="githubStep1">Перейдите в </span><a href="https://github.com/settings/tokens" target="_blank">Personal access tokens (classic)</a>.</li>
                        <li><span data-lang="githubStep2">Нажмите "Generate new token (classic)".</span></li>
                        <li><span data-lang="githubStep3">Дайте имя, выберите срок (например, 30 дней).</span></li>
                        <li><span data-lang="githubStep4">В разделе "Select scopes" отметьте только </span><strong>repo</strong>.</li>
                        <li><span data-lang="githubStep5">Скопируйте токен и вставьте сюда.</span></li>
                    </ol>
                    <p class="text-secondary" style="font-size:12px; background:var(--bg-primary); padding:8px; border-radius:8px;">⚠️ <span data-lang="githubWarning">Classic токен даёт доступ ко всем вашим репозиториям. Это нормально для участия в обсуждениях.</span></p>
                </div>
                <div style="position:relative; margin-bottom:16px;">
                    <input type="password" id="github-token-input" placeholder="github_pat_xxx..." autocomplete="off" style="width:100%; padding:12px 40px 12px 12px; background:var(--bg-primary); border:1px solid var(--border); border-radius:12px; color:var(--text-primary);">
                    <button type="button" id="token-toggle" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); background:transparent; border:none; color:var(--text-secondary); cursor:pointer;"><i class="fas fa-eye"></i></button>
                </div>
                <div id="modal-error-container"></div>
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
            } else {
                tokenInput.type = 'password';
                tokenToggle.innerHTML = '<i class="fas fa-eye"></i>';
            }
        });

        document.getElementById('modal-submit').addEventListener('click', () => {
            const token = tokenInput.value.trim();
            if (token) validateAndShowProfile(token, true);
        });
        document.getElementById('modal-cancel').addEventListener('click', () => {
            modal.classList.remove('active');
            clearModalError();
            tokenInput.value = '';
        });
    }

    function clearModalError() {
        const container = document.getElementById('modal-error-container');
        if (container) container.innerHTML = '';
    }

    function showModalError(messageKey, details = '') {
        const container = document.getElementById('modal-error-container');
        if (!container) return;
        const lang = localStorage.getItem('preferredLanguage') || 'ru';
        const errorMsg = (window.translations && window.translations[lang] && window.translations[lang][messageKey]) ? window.translations[lang][messageKey] : messageKey;
        container.innerHTML = `<div class="error-message" style="margin-bottom:15px; padding:10px; background:rgba(244,67,54,0.1); color:#f44336; border-radius:8px; text-align:center;"><i class="fas fa-exclamation-triangle"></i> ${errorMsg}${details ? `<br><small>${details}</small>` : ''}</div>`;
    }

    async function validateAndShowProfile(token, shouldSave = false) {
        if (!token) { showModalError('githubTokenMissing'); return; }
        profileContainer.innerHTML = `<i class="fas fa-circle-notch fa-spin" style="color:var(--accent); margin:8px;"></i>`;
        clearModalError();

        const { controller, timeoutId } = Core.createAbortable(10000);
        try {
            const userResponse = await fetch('https://api.github.com/user', {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' },
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!userResponse.ok) throw new Error(userResponse.status === 401 ? 'unauthorized' : `http_${userResponse.status}`);
            const userData = await userResponse.json();

            // Проверка доступа к репозиторию (необязательно)
            try {
                await fetch(`https://api.github.com/repos/NeonShadowYT/NeonImperium`, {
                    headers: { 'Authorization': `Bearer ${token}` },
                    signal: AbortSignal.timeout(5000)
                });
            } catch(e) { console.warn('Repo access check failed:', e); }

            if (shouldSave) {
                localStorage.setItem(TOKEN_KEY, token);
                sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData));
            }

            window.dispatchEvent(new CustomEvent('github-login-success', { detail: { login: userData.login } }));
            renderProfile(userData, token);
            if (ALLOWED_AUTHORS.includes(userData.login)) loadAdminScript();
            modal.classList.remove('active');
            tokenInput.value = '';
        } catch(error) {
            clearTimeout(timeoutId);
            localStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(USER_CACHE_KEY);
            if (error.name === 'AbortError') showModalError('githubTimeout');
            else if (error.message === 'unauthorized') showModalError('githubAuthError', 'Токен недействителен или истёк');
            else if (error.message.startsWith('http_')) {
                const status = error.message.split('_')[1];
                if (status === '403') showModalError('githubForbidden', 'Проверьте права токена (нужен scope repo)');
                else if (status === '404') showModalError('githubNotFound');
                else showModalError('githubServerError', `HTTP ${status}`);
            } else showModalError('githubNetworkError', error.message);
            setTimeout(() => { modal.classList.add('active'); tokenInput.focus(); }, 100);
        }
    }

    function renderProfile(user, token) {
        const avatarUrl = user.avatar_url || 'images/default-avatar.webp';
        const login = user.login;
        profileContainer.innerHTML = `
            <img src="${avatarUrl}" alt="${login}" class="nav-profile-avatar" onerror="this.src='images/default-avatar.webp'" width="32" height="32">
            <span class="nav-profile-login">${login}</span>
            <i class="fas fa-chevron-right nav-profile-chevron"></i>
            <div class="profile-dropdown">
                <div class="profile-dropdown-item" data-action="profile"><i class="fas fa-user"></i> <span data-lang="githubProfile">Профиль</span> (${login})</div>
                <div class="profile-dropdown-item" data-action="token-info"><i class="fas fa-key"></i> <span data-lang="githubTokenActive">Токен активен</span></div>
                <div class="profile-dropdown-item" data-action="revoke-token"><i class="fas fa-external-link-alt"></i> <span data-lang="githubRevoke">Управление токенами</span></div>
                <div class="profile-dropdown-divider"></div>
                <div class="profile-dropdown-item" data-action="support"><i class="fas fa-headset"></i> <span data-lang="supportMenuItem">Поддержка</span></div>
                <div class="profile-dropdown-divider"></div>
                <div class="profile-dropdown-item" data-action="clear-cache"><i class="fas fa-trash-alt"></i> <span data-lang="githubClearCache">Очистить кеш</span></div>
                <div class="profile-dropdown-item" data-action="logout"><i class="fas fa-sign-out-alt"></i> <span data-lang="githubLogout">Выйти</span></div>
            </div>
        `;
        profileContainer.dataset.githubToken = token;
        profileContainer.dataset.githubLogin = login;
        profileContainer.addEventListener('click', toggleDropdown);
        attachDropdownHandlers();
    }

    function showNotLoggedIn() {
        profileContainer.innerHTML = `
            <span class="nav-profile-login placeholder" data-lang="githubLogin">Войти</span>
            <i class="fas fa-chevron-right nav-profile-chevron"></i>
            <div class="profile-dropdown">
                <div class="profile-dropdown-item" data-action="login"><i class="fab fa-github"></i> <span data-lang="githubLoginVia">Войти через GitHub</span></div>
                <div class="profile-dropdown-item" data-action="about"><i class="fas fa-info-circle"></i> <span data-lang="githubWhy">Зачем это нужно?</span></div>
                <div class="profile-dropdown-divider"></div>
                <div class="profile-dropdown-item" data-action="clear-cache"><i class="fas fa-trash-alt"></i> <span data-lang="githubClearCache">Очистить кеш</span></div>
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
            case 'login': modal.classList.add('active'); tokenInput.focus(); break;
            case 'about': Core.showToast('Вход через GitHub позволяет оставлять идеи, голосовать и участвовать.', 'info'); break;
            case 'profile': if (userLogin) window.open(`https://github.com/${userLogin}`, '_blank'); break;
            case 'token-info': if (token) Core.showToast(`Вы вошли как ${userLogin}. Токен сохранён в браузере.`, 'success'); break;
            case 'revoke-token': window.open('https://github.com/settings/tokens', '_blank'); Core.showToast('Перейдите в раздел токенов, чтобы удалить ненужные', 'info'); break;
            case 'support': if (window.UIFeedback?.openSupportModal) window.UIFeedback.openSupportModal(); else Core.showToast('Система поддержки временно недоступна', 'error'); break;
            case 'clear-cache':
                const lastClear = localStorage.getItem(LAST_CLEAR_KEY);
                if (lastClear && Date.now() - parseInt(lastClear) < CLEAR_COOLDOWN) {
                    const remaining = Math.ceil((CLEAR_COOLDOWN - (Date.now() - parseInt(lastClear))) / 1000);
                    Core.showToast(`Очистка кеша доступна раз в 10 секунд. Подождите ${remaining} секунд.`, 'warning');
                    return;
                }
                sessionStorage.clear();
                localStorage.setItem(LAST_CLEAR_KEY, Date.now().toString());
                Core.showToast('Кеш очищен, страница будет перезагружена.', 'info');
                setTimeout(() => location.reload(), 1000);
                break;
            case 'logout':
                localStorage.removeItem(TOKEN_KEY);
                sessionStorage.clear();
                window.dispatchEvent(new CustomEvent('github-logout'));
                delete profileContainer.dataset.githubToken;
                delete profileContainer.dataset.githubLogin;
                showNotLoggedIn();
                Core.showToast('Вы вышли из аккаунта.', 'info');
                location.reload();
                break;
        }
    }

    function toggleDropdown(e) {
        e.stopPropagation();
        const isActive = profileContainer.classList.contains('active');
        profileContainer.classList.toggle('active');
        profileContainer.setAttribute('aria-expanded', (!isActive).toString());
    }

    window.GithubAuth = {
        getCurrentUser: () => profileContainer ? profileContainer.dataset.githubLogin : null,
        getToken: () => localStorage.getItem(TOKEN_KEY),
        isAdmin: () => {
            const user = window.GithubAuth.getCurrentUser();
            return user && ALLOWED_AUTHORS.includes(user);
        }
    };
})();