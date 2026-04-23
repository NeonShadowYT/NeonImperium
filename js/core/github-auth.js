// github-auth.js — аутентификация GitHub с динамической загрузкой модулей
(function() {
    const { CONFIG, createElement } = GithubCore;
    const TOKEN_KEY = 'github_token';
    const USER_CACHE_KEY = 'github_user';
    const SCOPES_CACHE_KEY = 'github_scopes';
    const LAST_CLEAR_KEY = 'last_cache_clear';
    const CLEAR_COOLDOWN = 10000;

    let navBar, profileContainer, modal, tokenInput, tokenToggle;
    let currentScopes = [];
    let currentUserLogin = null;

    // Динамический загрузчик модулей
    const ModuleLoader = {
        loaded: new Set(),
        async load(path) {
            if (this.loaded.has(path)) return;
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = path;
                script.async = true;
                script.onload = () => { this.loaded.add(path); resolve(); };
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
    };

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        navBar = document.querySelector('.nav-bar');
        if (!navBar) return;

        profileContainer = createElement('div', 'nav-profile', {}, {
            role: 'button', tabindex: '0'
        });

        const langSwitcher = document.querySelector('.lang-switcher');
        navBar.insertBefore(profileContainer, langSwitcher || null);

        createModal();
        restoreSession();
        attachGlobalListeners();
    }

    function restoreSession() {
        const savedToken = localStorage.getItem(TOKEN_KEY);
        const cachedUser = sessionStorage.getItem(USER_CACHE_KEY);
        const cachedScopes = sessionStorage.getItem(SCOPES_CACHE_KEY);

        if (savedToken && cachedUser) {
            try {
                const user = JSON.parse(cachedUser);
                currentUserLogin = user.login;
                currentScopes = cachedScopes ? JSON.parse(cachedScopes) : [];
                renderProfile(user, savedToken);
                if (CONFIG.ALLOWED_AUTHORS.includes(user.login)) {
                    preloadAdminModules();
                }
            } catch {
                validateAndShowProfile(savedToken);
            }
        } else if (savedToken) {
            validateAndShowProfile(savedToken);
        } else {
            showNotLoggedIn();
        }
    }

    function attachGlobalListeners() {
        window.addEventListener('click', e => {
            if (modal && e.target === modal) closeModal();
        });
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape' && modal?.classList.contains('active')) closeModal();
        });
        window.addEventListener('github-login-requested', () => {
            clearModalError();
            modal?.classList.add('active');
        });
    }

    async function preloadAdminModules() {
        // Предзагружаем админские модули в фоне
        ModuleLoader.load('js/features/editor.js').catch(()=>{});
        ModuleLoader.load('js/features/ui-feedback.js').catch(()=>{});
    }

    function createModal() {
        modal = createElement('div', 'modal', {}, {
            role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'github-modal-title'
        });
        modal.innerHTML = `
            <div class="modal-content">
                <h3 id="github-modal-title"><i class="fab fa-github"></i> <span data-lang="githubLoginTitle">Вход через GitHub</span></h3>
                <div class="modal-instructions" style="max-height:350px;overflow-y:auto;padding-right:10px;">
                    <p><strong>🔒 <span data-lang="githubSecure">Безопасно и прозрачно:</span></strong> <span data-lang="githubTokenNote">токен хранится в вашем браузере и передаётся только в GitHub API.</span></p>
                    <p><strong>📝 <span data-lang="githubHowTo">Как получить токен (простой способ):</span></strong></p>
                    <ol style="text-align:left;margin:10px 0 20px 20px;">
                        <li><span data-lang="githubStep1">Перейдите в </span><a href="https://github.com/settings/tokens" target="_blank">Personal access tokens (classic)</a>.</li>
                        <li><span data-lang="githubStep2">Нажмите "Generate new token (classic)".</span></li>
                        <li><span data-lang="githubStep3">Дайте имя, выберите срок (например, 30 дней).</span></li>
                        <li><span data-lang="githubStep4">В разделе "Select scopes" отметьте:</span>
                            <ul style="margin-top:5px;">
                                <li><strong>repo</strong> — для публикации постов, идей, комментариев.</li>
                                <li><strong>gist</strong> — для работы хранилища закладок.</li>
                            </ul>
                        </li>
                        <li><span data-lang="githubStep5">Скопируйте токен и вставьте сюда.</span></li>
                    </ol>
                    <p class="text-secondary" style="font-size:12px;background:var(--bg-primary);padding:8px;border-radius:8px;">
                        ⚠️ <span data-lang="githubWarning">Classic токен даёт доступ ко всем вашим репозиториям. Это нормально для участия в обсуждениях.</span>
                    </p>
                    <p style="margin-top:15px;text-align:center;">
                        <a href="https://github.com/settings/tokens" target="_blank" rel="noopener" style="color:var(--accent);">
                            <i class="fas fa-external-link-alt"></i> <span data-lang="githubRevokeLink">Управление токенами GitHub (для отзыва)</span>
                        </a>
                    </p>
                </div>
                <div style="position:relative;margin-bottom:16px;">
                    <input type="password" id="github-token-input" placeholder="github_pat_xxx..." autocomplete="off" style="width:100%;padding:12px;padding-right:40px;background:var(--bg-primary);border:1px solid var(--border);border-radius:12px;color:var(--text-primary);">
                    <button type="button" id="token-toggle" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:var(--text-secondary);cursor:pointer;" aria-label="Показать/скрыть токен">
                        <i class="fas fa-eye"></i>
                    </button>
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
            const isPassword = tokenInput.type === 'password';
            tokenInput.type = isPassword ? 'text' : 'password';
            tokenToggle.innerHTML = isPassword ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
        });

        document.getElementById('modal-submit').addEventListener('click', () => {
            const token = tokenInput.value.trim();
            if (token) validateAndShowProfile(token, true);
        });

        document.getElementById('modal-cancel').addEventListener('click', closeModal);
    }

    function closeModal() {
        modal.classList.remove('active');
        clearModalError();
        tokenInput.value = '';
        tokenInput.type = 'password';
        tokenToggle.innerHTML = '<i class="fas fa-eye"></i>';
    }

    function clearModalError() {
        const container = document.getElementById('modal-error-container');
        if (container) container.innerHTML = '';
    }

    function showModalError(messageKey, details = '') {
        const container = document.getElementById('modal-error-container');
        if (!container) return;
        const lang = localStorage.getItem('preferredLanguage') || 'ru';
        const errorMsg = window.translations?.[lang]?.[messageKey] || messageKey;
        container.innerHTML = `
            <div class="error-message" style="margin-bottom:15px;padding:10px;background:rgba(244,67,54,0.1);color:#f44336;border-radius:8px;text-align:center;">
                <i class="fas fa-exclamation-triangle"></i> ${errorMsg}
                ${details ? `<br><small>${details}</small>` : ''}
            </div>
        `;
    }

    async function validateAndShowProfile(token, shouldSave = false) {
        if (!token) return showModalError('githubTokenMissing');

        profileContainer.innerHTML = `<i class="fas fa-circle-notch fa-spin" style="color:var(--accent);margin:8px;"></i>`;
        clearModalError();

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!userResponse.ok) {
                throw new Error(userResponse.status === 401 ? 'unauthorized' : `http_${userResponse.status}`);
            }

            const scopesHeader = userResponse.headers.get('X-OAuth-Scopes');
            const scopes = scopesHeader ? scopesHeader.split(',').map(s => s.trim()) : [];
            const userData = await userResponse.json();
            currentUserLogin = userData.login;

            if (shouldSave) {
                localStorage.setItem(TOKEN_KEY, token);
                sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData));
                sessionStorage.setItem(SCOPES_CACHE_KEY, JSON.stringify(scopes));
            }

            currentScopes = scopes;
            window.dispatchEvent(new CustomEvent('github-login-success', { detail: { login: userData.login, scopes } }));

            renderProfile(userData, token);
            closeModal();

            const missingScopes = [];
            if (!scopes.includes('repo')) missingScopes.push('repo (посты)');
            if (!scopes.includes('gist')) missingScopes.push('gist (хранилище)');
            if (missingScopes.length) {
                UIUtils.showToast(`Внимание: отсутствуют разрешения ${missingScopes.join(', ')}`, 'warning', 8000);
            }

            if (CONFIG.ALLOWED_AUTHORS.includes(userData.login)) {
                preloadAdminModules();
            }

            // Обновляем страницу при необходимости
            if (window.refreshNewsFeed) window.refreshNewsFeed();
            if (window.refreshGameUpdates && window.currentGame) window.refreshGameUpdates(window.currentGame);

        } catch (error) {
            clearTimeout(timeoutId);
            console.error('Auth error:', error);
            localStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem(USER_CACHE_KEY);
            sessionStorage.removeItem(SCOPES_CACHE_KEY);

            if (error.name === 'AbortError') {
                showModalError('githubTimeout');
            } else if (error.message === 'unauthorized') {
                showModalError('githubAuthError', 'Токен недействителен или истёк');
            } else if (error.message.startsWith('http_')) {
                const status = error.message.split('_')[1];
                if (status === '403') showModalError('githubForbidden', 'Проверьте права токена');
                else if (status === '404') showModalError('githubNotFound', 'Репозиторий не найден');
                else showModalError('githubServerError', `HTTP ${status}`);
            } else if (error instanceof TypeError && error.message.includes('NetworkError')) {
                showModalError('githubNetworkError', 'Проверьте подключение к интернету');
            } else {
                showModalError('githubNetworkError', error.message);
            }

            setTimeout(() => {
                modal.classList.add('active');
                tokenInput.focus();
            }, 100);
        }
    }

    function renderProfile(user, token) {
        const avatarUrl = user.avatar_url || 'images/default-avatar.webp';
        const login = user.login || 'User';
        const hasRepo = currentScopes.includes('repo');
        const hasGist = currentScopes.includes('gist');
        const scopeStatus = [
            `<span style="color:${hasRepo?'#4caf50':'#ff9800'}" title="${hasRepo?'Доступ к постам':'Нет доступа к постам'}"><i class="fas fa-${hasRepo?'check':'exclamation-triangle'}-circle"></i> repo</span>`,
            `<span style="color:${hasGist?'#4caf50':'#ff9800'}" title="${hasGist?'Доступ к хранилищу':'Нет доступа к хранилищу'}"><i class="fas fa-${hasGist?'check':'exclamation-triangle'}-circle"></i> gist</span>`
        ].join(' ');

        profileContainer.innerHTML = `
            <img src="${avatarUrl}" alt="${login}" class="nav-profile-avatar" onerror="this.src='images/default-avatar.webp'" width="32" height="32">
            <span class="nav-profile-login">${login}</span>
            <i class="fas fa-chevron-right nav-profile-chevron"></i>
            <div class="profile-dropdown">
                <div class="profile-dropdown-item" data-action="profile"><i class="fas fa-user"></i> <span data-lang="githubProfile">Профиль</span> (${login})</div>
                <div class="profile-dropdown-item" data-action="token-info"><i class="fas fa-key"></i> <span data-lang="githubTokenActive">Токен активен</span><div style="font-size:11px;margin-left:8px;">${scopeStatus}</div></div>
                <div class="profile-dropdown-item" data-action="storage"><i class="fas fa-box-archive"></i> <span>Хранилище</span> ${!hasGist ? '<span style="color:#ff9800;margin-left:5px;" title="Требуется gist scope">⚠️</span>' : ''}</div>
                <div class="profile-dropdown-item" data-action="revoke-token"><i class="fas fa-external-link-alt"></i> <span data-lang="githubRevoke">Управление токенами</span></div>
                <div class="profile-dropdown-divider"></div>
                <div class="profile-dropdown-item" data-action="clear-cache"><i class="fas fa-trash-alt"></i> <span data-lang="githubClearCache">Очистить кеш</span></div>
                <div class="profile-dropdown-item" data-action="logout"><i class="fas fa-sign-out-alt"></i> <span data-lang="githubLogout">Выйти</span></div>
            </div>
        `;
        profileContainer.dataset.githubToken = token;
        profileContainer.dataset.githubLogin = login;
        profileContainer.dataset.githubScopes = JSON.stringify(currentScopes);

        profileContainer.addEventListener('click', toggleDropdown);
        profileContainer.addEventListener('blur', () => setTimeout(() => profileContainer.classList.remove('active'), 200));
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
            item.addEventListener('click', e => {
                e.stopPropagation();
                handleDropdownAction(e.currentTarget.dataset.action);
                profileContainer.classList.remove('active');
            });
        });
    }

    async function handleDropdownAction(action) {
        const scopes = currentScopes;
        switch(action) {
            case 'login':
                modal.classList.add('active');
                tokenInput.focus();
                break;
            case 'about':
                UIUtils.showToast('Вход через GitHub позволяет оставлять идеи, голосовать. Нужны scope "repo" и "gist".', 'info', 8000);
                break;
            case 'profile':
                if (currentUserLogin) window.open(`https://github.com/${currentUserLogin}`, '_blank');
                break;
            case 'token-info':
                UIUtils.showToast(`Вы вошли как ${currentUserLogin}. Разрешения: ${scopes.length ? scopes.join(', ') : 'отсутствуют'}.`, 'info', 6000);
                break;
            case 'storage':
                if (!scopes.includes('gist')) return UIUtils.showToast('Нужен scope "gist"', 'error');
                // Загружаем хранилище вручную, так как динамический import может не работать
                if (window.BookmarkStorage) {
                    window.BookmarkStorage.openStorageModal();
                } else {
                    ModuleLoader.load('js/features/storage.js').then(() => {
                        setTimeout(() => {
                            if (window.BookmarkStorage) window.BookmarkStorage.openStorageModal();
                            else UIUtils.showToast('Ошибка загрузки хранилища', 'error');
                        }, 100);
                    }).catch(() => UIUtils.showToast('Ошибка загрузки хранилища', 'error'));
                }
                break;
            case 'revoke-token':
                window.open('https://github.com/settings/tokens', '_blank');
                UIUtils.showToast('Перейдите в раздел токенов', 'info');
                break;
            case 'clear-cache':
                handleClearCache();
                break;
            case 'logout':
                localStorage.removeItem(TOKEN_KEY);
                sessionStorage.clear();
                window.dispatchEvent(new CustomEvent('github-logout'));
                currentScopes = [];
                currentUserLogin = null;
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
            UIUtils.showToast(`Подождите ${remaining} секунд`, 'warning');
            return;
        }
        sessionStorage.clear();
        localStorage.setItem(LAST_CLEAR_KEY, Date.now().toString());
        UIUtils.showToast('Кеш очищен', 'info');
        setTimeout(() => location.reload(), 1000);
    }

    function toggleDropdown(e) {
        e.stopPropagation();
        profileContainer.classList.toggle('active');
    }

    window.GithubAuth = {
        getCurrentUser: () => currentUserLogin,
        getToken: () => localStorage.getItem(TOKEN_KEY),
        getScopes: () => currentScopes,
        hasScope: scope => currentScopes.includes(scope),
        isAdmin: () => currentUserLogin && CONFIG.ALLOWED_AUTHORS.includes(currentUserLogin)
    };
})();