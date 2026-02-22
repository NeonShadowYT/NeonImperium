// github-auth.js — GitHub аутентификация через Personal Access Token
// Работает напрямую с api.github.com, не требует OAuth-прокси

(function() {
    // Конфигурация — замените на свои данные
    const CONFIG = {
				REPO_OWNER: 'NeonShadowYT',
				REPO_NAME: 'NeonImperium',
				DEFAULT_AVATAR: 'images/default-avatar.png'
    };

    // Ключ для хранения токена в localStorage
    const TOKEN_KEY = 'github_token';

    // DOM элементы
    let navBar, profileContainer, modal, tokenInput;

    // Инициализация после загрузки DOM
    document.addEventListener('DOMContentLoaded', init);

    function init() {
        // Находим навигационную панель
        navBar = document.querySelector('.nav-bar');
        if (!navBar) {
            console.warn('Navigation bar not found');
            return;
        }

        // Создаём контейнер для профиля
        profileContainer = document.createElement('div');
        profileContainer.className = 'nav-profile';
        profileContainer.setAttribute('role', 'button');
        profileContainer.setAttribute('tabindex', '0');
        profileContainer.setAttribute('aria-label', 'GitHub profile menu');

        // Вставляем профиль в правую часть навигации
        const langSwitcher = document.querySelector('.lang-switcher');
        if (langSwitcher) {
            navBar.insertBefore(profileContainer, langSwitcher);
        } else {
            navBar.appendChild(profileContainer);
        }

        // Создаём модальное окно для ввода токена
        createModal();

        // Проверяем, есть ли сохранённый токен
        const savedToken = localStorage.getItem(TOKEN_KEY);
        if (savedToken) {
            validateAndShowProfile(savedToken);
        } else {
            showNotLoggedIn();
        }

        // Закрытие модального окна при клике вне его
        window.addEventListener('click', (e) => {
            if (modal && e.target === modal) {
                modal.classList.remove('active');
            }
        });

        // Закрытие по Escape
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
                modal.classList.remove('active');
            }
        });
    }

    // Создание модального окна для ввода токена
    function createModal() {
        modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3><i class="fab fa-github"></i> Вход через GitHub</h3>
                <p>Вставьте ваш Personal Access Token для доступа к функциям сайта (создание идей, комментарии).</p>
                <p class="text-secondary" style="font-size: 12px;">
                    Токен создаётся в <strong>Settings → Developer settings → Personal access tokens → Fine-grained tokens</strong>.<br>
                    Доступ: только к репозиторию <strong>${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}</strong>, права: <strong>Issues: write</strong>.
                </p>
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
            if (token) {
                validateAndShowProfile(token, true);
            }
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