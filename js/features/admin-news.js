// admin-news.js — форма создания новостей и обновлений для администраторов

(function() {
    const { cacheRemove, CONFIG } = GithubCore;
    const { createIssue } = GithubAPI;
    const { isAdmin, getCurrentUser } = GithubAuth;

    const RATE_LIMIT = 60 * 1000; // 1 минута
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

        const toolbar = `
            <div class="editor-toolbar" style="display: flex; gap: 5px; margin-bottom: 10px; flex-wrap: wrap;">
                <button type="button" class="editor-btn" data-tag="**" data-placeholder="жирный текст"><i class="fas fa-bold"></i></button>
                <button type="button" class="editor-btn" data-tag="*" data-placeholder="курсив"><i class="fas fa-italic"></i></button>
                <button type="button" class="editor-btn" data-tag="### " data-placeholder="Заголовок"><i class="fas fa-heading"></i></button>
                <button type="button" class="editor-btn" data-tag="> " data-placeholder="цитата"><i class="fas fa-quote-right"></i></button>
                <button type="button" class="editor-btn" data-tag="\`" data-placeholder="код" data-wrap="true"><i class="fas fa-code"></i></button>
                <button type="button" class="editor-btn" data-tag="[" data-placeholder="текст](url)" data-link="true"><i class="fas fa-link"></i></button>
                <button type="button" class="editor-btn" data-tag="- " data-placeholder="элемент списка"><i class="fas fa-list-ul"></i></button>
                <button type="button" class="editor-btn" data-tag="1. " data-placeholder="элемент списка"><i class="fas fa-list-ol"></i></button>
                <button type="button" class="editor-btn" data-tag="![](" data-placeholder="url картинки)"><i class="fas fa-image"></i></button>
                <button type="button" class="editor-btn" data-spoiler="true"><i class="fas fa-chevron-down"></i> Спойлер</button>
                <button type="button" class="editor-btn" id="preview-btn"><i class="fas fa-eye"></i> Предпросмотр</button>
            </div>
        `;

        form.innerHTML = `
            <h3>${type === 'news' ? 'Новая новость' : 'Новое обновление'}</h3>
            <input type="text" id="admin-post-title" placeholder="Заголовок" required class="feedback-input">
            ${gameSelectHtml}
            ${toolbar}
            <textarea id="admin-post-body" placeholder="Текст (поддерживается Markdown, можно вставлять изображения)" rows="10" required class="feedback-textarea"></textarea>
            <div class="preview-area" id="preview-area" style="display: none; background: var(--bg-primary); border-radius: 16px; padding: 16px; margin-top: 10px;"></div>
            <div class="button-group">
                <button class="button button-secondary" id="admin-post-cancel">Отмена</button>
                <button class="button" id="admin-post-submit">Опубликовать</button>
            </div>
        `;

        const parent = document.querySelector('.admin-panel');
        parent.parentNode.insertBefore(form, parent.nextSibling);

        const textarea = document.getElementById('admin-post-body');
        document.querySelectorAll('.editor-btn[data-tag]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const tag = btn.dataset.tag;
                const placeholder = btn.dataset.placeholder || '';
                const wrap = btn.dataset.wrap === 'true';
                const isLink = btn.dataset.link === 'true';
                insertMarkdown(textarea, tag, placeholder, wrap, isLink);
            });
        });

        document.querySelector('[data-spoiler="true"]').addEventListener('click', (e) => {
            e.preventDefault();
            insertSpoiler(textarea);
        });

        document.getElementById('preview-btn').addEventListener('click', (e) => {
            e.preventDefault();
            const previewArea = document.getElementById('preview-area');
            const body = textarea.value.trim();
            if (!body) {
                previewArea.style.display = 'none';
                return;
            }
            previewArea.innerHTML = GithubCore.renderMarkdown(body);
            previewArea.style.display = 'block';
        });

        document.getElementById('admin-post-cancel').addEventListener('click', () => form.remove());
        document.getElementById('admin-post-submit').addEventListener('click', () => submitPost(type));
    }

    function insertMarkdown(textarea, tag, placeholder, wrap = false, isLink = false) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selected = text.substring(start, end);

        let insertion;
        if (isLink) {
            const url = prompt('Введите URL:', 'https://');
            if (!url) return;
            const text = prompt('Введите текст ссылки:', selected || 'ссылка');
            insertion = `[${text}](${url})`;
        } else if (tag === '![](') {
            const url = prompt('Введите URL изображения:', 'https://');
            if (!url) return;
            const alt = prompt('Введите описание изображения (alt):', 'image');
            insertion = `![${alt}](${url})`;
        } else if (wrap) {
            if (selected) {
                insertion = tag + selected + tag;
            } else {
                insertion = tag + placeholder + tag;
            }
        } else {
            if (selected) {
                insertion = tag + selected;
            } else {
                insertion = tag + placeholder;
            }
        }

        const newText = text.substring(0, start) + insertion + text.substring(end);
        textarea.value = newText;
        textarea.focus();
        textarea.setSelectionRange(start + insertion.length, start + insertion.length);
    }

    function insertSpoiler(textarea) {
        const summary = prompt('Заголовок спойлера:', 'Спойлер');
        if (summary === null) return;
        const content = prompt('Содержимое спойлера (можно оставить пустым):', '');
        const spoiler = `\n<details><summary>${summary}</summary>\n\n${content || '...'}\n\n</details>\n`;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const newText = text.substring(0, start) + spoiler + text.substring(end);
        textarea.value = newText;
        textarea.focus();
        textarea.setSelectionRange(start + spoiler.length, start + spoiler.length);
    }

    async function submitPost(type) {
        const lastPostTime = localStorage.getItem('last_post_time');
        if (lastPostTime && Date.now() - parseInt(lastPostTime) < RATE_LIMIT) {
            const remaining = Math.ceil((RATE_LIMIT - (Date.now() - parseInt(lastPostTime))) / 1000);
            alert(`Пожалуйста, подождите ${remaining} секунд перед следующей публикацией.`);
            return;
        }

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

        const labels = type === 'news' ? ['news'] : ['update', `game:${game}`];

        const submitBtn = document.getElementById('admin-post-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Публикация...';

        try {
            await createIssue(title, body, labels);
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