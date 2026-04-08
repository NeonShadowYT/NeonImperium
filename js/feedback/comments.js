(function() {
    function extractPostLinks(text) {
        const regex = /(?:https?:\/\/[^\s]*\?post=(\d+))|(?:\/(?:index\.html)?\?post=(\d+))/g;
        const matches = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            const id = match[1] || match[2];
            if (id) matches.push(parseInt(id, 10));
        }
        return [...new Set(matches)];
    }
    
    async function loadPostByNumber(issueNumber) {
        const cacheKey = `post_${issueNumber}`;
        let cached = null;
        if (window.Cache) cached = window.Cache.get(cacheKey);
        if (cached) return cached;
        try {
            const issue = await GithubAPI.loadIssue(issueNumber);
            const postData = {
                number: issue.number,
                title: issue.title,
                body: issue.body,
                author: issue.user.login,
                date: new Date(issue.created_at),
                labels: issue.labels.map(l => l.name),
                game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null
            };
            if (window.Cache) window.Cache.set(cacheKey, postData);
            return postData;
        } catch (err) {
            console.warn('Failed to load post', issueNumber, err);
            return null;
        }
    }
    
    async function renderMiniPostCard(container, postNumber) {
        const post = await loadPostByNumber(postNumber);
        if (!post) return;
        const typeLabel = post.labels.find(l => l.startsWith('type:'))?.split(':')[1] || 'post';
        const typeIcon = typeLabel === 'idea' ? '💡' : typeLabel === 'bug' ? '🐛' : typeLabel === 'review' ? '⭐' : typeLabel === 'news' ? '📰' : typeLabel === 'update' ? '🔄' : typeLabel === 'support' ? '🛟' : '📌';
        const card = document.createElement('div');
        card.className = 'mini-post-card';
        card.style.cssText = 'background: var(--bg-inner-gradient); border: 1px solid var(--border); border-radius: 16px; padding: 12px; margin: 8px 0; cursor: pointer; transition: all 0.2s;';
        card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 24px;">${typeIcon}</span>
                <div style="flex: 1;">
                    <div style="font-weight: bold; color: var(--accent);">${GithubCore.escapeHtml(post.title)}</div>
                    <div style="font-size: 12px; color: var(--text-secondary);">${GithubCore.escapeHtml(post.author)} · ${post.date.toLocaleDateString()}</div>
                </div>
                <i class="fas fa-external-link-alt" style="color: var(--text-secondary);"></i>
            </div>
        `;
        card.addEventListener('click', () => {
            if (window.UIFeedbackModal && window.UIFeedbackModal.openFullModal) {
                window.UIFeedbackModal.openFullModal({
                    type: 'issue',
                    id: post.number,
                    title: post.title,
                    body: post.body,
                    author: post.author,
                    date: post.date,
                    game: post.game,
                    labels: post.labels
                });
            }
        });
        container.appendChild(card);
    }
    
    async function processCommentLinks(commentBody, container) {
        const links = extractPostLinks(commentBody);
        for (const link of links) {
            await renderMiniPostCard(container, link);
        }
    }
    
    function renderComments(container, comments, currentUser, issueNumber) {
        const regularComments = comments.filter(c => !c.body.trim().startsWith('!vote'));
        container.innerHTML = '';
        for (const c of regularComments) {
            const commentDiv = document.createElement('div');
            commentDiv.className = 'comment';
            commentDiv.dataset.commentId = c.id;
            const isAuthor = currentUser && c.user.login === currentUser;
            const isAdmin = GithubAuth.isAdmin();
            const canEditDelete = isAuthor || isAdmin;
            let actionsHtml = '';
            if (canEditDelete) {
                actionsHtml = `<div class="comment-actions"><button class="comment-edit" data-comment-id="${c.id}" data-comment-body="${GithubCore.escapeHtml(c.body)}" title="Редактировать"><i class="fas fa-edit"></i></button><button class="comment-delete" data-comment-id="${c.id}" title="Удалить"><i class="fas fa-trash-alt"></i></button></div>`;
            }
            commentDiv.innerHTML = `
                <div class="comment-meta"><span class="comment-author">${GithubCore.escapeHtml(c.user.login)}</span></div>
                <div class="comment-body">${GithubCore.escapeHtml(c.body).replace(/\n/g,'<br>')}</div>
                <div class="comment-mini-cards"></div>
                ${actionsHtml}
            `;
            container.appendChild(commentDiv);
            const miniCardsContainer = commentDiv.querySelector('.comment-mini-cards');
            processCommentLinks(c.body, miniCardsContainer);
        }
        if (currentUser) {
            container.querySelectorAll('.comment-edit').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (window.UIFeedback && window.UIFeedback.openEditCommentModal) {
                        window.UIFeedback.openEditCommentModal(btn.dataset.commentId, btn.dataset.commentBody, issueNumber);
                    }
                });
            });
            container.querySelectorAll('.comment-delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const commentDiv = btn.closest('.comment');
                    const commentId = btn.dataset.commentId;
                    commentDiv.remove();
                    try {
                        await GithubAPI.deleteComment(commentId);
                        if (window.UIFeedbackModal && window.UIFeedbackModal.invalidateCache) window.UIFeedbackModal.invalidateCache(issueNumber);
                        if (window.UIUtils) UIUtils.showToast('Комментарий удалён', 'success');
                    } catch (err) {
                        if (window.UIUtils) UIUtils.showToast('Ошибка при удалении', 'error');
                        if (!commentDiv.parentNode) container.appendChild(commentDiv);
                    }
                });
            });
        }
    }
    
    function openEditCommentModal(commentId, currentBody, issueNumber) {
        const modalHtml = `
            <div class="feedback-form">
                <div id="modal-editor-toolbar"></div>
                <textarea id="edit-comment-body" class="feedback-textarea" rows="10">${GithubCore.escapeHtml(currentBody)}</textarea>
                <div class="preview-area" id="modal-preview-area" style="display:none;"></div>
                <div class="button-group" style="margin-top:15px;">
                    <button class="button" id="edit-comment-save">Сохранить</button>
                    <button class="button" id="edit-comment-cancel">Отмена</button>
                </div>
            </div>
        `;
        const { modal, closeModal } = UIUtils.createModal('Редактировать комментарий', modalHtml, { size: 'full' });
        const textarea = modal.querySelector('#edit-comment-body');
        const previewArea = modal.querySelector('#modal-preview-area');
        const toolbarContainer = modal.querySelector('#modal-editor-toolbar');
        
        if (window.EditorToolbar) {
            const updatePreview = () => {
                const text = textarea.value;
                if (text.trim()) {
                    previewArea.innerHTML = '';
                    if (!previewArea.classList.contains('markdown-body')) previewArea.classList.add('markdown-body');
                    GithubCore.renderMarkdown(text).then(html => { previewArea.innerHTML = html; });
                    previewArea.style.display = 'block';
                } else {
                    previewArea.style.display = 'none';
                }
            };
            const toolbar = EditorToolbar.createEditorToolbar(textarea, { onPreview: updatePreview });
            toolbarContainer.appendChild(toolbar);
        }
        
        const saveBtn = modal.querySelector('#edit-comment-save');
        const cancelBtn = modal.querySelector('#edit-comment-cancel');
        
        saveBtn.addEventListener('click', async () => {
            const newBody = textarea.value.trim();
            if (!newBody) { UIUtils.showToast('Комментарий не может быть пустым', 'error'); return; }
            if (newBody === currentBody) { UIUtils.showToast('Нет изменений', 'warning'); return; }
            saveBtn.disabled = true;
            try {
                await GithubAPI.updateComment(commentId, newBody);
                if (window.UIFeedbackModal && window.UIFeedbackModal.invalidateCache) window.UIFeedbackModal.invalidateCache(issueNumber);
                const updatedComments = await GithubAPI.loadComments(issueNumber);
                if (window.UIFeedbackModal && window.UIFeedbackModal.updateCommentsCache) window.UIFeedbackModal.updateCommentsCache(issueNumber, updatedComments);
                const commentsContainer = document.querySelector('.feedback-comments');
                if (commentsContainer) {
                    renderComments(commentsContainer, updatedComments, GithubAuth.getCurrentUser(), issueNumber);
                }
                closeModal();
                UIUtils.showToast('Комментарий обновлён', 'success');
            } catch (err) {
                UIUtils.showToast('Ошибка при сохранении', 'error');
                saveBtn.disabled = false;
            }
        });
        cancelBtn.addEventListener('click', closeModal);
    }
    
    window.FeedbackComments = {
        renderComments,
        openEditCommentModal,
        processCommentLinks,
        extractPostLinks,
        renderMiniPostCard
    };
})();