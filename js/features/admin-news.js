// admin-news.js — форма создания и редактирования новостей и обновлений для администраторов

(function() {
    const { cacheRemove, CONFIG } = GithubCore;
    const { createIssue, updateIssue } = GithubAPI;
    const { isAdmin } = GithubAuth;

    const RATE_LIMIT = 60 * 1000;
    const GAMES = [
        { id: 'starve-neon', name: 'Starve Neon' },
        { id: 'alpha-01', name: 'Alpha 01' },
        { id: 'gc-adven', name: 'ГК Адвенчур' }
    ];

    // Глобальная функция для открытия формы редактирования (вызывается из других модулей)
    window.AdminNews = {
        openEditForm: function(type, issueData) {
            showForm(type, issueData.game, issueData);
        }
    };

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

    function showForm(type, game, existingIssue = null) {
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

        const titleValue = existingIssue ? existingIssue.title : '';
        const bodyValue = existingIssue ? existingIssue.body : '';

        form.innerHTML = `
            <h3>${existingIssue ? 'Редактирование' : (type === 'news' ? 'Новая новость' : 'Новое обновление')}</h3>
            <input type="text" id="admin-post-title" placeholder="Заголовок" required class="feedback-input" value="${GithubCore.escapeHtml(titleValue)}">
            ${gameSelectHtml}
            <div id="admin-editor-toolbar"></div>
            <textarea id="admin-post-body" placeholder="Текст (поддерживается Markdown, можно вставлять изображения)" rows="10" required class="feedback-textarea">${GithubCore.escapeHtml(bodyValue)}</textarea>
            <div class="preview-area" id="preview-area-admin" style="display: none; background: var(--bg-primary); border-radius: 16px; padding: 16px; margin-top: 10px;"></div>
            <div class="button-group">
                <button class="button button-secondary" id="admin-post-cancel">Отмена</button>
                <button class="button" id="admin-post-submit">${existingIssue ? 'Сохранить' : 'Опубликовать'}</button>
            </div>
        `;

        // Вставляем форму после панели администратора или в нужное место
        const target = document.querySelector('.admin-panel');
        if (target) {
            target.parentNode.insertBefore(form, target.nextSibling);
        } else {
            // Если панели нет (например, при редактировании с главной), вставляем в контейнер
            const container = type === 'news' ? document.getElementById('news-section') : document.getElementById('game-updates')?.parentNode;
            if (container) container.appendChild(form);
            else document.querySelector('.page').appendChild(form);
        }

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
        }

        document.getElementById('admin-post-cancel').addEventListener('click', () => form.remove());
        document.getElementById('admin-post-submit').addEventListener('click', () => submitPost(type, existingIssue));
    }

    async function submitPost(type, existingIssue = null) {
        const lastPostTime = localStorage.getItem('last_post_time');
        if (!existingIssue && lastPostTime && Date.now() - parseInt(lastPostTime) < RATE_LIMIT) {
            const remaining = Math.ceil((RATE_LIMIT - (Date.now() - parseInt(lastPostTime))) / 1000);
            alert(`Пожалуйста, подождите ${remaining} секунд перед следующей публикацией.`);
            return;
        }

        const title = document.getElementById('admin-post-title').value.trim();
        const bodyRaw = document.getElementById('admin-post-body').value;
        const bodyTrimmed = bodyRaw.trim();

        if (!title || !bodyTrimmed) {
            alert('Заполните заголовок и текст');
            return;
        }

        let labels;
        if (type === 'news') {
            labels = ['type:news'];
        } else {
            const game = document.getElementById('admin-post-game').value;
            if (!game) {
                alert('Выберите игру');
                return;
            }
            labels = ['type:update', `game:${game}`];
        }

        const submitBtn = document.getElementById('admin-post-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = existingIssue ? 'Сохранение...' : 'Публикация...';

        try {
            if (existingIssue) {
                await updateIssue(existingIssue.number, {
                    title: title,
                    body: bodyRaw,
                    labels: labels
                });
            } else {
                await createIssue(title, bodyRaw, labels);
                localStorage.setItem('last_post_time', Date.now().toString());
            }

            // Очистка кеша
            if (type === 'news') {
                cacheRemove('posts_news');
            } else {
                const game = existingIssue ? existingIssue.game : document.getElementById('admin-post-game').value;
                cacheRemove(`game_updates_${game}`);
            }
            cacheRemove('posts_news+update');

            if (window.refreshNewsFeed) window.refreshNewsFeed();
            if (type === 'update' && window.refreshGameUpdates) {
                const game = existingIssue ? existingIssue.game : document.getElementById('admin-post-game').value;
                window.refreshGameUpdates(game);
            }

            document.getElementById('admin-post-form').remove();

        } catch (err) {
            console.error(err);
            alert('Ошибка: ' + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = existingIssue ? 'Сохранить' : 'Опубликовать';
        }
    }
})();