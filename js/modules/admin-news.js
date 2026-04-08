// admin-news.js – кнопки добавления новостей и обновлений для админов
(function() {
    const { isAdmin } = GithubAuth;
    
    function renderAdminPanels() {
        if (!isAdmin()) {
            document.querySelectorAll('.admin-panel, .admin-news-btn, .admin-update-btn').forEach(el => el.remove());
            return;
        }
        
        // Новости на главной
        const newsSection = document.getElementById('news-section');
        if (newsSection) {
            let header = newsSection.querySelector('.news-header');
            if (!header) {
                header = document.createElement('div');
                header.className = 'news-header';
                header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;';
                const titleWrapper = document.createElement('div');
                titleWrapper.innerHTML = '<h2 data-lang="newsTitle" style="margin: 0;">📰 Последние новости</h2><p class="text-secondary" data-lang="newsDesc" style="margin: 4px 0 0;">Свежие видео и обновления</p>';
                header.appendChild(titleWrapper);
                newsSection.prepend(header);
            }
            if (!header.querySelector('.admin-news-btn')) {
                const btn = document.createElement('button');
                btn.className = 'button admin-news-btn';
                btn.innerHTML = '<i class="fas fa-plus"></i> Добавить новость';
                btn.setAttribute('aria-label', 'Добавить новость');
                btn.addEventListener('click', () => {
                    if (window.UIFeedback && window.UIFeedback.openEditorModal) {
                        window.UIFeedback.openEditorModal('new', { game: null }, 'news');
                    }
                });
                header.appendChild(btn);
            }
        }
        
        // Обновления игр
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
                    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; flex-wrap: wrap; gap: 10px;';
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
                btn.addEventListener('click', () => {
                    if (window.UIFeedback && window.UIFeedback.openEditorModal) {
                        window.UIFeedback.openEditorModal('new', { game: game }, 'update');
                    }
                });
                header.appendChild(btn);
            }
        }
    }
    
    function removeAdminPanels() {
        document.querySelectorAll('.admin-panel, .admin-news-btn, .admin-update-btn').forEach(el => el.remove());
    }
    
    function init() {
        setTimeout(() => {
            if (isAdmin()) {
                renderAdminPanels();
            } else {
                removeAdminPanels();
            }
        }, 0);
        
        window.addEventListener('github-login-success', () => {
            setTimeout(() => {
                if (isAdmin()) {
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