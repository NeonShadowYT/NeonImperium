// js/features/admin.js
(function() {
    function renderAdminButtons() {
        if (!GithubAuth.isAdmin()) return;

        // Новостная лента на главной
        const newsHeader = document.querySelector('#news-section .news-header');
        if (newsHeader && !newsHeader.querySelector('.admin-news-btn')) {
            const btn = document.createElement('button');
            btn.className = 'button admin-news-btn';
            btn.innerHTML = '<i class="fas fa-plus"></i> Добавить новость';
            btn.addEventListener('click', () => {
                if (window.Editor && Editor.openEditorModal) {
                    Editor.openEditorModal('new', { game: null }, 'news');
                } else {
                    NeonUtils.showToast('Редактор временно недоступен', 'error');
                }
            });
            newsHeader.appendChild(btn);
        }

        // Обновления на страницах игр
        const updatesContainer = document.getElementById('game-updates');
        if (updatesContainer && updatesContainer.dataset.game) {
            const game = updatesContainer.dataset.game;
            const parent = updatesContainer.parentNode;
            let header = parent.querySelector('.updates-header');
            if (!header) {
                header = document.createElement('div');
                header.className = 'updates-header';
                header.style.display = 'flex';
                header.style.justifyContent = 'space-between';
                header.style.alignItems = 'center';
                header.style.marginBottom = '20px';
                const title = document.createElement('h2');
                title.setAttribute('data-lang', 'updatesTitle');
                title.textContent = 'Обновления';
                header.appendChild(title);
                parent.insertBefore(header, updatesContainer);
            }
            if (!header.querySelector('.admin-update-btn')) {
                const btn = document.createElement('button');
                btn.className = 'button admin-update-btn';
                btn.innerHTML = '<i class="fas fa-plus"></i> Добавить обновление';
                btn.addEventListener('click', () => {
                    if (window.Editor && Editor.openEditorModal) {
                        Editor.openEditorModal('new', { game: game }, 'update');
                    } else {
                        NeonUtils.showToast('Редактор временно недоступен', 'error');
                    }
                });
                header.appendChild(btn);
            }
        }
    }

    document.addEventListener('DOMContentLoaded', renderAdminButtons);
    window.addEventListener('login-success', renderAdminButtons);
    window.addEventListener('post-created', renderAdminButtons);
})();