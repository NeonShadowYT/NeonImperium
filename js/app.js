// js/app.js
(function() {
    // Инициализация дополнительных модулей при необходимости
    // Все основные модули уже загружены статически

    // Глобальные обработчики событий
    window.addEventListener('github-login-requested', () => {
        // Открыть модалку входа (уже реализовано в auth.js через кнопку профиля)
        const profile = document.querySelector('.nav-profile');
        if (profile) {
            const loginBtn = profile.querySelector('[data-action="login"]');
            if (loginBtn) loginBtn.click();
        }
    });

    // Локализация при загрузке (выполняется в lang.js)
    // Убедимся, что marked загружен при первом рендеринге
    NeonUtils.ensureMarked().catch(console.warn);

    console.log('Neon Imperium app initialized');
})();