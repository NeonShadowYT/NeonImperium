// js/features/auth.js
(function() {
    const { showToast, createModal } = NeonUtils;
    const { setState, getState, subscribe, on, emit } = NeonState;

    let profileContainer;

    function createProfileUI() {
        const navBar = document.querySelector('.nav-bar');
        if (!navBar) return;
        profileContainer = navBar.querySelector('.nav-profile');
        if (!profileContainer) {
            profileContainer = document.createElement('div');
            profileContainer.className = 'nav-profile';
            profileContainer.setAttribute('tabindex', '0');
            const langSwitcher = navBar.querySelector('.lang-switcher');
            navBar.insertBefore(profileContainer, langSwitcher);
        }
        updateProfileUI();
        attachEvents();
    }

    function updateProfileUI() {
        if (!profileContainer) return;
        const user = getState('currentUser');
        const token = getState('token');
        if (user && token) {
            const cached = sessionStorage.getItem('github_user');
            const avatar = cached ? JSON.parse(cached).avatar_url : 'images/default-avatar.webp';
            profileContainer.innerHTML = `
                <img src="${avatar}" alt="${user}" class="nav-profile-avatar" width="32" height="32" onerror="this.src='images/default-avatar.webp'">
                <span class="nav-profile-login">${user}</span>
                <i class="fas fa-chevron-right nav-profile-chevron"></i>
                <div class="profile-dropdown">
                    <div class="profile-dropdown-item" data-action="profile"><i class="fas fa-user"></i> Профиль (${user})</div>
                    <div class="profile-dropdown-item" data-action="token-info"><i class="fas fa-key"></i> Токен активен</div>
                    <div class="profile-dropdown-item" data-action="revoke-token"><i class="fas fa-external-link-alt"></i> Управление токенами</div>
                    <div class="profile-dropdown-divider"></div>
                    <div class="profile-dropdown-item" data-action="support"><i class="fas fa-headset"></i> Поддержка</div>
                    <div class="profile-dropdown-divider"></div>
                    <div class="profile-dropdown-item" data-action="clear-cache"><i class="fas fa-trash-alt"></i> Очистить кеш</div>
                    <div class="profile-dropdown-item" data-action="logout"><i class="fas fa-sign-out-alt"></i> Выйти</div>
                </div>
            `;
        } else {
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
        }
    }

    function attachEvents() {
        profileContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            profileContainer.classList.toggle('active');
        });
        profileContainer.addEventListener('blur', () => {
            setTimeout(() => profileContainer.classList.remove('active'), 200);
        });
        profileContainer.querySelectorAll('[data-action]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                profileContainer.classList.remove('active');
                handleAction(el.dataset.action);
            });
        });
    }

    function handleAction(action) {
        const user = getState('currentUser');
        switch(action) {
            case 'login': openLoginModal(); break;
            case 'about': showToast('Вход позволяет оставлять идеи, голосовать и участвовать', 'info'); break;
            case 'profile': user && window.open(`https://github.com/${user}`, '_blank'); break;
            case 'token-info': showToast(`Вы вошли как ${user}. Токен сохранён в браузере.`, 'success'); break;
            case 'revoke-token': window.open('https://github.com/settings/tokens', '_blank'); break;
            case 'support': if (window.UIFeedback) UIFeedback.openSupportModal(); break;
            case 'clear-cache':
                NeonUtils.clearAllCache();
                showToast('Кеш очищен', 'info');
                setTimeout(() => location.reload(), 1000);
                break;
            case 'logout':
                localStorage.removeItem('github_token');
                sessionStorage.removeItem('github_user');
                setState('token', null);
                setState('currentUser', null);
                updateProfileUI();
                emit('logout');
                showToast('Вы вышли', 'info');
                break;
        }
    }

    function openLoginModal() {
        const { modal } = createModal('Вход через GitHub', `
            <div>
                <p><strong>🔒 Безопасно:</strong> токен хранится только в вашем браузере.</p>
                <p><strong>📝 Как получить токен:</strong> перейдите в <a href="https://github.com/settings/tokens" target="_blank">Personal access tokens (classic)</a>, создайте токен с правами <strong>repo</strong> и вставьте его ниже.</p>
                <div style="position:relative; margin:16px 0">
                    <input type="password" id="github-token-input" placeholder="github_pat_xxx..." style="width:100%; padding:12px; padding-right:40px; background:var(--bg-primary); border:1px solid var(--border); border-radius:12px; color:var(--text-primary);">
                    <button type="button" id="token-toggle" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); background:transparent; border:none; color:var(--text-secondary); cursor:pointer;"><i class="fas fa-eye"></i></button>
                </div>
                <div id="login-error" style="color:#f44336; margin-bottom:12px;"></div>
                <div class="modal-buttons">
                    <button class="button" id="modal-cancel">Отмена</button>
                    <button class="button" id="modal-submit">Войти</button>
                </div>
            </div>
        `);
        const input = modal.querySelector('#github-token-input');
        const toggle = modal.querySelector('#token-toggle');
        toggle.addEventListener('click', () => {
            input.type = input.type === 'password' ? 'text' : 'password';
            toggle.innerHTML = input.type === 'password' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
        });
        modal.querySelector('#modal-cancel').addEventListener('click', () => modal.remove());
        modal.querySelector('#modal-submit').addEventListener('click', async () => {
            const token = input.value.trim();
            if (!token) return showToast('Введите токен', 'error');
            try {
                const user = await NeonAPI.githubFetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
                localStorage.setItem('github_token', token);
                sessionStorage.setItem('github_user', JSON.stringify(user));
                setState('token', token);
                setState('currentUser', user.login);
                updateProfileUI();
                modal.remove();
                showToast(`Добро пожаловать, ${user.login}!`, 'success');
                emit('login-success', { login: user.login });
            } catch (err) {
                document.getElementById('login-error').textContent = 'Ошибка: неверный токен или нет доступа.';
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        createProfileUI();
        subscribe('currentUser', updateProfileUI);
    });

    window.GithubAuth = {
        getCurrentUser: () => getState('currentUser'),
        getToken: () => getState('token'),
        isAdmin: () => {
            const user = getState('currentUser');
            return user && NeonConfig.ALLOWED_AUTHORS.includes(user);
        }
    };
})();