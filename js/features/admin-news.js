// admin-news.js — кнопки для админов с aria-label, поддержка существующих кнопок
// Теперь использует MutationObserver для отслеживания появления контейнеров

(function() {
    const { cacheRemove, CONFIG } = GithubCore;
    const { isAdmin } = GithubAuth;
    const { openEditorModal } = UIFeedback;

    // Состояние: были ли уже добавлены кнопки
    let panelsAdded = false;

    function renderAdminPanels() {
        if (!isAdmin()) {
            document.querySelectorAll('.admin-panel, .admin-news-btn, .admin-update-btn').forEach(el => el.remove());
            return;
        }

        // Кнопка для новостей
        const newsSection = document.getElementById('news-section');
        if (newsSection) {
            let header = newsSection.querySelector('.news-header');
            if (!header) {
                header = document.createElement('div');
                header.className = 'news-header';
                header.style.display = 'flex';
                header.style.alignItems = 'center';
                header.style.justifyContent = 'space-between';
                header.style.marginBottom = '20px';
                const title = document.createElement('h2');
                title.textContent = 'Новости';
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

        // Кнопка для обновлений (ищет все контейнеры game-updates)
        document.querySelectorAll('#game-updates').forEach(updatesContainer => {
            const game = String(updatesContainer.dataset.game).trim();
            if (!game) {
                console.warn('admin-news.js: data-game пустой или содержит только пробелы');
                return;
            }
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
            if (!header.querySelector('.admin-update-btn')) {
                const btn = document.createElement('button');
                btn.className = 'button admin-update-btn';
                btn.innerHTML = '<i class="fas fa-plus"></i> Добавить обновление';
                btn.setAttribute('aria-label', 'Добавить обновление');
                btn.addEventListener('click', () => openEditorModal('new', { game: game }, 'update'));
                header.appendChild(btn);
            }
        });
    }

    // Используем MutationObserver для отслеживания появления нужных элементов
    function initObserver() {
        const observer = new MutationObserver((mutations) => {
            // Проверяем, появились ли #news-section или #game-updates
            const newsSection = document.getElementById('news-section');
            const updatesContainers = document.querySelectorAll('#game-updates');
            if ((newsSection || updatesContainers.length > 0) && !panelsAdded) {
                renderAdminPanels();
                panelsAdded = true;
                // Можно отключить observer после первого успеха, но оставим на случай динамических изменений
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Функция для явного вызова извне (например, после логина)
    function init() {
        panelsAdded = false; // сбрасываем флаг, чтобы кнопки добавились заново
        renderAdminPanels();
        // также запускаем observer для будущих изменений
        initObserver();
    }

    // Запускаем при загрузке скрипта
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(init, 200);
    });

    // Также слушаем события логина/логаута
    window.addEventListener('github-login-success', () => {
        setTimeout(init, 100);
    });

    window.addEventListener('github-logout', () => {
        document.querySelectorAll('.admin-panel, .admin-news-btn, .admin-update-btn').forEach(el => el.remove());
        panelsAdded = false;
    });

    // Экспортируем для возможности вызова из github-auth.js
    window.AdminNews = { init };
})();