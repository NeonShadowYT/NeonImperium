// admin-news.js — админские кнопки с проверкой repo
(function() {
    const { cacheRemove } = GithubCore;
    const { isAdmin, hasScope } = GithubAuth;
    const { openEditorModal } = UIFeedback;

    function renderAdminPanels() {
        if (!isAdmin() || !hasScope('repo')) {
            document.querySelectorAll('.admin-panel, .admin-news-btn, .admin-update-btn').forEach(el => el.remove());
            return;
        }

        const newsSection = document.getElementById('news-section');
        if (newsSection) {
            let header = newsSection.querySelector('.news-header');
            if (!header) {
                header = document.createElement('div');
                header.className = 'news-header';
                header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;';
                const title = document.createElement('h2');
                title.setAttribute('data-lang', 'newsTitle');
                title.textContent = '📰 Последние новости';
                header.appendChild(title);
                newsSection.prepend(header);
            }
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
            const game = String(updatesContainer.dataset.game).trim();
            if (!game) return;
            const parent = updatesContainer.parentNode;
            let header = parent.querySelector('.updates-header');
            if (!header) {
                const possibleHeader = parent.querySelector('div[style*="display: flex"]');
                if (possibleHeader && possibleHeader.querySelector('h2')) {
                    header = possibleHeader;
                    header.classList.add('updates-header');
                } else {
                    header = document.createElement('div');
                    header.className = 'updates-header';
                    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;';
                    const title = document.createElement('h2');
                    title.setAttribute('data-lang', 'updatesTitle');
                    title.textContent = 'Обновления';
                    header.appendChild(title);
                    parent.insertBefore(header, updatesContainer);
                }
            }
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

    function removeAdminPanels() {
        document.querySelectorAll('.admin-panel, .admin-news-btn, .admin-update-btn').forEach(el => el.remove());
    }

    function init() {
        setTimeout(() => {
            if (isAdmin() && hasScope('repo')) {
                renderAdminPanels();
            } else {
                removeAdminPanels();
            }
        }, 0);

        window.addEventListener('github-login-success', () => {
            setTimeout(() => {
                if (isAdmin() && hasScope('repo')) {
                    renderAdminPanels();
                } else {
                    removeAdminPanels();
                }
            }, 100);
        });

        window.addEventListener('github-logout', () => {
            removeAdminPanels();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();