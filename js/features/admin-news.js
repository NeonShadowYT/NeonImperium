// admin-news.js — кнопки для админов с aria-label, поддержка существующих кнопок

(function() {
    const { cacheRemove, CONFIG } = GithubCore;
    const { isAdmin } = GithubAuth;
    const { openEditorModal } = UIFeedback;

    function renderAdminPanels() {
        if (!isAdmin()) {
            document.querySelectorAll('.admin-panel, .admin-news-btn, .admin-update-btn').forEach(el => el.remove());
            return;
        }

        const newsSection = document.getElementById('news-section');
        if (newsSection) {
            let header = newsSection.querySelector('.section-header');
            if (!header) {
                header = document.createElement('div');
                header.className = 'section-header';
                header.style.display = 'flex';
                header.style.alignItems = 'center';
                header.style.justifyContent = 'space-between';
                header.style.marginBottom = '20px';
                const title = document.createElement('h2');
                title.textContent = 'Новости';
                header.appendChild(title);
                newsSection.prepend(header);
            }
            // Проверяем, есть ли уже кнопка, чтобы не дублировать
            if (!header.querySelector('.admin-news-btn')) {
                const btn = document.createElement('button');
                btn.className = 'button admin-news-btn';
                btn.innerHTML = '<i class="fas fa-plus"></i> Добавить новость';
                btn.setAttribute('aria-label', 'Добавить новость');
                btn.addEventListener('click', () => openEditorModal('new', { game: null }, 'news'));
                header.appendChild(btn);
            }
        }

        const updatesContainer = document.getElementById('game-updates');
        if (updatesContainer && updatesContainer.dataset.game) {
            const game = updatesContainer.dataset.game;
            // Ищем родительский контейнер, который содержит заголовок
            const parent = updatesContainer.parentNode;
            let header = parent.querySelector('.updates-header');
            if (!header) {
                // Пытаемся найти существующий заголовок с кнопкой опросов
                const possibleHeader = parent.querySelector('div[style*="display: flex"]');
                if (possibleHeader && possibleHeader.querySelector('h2')) {
                    header = possibleHeader;
                    header.classList.add('updates-header');
                } else {
                    // Создаём новый заголовок
                    header = document.createElement('div');
                    header.className = 'updates-header';
                    header.style.display = 'flex';
                    header.style.alignItems = 'center';
                    header.style.justifyContent = 'space-between';
                    header.style.marginBottom = '20px';
                    const title = document.createElement('h2');
                    title.textContent = 'Обновления';
                    header.appendChild(title);
                    parent.insertBefore(header, updatesContainer);
                }
            }
            // Добавляем кнопку админа, если её ещё нет
            if (!header.querySelector('.admin-update-btn')) {
                const btn = document.createElement('button');
                btn.className = 'button admin-update-btn';
                btn.innerHTML = '<i class="fas fa-plus"></i> Добавить обновление';
                btn.setAttribute('aria-label', 'Добавить обновление');
                btn.addEventListener('click', () => openEditorModal('new', { game: game }, 'update'));
                header.appendChild(btn);
            }
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(renderAdminPanels, 200);
    });

    window.addEventListener('github-login-success', () => {
        setTimeout(renderAdminPanels, 100);
    });

    window.addEventListener('github-logout', () => {
        document.querySelectorAll('.admin-panel, .admin-news-btn, .admin-update-btn').forEach(el => el.remove());
    });
})();