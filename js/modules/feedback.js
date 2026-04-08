// feedback-ui.js – полный, рабочий, с правильным рендером поста
(function() {
    const REACTION_TYPES = [
        { content: '+1', emoji: '👍' }, { content: '-1', emoji: '👎' }, { content: 'laugh', emoji: '😄' },
        { content: 'confused', emoji: '😕' }, { content: 'heart', emoji: '❤️' }, { content: 'hooray', emoji: '🎉' },
        { content: 'rocket', emoji: '🚀' }, { content: 'eyes', emoji: '👀' }
    ];
    const reactionLocks = new Map();
    let commentsCache = new Map();

    // ---------- Реакции (полностью из оригинала) ----------
    function groupReactions(reactions, currentUser) {
        const grouped = {};
        REACTION_TYPES.forEach(type => grouped[type.content] = { content: type.content, emoji: type.emoji, count: 0, userReacted: false, userReactionId: null });
        reactions.forEach(r => {
            if (r.content.startsWith('vote:')) return;
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

    function showReactionMenu(relativeTo, issueNumber, callback) {
        document.querySelectorAll('.reaction-menu').forEach(m => m.remove());
        const menu = document.createElement('div');
        menu.className = 'reaction-menu';
        menu.setAttribute('role', 'menu');
        Object.assign(menu.style, { position: 'absolute', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '30px', padding: '5px', display: 'flex', gap: '5px', zIndex: '10010', boxShadow: 'var(--shadow)' });
        REACTION_TYPES.forEach(type => {
            const btn = document.createElement('button');
            btn.className = 'reaction-menu-btn';
            btn.innerHTML = type.emoji;
            btn.setAttribute('role', 'menuitem');
            btn.tabIndex = -1;
            btn.onclick = (e) => { e.stopPropagation(); callback(type.content); document.body.removeChild(menu); relativeTo.focus(); };
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
            const idx = items.indexOf(current);
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); if (idx < items.length-1) items[idx+1].focus(); else items[0].focus(); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); if (idx > 0) items[idx-1].focus(); else items[items.length-1].focus(); }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (current) current.click(); }
            else if (e.key === 'Escape') { e.preventDefault(); document.body.removeChild(menu); relativeTo.focus(); }
        };
        menu.addEventListener('keydown', handleKeyDown);
        const closeMenu = (e) => { if (!menu.contains(e.target) && document.body.contains(menu)) { document.body.removeChild(menu); document.removeEventListener('click', closeMenu); menu.removeEventListener('keydown', handleKeyDown); relativeTo.focus(); } };
        setTimeout(() => document.addEventListener('click', closeMenu), 100);
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
                const content = btn.dataset.content, reactionId = btn.dataset.reactionId, isActive = btn.classList.contains('active');
                const countSpan = btn.querySelector('.reaction-count'), oldCount = parseInt(countSpan.textContent, 10);
                const lockKey = `${issueNumber}_${content}`;
                if (reactionLocks.has(lockKey)) return;
                if (isActive && reactionId) {
                    reactionLocks.set(lockKey, true);
                    btn.classList.remove('active');
                    countSpan.textContent = oldCount - 1;
                    const wasZero = oldCount - 1 === 0;
                    if (wasZero) btn.style.display = 'none';
                    try { await onRemove(issueNumber, parseInt(reactionId, 10)); } catch(err) { UIUtils.showToast('Ошибка при удалении реакции', 'error'); btn.classList.add('active'); countSpan.textContent = oldCount; if (wasZero) btn.style.display = ''; } finally { reactionLocks.delete(lockKey); }
                } else if (!isActive) {
                    reactionLocks.set(lockKey, true);
                    btn.classList.add('active');
                    countSpan.textContent = oldCount + 1;
                    btn.dataset.reactionId = 'temp';
                    try { await onAdd(issueNumber, content); } catch(err) { UIUtils.showToast('Ошибка при добавлении реакции', 'error'); btn.classList.remove('active'); countSpan.textContent = oldCount; btn.dataset.reactionId = ''; } finally { reactionLocks.delete(lockKey); }
                }
            });
        });

        const addBtn = container.querySelector('[data-add],[data-more]');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showReactionMenu(addBtn, issueNumber, async (selected) => {
                    const lockKey = `${issueNumber}_${selected}`;
                    if (reactionLocks.has(lockKey)) return;
                    reactionLocks.set(lockKey, true);
                    const existingBtn = Array.from(container.querySelectorAll('.reaction-button')).find(btn => btn.dataset.content === selected);
                    if (existingBtn) {
                        if (existingBtn.classList.contains('active')) { reactionLocks.delete(lockKey); return; }
                        const countSpan = existingBtn.querySelector('.reaction-count'), oldCount = parseInt(countSpan.textContent, 10);
                        existingBtn.classList.add('active');
                        countSpan.textContent = oldCount + 1;
                        existingBtn.dataset.reactionId = 'temp';
                        try { await onAdd(issueNumber, selected); } catch(err) { UIUtils.showToast('Ошибка при добавлении реакции', 'error'); existingBtn.classList.remove('active'); countSpan.textContent = oldCount; existingBtn.dataset.reactionId = ''; } finally { reactionLocks.delete(lockKey); }
                    } else {
                        const tempBtn = document.createElement('button');
                        tempBtn.className = 'reaction-button active';
                        tempBtn.dataset.content = selected;
                        tempBtn.dataset.reactionId = 'temp';
                        const emoji = REACTION_TYPES.find(t => t.content === selected).emoji;
                        tempBtn.innerHTML = `<span class="reaction-emoji">${emoji}</span><span class="reaction-count">1</span>`;
                        container.insertBefore(tempBtn, addBtn);
                        try { await onAdd(issueNumber, selected); } catch(err) { UIUtils.showToast('Ошибка при добавлении реакции', 'error'); if (tempBtn.parentNode) tempBtn.remove(); } finally { reactionLocks.delete(lockKey); }
                    }
                });
            });
        }
    }

    // ---------- Опросы ----------
    function extractPollFromBody(body) {
        const match = body?.match(/<!-- poll: (.*?) -->/);
        return match ? JSON.parse(match[1]) : null;
    }

    async function renderPoll(container, issueNumber, pollData) {
        const currentUser = GithubAuth.getCurrentUser();
        const comments = await GithubAPI.loadComments(issueNumber);
        const voteComments = comments.filter(c => /^!vote \d+$/.test(c.body.trim()));
        const voteCounts = pollData.options.map((_, idx) => voteComments.filter(c => c.body.trim() === `!vote ${idx}`).length);
        const totalVotes = voteCounts.reduce((s,v)=>s+v,0);
        const userVoted = currentUser ? voteComments.some(c => c.user.login === currentUser) : false;
        const pollDiv = document.createElement('div');
        pollDiv.className = 'poll card';
        let html = `<h3>📊 ${GithubCore.escapeHtml(pollData.question)}</h3><div class="poll-options">`;
        pollData.options.forEach((option, index) => {
            const count = voteCounts[index], percent = totalVotes > 0 ? Math.round((count/totalVotes)*100) : 0;
            html += `<div class="poll-option" data-index="${index}"><div class="poll-option-text">${GithubCore.escapeHtml(option)}</div>`;
            if (!currentUser) {}
            else if (!userVoted) html += `<button class="button poll-vote-btn" data-option="${index}">Голосовать</button>`;
            else html += `<div class="progress-bar"><div style="width:${percent}%;">${percent}% (${count})</div></div>`;
            html += '</div>';
        });
        html += '</div>';
        if (!currentUser) html += '<p class="text-secondary small" style="margin-top:15px;"><i class="fas fa-info-circle"></i> Чтобы участвовать в опросе, <a href="#" id="poll-login-link">войдите в аккаунт</a>.</p>';
        else if (!userVoted) html += '<p class="text-secondary small" style="margin-top:10px;">Вы ещё не голосовали.</p>';
        pollDiv.innerHTML = html;
        container.innerHTML = '';
        container.appendChild(pollDiv);
        if (currentUser && !userVoted) {
            pollDiv.querySelectorAll('.poll-vote-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const optionIndex = btn.dataset.option;
                    btn.disabled = true;
                    try {
                        await GithubAPI.addComment(issueNumber, `!vote ${optionIndex}`);
                        UIUtils.showToast('Голос учтён', 'success');
                        await renderPoll(container, issueNumber, pollData);
                    } catch(err) { UIUtils.showToast('Ошибка при голосовании', 'error'); await renderPoll(container, issueNumber, pollData); }
                });
            });
        }
        const loginLink = pollDiv.querySelector('#poll-login-link');
        if (loginLink) loginLink.addEventListener('click', (e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('github-login-requested')); });
    }

    function renderStaticPoll(container, pollData) {
        const pollDiv = document.createElement('div');
        pollDiv.className = 'poll card';
        pollDiv.innerHTML = `<h3>📊 ${GithubCore.escapeHtml(pollData.question)}</h3><div class="poll-options static">${pollData.options.map(opt => `<div class="poll-option"><span class="poll-option-text">${GithubCore.escapeHtml(opt)}</span></div>`).join('')}</div><p class="text-secondary small">(опрос будет доступен после публикации)</p>`;
        container.appendChild(pollDiv);
    }

    // ---------- Ссылки на посты в комментариях ----------
    async function loadPostByNumber(issueNumber) {
        const cacheKey = `post_${issueNumber}`;
        let cached = window.Cache ? window.Cache.get(cacheKey) : null;
        if (cached) return cached;
        const issue = await GithubAPI.loadIssue(issueNumber);
        const postData = {
            number: issue.number, title: issue.title, body: issue.body, author: issue.user.login,
            date: new Date(issue.created_at), labels: issue.labels.map(l => l.name),
            game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null
        };
        if (window.Cache) window.Cache.set(cacheKey, postData);
        return postData;
    }

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

    async function renderMiniPostCard(container, postNumber) {
        const post = await loadPostByNumber(postNumber);
        if (!post) return;
        const typeLabel = post.labels.find(l => l.startsWith('type:'))?.split(':')[1] || 'post';
        const typeIcon = { idea:'💡', bug:'🐛', review:'⭐', news:'📰', update:'🔄', support:'🛟' }[typeLabel] || '📌';
        const card = document.createElement('div');
        card.className = 'mini-post-card';
        card.innerHTML = `<div style="display: flex; align-items: center; gap: 12px;"><span style="font-size: 24px;">${typeIcon}</span><div style="flex:1;"><div style="font-weight: bold; color: var(--accent);">${GithubCore.escapeHtml(post.title)}</div><div style="font-size: 12px; color: var(--text-secondary);">${GithubCore.escapeHtml(post.author)} · ${post.date.toLocaleDateString()}</div></div><i class="fas fa-external-link-alt" style="color: var(--text-secondary);"></i></div>`;
        card.addEventListener('click', () => openFullModal({ type: 'issue', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game, labels: post.labels }));
        container.appendChild(card);
    }

    async function processCommentLinks(commentBody, container) {
        const links = extractPostLinks(commentBody);
        for (const link of links) await renderMiniPostCard(container, link);
    }

    // ---------- Комментарии (оригинальный вид) ----------
    async function renderComments(container, comments, currentUser, issueNumber) {
        const regularComments = comments.filter(c => !c.body.trim().startsWith('!vote'));
        container.innerHTML = '';
        for (const c of regularComments) {
            const commentDiv = document.createElement('div');
            commentDiv.className = 'comment';
            commentDiv.dataset.commentId = c.id;
            const isAuthor = currentUser && c.user.login === currentUser;
            const canEditDelete = isAuthor || GithubAuth.isAdmin();
            let actionsHtml = '';
            if (canEditDelete) actionsHtml = `<div class="comment-actions"><button class="comment-edit" data-comment-id="${c.id}" data-comment-body="${GithubCore.escapeHtml(c.body)}" title="Редактировать"><i class="fas fa-edit"></i></button><button class="comment-delete" data-comment-id="${c.id}" title="Удалить"><i class="fas fa-trash-alt"></i></button></div>`;
            commentDiv.innerHTML = `<div class="comment-meta"><span class="comment-author">${GithubCore.escapeHtml(c.user.login)}</span><span class="comment-date">${new Date(c.created_at).toLocaleString()}</span></div><div class="comment-body">${GithubCore.escapeHtml(c.body).replace(/\n/g,'<br>')}</div><div class="comment-mini-cards"></div>${actionsHtml}`;
            container.appendChild(commentDiv);
            await processCommentLinks(c.body, commentDiv.querySelector('.comment-mini-cards'));
        }
        if (currentUser) {
            container.querySelectorAll('.comment-edit').forEach(btn => {
                btn.addEventListener('click', (e) => { e.stopPropagation(); openEditCommentModal(btn.dataset.commentId, btn.dataset.commentBody, issueNumber); });
            });
            container.querySelectorAll('.comment-delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const commentDiv = btn.closest('.comment');
                    const commentId = btn.dataset.commentId;
                    commentDiv.remove();
                    try {
                        await GithubAPI.deleteComment(commentId);
                        invalidateCache(issueNumber);
                        UIUtils.showToast('Комментарий удалён', 'success');
                    } catch(err) { UIUtils.showToast('Ошибка при удалении', 'error'); if (!commentDiv.parentNode) container.appendChild(commentDiv); }
                });
            });
        }
    }

    function openEditCommentModal(commentId, currentBody, issueNumber) {
        const modalHtml = `<div class="feedback-form"><div id="modal-editor-toolbar"></div><textarea id="edit-comment-body" class="feedback-textarea" rows="10">${GithubCore.escapeHtml(currentBody)}</textarea><div class="preview-area" id="modal-preview-area" style="display:none;"></div><div class="button-group" style="margin-top:15px;"><button class="button" id="edit-comment-save">Сохранить</button><button class="button" id="edit-comment-cancel">Отмена</button></div></div>`;
        const { modal, closeModal } = UIUtils.createModal('Редактировать комментарий', modalHtml, { size: 'full' });
        const textarea = modal.querySelector('#edit-comment-body');
        const previewArea = modal.querySelector('#modal-preview-area');
        const toolbarContainer = modal.querySelector('#modal-editor-toolbar');
        if (window.EditorToolbar) {
            const updatePreview = () => {
                if (textarea.value.trim()) {
                    previewArea.innerHTML = '';
                    previewArea.classList.add('markdown-body');
                    GithubCore.renderMarkdown(textarea.value).then(html => { previewArea.innerHTML = html; previewArea.style.display = 'block'; });
                } else previewArea.style.display = 'none';
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
                invalidateCache(issueNumber);
                const updated = await GithubAPI.loadComments(issueNumber);
                commentsCache.set(`comments_${issueNumber}`, { data: updated, timestamp: Date.now() });
                const commentsContainer = document.querySelector('.feedback-comments');
                if (commentsContainer) renderComments(commentsContainer, updated, GithubAuth.getCurrentUser(), issueNumber);
                closeModal();
                UIUtils.showToast('Комментарий обновлён', 'success');
            } catch(err) { UIUtils.showToast('Ошибка при сохранении', 'error'); saveBtn.disabled = false; }
        });
        cancelBtn.addEventListener('click', closeModal);
    }

    // ---------- Кеширование ----------
    function invalidateCache(issueNumber) {
        if (window.Cache) { window.Cache.remove(`reactions_${issueNumber}`); window.Cache.remove(`comments_${issueNumber}`); window.Cache.remove(`post_${issueNumber}`); }
        commentsCache.delete(`comments_${issueNumber}`);
    }

    async function loadReactionsWithCache(issueNumber) {
        const cacheKey = `reactions_${issueNumber}`;
        let cached = window.Cache ? window.Cache.get(cacheKey) : null;
        if (cached) return cached;
        const reactions = await GithubAPI.loadReactions(issueNumber);
        if (window.Cache) window.Cache.set(cacheKey, reactions);
        return reactions;
    }

    async function loadCommentsWithCache(issueNumber) {
        const cacheKey = `comments_${issueNumber}`;
        const cached = commentsCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) return cached.data;
        const comments = await GithubAPI.loadComments(issueNumber);
        commentsCache.set(cacheKey, { data: comments, timestamp: Date.now() });
        return comments;
    }

    // ---------- Рендер тела поста (Markdown + опросы + ссылки) ----------
    async function renderPostBody(container, body, issueNumber) {
        if (!window.marked) {
            // fallback, если marked не загрузился
            container.innerHTML = `<div class="error-message">Ошибка загрузки разметки. Попробуйте обновить страницу.</div>`;
            return;
        }
        let html = await GithubCore.renderMarkdown(body);
        container.innerHTML = html;
        if (!container.classList.contains('markdown-body')) container.classList.add('markdown-body');
        const images = container.querySelectorAll('img:not([loading])');
        images.forEach(img => img.setAttribute('loading', 'lazy'));
        const pollData = extractPollFromBody(body);
        if (pollData) {
            const pollContainer = document.createElement('div');
            pollContainer.className = 'poll-container';
            container.appendChild(pollContainer);
            if (issueNumber) await renderPoll(pollContainer, issueNumber, pollData);
            else renderStaticPoll(pollContainer, pollData);
        }
        const links = extractPostLinks(body);
        for (const link of links) await renderMiniPostCard(container, link);
    }

    // ---------- Модальное окно полного поста (как в оригинале) ----------
    async function openFullModal(item) {
        const currentUser = GithubAuth.getCurrentUser();
        const { modal, closeModal } = UIUtils.createModal(item.title, '<div class="loading-spinner" id="modal-loader"><i class="fas fa-circle-notch fa-spin"></i></div>', { size: 'full' });
        const container = modal.querySelector('.modal-body');
        const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
        document.addEventListener('keydown', escHandler);
        try {
            const issue = await GithubAPI.loadIssue(item.id);
            if (issue.state === 'closed') { container.innerHTML = '<p class="error-message">Этот пост был закрыт и больше не доступен.</p>'; return; }
            container.innerHTML = '';
            
            // Шапка поста (аватар, автор, тип, игра)
            const header = document.createElement('div');
            header.className = 'modal-post-header';
            Object.assign(header.style, { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' });
            let typeIcon = '';
            if (item.labels?.includes('type:news')) typeIcon = '📰';
            else if (item.labels?.includes('type:update')) typeIcon = '🔄';
            else if (item.labels?.includes('type:idea')) typeIcon = '💡';
            else if (item.labels?.includes('type:bug')) typeIcon = '🐛';
            else if (item.labels?.includes('type:review')) typeIcon = '⭐';
            else if (item.labels?.includes('type:support')) typeIcon = '🛟';
            else typeIcon = '📌';
            header.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;">
                    <span style="font-size:32px;">${typeIcon}</span>
                    <div>
                        <div style="font-weight:bold;color:var(--accent);">${GithubCore.escapeHtml(item.author || 'Unknown')}</div>
                        <div style="font-size:12px;color:var(--text-secondary);">${new Date(issue.created_at).toLocaleString()}</div>
                    </div>
                </div>
                <div style="margin-left:auto; display:flex; gap:8px;">
                    ${item.game ? `<span class="feedback-label" style="background:var(--accent);color:white;">${GithubCore.escapeHtml(item.game)}</span>` : ''}
                </div>
            `;
            container.appendChild(header);
            
            // Кнопки действий в заголовке модалки (редактировать, закрыть, поделиться)
            const modalHeader = modal.querySelector('.modal-header');
            if (modalHeader) addHeaderActions(modalHeader, item, issue, currentUser, closeModal, escHandler);
            
            // Тело поста
            await renderPostBody(container, issue.body, item.id);
            
            // Реакции
            const reactionsDiv = document.createElement('div'); reactionsDiv.className = 'reactions-container';
            const commentsDiv = document.createElement('div'); commentsDiv.className = 'feedback-comments';
            container.appendChild(reactionsDiv);
            container.appendChild(commentsDiv);
            
            const reactions = await loadReactionsWithCache(item.id);
            const handleAdd = async (num, content) => { await GithubAPI.addReaction(num, content); invalidateCache(num); };
            const handleRemove = async (num, reactionId) => { await GithubAPI.removeReaction(num, reactionId); invalidateCache(num); };
            renderReactions(reactionsDiv, item.id, reactions, currentUser, handleAdd, handleRemove);
            
            // Комментарии
            const comments = await loadCommentsWithCache(item.id);
            renderComments(commentsDiv, comments, currentUser, item.id);
            
            // Форма добавления комментария
            if (currentUser) setupCommentForm(container, item, currentUser);
        } catch(err) {
            console.error(err);
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
        submitBtn.addEventListener('click', async () => {
            const comment = input.value.trim();
            if (!comment) return;
            const tempDiv = document.createElement('div');
            tempDiv.className = 'comment';
            tempDiv.dataset.commentId = 'temp-' + Date.now();
            tempDiv.innerHTML = `<div class="comment-meta"><span class="comment-author">${GithubCore.escapeHtml(currentUser)}</span></div><div>${GithubCore.escapeHtml(comment).replace(/\n/g,'<br>')}</div><div class="comment-mini-cards"></div>`;
            const commentsDiv = container.querySelector('.feedback-comments');
            commentsDiv.appendChild(tempDiv);
            input.disabled = true; submitBtn.disabled = true; editorBtn.disabled = true;
            try {
                const newComment = await GithubAPI.addComment(item.id, comment);
                invalidateCache(item.id);
                const updated = await GithubAPI.loadComments(item.id);
                commentsCache.set(`comments_${item.id}`, { data: updated, timestamp: Date.now() });
                renderComments(commentsDiv, updated, currentUser, item.id);
                UIUtils.showToast('Комментарий добавлен', 'success');
            } catch(err) { UIUtils.showToast('Ошибка при отправке комментария', 'error'); tempDiv.remove(); }
            finally { input.disabled = false; submitBtn.disabled = false; editorBtn.disabled = false; input.value = ''; }
        });
        editorBtn.addEventListener('click', () => window.dispatchEvent(new CustomEvent('open-comment-editor', { detail: { issueNumber: item.id } })));
    }

    function addHeaderActions(modalHeader, item, issue, currentUser, closeModal, escHandler) {
        const isAdmin = GithubAuth.isAdmin();
        const postUrl = `${window.location.origin}${window.location.pathname}?post=${item.id}`;
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'modal-header-actions';
        let buttonsHtml = '';
        if (isAdmin || (currentUser && issue.user.login === currentUser)) buttonsHtml += `<button class="action-btn edit-issue" title="Редактировать"><i class="fas fa-edit"></i></button><button class="action-btn close-issue" title="Закрыть"><i class="fas fa-trash-alt"></i></button>`;
        buttonsHtml += `<button class="action-btn share-post" title="Поделиться"><i class="fas fa-share-alt"></i></button>`;
        actionsContainer.innerHTML = buttonsHtml;
        const closeBtn = modalHeader.querySelector('.modal-close');
        if (closeBtn) modalHeader.insertBefore(actionsContainer, closeBtn);
        else modalHeader.appendChild(actionsContainer);
        actionsContainer.querySelector('.edit-issue')?.addEventListener('click', (e) => {
            e.stopPropagation(); closeModal(); document.removeEventListener('keydown', escHandler);
            let postType = 'feedback';
            if (item.labels?.includes('type:news')) postType = 'news';
            else if (item.labels?.includes('type:update')) postType = 'update';
            else if (item.labels?.includes('type:support')) postType = 'support';
            if (window.UIFeedback && window.UIFeedback.openEditorModal) window.UIFeedback.openEditorModal('edit', { number: item.id, title: issue.title, body: issue.body, game: item.game }, postType);
        });
        actionsContainer.querySelector('.close-issue')?.addEventListener('click', async () => {
            if (!confirm('Закрыть пост?')) return;
            try {
                await GithubAPI.closeIssue(item.id);
                closeModal(); document.removeEventListener('keydown', escHandler);
                if (window.refreshNewsFeed) window.refreshNewsFeed();
                if (window.refreshGameUpdates && item.game) window.refreshGameUpdates(item.game);
                UIUtils.showToast('Пост закрыт', 'success');
            } catch(err) { UIUtils.showToast('Ошибка при закрытии', 'error'); }
        });
        actionsContainer.querySelector('.share-post')?.addEventListener('click', () => {
            navigator.clipboard.writeText(postUrl).then(() => UIUtils.showToast('Ссылка скопирована', 'success')).catch(() => UIUtils.showToast('Ошибка копирования', 'error'));
        });
    }

    window.UIFeedbackModal = { openFullModal, renderPostBody, invalidateCache, updateCommentsCache: (num, comments) => commentsCache.set(`comments_${num}`, { data: comments, timestamp: Date.now() }) };
    window.FeedbackComments = { renderComments, openEditCommentModal, processCommentLinks, extractPostLinks, renderMiniPostCard };
    window.FeedbackReactions = { REACTION_TYPES, renderReactions, showReactionMenu };
    window.FeedbackPolls = { extractPollFromBody, renderPoll, renderStaticPoll };
})();