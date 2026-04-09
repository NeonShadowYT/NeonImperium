// js/features/admin.js
(function() {
    function renderAdminButtons() {
        if (!GithubAuth.isAdmin()) return;
        const newsHeader = document.querySelector('#news-section .news-header');
        if (newsHeader && !newsHeader.querySelector('.admin-news-btn')) {
            const btn = document.createElement('button');
            btn.className = 'button admin-news-btn';
            btn.innerHTML = '<i class="fas fa-plus"></i> Новость';
            btn.addEventListener('click', () => UIFeedback.openEditorModal('new', { game: null }, 'news'));
            newsHeader.appendChild(btn);
        }
        const updatesContainer = document.getElementById('game-updates');
        if (updatesContainer) {
            const parent = updatesContainer.parentNode;
            let header = parent.querySelector('.updates-header');
            if (!header) {
                header = document.createElement('div');
                header.className = 'updates-header';
                header.style.display = 'flex';
                header.style.justifyContent = 'space-between';
                header.innerHTML = '<h2>Обновления</h2>';
                parent.insertBefore(header, updatesContainer);
            }
            if (!header.querySelector('.admin-update-btn')) {
                const btn = document.createElement('button');
                btn.className = 'button admin-update-btn';
                btn.innerHTML = '<i class="fas fa-plus"></i> Обновление';
                btn.addEventListener('click', () => UIFeedback.openEditorModal('new', { game: updatesContainer.dataset.game }, 'update'));
                header.appendChild(btn);
            }
        }
    }

    document.addEventListener('DOMContentLoaded', renderAdminButtons);
    window.addEventListener('login-success', renderAdminButtons);
})();