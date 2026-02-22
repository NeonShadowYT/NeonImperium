// admin-news.js — форма создания новостей и обновлений для NeonShadowYT

(function() {
    const ALLOWED_USERS = ['NeonShadowYT'];
    const REPO_OWNER = 'NeonShadowYT';
    const REPO_NAME = 'NeonImperium';

    const GAMES = [
        { id: 'starve-neon', name: 'Starve Neon' },
        { id: 'alpha-01', name: 'Alpha 01' },
        { id: 'gc-adven', name: 'ГК Адвенчур' }
    ];

    let currentUser = null;
    let token = null;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        // Слушаем события авторизации
        window.addEventListener('github-login-success', (e) => {
            currentUser = e.detail.login;
            token = localStorage.getItem('github_token');
            renderAdminPanels();
        });

        window.addEventListener('github-logout', () => {
            currentUser = null;
            token = null;
            renderAdminPanels();
        });

        // Проверим текущее состояние
        const profile = document.querySelector('.nav-profile');
        currentUser = profile ? profile.dataset.githubLogin : null;
        token = localStorage.getItem('github_token');
        renderAdminPanels();
    }

    function renderAdminPanels() {
        if (!currentUser || !ALLOWED_USERS.includes(currentUser) || !token) {
            // Скрываем все админ-панели
            document.querySelectorAll('.admin-panel').forEach(el => el.remove());
            return;
        }

        // Добавляем панель на главную, если есть блок новостей
        const newsSection = document.getElementById('news-section');
        if (newsSection && !newsSection.querySelector('.admin-panel')) {
            const panel = createAdminPanel('news');
            newsSection.appendChild(panel);
        }

        // Добавляем панель на страницы игр, если есть блок обновлений
        const updatesContainer = document.getElementById('game-updates');
        if (updatesContainer && updatesContainer.dataset.game) {
            const game = updatesContainer.dataset.game;
            const parentSection = updatesContainer.closest('.card');
            if (parentSection && !parentSection.querySelector('.admin-panel')) {
                const panel = createAdminPanel('update', game);
                parentSection.appendChild(panel);
            }
        }
    }

    function createAdminPanel(type, game = null) {
        const container = document.createElement('div');
        container.className = 'admin-panel';
        container.style.marginTop = '20px';
        container.style.textAlign = 'right';

        const button = document.createElement('button');
        button.className = 'button';
        button.innerHTML = `<i class="fas fa-plus"></i> ${type === 'news' ? 'Добавить новость' : 'Добавить обновление'}`;
        button.addEventListener('click', () => showForm(type, game));

        container.appendChild(button);
        return container;
    }

    function showForm(type, game) {
        // Удаляем предыдущую форму, если есть
        const oldForm = document.getElementById('admin-post-form');
        if (oldForm) oldForm.remove();

        const form = document.createElement('div');
        form.id = 'admin-post-form';
        form.className = 'feedback-form';
        form.style.marginTop = '20px';

        let gameSelectHtml = '';
        if (type === 'update') {
            gameSelectHtml = `
                <select id="admin-post-game" required>
                    <option value="">Выберите игру</option>
                    ${GAMES.map(g => `<option value="${g.id}" ${g.id === game ? 'selected' : ''}>${g.name}</option>`).join('')}
                </select>
            `;
        }

        form.innerHTML = `
            <h3>${type === 'news' ? 'Новая новость' : 'Новое обновление'}</h3>
            <input type="text" id="admin-post-title" placeholder="Заголовок" required>
            ${gameSelectHtml}
            <textarea id="admin-post-body" placeholder="Текст (поддерживается Markdown, можно вставлять изображения)" rows="10" required></textarea>
            <div class="button-group">
                <button class="button button-secondary" id="admin-post-cancel">Отмена</button>
                <button class="button" id="admin-post-submit">Опубликовать</button>
            </div>
        `;

        // Вставляем форму после кнопки
        const parent = document.querySelector('.admin-panel');
        parent.parentNode.insertBefore(form, parent.nextSibling);

        document.getElementById('admin-post-cancel').addEventListener('click', () => form.remove());
        document.getElementById('admin-post-submit').addEventListener('click', () => submitPost(type));
    }

    async function submitPost(type) {
        const title = document.getElementById('admin-post-title').value.trim();
        const body = document.getElementById('admin-post-body').value.trim();
        let game = null;
        if (type === 'update') {
            game = document.getElementById('admin-post-game').value;
            if (!game) {
                alert('Выберите игру');
                return;
            }
        }

        if (!title || !body) {
            alert('Заполните заголовок и текст');
            return;
        }

        const labels = [type === 'news' ? 'news' : `update:${game}`];

        const submitBtn = document.getElementById('admin-post-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Публикация...';

        try {
            const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title, body, labels })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.message || 'Ошибка');
            }

            // Очищаем кеш соответствующего типа
            if (type === 'news') {
                sessionStorage.removeItem('posts_news');
                sessionStorage.removeItem('posts_news_time');
                // Обновляем блок новостей на главной
                if (window.refreshNewsFeed) window.refreshNewsFeed();
            } else {
                const cacheKey = `posts_update_${game}`;
                sessionStorage.removeItem(cacheKey);
                sessionStorage.removeItem(`${cacheKey}_time`);
                // Обновляем блок обновлений
                if (window.refreshGameUpdates) window.refreshGameUpdates(game);
            }

            // Убираем форму
            document.getElementById('admin-post-form').remove();

        } catch (err) {
            console.error(err);
            alert('Ошибка: ' + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Опубликовать';
        }
    }
})();