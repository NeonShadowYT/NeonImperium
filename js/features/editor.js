// js/features/editor.js
(function() {
    const { createModal, showToast, saveDraft, loadDraft, clearDraft, escapeHtml, renderMarkdown, ensureMarked, extractMeta } = NeonUtils;
    const { createIssue, updateIssue, addComment } = NeonAPI;
    const { getCurrentUser } = GithubAuth;
    const { getState } = NeonState;

    const TEMPLATES = {
        bold: { name: 'Жирный', icon: 'fas fa-bold', action: (ta) => insertMarkdown(ta, '**', 'текст', true) },
        italic: { name: 'Курсив', icon: 'fas fa-italic', action: (ta) => insertMarkdown(ta, '*', 'текст', true) },
        strikethrough: { name: 'Зачёркнутый', icon: 'fas fa-strikethrough', action: (ta) => insertMarkdown(ta, '~~', 'текст', true) },
        h1: { name: 'Заголовок 1', icon: 'H1', action: (ta) => insertMarkdown(ta, '# ', 'Заголовок') },
        h2: { name: 'Заголовок 2', icon: 'H2', action: (ta) => insertMarkdown(ta, '## ', 'Заголовок') },
        h3: { name: 'Заголовок 3', icon: 'H3', action: (ta) => insertMarkdown(ta, '### ', 'Заголовок') },
        ul: { name: 'Список', icon: 'fas fa-list-ul', action: (ta) => insertList(ta, '- ') },
        ol: { name: 'Нумерованный', icon: 'fas fa-list-ol', action: (ta) => insertList(ta, '1. ') },
        quote: { name: 'Цитата', icon: 'fas fa-quote-right', action: (ta) => insertMarkdown(ta, '> ', 'цитата') },
        link: { name: 'Ссылка', icon: 'fas fa-link', action: insertLink },
        image: { name: 'Изображение', icon: 'fas fa-image', action: insertImage },
        youtube: { name: 'YouTube', icon: 'fab fa-youtube', action: insertYouTube },
        code: { name: 'Код', icon: 'fas fa-code', action: (ta) => insertMarkdown(ta, '`', 'код', true) },
        codeblock: { name: 'Блок кода', icon: 'fas fa-file-code', action: insertCodeBlock },
        spoiler: { name: 'Спойлер', icon: 'fas fa-chevron-down', action: insertSpoiler },
        table: { name: 'Таблица', icon: 'fas fa-table', action: insertTable },
        poll: { name: 'Опрос', icon: 'fas fa-chart-pie', action: insertPoll },
        progress: { name: 'Прогресс-бар', icon: 'fas fa-chart-bar', action: insertProgressBar },
        card: { name: 'Карточка', icon: 'fas fa-credit-card', action: insertCard },
        icon: { name: 'Иконка', icon: 'fas fa-icons', action: insertIcon },
        color: { name: 'Цвет текста', icon: 'fas fa-palette', action: (ta) => insertColor(ta, 'color') },
        bgcolor: { name: 'Цвет фона', icon: 'fas fa-fill-drip', action: (ta) => insertColor(ta, 'background-color') },
        hr: { name: 'Линия', icon: 'fas fa-minus', action: (ta) => insertAtCursor(ta, '\n---\n') }
    };

    function insertAtCursor(textarea, text) {
        const start = textarea.selectionStart, end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
        textarea.focus();
        textarea.setSelectionRange(start + text.length, start + text.length);
    }

    function insertMarkdown(textarea, tag, placeholder, wrap = false) {
        const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
        insertAtCursor(textarea, wrap ? (selected ? tag + selected + tag : tag + placeholder + tag) : (selected ? tag + selected : tag + placeholder));
    }

    function insertList(textarea, prefix) {
        const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
        if (selected.includes('\n')) {
            const lines = selected.split('\n');
            insertAtCursor(textarea, lines.map(l => l.trim() ? prefix + l : l).join('\n'));
        } else {
            insertAtCursor(textarea, prefix + (selected || 'элемент'));
        }
    }

    function insertLink(textarea) {
        const url = prompt('URL:', 'https://');
        if (!url) return;
        const text = prompt('Текст ссылки:', 'ссылка');
        insertAtCursor(textarea, `[${text || 'ссылка'}](${url})`);
    }

    function insertImage(textarea) {
        const url = prompt('URL изображения:', 'https://');
        if (!url) return;
        const alt = prompt('Описание:', 'image');
        insertAtCursor(textarea, `![${alt || 'image'}](${url})`);
    }

    function insertYouTube(textarea) {
        const url = prompt('Ссылка на YouTube:', 'https://youtu.be/...');
        if (!url) return;
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
        if (match) {
            insertAtCursor(textarea, `\n<div class="youtube-embed"><iframe src="https://www.youtube.com/embed/${match[1]}" frameborder="0" allowfullscreen></iframe></div>\n`);
        } else {
            insertAtCursor(textarea, url);
        }
    }

    function insertSpoiler(textarea) {
        const summary = prompt('Заголовок спойлера:', 'Спойлер');
        if (summary === null) return;
        const content = prompt('Содержимое:', '');
        insertAtCursor(textarea, `\n<details><summary>${summary}</summary>\n\n${content || '...'}\n\n</details>\n`);
    }

    function insertTable(textarea) {
        const rows = prompt('Строк:', '3');
        const cols = prompt('Столбцов:', '2');
        if (!rows || !cols) return;
        let table = '\n';
        for (let i=0; i<parseInt(cols); i++) table += `| Заголовок ${i+1} `;
        table += '|\n';
        for (let i=0; i<parseInt(cols); i++) table += '|-------------';
        table += '|\n';
        for (let r=0; r<parseInt(rows); r++) {
            for (let c=0; c<parseInt(cols); c++) table += `| Ячейка ${r+1}-${c+1} `;
            table += '|\n';
        }
        insertAtCursor(textarea, table);
    }

    function insertCodeBlock(textarea) {
        const lang = prompt('Язык (например, javascript):', '');
        const code = prompt('Код:', '');
        if (code === null) return;
        insertAtCursor(textarea, `\n\`\`\`${lang}\n${code}\n\`\`\`\n`);
    }

    function insertProgressBar(textarea) {
        const percent = prompt('Процент (0-100):', '50');
        if (percent === null) return;
        insertAtCursor(textarea, `\n<!-- progress: ${percent} -->\n<div class="progress-bar"><div style="width: ${percent}%;">${percent}%</div></div>\n`);
    }

    function insertCard(textarea) {
        const title = prompt('Заголовок карточки:', 'Карточка');
        if (title === null) return;
        const content = prompt('Содержимое:', '');
        insertAtCursor(textarea, `\n<div class="custom-card"><h4>${title}</h4><p>${content || ''}</p></div>\n`);
    }

    function insertPoll(textarea) {
        const question = prompt('Вопрос:', 'Добавлять ли функцию?');
        if (question === null) return;
        const opts = prompt('Варианты через запятую:', 'Да, Нет, Возможно');
        if (!opts) return;
        const options = opts.split(',').map(s => s.trim()).filter(s => s);
        if (options.length === 0) return;
        if (options.length > 10) { alert('Максимум 10 вариантов'); options.splice(10); }
        insertAtCursor(textarea, `\n<!-- poll: ${JSON.stringify({ question, options })} -->\n`);
    }

    function insertIcon(textarea) {
        const icon = prompt('Название иконки (например, "fa-heart"):', 'fa-heart');
        if (!icon) return;
        insertAtCursor(textarea, `<i class="fas ${icon}"></i>`);
    }

    function insertColor(textarea, styleProp) {
        const color = prompt('Цвет (red, #ff0000):', 'red');
        if (!color) return;
        const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
        insertAtCursor(textarea, selected ? `<span style="${styleProp}: ${color};">${selected}</span>` : `<span style="${styleProp}: ${color};">текст</span>`);
    }

    function createEditorToolbar(textarea) {
        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';
        const groups = {
            Форматирование: ['bold', 'italic', 'strikethrough'],
            Заголовки: ['h1', 'h2', 'h3'],
            Списки: ['ul', 'ol', 'quote'],
            Медиа: ['link', 'image', 'youtube'],
            Код: ['code', 'codeblock'],
            Блоки: ['spoiler', 'table', 'poll', 'progress', 'card'],
            Иконки: ['icon'],
            Цвет: ['color', 'bgcolor'],
            Доп: ['hr']
        };
        for (const [_, keys] of Object.entries(groups)) {
            const group = document.createElement('div');
            group.className = 'editor-btn-group';
            keys.forEach(key => {
                const t = TEMPLATES[key];
                if (!t) return;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'editor-btn';
                btn.title = t.name;
                btn.innerHTML = t.icon.startsWith('fa') ? `<i class="${t.icon}"></i>` : t.icon;
                btn.addEventListener('click', (e) => { e.preventDefault(); t.action(textarea); });
                group.appendChild(btn);
            });
            toolbar.appendChild(group);
        }
        return toolbar;
    }

    function createImageServicesMenu() {
        const container = document.createElement('div');
        container.className = 'image-services-menu';
        container.style.position = 'relative';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'image-services-btn';
        btn.innerHTML = '<i class="fas fa-images"></i> Хостинги';
        const dropdown = document.createElement('div');
        dropdown.className = 'preview-dropdown';
        dropdown.style.display = 'none';
        const services = [
            { name: 'Catbox', url: 'https://catbox.moe/', desc: 'До 200 МБ, анонимно' },
            { name: 'ImageBam', url: 'https://www.imagebam.com/upload?multi=1', desc: 'До 100 МБ' },
            { name: 'Postimages', url: 'https://postimages.org/', desc: 'До 32 МБ' },
            { name: 'ImgBB', url: 'https://imgbb.com/', desc: 'До 32 МБ' }
        ];
        services.forEach(s => {
            const item = document.createElement('button');
            item.innerHTML = `<strong>${s.name}</strong><br><small>${s.desc}</small>`;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                window.open(s.url, '_blank');
                dropdown.style.display = 'none';
            });
            dropdown.appendChild(item);
        });
        container.appendChild(btn);
        container.appendChild(dropdown);
        btn.addEventListener('click', (e) => { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'; });
        document.addEventListener('click', () => dropdown.style.display = 'none');
        return container;
    }

    // ---------- Модалка редактора (пост / комментарий / поддержка) ----------
    function openEditorModal(mode, data, postType = 'feedback') {
        const currentUser = getCurrentUser();
        if (!currentUser) {
            showToast('Войдите через GitHub', 'error');
            window.dispatchEvent(new CustomEvent('github-login-requested'));
            return;
        }

        const isEdit = mode === 'edit';
        const initialTitle = data.title || '';
        const initialBody = data.body || '';
        const initialGame = data.game || null;
        const isSupport = postType === 'support';
        const isComment = postType === 'comment';

        // Извлечение превью, саммари, разрешённых пользователей
        let previewUrl = extractMeta(initialBody, 'preview') || '';
        let summary = extractMeta(initialBody, 'summary') || '';
        let allowedUsers = extractMeta(initialBody, 'allowed') || '';
        let cleanBody = initialBody.replace(/<!--.*?-->\s*/g, '').trim();

        // Категория (для feedback)
        let currentCategory = 'idea';
        if (postType === 'feedback' && data.labels) {
            const typeLabel = data.labels.find(l => l.startsWith('type:'));
            if (typeLabel) currentCategory = typeLabel.split(':')[1];
        }

        const draftKey = `draft_${postType}_${mode}_${initialGame || 'global'}_${data.number || 'new'}`;
        const savedDraft = loadDraft(draftKey);

        const modalContent = document.createElement('div');
        modalContent.style.display = 'flex';
        modalContent.style.flexDirection = 'column';
        modalContent.style.height = '100%';
        modalContent.style.gap = '15px';

        if (isComment) {
            // Простая форма комментария с тулбаром и предпросмотром
            modalContent.innerHTML = `
                <div id="comment-toolbar"></div>
                <textarea id="comment-body" class="feedback-textarea" rows="12" placeholder="Ваш комментарий..."></textarea>
                <div id="comment-preview" class="markdown-body preview-area" style="display:none;"></div>
                <div style="display:flex; gap:10px; justify-content:flex-end;">
                    <button class="button" id="comment-cancel">Отмена</button>
                    <button class="button" id="comment-submit">Отправить</button>
                </div>
            `;
            const { modal, closeModal } = createModal('Новый комментарий', '', { size: 'full' });
            modal.querySelector('.modal-body').appendChild(modalContent);
            const textarea = modal.querySelector('#comment-body');
            const previewDiv = modal.querySelector('#comment-preview');
            const toolbarDiv = modal.querySelector('#comment-toolbar');
            toolbarDiv.appendChild(createEditorToolbar(textarea));

            // Восстановление черновика
            if (savedDraft?.body) textarea.value = savedDraft.body;

            const updatePreview = async () => {
                await ensureMarked();
                previewDiv.innerHTML = renderMarkdown(textarea.value);
                previewDiv.style.display = textarea.value.trim() ? 'block' : 'none';
            };
            textarea.addEventListener('input', updatePreview);
            updatePreview();

            modal.querySelector('#comment-cancel').addEventListener('click', closeModal);
            modal.querySelector('#comment-submit').addEventListener('click', async () => {
                const body = textarea.value.trim();
                if (!body) { showToast('Введите текст', 'error'); return; }
                try {
                    if (isEdit) {
                        await NeonAPI.updateComment(data.commentId, body);
                    } else {
                        await addComment(data.issueNumber, body);
                    }
                    clearDraft(draftKey);
                    closeModal();
                    showToast(isEdit ? 'Сохранено' : 'Отправлено', 'success');
                    window.dispatchEvent(new CustomEvent('comment-updated', { detail: { issueNumber: data.issueNumber } }));
                } catch (err) {
                    showToast('Ошибка', 'error');
                }
            });

            // Сохранение черновика при вводе
            textarea.addEventListener('input', () => saveDraft(draftKey, { body: textarea.value }));
            return;
        }

        // Для постов (feedback, news, update, support)
        modalContent.innerHTML = `
            <div class="settings-card">
                <input type="text" id="modal-title" class="feedback-input" placeholder="Заголовок" value="${escapeHtml(initialTitle)}">
                <input type="text" id="modal-summary" class="feedback-input" placeholder="Краткое описание (отображается в ленте)" value="${escapeHtml(summary)}">
                <div class="preview-url-wrapper">
                    <input type="url" id="modal-preview-url" class="feedback-input" placeholder="Ссылка на превью (изображение)" value="${escapeHtml(previewUrl)}">
                    <div id="image-services-placeholder"></div>
                </div>
                <div id="preview-thumbnail" style="${previewUrl ? '' : 'display:none;'} margin-bottom:12px;">
                    <img id="preview-img" src="${previewUrl}" style="max-width:200px; border-radius:12px;" onerror="this.style.display='none'">
                    <button type="button" id="remove-preview" class="remove-preview"><i class="fas fa-times"></i></button>
                </div>
                ${!isSupport ? `
                <div style="display:flex; align-items:center; gap:12px; margin:12px 0;">
                    <div id="access-dropdown-placeholder"></div>
                    <input type="text" id="private-users" class="feedback-input" placeholder="Ники через запятую" value="${escapeHtml(allowedUsers)}" style="flex:1; display:${allowedUsers ? 'block' : 'none'};">
                </div>
                ` : ''}
                ${postType === 'feedback' ? `
                <select id="modal-category" class="feedback-select">
                    <option value="idea" ${currentCategory==='idea'?'selected':''}>💡 Идея</option>
                    <option value="bug" ${currentCategory==='bug'?'selected':''}>🐛 Баг</option>
                    <option value="review" ${currentCategory==='review'?'selected':''}>⭐ Отзыв</option>
                </select>
                ` : ''}
                ${isSupport ? '<p class="text-secondary small"><i class="fas fa-lock"></i> Обращение увидят только вы и администратор.</p>' : ''}
            </div>
            <div id="editor-toolbar"></div>
            <div style="display:flex; gap:16px; flex:1; min-height:300px;">
                <textarea id="modal-body" class="feedback-textarea" style="flex:1;">${escapeHtml(cleanBody)}</textarea>
                <div id="modal-preview" class="markdown-body preview-area" style="flex:1;"></div>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:15px;">
                <button class="button" id="modal-cancel">Отмена</button>
                <button class="button" id="modal-submit">${isEdit ? 'Сохранить' : 'Опубликовать'}</button>
            </div>
        `;

        const { modal, closeModal } = createModal(isEdit ? 'Редактирование' : 'Новое сообщение', '', { size: 'full' });
        modal.querySelector('.modal-body').appendChild(modalContent);

        const titleInput = modal.querySelector('#modal-title');
        const summaryInput = modal.querySelector('#modal-summary');
        const previewUrlInput = modal.querySelector('#modal-preview-url');
        const previewImg = modal.querySelector('#preview-img');
        const previewThumb = modal.querySelector('#preview-thumbnail');
        const bodyTextarea = modal.querySelector('#modal-body');
        const previewDiv = modal.querySelector('#modal-preview');
        const accessPlaceholder = modal.querySelector('#access-dropdown-placeholder');
        const privateUsersInput = modal.querySelector('#private-users');
        const categorySelect = modal.querySelector('#modal-category');
        const toolbarDiv = modal.querySelector('#editor-toolbar');
        const imageServicesPlaceholder = modal.querySelector('#image-services-placeholder');

        toolbarDiv.appendChild(createEditorToolbar(bodyTextarea));
        if (imageServicesPlaceholder) imageServicesPlaceholder.appendChild(createImageServicesMenu());

        // Приватность
        let isPrivate = !!allowedUsers;
        if (!isSupport && accessPlaceholder) {
            const accessContainer = document.createElement('div');
            accessContainer.className = 'access-dropdown-container';
            const accessBtn = document.createElement('button');
            accessBtn.type = 'button';
            accessBtn.className = 'editor-btn access-dropdown-btn';
            accessBtn.innerHTML = isPrivate ? '<i class="fas fa-lock"></i> Приватный' : '<i class="fas fa-globe"></i> Публичный';
            const dropdown = document.createElement('div');
            dropdown.className = 'preview-dropdown';
            dropdown.style.display = 'none';
            dropdown.innerHTML = `
                <button data-access="public"><i class="fas fa-globe"></i> Публичный</button>
                <button data-access="private"><i class="fas fa-lock"></i> Приватный</button>
            `;
            accessContainer.appendChild(accessBtn);
            accessContainer.appendChild(dropdown);
            accessPlaceholder.appendChild(accessContainer);

            accessBtn.addEventListener('click', (e) => { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'; });
            dropdown.querySelectorAll('button').forEach(b => {
                b.addEventListener('click', () => {
                    const access = b.dataset.access;
                    isPrivate = access === 'private';
                    accessBtn.innerHTML = isPrivate ? '<i class="fas fa-lock"></i> Приватный' : '<i class="fas fa-globe"></i> Публичный';
                    privateUsersInput.style.display = isPrivate ? 'block' : 'none';
                    dropdown.style.display = 'none';
                });
            });
            document.addEventListener('click', (e) => { if (!accessContainer.contains(e.target)) dropdown.style.display = 'none'; });
        }

        // Превью изображения
        const updatePreviewImage = () => {
            const url = previewUrlInput.value.trim();
            if (url) {
                previewImg.src = url;
                previewThumb.style.display = 'block';
            } else {
                previewThumb.style.display = 'none';
            }
        };
        previewUrlInput.addEventListener('input', updatePreviewImage);
        modal.querySelector('#remove-preview').addEventListener('click', () => {
            previewUrlInput.value = '';
            updatePreviewImage();
        });

        // Предпросмотр текста
        const updateMarkdownPreview = async () => {
            await ensureMarked();
            previewDiv.innerHTML = renderMarkdown(bodyTextarea.value);
        };
        bodyTextarea.addEventListener('input', updateMarkdownPreview);
        updateMarkdownPreview();

        // Восстановление черновика
        if (savedDraft) {
            if (confirm('Восстановить черновик?')) {
                titleInput.value = savedDraft.title || '';
                summaryInput.value = savedDraft.summary || '';
                previewUrlInput.value = savedDraft.previewUrl || '';
                updatePreviewImage();
                bodyTextarea.value = savedDraft.body || '';
                updateMarkdownPreview();
                if (savedDraft.category && categorySelect) categorySelect.value = savedDraft.category;
                if (savedDraft.isPrivate !== undefined) {
                    isPrivate = savedDraft.isPrivate;
                    if (privateUsersInput) {
                        privateUsersInput.style.display = isPrivate ? 'block' : 'none';
                        privateUsersInput.value = savedDraft.privateUsers || '';
                    }
                }
            } else {
                clearDraft(draftKey);
            }
        }

        // Сохранение черновика при изменениях
        const saveCurrentDraft = () => {
            const draft = {
                title: titleInput.value,
                summary: summaryInput.value,
                previewUrl: previewUrlInput.value,
                body: bodyTextarea.value,
                category: categorySelect?.value,
                isPrivate,
                privateUsers: privateUsersInput?.value || ''
            };
            saveDraft(draftKey, draft);
        };
        [titleInput, summaryInput, previewUrlInput, bodyTextarea, categorySelect, privateUsersInput].forEach(el => el?.addEventListener('input', saveCurrentDraft));

        // Закрытие
        const closeHandler = () => {
            if (confirm('Закрыть без сохранения?')) {
                clearDraft(draftKey);
                closeModal();
            }
        };
        modal.querySelector('#modal-cancel').addEventListener('click', closeHandler);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeHandler(); });

        // Отправка
        modal.querySelector('#modal-submit').addEventListener('click', async () => {
            const title = titleInput.value.trim();
            const summary = summaryInput.value.trim();
            const preview = previewUrlInput.value.trim();
            let body = bodyTextarea.value.trim();

            if (!title) { showToast('Введите заголовок', 'error'); return; }

            // Сборка метаданных
            let meta = '';
            if (preview) meta += `<!-- preview: ${preview} -->\n![Preview](${preview})\n\n`;
            if (summary) meta += `<!-- summary: ${summary} -->\n`;
            if (isPrivate && privateUsersInput) {
                const allowed = privateUsersInput.value.trim();
                if (allowed) meta += `<!-- allowed: ${allowed} -->\n`;
            } else if (isSupport) {
                meta += `<!-- allowed: ${currentUser} -->\n`;
            }
            body = meta + body;

            // Определение меток
            let labels = [];
            if (postType === 'feedback') {
                const category = categorySelect.value;
                labels = [`game:${initialGame}`, `type:${category}`];
            } else if (postType === 'news') {
                labels = ['type:news'];
            } else if (postType === 'update') {
                labels = ['type:update', `game:${initialGame}`];
            } else if (postType === 'support') {
                labels = ['type:support', 'private'];
            }
            if (isPrivate && !labels.includes('private')) labels.push('private');

            try {
                if (isEdit) {
                    await updateIssue(data.number, { title, body, labels });
                } else {
                    await createIssue(title, body, labels);
                }
                clearDraft(draftKey);
                closeModal();
                showToast(isEdit ? 'Сохранено' : 'Опубликовано', 'success');
                window.dispatchEvent(new CustomEvent('post-created'));
            } catch (err) {
                showToast('Ошибка: ' + err.message, 'error');
            }
        });
    }

    // Открытие редактора комментария (публичный API)
    function openCommentEditor(issueNumber) {
        openEditorModal('new', { issueNumber }, 'comment');
    }

    window.Editor = {
        TEMPLATES,
        createEditorToolbar,
        createImageServicesMenu,
        openEditorModal,
        openCommentEditor
    };
})();