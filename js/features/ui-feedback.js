(function() {
    const REACTION_TYPES = [
        { content: '+1', emoji: '👍' }, { content: '-1', emoji: '👎' }, { content: 'laugh', emoji: '😄' },
        { content: 'confused', emoji: '😕' }, { content: 'heart', emoji: '❤️' }, { content: 'hooray', emoji: '🎉' },
        { content: 'rocket', emoji: '🚀' }, { content: 'eyes', emoji: '👀' }
    ];

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
        let html = visible.map(g => `<button class="reaction-button ${g.userReacted ? 'active' : ''}" data-content="${g.content}" data-reaction-id="${g.userReactionId||''}" data-count="${g.count}" ${!currentUser ? 'disabled' : ''}><span class="reaction-emoji">${g.emoji}</span><span class="reaction-count">${g.count}</span></button>`).join('');
        if (currentUser) html += hiddenCount > 0 ? `<button class="reaction-add-btn" data-more><span>+${hiddenCount}</span></button>` : `<button class="reaction-add-btn" data-add><span>+</span></button>`;
        container.innerHTML = html;
        if (!currentUser) return;
        container.querySelectorAll('.reaction-button:not([disabled])').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const content = btn.dataset.content, reactionId = btn.dataset.reactionId, isActive = btn.classList.contains('active');
                if (isActive && reactionId) { try { await onRemove(issueNumber, parseInt(reactionId,10)); } catch {} }
                else { showReactionMenu(container, issueNumber, async (selected) => { try { await onAdd(issueNumber, selected); } catch {} }); }
            });
        });
        const addBtn = container.querySelector('[data-add],[data-more]');
        if (addBtn) addBtn.addEventListener('click', (e) => { e.stopPropagation(); showReactionMenu(container, issueNumber, async (selected) => { try { await onAdd(issueNumber, selected); } catch {} }); });
    }

    function showReactionMenu(relativeTo, issueNumber, callback) {
        document.querySelectorAll('.reaction-menu').forEach(m => m.remove());
        const menu = document.createElement('div'); menu.className = 'reaction-menu';
        Object.assign(menu.style, { position:'absolute', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'30px', padding:'5px', display:'flex', gap:'5px', zIndex:'1000', boxShadow:'var(--shadow)' });
        REACTION_TYPES.forEach(type => {
            const btn = document.createElement('button'); btn.className = 'reaction-menu-btn'; btn.innerHTML = type.emoji;
            btn.onclick = (e) => { e.stopPropagation(); callback(type.content); document.body.removeChild(menu); };
            menu.appendChild(btn);
        });
        const rect = relativeTo.getBoundingClientRect();
        menu.style.left = rect.left + 'px'; menu.style.top = (rect.bottom + window.scrollY + 5) + 'px';
        document.body.appendChild(menu);
        setTimeout(() => { const close = (e) => { if (!menu.contains(e.target) && document.body.contains(menu)) { document.body.removeChild(menu); document.removeEventListener('click', close); } }; document.addEventListener('click', close); }, 100);
    }

    function renderComments(container, comments) {
        container.innerHTML = comments.map(c => `<div class="comment" data-comment-id="${c.id}"><div class="comment-meta"><span class="comment-author">${GithubCore.escapeHtml(c.user.login)}</span><span>${new Date(c.created_at).toLocaleString()}</span></div><div>${GithubCore.escapeHtml(c.body).replace(/\n/g,'<br>')}</div></div>`).join('');
    }

    async function openFullModal(item) {
        const { loadIssue, loadComments, loadReactions, addReaction, removeReaction, addComment, closeIssue } = GithubAPI;
        const currentUser = GithubAuth.getCurrentUser();
        const isAdmin = GithubAuth.isAdmin();
        const modal = document.createElement('div'); modal.className = 'modal modal-fullscreen';
        modal.innerHTML = `<div class="modal-content modal-content-full"><div class="modal-header"><h2>${GithubCore.escapeHtml(item.title)}</h2><button class="modal-close"><i class="fas fa-times"></i></button></div><div class="modal-body" id="modal-body-${item.id}"><div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        const closeModal = () => { modal.remove(); document.body.style.overflow = ''; };
        modal.querySelector('.modal-close').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        const escHandler = (e) => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);
        const container = document.getElementById(`modal-body-${item.id}`);
        try {
            const issue = await loadIssue(item.id);
            const bodyDiv = document.createElement('div'); bodyDiv.className = 'spoiler-content'; bodyDiv.innerHTML = GithubCore.renderMarkdown(issue.body);
            const reactionsDiv = document.createElement('div'); reactionsDiv.className = 'reactions-container';
            const commentsDiv = document.createElement('div'); commentsDiv.className = 'feedback-comments';
            const commentForm = document.createElement('div'); commentForm.className = 'comment-form'; commentForm.dataset.issue = item.id;
            commentForm.innerHTML = `<input type="text" class="comment-input" placeholder="Написать комментарий..."><button class="button comment-submit">Отправить</button>`;
            const actionButtons = document.createElement('div'); actionButtons.className = 'feedback-item-actions';
            if (isAdmin || (currentUser && issue.user.login === currentUser)) actionButtons.innerHTML = `<button class="edit-issue" title="Редактировать"><i class="fas fa-edit"></i></button><button class="close-issue" title="Закрыть"><i class="fas fa-trash-alt"></i></button>`;
            container.innerHTML = ''; container.append(bodyDiv, reactionsDiv);
            if (actionButtons.innerHTML) container.appendChild(actionButtons);
            container.appendChild(commentsDiv);
            if (currentUser) container.appendChild(commentForm);
            const reactions = await loadReactions(item.id);
            const handleAdd = async (num, content) => { try { await addReaction(num, content); const updated = await loadReactions(num); renderReactions(reactionsDiv, num, updated, currentUser, handleAdd, handleRemove); } catch {} };
            const handleRemove = async (num, reactionId) => { try { await removeReaction(num, reactionId); const updated = await loadReactions(num); renderReactions(reactionsDiv, num, updated, currentUser, handleAdd, handleRemove); } catch {} };
            renderReactions(reactionsDiv, item.id, reactions, currentUser, handleAdd, handleRemove);
            const comments = await loadComments(item.id); renderComments(commentsDiv, comments);
            commentForm.querySelector('.comment-submit')?.addEventListener('click', async (e) => {
                e.stopPropagation(); const input = commentForm.querySelector('.comment-input'); const comment = input.value.trim();
                if (!comment) return; input.disabled = true; e.target.disabled = true;
                try { await addComment(item.id, comment); const updated = await loadComments(item.id); renderComments(commentsDiv, updated); input.value = ''; } catch { alert('Ошибка'); } finally { input.disabled = false; e.target.disabled = false; }
            });
            if (actionButtons.innerHTML) {
                actionButtons.querySelector('.edit-issue')?.addEventListener('click', (e) => { e.stopPropagation(); closeModal(); document.removeEventListener('keydown', escHandler); 
                    // Determine post type
                    let postType = 'feedback';
                    if (item.labels?.includes('type:news')) postType = 'news';
                    else if (item.labels?.includes('type:update')) postType = 'update';
                    openEditorModal('edit', { number: item.id, title: issue.title, body: issue.body, game: item.game }, postType);
                });
                actionButtons.querySelector('.close-issue')?.addEventListener('click', async (e) => {
                    e.stopPropagation(); if (!confirm('Закрыть?')) return; try { await closeIssue(item.id); closeModal(); document.removeEventListener('keydown', escHandler); if (window.refreshNewsFeed) window.refreshNewsFeed(); if (window.refreshGameUpdates && item.game) window.refreshGameUpdates(item.game); } catch { alert('Ошибка'); }
                });
            }
        } catch (err) { container.innerHTML = '<p class="error-message">Ошибка загрузки</p>'; }
    }

    // Enhanced editor modal with type support
    function openEditorModal(mode, data, postType = 'feedback') {
        const modal = document.createElement('div'); modal.className = 'modal modal-fullscreen';
        // Build inner HTML based on postType
        let categoryHtml = '';
        if (postType === 'feedback') {
            categoryHtml = `<select id="modal-category" class="feedback-select">
                <option value="idea">💡 Идея</option>
                <option value="bug">🐛 Баг</option>
                <option value="review">⭐ Отзыв</option>
            </select>`;
        }
        // For updates, we don't show game select; game is taken from page (data attribute)
        // For news, no game.
        modal.innerHTML = `<div class="modal-content modal-content-full"><div class="modal-header"><h2>${mode==='edit'?'Редактирование':'Новое сообщение'}</h2><button class="modal-close"><i class="fas fa-times"></i></button></div><div class="modal-body"><div class="feedback-form"><input type="text" id="modal-title" class="feedback-input" placeholder="Заголовок" value="${GithubCore.escapeHtml(data.title||'')}">${categoryHtml}<div id="modal-editor-toolbar"></div><textarea id="modal-body" class="feedback-textarea" placeholder="Описание..." rows="10">${GithubCore.escapeHtml(data.body||'')}</textarea><div class="preview-area" id="modal-preview-area" style="display:none;"></div><div class="button-group"><button class="button button-secondary" id="modal-cancel">Отмена</button><button class="button" id="modal-submit">${mode==='edit'?'Сохранить':'Опубликовать'}</button></div></div></div></div>`;
        document.body.appendChild(modal); document.body.style.overflow = 'hidden';
        const closeModal = () => { modal.remove(); document.body.style.overflow = ''; };
        modal.querySelector('.modal-close').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        const escHandler = (e) => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);
        const textarea = document.getElementById('modal-body');
        if (window.Editor) {
            const toolbar = Editor.createEditorToolbar(textarea, { previewAreaId: 'modal-preview-area', onPreview: () => {
                const preview = document.getElementById('modal-preview-area');
                preview.innerHTML = GithubCore.renderMarkdown(textarea.value);
                preview.style.display = textarea.value.trim() ? 'block' : 'none';
            }});
            document.getElementById('modal-editor-toolbar').appendChild(toolbar);
        }
        document.getElementById('modal-cancel').addEventListener('click', closeModal);
        document.getElementById('modal-submit').addEventListener('click', async () => {
            const title = document.getElementById('modal-title').value.trim();
            const body = document.getElementById('modal-body').value;
            if (!title || !body.trim()) { alert('Заполните всё'); return; }
            let category = 'idea';
            if (postType === 'feedback') {
                category = document.getElementById('modal-category').value;
            }
            const btn = document.getElementById('modal-submit'); btn.disabled = true; btn.textContent = 'Сохранение...';
            try {
                let labels;
                if (postType === 'feedback') {
                    labels = [`game:${data.game}`, `type:${category}`];
                } else if (postType === 'news') {
                    labels = ['type:news'];
                } else { // update
                    labels = ['type:update', `game:${data.game}`];
                }
                if (mode === 'edit') await GithubAPI.updateIssue(data.number, { title, body, labels });
                else await GithubAPI.createIssue(title, body, labels);
                closeModal(); document.removeEventListener('keydown', escHandler);
                if (postType === 'feedback' && window.refreshNewsFeed) window.refreshNewsFeed();
                if (postType === 'update' && window.refreshGameUpdates) window.refreshGameUpdates(data.game);
                if (postType === 'news' && window.refreshNewsFeed) window.refreshNewsFeed();
            } catch (err) { alert('Ошибка: '+err.message); } finally { btn.disabled = false; btn.textContent = mode==='edit'?'Сохранить':'Опубликовать'; }
        });
    }

    window.UIFeedback = { renderReactions, showReactionMenu, renderComments, openFullModal, openEditorModal, REACTION_TYPES };
})();