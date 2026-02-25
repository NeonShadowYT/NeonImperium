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
        script.onload = () => {
            // После загрузки скрипта вызываем его инициализацию, если DOM уже готов
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', window.renderAdminPanels);
            } else {
                window.renderAdminPanels();
            }
        };
        document.body.appendChild(script);
    }

    // ... остальные функции (createModal, validateAndShowProfile, renderProfile, showNotLoggedIn, showLoginError, attachDropdownHandlers, handleDropdownAction, handleClearCache, toggleDropdown) без изменений
    // (для краткости они не дублируются, но подразумеваются)

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