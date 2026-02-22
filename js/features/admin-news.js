(function() {
    const { cacheRemove, CONFIG } = GithubCore;
    const { isAdmin } = GithubAuth;
    const { openEditorModal } = UIFeedback;

    function renderAdminPanels() {
        if (!isAdmin()) {
            document.querySelectorAll('.admin-panel').forEach(el => el.remove());
            return;
        }

        // News section – add button in header
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
            // Remove old button if exists, then add new
            const oldBtn = header.querySelector('.admin-news-btn');
            if (oldBtn) oldBtn.remove();
            const btn = document.createElement('button');
            btn.className = 'button admin-news-btn';
            btn.innerHTML = '<i class="fas fa-plus"></i> Добавить новость';
            btn.addEventListener('click', () => openEditorModal('new', { game: null }, 'news'));
            header.appendChild(btn);
        }

        // Game updates section – find container and add button to its header
        const updatesContainer = document.getElementById('game-updates');
        if (updatesContainer && updatesContainer.dataset.game) {
            const game = updatesContainer.dataset.game;
            const parent = updatesContainer.parentNode;
            let header = parent.querySelector('.updates-header');
            if (!header) {
                header = document.createElement('div');
                header.className = 'updates-header';
                header.style.display = 'flex';
                header.style.alignItems = 'center';
                header.style.justifyContent = 'space-between';
                header.style.marginBottom = '20px';
                const title = document.createElement('h2');
                title.textContent = 'Обновления игры';
                header.appendChild(title);
                parent.insertBefore(header, updatesContainer);
            }
            const oldBtn = header.querySelector('.admin-update-btn');
            if (oldBtn) oldBtn.remove();
            const btn = document.createElement('button');
            btn.className = 'button admin-update-btn';
            btn.innerHTML = '<i class="fas fa-plus"></i> Добавить обновление';
            btn.addEventListener('click', () => openEditorModal('new', { game: game }, 'update'));
            header.appendChild(btn);
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