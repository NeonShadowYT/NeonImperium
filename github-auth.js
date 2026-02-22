// github-auth.js — обновлён с инструкцией и событием

(function() {
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',       // ← замените, если нужно
        REPO_NAME: 'NeonImperium',        // ← замените, если нужно
        DEFAULT_AVATAR: 'images/default-avatar.png'
    };

    const TOKEN_KEY = 'github_token';
    let navBar, profileContainer, modal, tokenInput;

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
        if (savedToken) {
            validateAndShowProfile(savedToken);
        } else {
            showNotLoggedIn();
        }

        window.addEventListener('click', (e) => {
            if (modal && e.target === modal) {
                modal.classList.remove('active');
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal?.classList.contains('active')) {
                modal.classList.remove('active');
            }
        });

        // Слушаем событие запроса входа из блока обратной связи
        window.addEventListener('github-login-requested', () => {
            if (modal) modal.classList.add('active');
        });
    }

    function createModal() {
        modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3><i class="fab fa-github"></i> Вход через GitHub</h3>
                <div class="modal-instructions" style="max-height: 300px; overflow-y: auto; padding-right: 10px;">
                    <p><strong>🔒 Это безопасно:</strong></p>
                    <ul style="text-align: left; margin: 10px 0 20px 20px; color: var(--text-secondary);">
                        <li>Ваш токен хранится только в вашем браузере (localStorage).</li>
                        <li>Токен передаётся напрямую в GitHub API — мы его не видим.</li>
                        <li>Вы можете в любой момент выйти — токен удалится.</li>
                        <li>Токен имеет доступ только к issues этого репозитория.</li>
                    </ul>
                    <p><strong>📝 Как получить токен:</strong></p>
                    <ol style="text-align: left; margin: 10px 0 20px 20px; color: var(--text-secondary);">
                        <li>Перейдите в <a href="https://github.com/settings/tokens?type=beta" target="_blank">Fine-grained tokens</a> (новая вкладка).</li>
                        <li>Нажмите "Generate new token".</li>
                        <li>Укажите имя (например, "Neon Imperium").</li>
                        <li>В "Repository access" выберите "Only select repositories" и отметьте <strong>${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}</strong>.</li>
                        <li>В "Permissions" найдите "Issues" и выберите "Access: Read and write".</li>
                        <li>Создайте токен и скопируйте его.</li>
                        <li>Вставьте токен в поле ниже и нажмите "Войти".</li>
                    </ol>
                </div>
                <input type="text" id="github-token-input" placeholder="github_pat_xxx..." autocomplete="off">
                <div class="modal-buttons">
                    <button class="button" id="modal-cancel">Отмена</button>
                    <button class="button" id="modal-submit">Войти</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        tokenInput = document.getElementById('github-token-input');
        document.getElementById('modal-submit').addEventListener('click', () => {
            const token = tokenInput.value.trim();
            if (token) validateAndShowProfile(token, true);
        });
        document.getElementById('modal-cancel').addEventListener('click', () => {
            modal.classList.remove('active');
            tokenInput.value = '';
        });
    }

    // Валидация токена через GitHub API и отображение профиля
    async function validateAndShowProfile(token, shouldSave = false) {
        try {
            // Показываем заглушку загрузки
            profileContainer.innerHTML = `
                <i class="fas fa-circle-notch fa-spin" style="color: var(--accent); margin: 8px;"></i>
            `;

            // Запрашиваем информацию о пользователе
            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!userResponse.ok) {
                throw new Error(`GitHub API error: ${userResponse.status}`);
            }

            const userData = await userResponse.json();

            // Дополнительно проверяем, что токен имеет доступ к issues репозитория
            const repoResponse = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!repoResponse.ok) {
                // Если нет доступа к репозиторию, но есть к пользователю — показываем профиль,
                // но с предупреждением, что функционал идей будет ограничен
                console.warn('Token does not have access to the repository');
            }

            // Сохраняем токен, если нужно
            if (shouldSave) {
                localStorage.setItem(TOKEN_KEY, token);
            }

            // Отображаем профиль
            renderProfile(userData, token);
            modal.classList.remove('active');

        } catch (error) {
            console.error('Auth error:', error);
            showNotLoggedIn();
            // Показываем ошибку
            profileContainer.innerHTML = `
                <span class="nav-profile-login placeholder">Ошибка</span>
                <i class="fas fa-exclamation-triangle" style="color: #f44336;"></i>
            `;
            // Через 2 секунды возвращаем обычный вид
            setTimeout(() => {
                if (!localStorage.getItem(TOKEN_KEY)) {
                    showNotLoggedIn();
                }
            }, 2000);
        }
    }

    // Отображение залогиненного профиля
    function renderProfile(user, token) {
        const avatarUrl = user.avatar_url || CONFIG.DEFAULT_AVATAR;
        const login = user.login || 'User';

        profileContainer.innerHTML = `
            <img src="${avatarUrl}" alt="${login}" class="nav-profile-avatar" onerror="this.src='${CONFIG.DEFAULT_AVATAR}'">
            <span class="nav-profile-login">${login}</span>
            <i class="fas fa-chevron-right nav-profile-chevron"></i>
            <div class="profile-dropdown">
                <div class="profile-dropdown-item" data-action="profile">
                    <i class="fas fa-user"></i> Профиль (${login})
                </div>
                <div class="profile-dropdown-item" data-action="token-info">
                    <i class="fas fa-key"></i> Токен активен
                </div>
                <div class="profile-dropdown-divider"></div>
                <div class="profile-dropdown-item" data-action="logout">
                    <i class="fas fa-sign-out-alt"></i> Выйти
                </div>
            </div>
        `;

        // Сохраняем токен в dataset для возможного использования другими скриптами
        profileContainer.dataset.githubToken = token;
        profileContainer.dataset.githubLogin = login;

        // Добавляем обработчики для дропдауна
        profileContainer.addEventListener('click', toggleDropdown);
        profileContainer.addEventListener('blur', () => {
            setTimeout(() => {
                profileContainer.classList.remove('active');
            }, 200);
        });

        // Обработчики пунктов меню
        profileContainer.querySelectorAll('[data-action]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = e.currentTarget.dataset.action;
                handleDropdownAction(action, token, user);
            });
        });
    }

    // Отображение незалогиненного состояния
    function showNotLoggedIn() {
        profileContainer.innerHTML = `
            <span class="nav-profile-login placeholder">Войти</span>
            <i class="fas fa-chevron-right nav-profile-chevron"></i>
            <div class="profile-dropdown">
                <div class="profile-dropdown-item" data-action="login">
                    <i class="fab fa-github"></i> Войти через GitHub
                </div>
                <div class="profile-dropdown-item" data-action="about">
                    <i class="fas fa-info-circle"></i> Зачем это нужно?
                </div>
            </div>
        `;

        profileContainer.addEventListener('click', toggleDropdown);

        profileContainer.querySelectorAll('[data-action]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = e.currentTarget.dataset.action;
                if (action === 'login') {
                    modal.classList.add('active');
                    tokenInput.focus();
                } else if (action === 'about') {
                    alert('Вход через GitHub позволяет оставлять идеи, голосовать за предложения и участвовать в жизни сообщества. Ваш токен хранится локально в браузере и не передаётся никуда, кроме GitHub API.');
                }
                profileContainer.classList.remove('active');
            });
        });
    }

    // Обработка действий в дропдауне
    function handleDropdownAction(action, token, user) {
        switch(action) {
            case 'profile':
                window.open(user.html_url, '_blank');
                break;
            case 'token-info':
                alert(`Вы вошли как ${user.login}. Токен сохранён в браузере и действителен до отзыва.`);
                break;
            case 'logout':
                localStorage.removeItem(TOKEN_KEY);
                delete profileContainer.dataset.githubToken;
                delete profileContainer.dataset.githubLogin;
                showNotLoggedIn();
                break;
        }
        profileContainer.classList.remove('active');
    }

    // Переключение дропдауна
    function toggleDropdown(e) {
        e.stopPropagation();
        profileContainer.classList.toggle('active');
    }
})();