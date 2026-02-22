// admin-news.js — форма создания новостей и обновлений для администраторов

(function() {
    const { cacheRemove, CONFIG } = GithubCore;
    const { createIssue } = GithubAPI;
    const { isAdmin, getCurrentUser } = GithubAuth;

    const RATE_LIMIT = 60 * 1000;
    const GAMES = [
        { id: 'starve-neon', name: 'Starve Neon' },
        { id: 'alpha-01', name: 'Alpha 01' },
        { id: 'gc-adven', name: 'ГК Адвенчур' }
    ];

    function renderAdminPanels() {
        if (!isAdmin()) {
            document.querySelectorAll('.admin-panel').forEach(el => el.remove());
            return;
        }

        const newsSection = document.getElementById('news-section');
        if (newsSection && !newsSection.querySelector('.admin-panel')) {
            const panel = createAdminPanel('news');
            newsSection.appendChild(panel);
        }

        const updatesContainer = document.getElementById('game-updates');
        if (updatesContainer && updatesContainer.dataset.game) {
            const game = updatesContainer.dataset.game;
            const existingPanel = document.querySelector(`.admin-panel[data-for="updates-${game}"]`);
            if (!existingPanel) {
                const panel = createAdminPanel('update', game);
                panel.dataset.for = `updates-${game}`;
                updatesContainer.parentNode.insertBefore(panel, updatesContainer.nextSibling);
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
        document.querySelectorAll('.admin-panel').forEach(el => el.remove());
    });

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
        const oldForm = document.getElementById('admin-post-form');
        if (oldForm) oldForm.remove();

        const form = document.createElement('div');
        form.id = 'admin-post-form';
        form.className = 'feedback-form';
        form.style.marginTop = '20px';

        let gameSelectHtml = '';
        if (type === 'update') {
            gameSelectHtml = `
                <select id="admin-post-game" required class="feedback-select">
                    <option value="">Выберите игру</option>
                    ${GAMES.map(g => `<option value="${g.id}" ${g.id === game ? 'selected' : ''}>${g.name}</option>`).join('')}
                </select>
            `;
        }

        form.innerHTML = `
            <h3>${type === 'news' ? 'Новая новость' : 'Новое обновление'}</h3>
            <input type="text" id="admin-post-title" placeholder="Заголовок" required class="feedback-input">
            ${gameSelectHtml}
            <div id="admin-editor-toolbar"></div>
            <textarea id="admin-post-body" placeholder="Текст (поддерживается Markdown, можно вставлять изображения)" rows="10" required class="feedback-textarea"></textarea>
            <div class="preview-area" id="preview-area-admin" style="display: none; background: var(--bg-primary); border-radius: 16px; padding: 16px; margin-top: 10px;"></div>
            <div class="button-group">
                <button class="button button-secondary" id="admin-post-cancel">Отмена</button>
                <button class="button" id="admin-post-submit">Опубликовать</button>
            </div>
        `;

        const parent = document.querySelector('.admin-panel');
        parent.parentNode.insertBefore(form, parent.nextSibling);

        const textarea = document.getElementById('admin-post-body');
        const toolbarContainer = document.getElementById('admin-editor-toolbar');

        if (typeof Editor !== 'undefined') {
            const toolbar = Editor.createEditorToolbar(textarea, {
                previewId: 'preview-btn-admin',
                previewAreaId: 'preview-area-admin',
                onPreview: () => {
                    const previewArea = document.getElementById('preview-area-admin');
                    const body = textarea.value;
                    if (!body.trim()) {
                        previewArea.style.display = 'none';
                        return;
                    }
                    previewArea.innerHTML = GithubCore.renderMarkdown(body);
                    previewArea.style.display = 'block';
                }
            });
            toolbarContainer.appendChild(toolbar);
        } else {
            console.warn('Editor module not loaded');
        }

        document.getElementById('admin-post-cancel').addEventListener('click', () => form.remove());
        document.getElementById('admin-post-submit').addEventListener('click', () => submitPost(type));
    }

    async function submitPost(type) {
        const lastPostTime = localStorage.getItem('last_post_time');
        if (lastPostTime && Date.now() - parseInt(lastPostTime) < RATE_LIMIT) {
            const remaining = Math.ceil((RATE_LIMIT - (Date.now() - parseInt(lastPostTime))) / 1000);
            alert(`Пожалуйста, подождите ${remaining} секунд перед следующей публикацией.`);
            return;
        }

        const title = document.getElementById('admin-post-title').value.trim();
        const bodyRaw = document.getElementById('admin-post-body').value;
        const bodyTrimmed = bodyRaw.trim();
        let game = null;
        if (type === 'update') {
            game = document.getElementById('admin-post-game').value;
            if (!game) {
                alert('Выберите игру');
                return;
            }
        }

        if (!title || !bodyTrimmed) {
            alert('Заполните заголовок и текст');
            return;
        }

        const labels = type === 'news' ? ['news'] : ['update', `game:${game}`];

        const submitBtn = document.getElementById('admin-post-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Публикация...';

        try {
            await createIssue(title, bodyRaw, labels);
            localStorage.setItem('last_post_time', Date.now().toString());

            cacheRemove('posts_news+update');
            if (type === 'update') {
                cacheRemove(`game_updates_${game}`);
            }

            if (window.refreshNewsFeed) window.refreshNewsFeed();
            if (type === 'update' && window.refreshGameUpdates) {
                window.refreshGameUpdates(game);
            }

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