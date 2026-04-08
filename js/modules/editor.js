// editor.js – создание/редактирование постов и комментариев
(function() {
    function createAccessDropdown(initialIsPrivate, allowedUsersValue, onToggle) {
        const container = document.createElement('div');
        container.className = 'access-dropdown-container';
        container.style.position = 'relative';
        container.style.display = 'inline-block';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'editor-btn access-dropdown-btn';
        btn.innerHTML = initialIsPrivate ? '<i class="fas fa-lock"></i> Приватный' : '<i class="fas fa-globe"></i> Публичный';
        btn.style.padding = '8px 16px';
        btn.style.borderRadius = '30px';
        const dropdownMenu = document.createElement('div');
        dropdownMenu.className = 'preview-dropdown';
        dropdownMenu.style.position = 'absolute';
        dropdownMenu.style.top = '100%';
        dropdownMenu.style.left = '0';
        dropdownMenu.style.minWidth = '160px';
        dropdownMenu.style.zIndex = '1000';
        dropdownMenu.style.background = 'var(--bg-card)';
        dropdownMenu.style.border = '1px solid var(--border)';
        dropdownMenu.style.borderRadius = '12px';
        dropdownMenu.style.padding = '5px 0';
        dropdownMenu.style.display = 'none';
        const publicOption = document.createElement('button');
        publicOption.type = 'button';
        publicOption.innerHTML = '<i class="fas fa-globe"></i> Публичный';
        publicOption.addEventListener('click', () => {
            dropdownMenu.style.display = 'none';
            if (initialIsPrivate) {
                initialIsPrivate = false;
                btn.innerHTML = '<i class="fas fa-globe"></i> Публичный';
                if (onToggle) onToggle(false, '');
            }
        });
        const privateOption = document.createElement('button');
        privateOption.type = 'button';
        privateOption.innerHTML = '<i class="fas fa-lock"></i> Приватный';
        privateOption.addEventListener('click', () => {
            dropdownMenu.style.display = 'none';
            if (!initialIsPrivate) {
                initialIsPrivate = true;
                btn.innerHTML = '<i class="fas fa-lock"></i> Приватный';
                if (onToggle) onToggle(true, allowedUsersValue);
            }
        });
        dropdownMenu.appendChild(publicOption);
        dropdownMenu.appendChild(privateOption);
        btn.addEventListener('click', (e) => { e.stopPropagation(); dropdownMenu.style.display = dropdownMenu.style.display === 'block' ? 'none' : 'block'; });
        document.addEventListener('click', (e) => { if (!container.contains(e.target)) dropdownMenu.style.display = 'none'; });
        container.appendChild(btn);
        container.appendChild(dropdownMenu);
        return container;
    }

    function createSplitEditor(initialContent, onSave, options = {}) {
        const container = document.createElement('div');
        container.className = 'split-editor';
        container.style.cssText = 'display: flex; flex-direction: column; gap: 16px; margin-top: 10px; height: 100%;';
        const toolbarContainer = document.createElement('div');
        toolbarContainer.id = 'split-editor-toolbar';
        toolbarContainer.style.cssText = 'position: sticky; top: 0; background: var(--bg-card); z-index: 10; padding: 8px 0; border-radius: 12px;';
        const panelsRow = document.createElement('div');
        panelsRow.style.cssText = 'display: flex; gap: 16px; flex: 1; min-height: 400px;';
        const leftPanel = document.createElement('div');
        leftPanel.className = 'split-editor-left';
        leftPanel.style.cssText = 'flex: 1; display: flex; flex-direction: column; overflow: hidden;';
        const textarea = document.createElement('textarea');
        textarea.className = 'feedback-textarea';
        textarea.value = initialContent || '';
        textarea.style.cssText = 'flex: 1; resize: vertical; min-height: 300px;';
        leftPanel.appendChild(textarea);
        const rightPanel = document.createElement('div');
        rightPanel.className = 'split-editor-right';
        rightPanel.style.cssText = 'flex: 1; overflow-y: auto; background: var(--bg-primary); border-radius: 16px; border: 1px solid var(--border); padding: 16px;';
        const previewDiv = document.createElement('div');
        previewDiv.className = 'markdown-body';
        rightPanel.appendChild(previewDiv);
        panelsRow.appendChild(leftPanel);
        panelsRow.appendChild(rightPanel);
        container.appendChild(toolbarContainer);
        container.appendChild(panelsRow);
        let updateTimeout;
        const updatePreview = () => {
            if (updateTimeout) clearTimeout(updateTimeout);
            updateTimeout = setTimeout(() => {
                const text = textarea.value;
                if (text.trim()) {
                    previewDiv.innerHTML = '';
                    if (window.UIFeedbackModal && window.UIFeedbackModal.renderPostBody) {
                        window.UIFeedbackModal.renderPostBody(previewDiv, text, null);
                    } else {
                        GithubCore.renderMarkdown(text).then(html => { previewDiv.innerHTML = html; });
                    }
                } else previewDiv.innerHTML = '<p class="text-secondary">Предпросмотр будет здесь...</p>';
            }, 150);
        };
        textarea.addEventListener('input', updatePreview);
        updatePreview();
        let syncingLeft = false, syncingRight = false;
        textarea.addEventListener('scroll', () => {
            if (syncingLeft) return;
            syncingRight = true;
            const ratio = textarea.scrollTop / (textarea.scrollHeight - textarea.clientHeight);
            const targetScroll = ratio * (rightPanel.scrollHeight - rightPanel.clientHeight);
            rightPanel.scrollTop = targetScroll;
            setTimeout(() => { syncingRight = false; }, 50);
        });
        rightPanel.addEventListener('scroll', () => {
            if (syncingRight) return;
            syncingLeft = true;
            const ratio = rightPanel.scrollTop / (rightPanel.scrollHeight - rightPanel.clientHeight);
            const targetScroll = ratio * (textarea.scrollHeight - textarea.clientHeight);
            textarea.scrollTop = targetScroll;
            setTimeout(() => { syncingLeft = false; }, 50);
        });
        if (window.EditorToolbar) {
            const toolbar = EditorToolbar.createEditorToolbar(textarea, { preview: false });
            toolbarContainer.appendChild(toolbar);
        }
        const buttonRow = document.createElement('div');
        buttonRow.style.cssText = 'display: flex; justify-content: flex-end; margin-top: 16px;';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'button';
        saveBtn.textContent = options.saveText || 'Сохранить';
        buttonRow.appendChild(saveBtn);
        container.appendChild(buttonRow);
        let isSubmitting = false;
        saveBtn.addEventListener('click', async () => {
            if (isSubmitting) return;
            isSubmitting = true;
            saveBtn.disabled = true;
            try { await onSave(textarea.value.trim()); } finally { isSubmitting = false; saveBtn.disabled = false; }
        });
        return { container, textarea, previewDiv, updatePreview };
    }

    function openEditorModal(mode, data, postType = 'feedback') {
        const currentUser = GithubAuth.getCurrentUser();
        const title = mode === 'edit' ? 'Редактирование' : 'Новое сообщение';
        let previewUrl = '', allowedUsers = '', bodyContent = data.body || '';
        const previewMatch = bodyContent.match(/<!--\s*preview:\s*(https?:\/\/[^\s]+)\s*-->/);
        if (previewMatch) { previewUrl = previewMatch[1]; bodyContent = bodyContent.replace(/<!--\s*preview:\s*https?:\/\/[^\s]+\s*-->\s*\n?/, ''); }
        const allowedMatch = bodyContent.match(/<!--\s*allowed:\s*(.*?)\s*-->/);
        if (allowedMatch) { allowedUsers = allowedMatch[1]; bodyContent = bodyContent.replace(/<!--\s*allowed:\s*.*?\s*-->\s*\n?/, ''); }
        let categoryHtml = '';
        let currentCategory = 'idea';
        if (postType === 'feedback') {
            if (data.labels) { const typeLabel = data.labels.find(l => l.startsWith('type:')); if (typeLabel) currentCategory = typeLabel.split(':')[1]; }
            categoryHtml = `<select id="modal-category" class="feedback-select"><option value="idea" ${currentCategory==='idea'?'selected':''}>💡 Идея</option><option value="bug" ${currentCategory==='bug'?'selected':''}>🐛 Баг</option><option value="review" ${currentCategory==='review'?'selected':''}>⭐ Отзыв</option></select>`;
        }
        let draftKey;
        if (postType === 'comment') draftKey = `draft_comment_${data.issueNumber || 'new'}`;
        else draftKey = `draft_${postType}_${mode}_${data.game || 'global'}_${data.number || 'new'}`;
        const { modal, closeModal } = UIUtils.createModal(title, '<div id="editor-container" style="height: 100%; display: flex; flex-direction: column;"></div>', { size: 'full' });
        const editorContainer = modal.querySelector('#editor-container');
        let syncToBody = null;
        let privateUsersInput = null;
        const handleSave = async (finalBody) => {
            if (!GithubAuth.getToken()) { UIUtils.showToast('Вы не авторизованы. Войдите через GitHub.', 'error'); throw new Error('No token'); }
            if (postType === 'comment') {
                await GithubAPI.addComment(data.issueNumber, finalBody);
                UIUtils.clearDraft(draftKey);
                closeModal();
                window.dispatchEvent(new CustomEvent('github-comment-created', { detail: { issueNumber: data.issueNumber } }));
                UIUtils.showToast('Комментарий добавлен', 'success');
                return;
            }
            const titleInput = modal.querySelector('#modal-input-title');
            const title = titleInput ? titleInput.value.trim() : '';
            if (!title) { UIUtils.showToast('Заполните заголовок', 'error'); throw new Error('No title'); }
            let finalProcessedBody = finalBody;
            finalProcessedBody = finalProcessedBody.replace(/<!--\s*preview:\s*https?:\/\/[^\s]+\s*-->\s*\n?/g, '');
            finalProcessedBody = finalProcessedBody.replace(/<!--\s*summary:\s*.*?\s*-->\s*\n?/g, '');
            finalProcessedBody = finalProcessedBody.replace(/<!--\s*allowed:\s*.*?\s*-->\s*\n?/g, '');
            const newPreviewUrl = modal.querySelector('#modal-preview-url').value.trim();
            const isPrivate = postType === 'support' ? true : currentIsPrivate;
            const allowedUsersValue = (privateUsersInput && postType !== 'support') ? privateUsersInput.value.trim() : '';
            let existingPreviewUrl = null;
            if (mode === 'edit') { const oldPreviewMatch = data.body?.match(/<!--\s*preview:\s*(https?:\/\/[^\s]+)\s*-->/); if (oldPreviewMatch) existingPreviewUrl = oldPreviewMatch[1]; }
            if (newPreviewUrl) {
                if (mode !== 'edit' || newPreviewUrl !== existingPreviewUrl) finalProcessedBody = `<!-- preview: ${newPreviewUrl} -->\n\n![Preview](${newPreviewUrl})\n\n` + finalProcessedBody;
                else { const originalPreviewTag = `<!-- preview: ${existingPreviewUrl} -->`; if (!finalProcessedBody.includes(originalPreviewTag)) finalProcessedBody = originalPreviewTag + '\n\n![Preview](' + existingPreviewUrl + ')\n\n' + finalProcessedBody; }
            }
            const newSummary = modal.querySelector('#modal-summary')?.value.trim();
            if (newSummary) finalProcessedBody = `<!-- summary: ${newSummary} -->\n\n` + finalProcessedBody;
            if (isPrivate && allowedUsersValue && postType !== 'support') finalProcessedBody = `<!-- allowed: ${allowedUsersValue} -->\n\n` + finalProcessedBody;
            else if (postType === 'support') finalProcessedBody = `<!-- allowed: ${currentUser} -->\n\n` + finalProcessedBody;
            const pollMatches = finalProcessedBody.match(/<!-- poll: .*? -->/g);
            if (pollMatches && pollMatches.length > 1) { if (!confirm('Обнаружено несколько блоков опроса. Будут сохранены только первые. Продолжить?')) throw new Error('Cancel'); const first = pollMatches[0]; finalProcessedBody = finalProcessedBody.replace(/<!-- poll: .*? -->/g, ''); finalProcessedBody = first + '\n' + finalProcessedBody; }
            let category = 'idea';
            if (postType === 'feedback' && modal.querySelector('#modal-category')) category = modal.querySelector('#modal-category').value;
            if (mode === 'edit') { const originalTitle = data.title || ''; const originalBody = data.body || ''; if (title === originalTitle && finalProcessedBody === originalBody) { UIUtils.showToast('Нет изменений', 'warning'); throw new Error('No changes'); } }
            let labels;
            if (postType === 'feedback') { if (!data.game) throw new Error('Не указана игра'); labels = [`game:${data.game}`, `type:${category}`]; }
            else if (postType === 'news') labels = ['type:news'];
            else if (postType === 'support') labels = ['type:support', 'private'];
            else { if (!data.game || data.game.trim() === '') throw new Error('Не указана игра для обновления'); labels = ['type:update', `game:${data.game}`]; }
            if (isPrivate && !labels.includes('private') && postType !== 'support') labels.push('private');
            if (mode === 'edit') await GithubAPI.updateIssue(data.number, { title, body: finalProcessedBody, labels });
            else await GithubAPI.createIssue(title, finalProcessedBody, labels);
            UIUtils.clearDraft(draftKey);
            closeModal();
            if (postType === 'feedback' && window.refreshNewsFeed) window.refreshNewsFeed();
            if (postType === 'update' && window.refreshGameUpdates) window.refreshGameUpdates(data.game);
            if (postType === 'news' && window.refreshNewsFeed) window.refreshNewsFeed();
            UIUtils.showToast(mode === 'edit' ? 'Сохранено' : 'Опубликовано', 'success');
        };
        if (postType === 'comment') {
            const { container: editorUI, textarea } = createSplitEditor(bodyContent, handleSave, { saveText: mode === 'edit' ? 'Сохранить' : 'Отправить' });
            editorContainer.appendChild(editorUI);
        } else {
            const settingsCard = document.createElement('div');
            settingsCard.className = 'card';
            settingsCard.style.padding = '20px';
            settingsCard.style.marginBottom = '20px';
            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.id = 'modal-input-title';
            titleInput.className = 'feedback-input';
            titleInput.placeholder = 'Заголовок';
            titleInput.value = data.title || '';
            titleInput.style.marginBottom = '12px';
            settingsCard.appendChild(titleInput);
            const summaryInput = document.createElement('input');
            summaryInput.type = 'text';
            summaryInput.id = 'modal-summary';
            summaryInput.className = 'feedback-input';
            summaryInput.placeholder = 'Краткое описание (будет видно в ленте)';
            summaryInput.value = GithubCore.extractSummary(data.body) || '';
            summaryInput.style.marginBottom = '12px';
            settingsCard.appendChild(summaryInput);
            const previewRow = document.createElement('div');
            previewRow.className = 'preview-url-wrapper';
            previewRow.style.cssText = 'display: flex; gap: 8px; margin-bottom: 12px;';
            const previewUrlInput = document.createElement('input');
            previewUrlInput.type = 'url';
            previewUrlInput.id = 'modal-preview-url';
            previewUrlInput.className = 'feedback-input preview-url-input';
            previewUrlInput.placeholder = 'Ссылка на превью (необязательно)';
            previewUrlInput.value = previewUrl;
            const servicesPlaceholder = document.createElement('div');
            servicesPlaceholder.id = 'preview-services-placeholder';
            if (window.EditorToolbar) servicesPlaceholder.appendChild(window.EditorToolbar.createImageServicesMenu());
            previewRow.appendChild(previewUrlInput);
            previewRow.appendChild(servicesPlaceholder);
            settingsCard.appendChild(previewRow);
            const thumbnailContainer = document.createElement('div');
            thumbnailContainer.id = 'preview-thumbnail-container';
            thumbnailContainer.className = 'preview-thumbnail';
            thumbnailContainer.style.display = previewUrl ? 'block' : 'none';
            thumbnailContainer.style.marginBottom = '12px';
            const thumbnailImg = document.createElement('img');
            thumbnailImg.id = 'preview-thumbnail-img';
            thumbnailImg.src = previewUrl || '';
            thumbnailImg.alt = 'Preview';
            thumbnailImg.loading = 'lazy';
            const removePreviewBtn = document.createElement('button');
            removePreviewBtn.type = 'button';
            removePreviewBtn.className = 'remove-preview';
            removePreviewBtn.innerHTML = '<i class="fas fa-times"></i>';
            removePreviewBtn.addEventListener('click', () => { previewUrlInput.value = ''; thumbnailContainer.style.display = 'none'; thumbnailImg.src = ''; if (syncToBody) syncToBody(); });
            thumbnailContainer.appendChild(thumbnailImg);
            thumbnailContainer.appendChild(removePreviewBtn);
            settingsCard.appendChild(thumbnailContainer);
            previewUrlInput.addEventListener('input', (e) => { const val = e.target.value.trim(); if (val) { thumbnailImg.src = val; thumbnailContainer.style.display = 'block'; } else { thumbnailContainer.style.display = 'none'; thumbnailImg.src = ''; } if (syncToBody) syncToBody(); });
            if (postType === 'feedback') {
                const categorySelect = document.createElement('select');
                categorySelect.id = 'modal-category';
                categorySelect.className = 'feedback-select';
                categorySelect.innerHTML = `<option value="idea" ${currentCategory==='idea'?'selected':''}>💡 Идея</option><option value="bug" ${currentCategory==='bug'?'selected':''}>🐛 Баг</option><option value="review" ${currentCategory==='review'?'selected':''}>⭐ Отзыв</option>`;
                categorySelect.style.marginBottom = '12px';
                settingsCard.appendChild(categorySelect);
                categorySelect.addEventListener('change', () => { if (syncToBody) syncToBody(); });
            }
            editorContainer.appendChild(settingsCard);
            const { container: editorUI, textarea, updatePreview } = createSplitEditor(bodyContent, handleSave, { saveText: mode === 'edit' ? 'Сохранить' : 'Опубликовать' });
            const bottomBar = document.createElement('div');
            bottomBar.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-top: 16px; gap: 16px; flex-wrap: wrap;';
            const accessRow = document.createElement('div');
            accessRow.className = 'access-settings';
            accessRow.style.cssText = 'display: flex; align-items: center; gap: 12px; flex: 1;';
            const accessPlaceholder = document.createElement('div');
            accessPlaceholder.id = 'access-dropdown-placeholder';
            privateUsersInput = document.createElement('input');
            privateUsersInput.type = 'text';
            privateUsersInput.id = 'private-users';
            privateUsersInput.className = 'feedback-input';
            privateUsersInput.placeholder = 'Ники через запятую';
            privateUsersInput.value = allowedUsers;
            const isPrivateInit = (postType === 'support') ? true : (data.labels?.includes('private') || false);
            let currentIsPrivate = isPrivateInit;
            const onAccessToggle = (isPrivate, allowedVal) => { if (postType === 'support') return; currentIsPrivate = isPrivate; privateUsersInput.style.display = isPrivate ? 'block' : 'none'; if (isPrivate && allowedVal) privateUsersInput.value = allowedVal; if (syncToBody) syncToBody(); };
            const accessDropdown = createAccessDropdown(currentIsPrivate, allowedUsers, onAccessToggle);
            if (postType === 'support') {
                accessDropdown.style.display = 'none';
                const supportInfo = document.createElement('div');
                supportInfo.style.cssText = 'background: rgba(244,67,54,0.15); border-left: 4px solid #f44336; padding: 10px 12px; border-radius: 12px; margin-bottom: 10px;';
                supportInfo.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #f44336;"></i> <strong>Внимание:</strong> На сайте это обращение увидят только вы и администратор. Однако оно сохраняется в <strong>публичном репозитории GitHub</strong>, и любой, у кого есть прямая ссылка, потенциально может его увидеть. Не публикуйте конфиденциальные данные (пароли, ключи).';
                accessPlaceholder.appendChild(supportInfo);
            } else accessPlaceholder.appendChild(accessDropdown);
            accessRow.appendChild(accessPlaceholder);
            if (postType !== 'support') { privateUsersInput.style.display = currentIsPrivate ? 'block' : 'none'; privateUsersInput.style.flex = '1'; accessRow.appendChild(privateUsersInput); }
            bottomBar.appendChild(accessRow);
            const existingSaveBtn = editorUI.querySelector('.button:last-child');
            if (existingSaveBtn) existingSaveBtn.remove();
            const saveBtn = document.createElement('button');
            saveBtn.className = 'button';
            saveBtn.textContent = mode === 'edit' ? 'Сохранить' : 'Опубликовать';
            bottomBar.appendChild(saveBtn);
            editorUI.appendChild(bottomBar);
            editorContainer.appendChild(editorUI);
            syncToBody = () => {
                let body = textarea.value;
                body = body.replace(/<!--\s*preview:\s*https?:\/\/[^\s]+\s*-->\s*\n?/g, '');
                body = body.replace(/<!--\s*summary:\s*.*?\s*-->\s*\n?/g, '');
                body = body.replace(/<!--\s*allowed:\s*.*?\s*-->\s*\n?/g, '');
                const newPreview = previewUrlInput.value.trim();
                if (newPreview) body = `<!-- preview: ${newPreview} -->\n\n![Preview](${newPreview})\n\n` + body;
                const newSummary = summaryInput.value.trim();
                if (newSummary) body = `<!-- summary: ${newSummary} -->\n\n` + body;
                if (postType === 'support') body = `<!-- allowed: ${currentUser} -->\n\n` + body;
                else if (currentIsPrivate && privateUsersInput.value.trim()) body = `<!-- allowed: ${privateUsersInput.value.trim()} -->\n\n` + body;
                textarea.value = body;
                updatePreview();
            };
            titleInput.addEventListener('input', () => {});
            summaryInput.addEventListener('input', syncToBody);
            previewUrlInput.addEventListener('input', syncToBody);
            if (postType !== 'support') privateUsersInput.addEventListener('input', syncToBody);
            if (postType === 'feedback') { const categorySelect = settingsCard.querySelector('#modal-category'); if (categorySelect) categorySelect.addEventListener('change', syncToBody); }
            const savedDraft = UIUtils.loadDraft(draftKey);
            if (savedDraft && (savedDraft.title || savedDraft.body || savedDraft.previewUrl || savedDraft.summary || savedDraft.access || savedDraft.privateUsers)) {
                if (confirm('Найден несохранённый черновик. Восстановить?')) {
                    titleInput.value = savedDraft.title || '';
                    if (savedDraft.previewUrl) { previewUrlInput.value = savedDraft.previewUrl; thumbnailImg.src = savedDraft.previewUrl; thumbnailContainer.style.display = 'block'; }
                    if (savedDraft.summary) summaryInput.value = savedDraft.summary;
                    textarea.value = savedDraft.body || '';
                    if (savedDraft.category && settingsCard.querySelector('#modal-category')) settingsCard.querySelector('#modal-category').value = savedDraft.category;
                    if (postType !== 'support' && savedDraft.access) { const isPrivate = savedDraft.access === 'private'; if (isPrivate !== currentIsPrivate) { currentIsPrivate = isPrivate; const btn = accessDropdown.querySelector('.access-dropdown-btn'); if (btn) btn.innerHTML = isPrivate ? '<i class="fas fa-lock"></i> Приватный' : '<i class="fas fa-globe"></i> Публичный'; if (privateUsersInput) privateUsersInput.style.display = isPrivate ? 'block' : 'none'; } }
                    if (savedDraft.privateUsers && privateUsersInput) privateUsersInput.value = savedDraft.privateUsers;
                    syncToBody();
                } else UIUtils.clearDraft(draftKey);
            }
            let hasChanges = false;
            const updateDraft = () => {
                const currentTitle = titleInput.value.trim();
                const currentPreview = previewUrlInput.value.trim();
                const currentSummary = summaryInput.value.trim();
                const currentBody = textarea.value.trim();
                const currentCategory = settingsCard.querySelector('#modal-category') ? settingsCard.querySelector('#modal-category').value : null;
                const currentAccess = currentIsPrivate ? 'private' : 'public';
                const currentPrivateUsers = privateUsersInput ? privateUsersInput.value.trim() : '';
                UIUtils.saveDraft(draftKey, { title: currentTitle, previewUrl: currentPreview, summary: currentSummary, body: currentBody, category: currentCategory, access: currentAccess, privateUsers: currentPrivateUsers });
                hasChanges = true;
            };
            titleInput.addEventListener('input', updateDraft);
            previewUrlInput.addEventListener('input', updateDraft);
            summaryInput.addEventListener('input', updateDraft);
            textarea.addEventListener('input', updateDraft);
            if (settingsCard.querySelector('#modal-category')) settingsCard.querySelector('#modal-category').addEventListener('change', updateDraft);
            if (postType !== 'support' && privateUsersInput) privateUsersInput.addEventListener('input', updateDraft);
            const originalCloseModal = closeModal;
            const closeWithCheck = () => { if (hasChanges) { if (confirm('У вас есть несохранённые изменения. Вы действительно хотите закрыть?')) { UIUtils.clearDraft(draftKey); originalCloseModal(); } } else { UIUtils.clearDraft(draftKey); originalCloseModal(); } };
            modal.addEventListener('click', (e) => { if (e.target === modal) { e.preventDefault(); closeWithCheck(); } });
            const escHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeWithCheck(); } };
            document.addEventListener('keydown', escHandler);
            const closeBtn = modal.querySelector('.modal-close');
            if (closeBtn) { closeBtn.replaceWith(closeBtn.cloneNode(true)); modal.querySelector('.modal-close').addEventListener('click', (e) => { e.preventDefault(); closeWithCheck(); }); }
            let isSubmitting = false;
            const saveHandler = async () => { if (isSubmitting) return; isSubmitting = true; saveBtn.disabled = true; try { await handleSave(textarea.value.trim()); } finally { isSubmitting = false; saveBtn.disabled = false; } };
            saveBtn.addEventListener('click', saveHandler);
        }
    }

    async function openSupportModal() {
        const currentUser = GithubAuth.getCurrentUser();
        if (!currentUser) { UIUtils.showToast('Войдите в аккаунт, чтобы использовать поддержку', 'error'); window.dispatchEvent(new CustomEvent('github-login-requested')); return; }
        const modalContent = `<div style="display: flex; flex-direction: column; gap: 20px;"><div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;"><h3 style="margin: 0;"><i class="fas fa-headset"></i> <span data-lang="supportTitle">Поддержка</span></h3><button class="button" id="new-support-btn"><i class="fas fa-plus"></i> <span data-lang="supportNewBtn">Новое обращение</span></button></div><div class="text-secondary" style="font-size: 12px; background: rgba(244,67,54,0.1); border-left: 3px solid #f44336; padding: 8px 12px; border-radius: 8px;"><i class="fas fa-exclamation-triangle"></i> <strong>Конфиденциальность:</strong> На сайте ваше обращение увидят только вы и администратор. Но оно хранится в <strong>публичном репозитории GitHub</strong>. Любой, у кого есть прямая ссылка, может его прочитать. Не публикуйте пароли или личные данные.</div><div id="support-list" style="display: flex; flex-direction: column; gap: 12px; max-height: 500px; overflow-y: auto;"><div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div></div><div class="text-secondary" style="font-size: 12px; text-align: center; border-top: 1px solid var(--border); padding-top: 12px;"><i class="fas fa-lock"></i> Все обращения приватны на сайте: их видят только вы и администратор.</div></div>`;
        const { modal, closeModal } = UIUtils.createModal('Поддержка', modalContent, { size: 'full' });
        const listContainer = modal.querySelector('#support-list');
        const newBtn = modal.querySelector('#new-support-btn');
        newBtn.addEventListener('click', () => { closeModal(); openEditorModal('new', { game: null }, 'support'); });
        try {
            const issues = await GithubAPI.loadIssues({ labels: 'type:support', state: 'open', per_page: 100 });
            const isAdmin = GithubAuth.isAdmin();
            let filtered = issues.filter(issue => { if (isAdmin) return true; const allowed = GithubCore.extractAllowed(issue.body); return allowed === currentUser; });
            filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            if (filtered.length === 0) { listContainer.innerHTML = '<p class="text-secondary" style="text-align: center;">У вас нет обращений. Нажмите «Новое обращение».</p>'; return; }
            listContainer.innerHTML = '';
            for (const issue of filtered) {
                const card = document.createElement('div');
                card.className = 'support-ticket-card';
                card.style.cssText = 'background: var(--bg-inner-gradient); border: 1px solid var(--border); border-radius: 16px; padding: 12px 16px; cursor: pointer; transition: all 0.2s;';
                card.innerHTML = `<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;"><div><div style="font-weight: bold; color: var(--accent);">${GithubCore.escapeHtml(issue.title)}</div><div style="font-size: 12px; color: var(--text-secondary);">${new Date(issue.created_at).toLocaleString()}</div></div><div style="font-size: 12px; background: var(--bg-primary); padding: 4px 8px; border-radius: 20px;">#${issue.number}</div></div><div class="text-secondary" style="font-size: 13px; margin-top: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${GithubCore.stripHtml(issue.body).substring(0, 100)}...</div>`;
                card.addEventListener('click', () => { closeModal(); if (window.UIFeedbackModal && window.UIFeedbackModal.openFullModal) window.UIFeedbackModal.openFullModal({ type: 'issue', id: issue.number, title: issue.title, body: issue.body, author: issue.user.login, date: new Date(issue.created_at), game: null, labels: issue.labels.map(l => l.name) }); });
                listContainer.appendChild(card);
            }
        } catch(err) { console.error('Failed to load support tickets', err); listContainer.innerHTML = '<p class="error-message">Ошибка загрузки обращений</p>'; }
    }

    window.UIFeedback = { openEditorModal, openSupportModal, createAccessDropdown, createSplitEditor };
})();