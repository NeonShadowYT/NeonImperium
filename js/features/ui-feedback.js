// ui-feedback.js – общие компоненты с поддержкой доступности и header в модалке

(function() {
    const REACTION_TYPES = [
        { content: '+1', emoji: '👍' }, { content: '-1', emoji: '👎' }, { content: 'laugh', emoji: '😄' },
        { content: 'confused', emoji: '😕' }, { content: 'heart', emoji: '❤️' }, { content: 'hooray', emoji: '🎉' },
        { content: 'rocket', emoji: '🚀' }, { content: 'eyes', emoji: '👀' }
    ];

    const CACHE_TTL = 5 * 60 * 1000;

    const reactionsCache = new Map();
    const commentsCache = new Map();

    function getCached(key, cacheMap) {
        const cached = cacheMap.get(key);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
        return null;
    }

    function setCached(key, data, cacheMap) {
        cacheMap.set(key, { data, timestamp: Date.now() });
    }

    function invalidateCache(issueNumber) {
        reactionsCache.delete(`reactions_${issueNumber}`);
        commentsCache.delete(`comments_${issueNumber}`);
        if (window.reactionsListCache) {
            window.reactionsListCache.delete(`list_reactions_${issueNumber}`);
        }
    }

    function groupReactions(reactions, currentUser) {
        const grouped = {};
        REACTION_TYPES.forEach(type => { grouped[type.content] = { content: type.content, emoji: type.emoji, count: 0, userReacted: false, userReactionId: null }; });
        reactions.forEach(r => {
            if (grouped[r.content]) {
                grouped[r.content].count++;
                if (currentUser && r.user && r.user.login === currentUser) {
                    grouped[r.content].userReacted = true;
                    grouped[r.content].userReactionId = r.id;
                }
            }
        });
        return Object.values(grouped).filter(g => g.count > 0).sort((a,b) => b.count - a.count);
    }

    function renderReactions(container, issueNumber, reactions, currentUser, onAdd, onRemove) {
        if (!container) return;
        const grouped = groupReactions(reactions, currentUser);
        const visible = grouped.slice(0,3);
        const hiddenCount = grouped.length - 3;
        let html = visible.map(g => `<button class="reaction-button ${g.userReacted ? 'active' : ''}" data-content="${g.content}" data-reaction-id="${g.userReactionId||''}" data-count="${g.count}" ${!currentUser ? 'disabled' : ''} aria-label="${g.emoji} (${g.count})"><span class="reaction-emoji">${g.emoji}</span><span class="reaction-count">${g.count}</span></button>`).join('');
        if (currentUser) html += hiddenCount > 0 ? `<button class="reaction-add-btn" data-more aria-label="Показать ещё реакции"><span>+${hiddenCount}</span></button>` : `<button class="reaction-add-btn" data-add aria-label="Добавить реакцию"><span>+</span></button>`;
        container.innerHTML = html;
        if (!currentUser) return;

        container.querySelectorAll('.reaction-button:not([disabled])').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const content = btn.dataset.content;
                const reactionId = btn.dataset.reactionId;
                const isActive = btn.classList.contains('active');
                const countSpan = btn.querySelector('.reaction-count');
                const oldCount = parseInt(countSpan.textContent, 10);

                if (isActive && reactionId) {
                    // Оптимистичное удаление
                    btn.classList.remove('active');
                    countSpan.textContent = oldCount - 1;
                    const wasZero = oldCount - 1 === 0;
                    if (wasZero) btn.style.display = 'none';
                    try {
                        await onRemove(issueNumber, parseInt(reactionId, 10));
                        // Успех: ничего не делаем, кнопка уже обновлена
                    } catch (err) {
                        // Ошибка: откатываем
                        UIUtils.showToast('Ошибка при удалении реакции', 'error');
                        btn.classList.add('active');
                        countSpan.textContent = oldCount;
                        if (wasZero) btn.style.display = '';
                    }
                } else {
                    showReactionMenu(btn, issueNumber, async (selected) => {
                        // Оптимистичное добавление: создаём временную кнопку
                        const tempBtn = document.createElement('button');
                        tempBtn.className = 'reaction-button active';
                        tempBtn.dataset.content = selected;
                        tempBtn.dataset.reactionId = 'temp';
                        const emoji = REACTION_TYPES.find(t => t.content === selected).emoji;
                        tempBtn.innerHTML = `<span class="reaction-emoji">${emoji}</span><span class="reaction-count">1</span>`;
                        tempBtn.setAttribute('aria-label', `${emoji} (1)`);
                        // Вставляем перед кнопкой "ещё" или добавляем в конец
                        const addBtn = container.querySelector('[data-add],[data-more]');
                        if (addBtn && addBtn.parentNode === container) {
                            container.insertBefore(tempBtn, addBtn);
                        } else {
                            container.appendChild(tempBtn);
                        }
                        try {
                            await onAdd(issueNumber, selected);
                            // Успех: заменяем временный ID на настоящий (если нужно)
                            // Но мы не знаем настоящий ID, поэтому просто оставляем кнопку
                            // При следующем рендере (если он случится) данные обновятся
                        } catch (err) {
                            // Ошибка: удаляем временную кнопку
                            UIUtils.showToast('Ошибка при добавлении реакции', 'error');
                            if (tempBtn.parentNode) tempBtn.remove();
                        }
                    });
                }
            });
        });

        const addBtn = container.querySelector('[data-add],[data-more]');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showReactionMenu(addBtn, issueNumber, async (selected) => {
                    // Оптимистичное добавление
                    const tempBtn = document.createElement('button');
                    tempBtn.className = 'reaction-button active';
                    tempBtn.dataset.content = selected;
                    tempBtn.dataset.reactionId = 'temp';
                    const emoji = REACTION_TYPES.find(t => t.content === selected).emoji;
                    tempBtn.innerHTML = `<span class="reaction-emoji">${emoji}</span><span class="reaction-count">1</span>`;
                    tempBtn.setAttribute('aria-label', `${emoji} (1)`);
                    container.insertBefore(tempBtn, addBtn);
                    try {
                        await onAdd(issueNumber, selected);
                    } catch (err) {
                        UIUtils.showToast('Ошибка при добавлении реакции', 'error');
                        if (tempBtn.parentNode) tempBtn.remove();
                    }
                });
            });
        }
    }

    function showReactionMenu(relativeTo, issueNumber, callback) {
        document.querySelectorAll('.reaction-menu').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'reaction-menu';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Выберите реакцию');
        Object.assign(menu.style, {
            position: 'absolute',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '30px',
            padding: '5px',
            display: 'flex',
            gap: '5px',
            zIndex: '10010',
            boxShadow: 'var(--shadow)'
        });

        REACTION_TYPES.forEach(type => {
            const btn = document.createElement('button');
            btn.className = 'reaction-menu-btn';
            btn.innerHTML = type.emoji;
            btn.setAttribute('role', 'menuitem');
            btn.setAttribute('aria-label', type.emoji);
            btn.tabIndex = -1;
            btn.onclick = (e) => {
                e.stopPropagation();
                callback(type.content);
                document.body.removeChild(menu);
                relativeTo.focus();
            };
            menu.appendChild(btn);
        });

        const rect = relativeTo.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + window.scrollY + 5) + 'px';
        document.body.appendChild(menu);

        const firstBtn = menu.querySelector('button');
        if (firstBtn) firstBtn.focus();

        const handleKeyDown = (e) => {
            const items = Array.from(menu.querySelectorAll('button'));
            const current = document.activeElement;
            const currentIndex = items.indexOf(current);

            switch (e.key) {
                case 'ArrowRight':
                case 'ArrowDown':
                    e.preventDefault();
                    if (currentIndex < items.length - 1) items[currentIndex + 1].focus();
                    else items[0].focus();
                    break;
                case 'ArrowLeft':
                case 'ArrowUp':
                    e.preventDefault();
                    if (currentIndex > 0) items[currentIndex - 1].focus();
                    else items[items.length - 1].focus();
                    break;
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    if (current) current.click();
                    break;
                case 'Escape':
                    e.preventDefault();
                    document.body.removeChild(menu);
                    relativeTo.focus();
                    break;
            }
        };

        menu.addEventListener('keydown', handleKeyDown);

        const closeMenu = (e) => {
            if (!menu.contains(e.target) && document.body.contains(menu)) {
                document.body.removeChild(menu);
                document.removeEventListener('click', closeMenu);
                menu.removeEventListener('keydown', handleKeyDown);
                relativeTo.focus();
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 100);
    }

    function renderComments(container, comments) {
        container.innerHTML = comments.map(c => `<div class="comment" data-comment-id="${c.id}"><div class="comment-meta"><span class="comment-author">${GithubCore.escapeHtml(c.user.login)}</span><span>${new Date(c.created_at).toLocaleString()}</span></div><div>${GithubCore.escapeHtml(c.body).replace(/\n/g,'<br>')}</div></div>`).join('');
    }

    async function loadReactionsWithCache(issueNumber) {
        const cacheKey = `reactions_${issueNumber}`;
        const cached = getCached(cacheKey, reactionsCache);
        if (cached) return cached;
        try {
            const reactions = await GithubAPI.loadReactions(issueNumber);
            setCached(cacheKey, reactions, reactionsCache);
            return reactions;
        } catch (err) {
            UIUtils.showToast('Ошибка загрузки реакций', 'error');
            throw err;
        }
    }

    async function loadCommentsWithCache(issueNumber) {
        const cacheKey = `comments_${issueNumber}`;
        const cached = getCached(cacheKey, commentsCache);
        if (cached) return cached;
        try {
            const comments = await GithubAPI.loadComments(issueNumber);
            setCached(cacheKey, comments, commentsCache);
            return comments;
        } catch (err) {
            UIUtils.showToast('Ошибка загрузки комментариев', 'error');
            throw err;
        }
    }

    // --- Подфункции для openFullModal ---

    async function loadReactionsAndComments(container, item, currentUser, issue) {
        const reactionsDiv = document.createElement('div'); reactionsDiv.className = 'reactions-container';
        const commentsDiv = document.createElement('div'); commentsDiv.className = 'feedback-comments';
        container.appendChild(reactionsDiv);
        container.appendChild(commentsDiv);

        const reactions = await loadReactionsWithCache(item.id);
        const handleAdd = async (num, content) => { 
            try { 
                await GithubAPI.addReaction(num, content); 
                invalidateCache(num);
                // Не перезагружаем, только инвалидируем кеш
            } catch (err) {
                UIUtils.showToast('Ошибка при добавлении реакции', 'error');
                throw err;
            }
        };
        const handleRemove = async (num, reactionId) => { 
            try { 
                await GithubAPI.removeReaction(num, reactionId); 
                invalidateCache(num);
            } catch (err) {
                UIUtils.showToast('Ошибка при удалении реакции', 'error');
                throw err;
            }
        };
        renderReactions(reactionsDiv, item.id, reactions, currentUser, handleAdd, handleRemove);

        const comments = await loadCommentsWithCache(item.id);
        renderComments(commentsDiv, comments);
    }

    function setupCommentForm(container, item, currentUser) {
        const commentForm = document.createElement('div'); commentForm.className = 'comment-form'; commentForm.dataset.issue = item.id;
        commentForm.innerHTML = `<input type="text" class="comment-input" placeholder="Написать комментарий..."><button class="button comment-submit">Отправить</button>`;
        container.appendChild(commentForm);

        commentForm.querySelector('.comment-submit')?.addEventListener('click', async (e) => {
            e.stopPropagation(); 
            const input = commentForm.querySelector('.comment-input'); 
            const comment = input.value.trim();
            if (!comment) return; 
            
            const tempId = 'temp-' + Date.now();
            const tempCommentDiv = document.createElement('div');
            tempCommentDiv.className = 'comment';
            tempCommentDiv.dataset.commentId = tempId;
            tempCommentDiv.innerHTML = `
                <div class="comment-meta">
                    <span class="comment-author">${GithubCore.escapeHtml(currentUser)}</span>
                    <span>только что</span>
                </div>
                <div>${GithubCore.escapeHtml(comment).replace(/\n/g,'<br>')}</div>
            `;
            const commentsDiv = container.querySelector('.feedback-comments');
            commentsDiv.appendChild(tempCommentDiv);
            
            input.disabled = true; 
            e.target.disabled = true;
            
            try { 
                const newComment = await GithubAPI.addComment(item.id, comment); 
                tempCommentDiv.dataset.commentId = newComment.id;
                const timeSpan = tempCommentDiv.querySelector('.comment-meta span:last-child');
                timeSpan.textContent = new Date(newComment.created_at).toLocaleString();
                invalidateCache(item.id);
                const updated = await GithubAPI.loadComments(item.id); 
                setCached(`comments_${item.id}`, updated, commentsCache);
                UIUtils.showToast('Комментарий добавлен', 'success');
            } catch (err) { 
                UIUtils.showToast('Ошибка при отправке комментария', 'error');
                tempCommentDiv.remove();
            } finally { 
                input.disabled = false; 
                e.target.disabled = false; 
                input.value = '';
            }
        });
    }

    function setupAdminActions(container, item, issue, currentUser, closeModal, escHandler) {
        const isAdmin = GithubAuth.isAdmin();
        const actionButtons = document.createElement('div'); actionButtons.className = 'feedback-item-actions';
        if (isAdmin || (currentUser && issue.user.login === currentUser)) {
            actionButtons.innerHTML = `
                <button class="edit-issue" title="Редактировать" aria-label="Редактировать"><i class="fas fa-edit"></i></button>
                <button class="close-issue" title="Закрыть" aria-label="Закрыть"><i class="fas fa-trash-alt"></i></button>
            `;
        }
        container.appendChild(actionButtons);

        actionButtons.querySelector('.edit-issue')?.addEventListener('click', (e) => {
            e.stopPropagation(); closeModal(); document.removeEventListener('keydown', escHandler); 
            let postType = 'feedback';
            if (item.labels?.includes('type:news')) postType = 'news';
            else if (item.labels?.includes('type:update')) postType = 'update';
            openEditorModal('edit', { number: item.id, title: issue.title, body: issue.body, game: item.game }, postType);
        });

        actionButtons.querySelector('.close-issue')?.addEventListener('click', async (e) => {
            e.stopPropagation(); if (!confirm('Закрыть?')) return; 
            try { 
                await GithubAPI.closeIssue(item.id); 
                closeModal(); 
                document.removeEventListener('keydown', escHandler); 
                if (window.refreshNewsFeed) window.refreshNewsFeed(); 
                if (window.refreshGameUpdates && item.game) window.refreshGameUpdates(item.game); 
                UIUtils.showToast('Закрыто', 'success');
            } catch (err) { 
                UIUtils.showToast('Ошибка при закрытии', 'error');
            }
        });
    }

    // --- Основная функция открытия модалки с header ---
    async function openFullModal(item) {
        const currentUser = GithubAuth.getCurrentUser();
        const contentHtml = `<div class="loading-spinner" id="modal-loader"><i class="fas fa-circle-notch fa-spin"></i></div>`;
        const { modal, closeModal } = UIUtils.createModal(item.title, contentHtml, { size: 'full' });

        const container = modal.querySelector('.modal-body');
        const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
        document.addEventListener('keydown', escHandler);

        try {
            const issue = await GithubAPI.loadIssue(item.id);
            container.innerHTML = '';

            // Header
            const header = document.createElement('div');
            header.className = 'modal-post-header';
            header.style.cssText = `
                display: flex;
                align-items: center;
                gap: 16px;
                margin-bottom: 20px;
                padding-bottom: 16px;
                border-bottom: 1px solid var(--border);
                flex-wrap: wrap;
            `;
            let typeIcon = '';
            if (item.labels?.includes('type:news')) typeIcon = '📰';
            else if (item.labels?.includes('type:update')) typeIcon = '🔄';
            else if (item.labels?.includes('type:idea')) typeIcon = '💡';
            else if (item.labels?.includes('type:bug')) typeIcon = '🐛';
            else if (item.labels?.includes('type:review')) typeIcon = '⭐';
            else typeIcon = '📌';

            header.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 24px;">${typeIcon}</span>
                    <div>
                        <div style="font-size: 14px; color: var(--accent);">${GithubCore.escapeHtml(item.author || 'Unknown')}</div>
                        <div style="font-size: 12px; color: var(--text-secondary);">${new Date(item.date).toLocaleString()}</div>
                    </div>
                </div>
                ${item.game ? `<span class="feedback-label" style="margin-left: auto;">${GithubCore.escapeHtml(item.game)}</span>` : ''}
            `;
            container.appendChild(header);

            const bodyDiv = document.createElement('div'); bodyDiv.className = 'spoiler-content'; 
            bodyDiv.innerHTML = GithubCore.renderMarkdown(issue.body);
            container.appendChild(bodyDiv);

            await loadReactionsAndComments(container, item, currentUser, issue);
            if (currentUser) setupCommentForm(container, item, currentUser);
            setupAdminActions(container, item, issue, currentUser, closeModal, escHandler);

        } catch (err) {
            container.innerHTML = '<p class="error-message">Не удалось загрузить содержимое. Закрытие...</p>';
            setTimeout(() => {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }, 2000);
        }
    }

    function openEditorModal(mode, data, postType = 'feedback') {
        const title = mode === 'edit' ? 'Редактирование' : 'Новое сообщение';
        let categoryHtml = '';
        if (postType === 'feedback') {
            categoryHtml = `<select id="modal-category" class="feedback-select">
                <option value="idea">💡 Идея</option>
                <option value="bug">🐛 Баг</option>
                <option value="review">⭐ Отзыв</option>
            </select>`;
        }
        const contentHtml = `
            <div class="feedback-form">
                <input type="text" id="modal-title" class="feedback-input" placeholder="Заголовок" value="${GithubCore.escapeHtml(data.title||'')}">
                ${categoryHtml}
                <div id="modal-editor-toolbar"></div>
                <textarea id="modal-body" class="feedback-textarea" placeholder="Описание..." rows="10">${GithubCore.escapeHtml(data.body||'')}</textarea>
                <div class="preview-area" id="modal-preview-area" style="display:none;"></div>
                <div class="button-group">
                    <button class="button" id="modal-submit">${mode==='edit'?'Сохранить':'Опубликовать'}</button>
                </div>
            </div>
        `;

        const { modal, closeModal } = UIUtils.createModal(title, contentHtml, { size: 'full' });

        const textarea = document.getElementById('modal-body');
        if (window.Editor) {
            const toolbar = Editor.createEditorToolbar(textarea, { previewAreaId: 'modal-preview-area', onPreview: () => {
                const preview = document.getElementById('modal-preview-area');
                preview.innerHTML = GithubCore.renderMarkdown(textarea.value);
                preview.style.display = textarea.value.trim() ? 'block' : 'none';
            }});
            document.getElementById('modal-editor-toolbar').appendChild(toolbar);
        }

        document.getElementById('modal-submit').addEventListener('click', async () => {
            const title = document.getElementById('modal-title').value.trim();
            const body = document.getElementById('modal-body').value;
            if (!title || !body.trim()) { UIUtils.showToast('Заполните заголовок и описание', 'error'); return; }
            let category = 'idea';
            if (postType === 'feedback') category = document.getElementById('modal-category').value;
            const btn = document.getElementById('modal-submit'); btn.disabled = true; btn.textContent = 'Сохранение...';
            try {
                let labels;
                if (postType === 'feedback') labels = [`game:${data.game}`, `type:${category}`];
                else if (postType === 'news') labels = ['type:news'];
                else labels = ['type:update', `game:${data.game}`];

                if (mode === 'edit') await GithubAPI.updateIssue(data.number, { title, body, labels });
                else await GithubAPI.createIssue(title, body, labels);

                closeModal();
                if (postType === 'feedback' && window.refreshNewsFeed) window.refreshNewsFeed();
                if (postType === 'update' && window.refreshGameUpdates) window.refreshGameUpdates(data.game);
                if (postType === 'news' && window.refreshNewsFeed) window.refreshNewsFeed();
                UIUtils.showToast(mode === 'edit' ? 'Сохранено' : 'Опубликовано', 'success');
            } catch (err) { 
                UIUtils.showToast('Ошибка: ' + err.message, 'error'); 
            } finally { 
                btn.disabled = false; 
                btn.textContent = mode==='edit'?'Сохранить':'Опубликовать'; 
            }
        });
    }

    window.UIFeedback = { 
        renderReactions, 
        showReactionMenu, 
        renderComments, 
        openFullModal, 
        openEditorModal, 
        REACTION_TYPES,
        invalidateCache 
    };
})();