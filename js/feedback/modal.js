(function() {
    function addLazyLoadingToImages(container) {
        if (!container) return;
        const images = container.querySelectorAll('img:not([loading])');
        images.forEach(img => {
            if (!img.hasAttribute('loading')) {
                img.setAttribute('loading', 'lazy');
            }
        });
    }
    
    async function renderPostBody(container, body, issueNumber) {
        let html = await GithubCore.renderMarkdown(body);
        container.innerHTML = html;
        if (!container.classList.contains('markdown-body')) container.classList.add('markdown-body');
        addLazyLoadingToImages(container);
        
        const pollData = window.FeedbackPolls ? window.FeedbackPolls.extractPollFromBody(body) : null;
        if (pollData) {
            const pollContainer = document.createElement('div');
            pollContainer.className = 'poll-container';
            container.appendChild(pollContainer);
            if (issueNumber && window.FeedbackPolls) await window.FeedbackPolls.renderPoll(pollContainer, issueNumber, pollData);
            else if (window.FeedbackPolls) window.FeedbackPolls.renderStaticPoll(pollContainer, pollData);
        }
        if (window.FeedbackComments && window.FeedbackComments.processCommentLinks) {
            const links = window.FeedbackComments.extractPostLinks ? window.FeedbackComments.extractPostLinks(body) : (() => { const regex = /(?:https?:\/\/[^\s]*\?post=(\d+))/g; const matches = []; let m; while ((m = regex.exec(body)) !== null) matches.push(parseInt(m[1],10)); return matches; })();
            for (const link of links) {
                await window.FeedbackComments.renderMiniPostCard(container, link);
            }
        }
    }
    
    async function loadReactionsWithCache(issueNumber) {
        const cacheKey = `reactions_${issueNumber}`;
        let cached = null;
        if (window.Cache) cached = window.Cache.get(cacheKey);
        if (cached) return cached;
        try {
            const reactions = await GithubAPI.loadReactions(issueNumber);
            if (window.Cache) window.Cache.set(cacheKey, reactions);
            return reactions;
        } catch (err) {
            if (window.UIUtils) UIUtils.showToast('Ошибка загрузки реакций', 'error');
            throw err;
        }
    }
    
    async function loadCommentsWithCache(issueNumber) {
        const cacheKey = `comments_${issueNumber}`;
        let cached = null;
        if (window.Cache) cached = window.Cache.get(cacheKey);
        if (cached) return cached;
        try {
            const comments = await GithubAPI.loadComments(issueNumber);
            if (window.Cache) window.Cache.set(cacheKey, comments);
            return comments;
        } catch (err) {
            if (window.UIUtils) UIUtils.showToast('Ошибка загрузки комментариев', 'error');
            throw err;
        }
    }
    
    function invalidateCache(issueNumber) {
        if (window.Cache) {
            window.Cache.remove(`reactions_${issueNumber}`);
            window.Cache.remove(`comments_${issueNumber}`);
            window.Cache.remove(`post_${issueNumber}`);
        }
    }
    
    function updateCommentsCache(issueNumber, comments) {
        if (window.Cache) window.Cache.set(`comments_${issueNumber}`, comments);
    }
    
    async function openFullModal(item) {
        const currentUser = GithubAuth.getCurrentUser();
        const contentHtml = '<div class="loading-spinner" id="modal-loader"><i class="fas fa-circle-notch fa-spin"></i></div>';
        const { modal, closeModal } = UIUtils.createModal(item.title, contentHtml, { size: 'full' });
        const container = modal.querySelector('.modal-body');
        const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
        document.addEventListener('keydown', escHandler);
        try {
            const issue = await GithubAPI.loadIssue(item.id);
            
            if (issue.state === 'closed') {
                container.innerHTML = '<p class="error-message">Этот пост был закрыт и больше не доступен.</p>';
                return;
            }
            
            container.innerHTML = '';
            
            const header = document.createElement('div');
            header.className = 'modal-post-header';
            header.style.cssText = 'display:flex;align-items:center;gap:16px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border);flex-wrap:wrap;';
            let typeIcon = '';
            if (item.labels?.includes('type:news')) typeIcon = '📰';
            else if (item.labels?.includes('type:update')) typeIcon = '🔄';
            else if (item.labels?.includes('type:idea')) typeIcon = '💡';
            else if (item.labels?.includes('type:bug')) typeIcon = '🐛';
            else if (item.labels?.includes('type:review')) typeIcon = '⭐';
            else if (item.labels?.includes('type:support')) typeIcon = '🛟';
            else typeIcon = '📌';
            header.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="font-size:24px;">${typeIcon}</span>
                    <div>
                        <div style="font-size:14px;color:var(--accent);">${GithubCore.escapeHtml(item.author || 'Unknown')}</div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0;">
                    ${item.game ? `<span class="feedback-label">${GithubCore.escapeHtml(item.game)}</span>` : ''}
                </div>
            `;
            container.appendChild(header);
            
            const modalHeader = modal.querySelector('.modal-header');
            if (modalHeader) {
                addHeaderActions(modalHeader, item, issue, currentUser, closeModal, escHandler);
            }
            
            await renderPostBody(container, issue.body, item.id);
            
            const reactionsDiv = document.createElement('div'); reactionsDiv.className = 'reactions-container';
            const commentsDiv = document.createElement('div'); commentsDiv.className = 'feedback-comments';
            container.appendChild(reactionsDiv);
            container.appendChild(commentsDiv);
            
            const reactions = await loadReactionsWithCache(item.id);
            const handleAdd = async (num, content) => { try { await GithubAPI.addReaction(num, content); invalidateCache(num); } catch (err) { if (window.UIUtils) UIUtils.showToast('Ошибка при добавлении реакции', 'error'); throw err; } };
            const handleRemove = async (num, reactionId) => { try { await GithubAPI.removeReaction(num, reactionId); invalidateCache(num); } catch (err) { if (window.UIUtils) UIUtils.showToast('Ошибка при удалении реакции', 'error'); throw err; } };
            if (window.FeedbackReactions) {
                window.FeedbackReactions.renderReactions(reactionsDiv, item.id, reactions, currentUser, handleAdd, handleRemove);
            }
            
            const comments = await loadCommentsWithCache(item.id);
            if (window.FeedbackComments) {
                window.FeedbackComments.renderComments(commentsDiv, comments, currentUser, item.id);
            }
            
            if (currentUser) setupCommentForm(container, item, currentUser);
        } catch (err) {
            console.error('Error loading post:', err);
            container.innerHTML = '<p class="error-message">Пост не найден или произошла ошибка загрузки.</p>';
            setTimeout(() => { closeModal(); document.removeEventListener('keydown', escHandler); }, 3000);
        }
    }
    
    function setupCommentForm(container, item, currentUser) {
        const commentForm = document.createElement('div');
        commentForm.className = 'comment-form';
        commentForm.innerHTML = `
            <div style="display: flex; gap: 8px; width: 100%; align-items: stretch;">
                <input type="text" class="comment-input" placeholder="Написать комментарий..." style="flex: 1; height: 40px;">
                <button class="button comment-submit" style="flex-shrink: 0; height: 40px;">Отправить</button>
                <button class="button comment-editor-btn" style="flex-shrink: 0; height: 40px; padding: 0 12px;" title="Редактор"><i class="fas fa-pencil-alt"></i></button>
            </div>
        `;
        container.appendChild(commentForm);
        const input = commentForm.querySelector('.comment-input');
        const submitBtn = commentForm.querySelector('.comment-submit');
        const editorBtn = commentForm.querySelector('.comment-editor-btn');
        
        submitBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const comment = input.value.trim();
            if (!comment) return;
            const tempId = 'temp-' + Date.now();
            const tempCommentDiv = document.createElement('div');
            tempCommentDiv.className = 'comment';
            tempCommentDiv.dataset.commentId = tempId;
            tempCommentDiv.innerHTML = `<div class="comment-meta"><span class="comment-author">${GithubCore.escapeHtml(currentUser)}</span></div><div>${GithubCore.escapeHtml(comment).replace(/\n/g,'<br>')}</div><div class="comment-mini-cards"></div>`;
            const commentsDiv = container.querySelector('.feedback-comments');
            commentsDiv.appendChild(tempCommentDiv);
            input.disabled = true; submitBtn.disabled = true; editorBtn.disabled = true;
            try {
                const newComment = await GithubAPI.addComment(item.id, comment);
                tempCommentDiv.dataset.commentId = newComment.id;
                invalidateCache(item.id);
                const updated = await GithubAPI.loadComments(item.id);
                updateCommentsCache(item.id, updated);
                if (window.FeedbackComments) {
                    window.FeedbackComments.renderComments(commentsDiv, updated, currentUser, item.id);
                }
                if (window.UIUtils) UIUtils.showToast('Комментарий добавлен', 'success');
            } catch (err) {
                if (window.UIUtils) UIUtils.showToast('Ошибка при отправке комментария', 'error');
                tempCommentDiv.remove();
            } finally {
                input.disabled = false; submitBtn.disabled = false; editorBtn.disabled = false; input.value = '';
            }
        });
        
        editorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('open-comment-editor', { detail: { issueNumber: item.id } }));
        });
    }
    
    function addHeaderActions(modalHeader, item, issue, currentUser, closeModal, escHandler) {
        const isAdmin = GithubAuth.isAdmin();
        const postUrl = `${window.location.origin}${window.location.pathname}?post=${item.id}`;
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'modal-header-actions';
        
        let buttonsHtml = '';
        if (isAdmin || (currentUser && issue.user.login === currentUser)) {
            buttonsHtml += `
                <button class="action-btn edit-issue" title="Редактировать" aria-label="Редактировать"><i class="fas fa-edit"></i></button>
                <button class="action-btn close-issue" title="Закрыть" aria-label="Закрыть"><i class="fas fa-trash-alt"></i></button>
            `;
        }
        buttonsHtml += `<button class="action-btn share-post" title="Поделиться" aria-label="Поделиться"><i class="fas fa-share-alt"></i></button>`;
        
        actionsContainer.innerHTML = buttonsHtml;
        
        const closeBtn = modalHeader.querySelector('.modal-close');
        if (closeBtn) {
            modalHeader.insertBefore(actionsContainer, closeBtn);
        } else {
            modalHeader.appendChild(actionsContainer);
        }
        
        actionsContainer.querySelector('.edit-issue')?.addEventListener('click', (e) => {
            e.stopPropagation(); closeModal(); document.removeEventListener('keydown', escHandler);
            let postType = 'feedback';
            if (item.labels?.includes('type:news')) postType = 'news';
            else if (item.labels?.includes('type:update')) postType = 'update';
            else if (item.labels?.includes('type:support')) postType = 'support';
            if (window.UIFeedback && window.UIFeedback.openEditorModal) {
                window.UIFeedback.openEditorModal('edit', { number: item.id, title: issue.title, body: issue.body, game: item.game }, postType);
            }
        });
        
        actionsContainer.querySelector('.close-issue')?.addEventListener('click', async (e) => {
            e.stopPropagation(); if (!confirm('Закрыть?')) return;
            try {
                await GithubAPI.closeIssue(item.id);
                closeModal(); document.removeEventListener('keydown', escHandler);
                if (window.refreshNewsFeed) window.refreshNewsFeed();
                if (window.refreshGameUpdates && item.game) window.refreshGameUpdates(item.game);
                if (window.UIUtils) UIUtils.showToast('Закрыто', 'success');
            } catch (err) { if (window.UIUtils) UIUtils.showToast('Ошибка при закрытии', 'error'); }
        });
        
        actionsContainer.querySelector('.share-post')?.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(postUrl).then(() => UIUtils.showToast('Ссылка скопирована', 'success')).catch(() => UIUtils.showToast('Ошибка копирования', 'error'));
        });
    }
    
    window.UIFeedbackModal = {
        openFullModal,
        renderPostBody,
        invalidateCache,
        updateCommentsCache
    };
})();