(function() {
    const REACTION_TYPES = [
        { content: '+1', emoji: '👍' }, { content: '-1', emoji: '👎' }, { content: 'laugh', emoji: '😄' },
        { content: 'confused', emoji: '😕' }, { content: 'heart', emoji: '❤️' }, { content: 'hooray', emoji: '🎉' },
        { content: 'rocket', emoji: '🚀' }, { content: 'eyes', emoji: '👀' }
    ];
    const CACHE_TTL = 5 * 60 * 1000;
    const reactionsCache = new Map();
    const commentsCache = new Map();
    const reactionLocks = new Map();

    function getCached(key, cacheMap) {
        const cached = cacheMap.get(key);
        return (cached && Date.now() - cached.timestamp < CACHE_TTL) ? cached.data : null;
    }
    function setCached(key, data, cacheMap) { cacheMap.set(key, { data, timestamp: Date.now() }); }
    function invalidateCache(issueNumber) {
        reactionsCache.delete(`reactions_${issueNumber}`);
        commentsCache.delete(`comments_${issueNumber}`);
        if (window.reactionsListCache) window.reactionsListCache.delete(`list_reactions_${issueNumber}`);
    }

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
                    try {
                        await onRemove(issueNumber, parseInt(reactionId, 10));
                    } catch (err) {
                        UIUtils.showToast('Ошибка при удалении реакции', 'error');
                        btn.classList.add('active');
                        countSpan.textContent = oldCount;
                        if (wasZero) btn.style.display = '';
                    } finally {
                        reactionLocks.delete(lockKey);
                    }
                } else if (!isActive) {
                    reactionLocks.set(lockKey, true);
                    btn.classList.add('active');
                    countSpan.textContent = oldCount + 1;
                    btn.dataset.reactionId = 'temp';
                    try {
                        await onAdd(issueNumber, content);
                    } catch (err) {
                        UIUtils.showToast('Ошибка при добавлении реакции', 'error');
                        btn.classList.remove('active');
                        countSpan.textContent = oldCount;
                        btn.dataset.reactionId = '';
                    } finally {
                        reactionLocks.delete(lockKey);
                    }
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
                        if (existingBtn.classList.contains('active')) {
                            reactionLocks.delete(lockKey);
                            return;
                        } else {
                            const countSpan = existingBtn.querySelector('.reaction-count'), oldCount = parseInt(countSpan.textContent, 10);
                            existingBtn.classList.add('active');
                            countSpan.textContent = oldCount + 1;
                            existingBtn.dataset.reactionId = 'temp';
                            try {
                                await onAdd(issueNumber, selected);
                            } catch (err) {
                                UIUtils.showToast('Ошибка при добавлении реакции', 'error');
                                existingBtn.classList.remove('active');
                                countSpan.textContent = oldCount;
                                existingBtn.dataset.reactionId = '';
                            } finally {
                                reactionLocks.delete(lockKey);
                            }
                        }
                    } else {
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
                        } finally {
                            reactionLocks.delete(lockKey);
                        }
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
        Object.assign(menu.style, { position: 'absolute', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '30px', padding: '5px', display: 'flex', gap: '5px', zIndex: '10010', boxShadow: 'var(--shadow)' });
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
                case 'ArrowRight': case 'ArrowDown': e.preventDefault(); if (currentIndex < items.length - 1) items[currentIndex + 1].focus(); else items[0].focus(); break;
                case 'ArrowLeft': case 'ArrowUp': e.preventDefault(); if (currentIndex > 0) items[currentIndex - 1].focus(); else items[items.length - 1].focus(); break;
                case 'Enter': case ' ': e.preventDefault(); if (current) current.click(); break;
                case 'Escape': e.preventDefault(); document.body.removeChild(menu); relativeTo.focus(); break;
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

    function renderComments(container, comments, currentUser, issueNumber) {
        const regularComments = comments.filter(c => !c.body.trim().startsWith('!vote'));
        container.innerHTML = regularComments.map(c => {
            const isAuthor = currentUser && c.user.login === currentUser;
            const isAdmin = GithubAuth.isAdmin();
            const canEditDelete = isAuthor || isAdmin;
            let actionsHtml = '';
            if (canEditDelete) {
                actionsHtml = `<div class="comment-actions"><button class="comment-edit" data-comment-id="${c.id}" data-comment-body="${GithubCore.escapeHtml(c.body)}" title="Редактировать"><i class="fas fa-edit"></i></button><button class="comment-delete" data-comment-id="${c.id}" title="Удалить"><i class="fas fa-trash-alt"></i></button></div>`;
            }
            return `<div class="comment" data-comment-id="${c.id}"><div class="comment-meta"><span class="comment-author">${GithubCore.escapeHtml(c.user.login)}</span><span>${new Date(c.created_at).toLocaleString()}</span></div><div class="comment-body">${GithubCore.escapeHtml(c.body).replace(/\n/g,'<br>')}</div>${actionsHtml}</div>`;
        }).join('');
        if (currentUser) {
            container.querySelectorAll('.comment-edit').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditCommentModal(btn.dataset.commentId, btn.dataset.commentBody, issueNumber);
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
                        invalidateCache(issueNumber);
                        UIUtils.showToast('Комментарий удалён', 'success');
                    } catch (err) {
                        UIUtils.showToast('Ошибка при удалении', 'error');
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

        if (window.Editor) {
            const updatePreview = () => {
                const text = textarea.value;
                if (text.trim()) {
                    previewArea.innerHTML = '';
                    if (!previewArea.classList.contains('markdown-body')) previewArea.classList.add('markdown-body');
                    renderPostBody(previewArea, text, null);
                    previewArea.style.display = 'block';
                } else {
                    previewArea.style.display = 'none';
                }
            };
            const toolbar = Editor.createEditorToolbar(textarea, { onPreview: updatePreview, textarea: textarea });
            toolbarContainer.appendChild(toolbar);
        }

        const saveBtn = modal.querySelector('#edit-comment-save');
        const cancelBtn = modal.querySelector('#edit-comment-cancel');

        saveBtn.addEventListener('click', async () => {
            const newBody = textarea.value.trim();
            if (!newBody) { UIUtils.showToast('Комментарий не может быть пустым', 'error'); return; }
            saveBtn.disabled = true;
            try {
                await GithubAPI.updateComment(commentId, newBody);
                invalidateCache(issueNumber);
                const updatedComments = await GithubAPI.loadComments(issueNumber);
                setCached(`comments_${issueNumber}`, updatedComments, commentsCache);
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

    function extractPollFromBody(body) {
        const regex = /<!-- poll: (.*?) -->/g;
        const match = regex.exec(body);
        if (match) { try { return JSON.parse(match[1]); } catch (e) { return null; } }
        return null;
    }

    async function renderPostBody(container, body, issueNumber) {
        let html = GithubCore.renderMarkdown(body);
        container.innerHTML = html;
        if (!container.classList.contains('markdown-body')) container.classList.add('markdown-body');
        const pollData = extractPollFromBody(body);
        if (pollData) {
            const pollContainer = document.createElement('div');
            pollContainer.className = 'poll-container';
            container.appendChild(pollContainer);
            if (issueNumber) await renderPoll(pollContainer, issueNumber, pollData);
            else renderStaticPoll(pollContainer, pollData);
        }
    }

    function renderStaticPoll(container, pollData) {
        const pollDiv = document.createElement('div');
        pollDiv.className = 'poll card';
        pollDiv.innerHTML = `<h3>📊 ${GithubCore.escapeHtml(pollData.question)}</h3><div class="poll-options static">${pollData.options.map(opt => `<div class="poll-option"><span class="poll-option-text">${GithubCore.escapeHtml(opt)}</span></div>`).join('')}</div><p class="text-secondary small">(опрос будет доступен после публикации)</p>`;
        container.appendChild(pollDiv);
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
        pollDiv.dataset.issue = issueNumber;
        pollDiv.dataset.options = JSON.stringify(pollData.options);
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
                    } catch (err) {
                        UIUtils.showToast('Ошибка при голосовании', 'error');
                        await renderPoll(container, issueNumber, pollData);
                    }
                });
            });
        }
        const loginLink = pollDiv.querySelector('#poll-login-link');
        if (loginLink) {
            loginLink.addEventListener('click', (e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('github-login-requested')); });
        }
    }

    async function loadReactionsAndComments(container, item, currentUser, issue) {
        const reactionsDiv = document.createElement('div'); reactionsDiv.className = 'reactions-container';
        const commentsDiv = document.createElement('div'); commentsDiv.className = 'feedback-comments';
        container.appendChild(reactionsDiv);
        container.appendChild(commentsDiv);
        const reactions = await loadReactionsWithCache(item.id);
        const handleAdd = async (num, content) => { try { await GithubAPI.addReaction(num, content); invalidateCache(num); } catch (err) { UIUtils.showToast('Ошибка при добавлении реакции', 'error'); throw err; } };
        const handleRemove = async (num, reactionId) => { try { await GithubAPI.removeReaction(num, reactionId); invalidateCache(num); } catch (err) { UIUtils.showToast('Ошибка при удалении реакции', 'error'); throw err; } };
        renderReactions(reactionsDiv, item.id, reactions, currentUser, handleAdd, handleRemove);
        const comments = await loadCommentsWithCache(item.id);
        renderComments(commentsDiv, comments, currentUser, item.id);
    }

    function setupCommentForm(container, item, currentUser) {
        const commentForm = document.createElement('div'); commentForm.className = 'comment-form'; commentForm.dataset.issue = item.id;
        commentForm.innerHTML = '<input type="text" class="comment-input" placeholder="Написать комментарий..."><button class="button comment-submit">Отправить</button>';
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
            tempCommentDiv.innerHTML = `<div class="comment-meta"><span class="comment-author">${GithubCore.escapeHtml(currentUser)}</span><span>только что</span></div><div>${GithubCore.escapeHtml(comment).replace(/\n/g,'<br>')}</div>`;
            const commentsDiv = container.querySelector('.feedback-comments');
            commentsDiv.appendChild(tempCommentDiv);
            input.disabled = true; e.target.disabled = true;
            try {
                const newComment = await GithubAPI.addComment(item.id, comment);
                tempCommentDiv.dataset.commentId = newComment.id;
                tempCommentDiv.querySelector('.comment-meta span:last-child').textContent = new Date(newComment.created_at).toLocaleString();
                invalidateCache(item.id);
                const updated = await GithubAPI.loadComments(item.id);
                setCached(`comments_${item.id}`, updated, commentsCache);
                renderComments(commentsDiv, updated, currentUser, item.id);
                UIUtils.showToast('Комментарий добавлен', 'success');
            } catch (err) {
                UIUtils.showToast('Ошибка при отправке комментария', 'error');
                tempCommentDiv.remove();
            } finally {
                input.disabled = false; e.target.disabled = false; input.value = '';
            }
        });
    }

    // Функция для добавления кнопок в шапку модалки
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
        modalHeader.appendChild(actionsContainer);

        actionsContainer.querySelector('.edit-issue')?.addEventListener('click', (e) => {
            e.stopPropagation(); closeModal(); document.removeEventListener('keydown', escHandler);
            let postType = 'feedback';
            if (item.labels?.includes('type:news')) postType = 'news';
            else if (item.labels?.includes('type:update')) postType = 'update';
            openEditorModal('edit', { number: item.id, title: issue.title, body: issue.body, game: item.game }, postType);
        });

        actionsContainer.querySelector('.close-issue')?.addEventListener('click', async (e) => {
            e.stopPropagation(); if (!confirm('Закрыть?')) return;
            try {
                await GithubAPI.closeIssue(item.id);
                closeModal(); document.removeEventListener('keydown', escHandler);
                if (window.refreshNewsFeed) window.refreshNewsFeed();
                if (window.refreshGameUpdates && item.game) window.refreshGameUpdates(item.game);
                UIUtils.showToast('Закрыто', 'success');
            } catch (err) { UIUtils.showToast('Ошибка при закрытии', 'error'); }
        });

        actionsContainer.querySelector('.share-post')?.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(postUrl).then(() => UIUtils.showToast('Ссылка скопирована', 'success')).catch(() => UIUtils.showToast('Ошибка копирования', 'error'));
        });
    }

    // Основная функция открытия модального окна поста
    async function openFullModal(item) {
        const currentUser = GithubAuth.getCurrentUser();
        const contentHtml = '<div class="loading-spinner" id="modal-loader"><i class="fas fa-circle-notch fa-spin"></i></div>';
        const { modal, closeModal } = UIUtils.createModal(item.title, contentHtml, { size: 'full' });
        const container = modal.querySelector('.modal-body');
        const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
        document.addEventListener('keydown', escHandler);
        try {
            const issue = await GithubAPI.loadIssue(item.id);
            
            // Проверяем, не закрыт ли issue
            if (issue.state === 'closed') {
                container.innerHTML = '<p class="error-message">Этот пост был закрыт и больше не доступен.</p>';
                return;
            }

            container.innerHTML = '';

            // Создаём шапку (без кнопок действий)
            const header = document.createElement('div');
            header.className = 'modal-post-header';
            header.style.cssText = 'display:flex;align-items:center;gap:16px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border);flex-wrap:wrap;';
            let typeIcon = '';
            if (item.labels?.includes('type:news')) typeIcon = '📰';
            else if (item.labels?.includes('type:update')) typeIcon = '🔄';
            else if (item.labels?.includes('type:idea')) typeIcon = '💡';
            else if (item.labels?.includes('type:bug')) typeIcon = '🐛';
            else if (item.labels?.includes('type:review')) typeIcon = '⭐';
            else typeIcon = '📌';
            header.innerHTML = `
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="font-size:24px;">${typeIcon}</span>
                    <div>
                        <div style="font-size:14px;color:var(--accent);">${GithubCore.escapeHtml(item.author || 'Unknown')}</div>
                        <div style="font-size:12px;color:var(--text-secondary);">${new Date(item.date).toLocaleString()}</div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0;">
                    ${item.game ? `<span class="feedback-label">${GithubCore.escapeHtml(item.game)}</span>` : ''}
                </div>
            `;
            container.appendChild(header);

            // Добавляем кнопки действий в шапку модального окна (рядом с крестиком)
            const modalHeader = modal.querySelector('.modal-header');
            if (modalHeader) {
                addHeaderActions(modalHeader, item, issue, currentUser, closeModal, escHandler);
            }

            await renderPostBody(container, issue.body, item.id);
            await loadReactionsAndComments(container, item, currentUser, issue);
            if (currentUser) setupCommentForm(container, item, currentUser);
        } catch (err) {
            console.error('Error loading post:', err);
            container.innerHTML = '<p class="error-message">Пост не найден или произошла ошибка загрузки.</p>';
            setTimeout(() => { closeModal(); document.removeEventListener('keydown', escHandler); }, 3000);
        }
    }

    function openEditorModal(mode, data, postType = 'feedback') {
        const title = mode === 'edit' ? 'Редактирование' : 'Новое сообщение';
        let previewUrl = '';
        let bodyContent = data.body || '';
        const previewMatch = bodyContent.match(/<!--\s*preview:\s*(https?:\/\/[^\s]+)\s*-->/);
        if (previewMatch) {
            previewUrl = previewMatch[1];
            bodyContent = bodyContent.replace(/<!--\s*preview:\s*https?:\/\/[^\s]+\s*-->\s*\n?/, '');
        }
        let categoryHtml = '';
        if (postType === 'feedback') {
            categoryHtml = `<select id="modal-category" class="feedback-select"><option value="idea">💡 Идея</option><option value="bug">🐛 Баг</option><option value="review">⭐ Отзыв</option></select>`;
        }
        const contentHtml = `
            <div class="feedback-form">
                <input type="text" id="modal-input-title" class="feedback-input" placeholder="Заголовок" value="${GithubCore.escapeHtml(data.title||'')}">
                <div class="preview-url-wrapper">
                    <input type="url" id="modal-preview-url" class="feedback-input preview-url-input" placeholder="Ссылка на превью (необязательно)" value="${GithubCore.escapeHtml(previewUrl)}">
                    <div id="preview-services-placeholder"></div>
                </div>
                <div id="preview-thumbnail-container" class="preview-thumbnail" style="${previewUrl ? '' : 'display:none;'}">
                    <img id="preview-thumbnail-img" src="${previewUrl ? GithubCore.escapeHtml(previewUrl) : ''}" alt="Preview">
                    <button type="button" class="remove-preview" id="remove-preview-btn" title="Удалить превью"><i class="fas fa-times"></i></button>
                </div>
                ${categoryHtml}
                <div id="modal-editor-toolbar"></div>
                <textarea id="modal-body" class="feedback-textarea" placeholder="Описание..." rows="10">${GithubCore.escapeHtml(bodyContent)}</textarea>
                <div class="preview-area" id="modal-preview-area" style="display:none;"></div>
                <div class="button-group" style="margin-top:10px;"><button class="button" id="modal-submit">${mode==='edit'?'Сохранить':'Опубликовать'}</button></div>
            </div>
        `;
        const { modal, closeModal } = UIUtils.createModal(title, contentHtml, { size: 'full' });
        const servicesPlaceholder = modal.querySelector('#preview-services-placeholder');
        if (servicesPlaceholder && window.Editor) {
            servicesPlaceholder.appendChild(window.Editor.createImageServicesMenu());
        }
        const previewUrlInput = modal.querySelector('#modal-preview-url');
        const thumbnailContainer = modal.querySelector('#preview-thumbnail-container');
        const thumbnailImg = modal.querySelector('#preview-thumbnail-img');
        const removePreviewBtn = modal.querySelector('#remove-preview-btn');
        function updateThumbnail(url) {
            if (url && url.trim()) { thumbnailImg.src = url; thumbnailContainer.style.display = 'block'; }
            else { thumbnailContainer.style.display = 'none'; thumbnailImg.src = ''; }
        }
        previewUrlInput.addEventListener('input', (e) => updateThumbnail(e.target.value.trim()));
        removePreviewBtn.addEventListener('click', () => { previewUrlInput.value = ''; updateThumbnail(''); });

        const draftKey = `draft_${postType}_${mode}_${data.game || 'global'}_${data.number || 'new'}`;
        const savedDraft = UIUtils.loadDraft(draftKey);
        if (savedDraft && (savedDraft.title || savedDraft.body || savedDraft.previewUrl)) {
            if (confirm('Найден несохранённый черновик. Восстановить?')) {
                document.getElementById('modal-input-title').value = savedDraft.title || '';
                if (savedDraft.previewUrl) {
                    document.getElementById('modal-preview-url').value = savedDraft.previewUrl;
                    updateThumbnail(savedDraft.previewUrl);
                }
                document.getElementById('modal-body').value = savedDraft.body || '';
                if (savedDraft.category && document.getElementById('modal-category')) {
                    document.getElementById('modal-category').value = savedDraft.category;
                }
            } else { UIUtils.clearDraft(draftKey); }
        }

        let hasChanges = false;
        const titleInput = modal.querySelector('#modal-input-title');
        const bodyTextarea = modal.querySelector('#modal-body');
        const categorySelect = modal.querySelector('#modal-category');
        const updateDraft = () => {
            const currentTitle = titleInput.value.trim();
            const currentPreview = previewUrlInput.value.trim();
            const currentBody = bodyTextarea.value.trim();
            const currentCategory = categorySelect ? categorySelect.value : null;
            UIUtils.saveDraft(draftKey, { title: currentTitle, previewUrl: currentPreview, body: currentBody, category: currentCategory });
            hasChanges = true;
        };
        titleInput.addEventListener('input', updateDraft);
        previewUrlInput.addEventListener('input', updateDraft);
        bodyTextarea.addEventListener('input', updateDraft);
        if (categorySelect) categorySelect.addEventListener('change', updateDraft);

        const originalCloseModal = closeModal;
        const closeWithCheck = () => {
            if (hasChanges) {
                if (confirm('У вас есть несохранённые изменения. Вы действительно хотите закрыть?')) {
                    UIUtils.clearDraft(draftKey);
                    originalCloseModal();
                }
            } else {
                UIUtils.clearDraft(draftKey);
                originalCloseModal();
            }
        };
        modal.addEventListener('click', (e) => { if (e.target === modal) { e.preventDefault(); closeWithCheck(); } });
        const escHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeWithCheck(); } };
        document.addEventListener('keydown', escHandler);
        const closeBtn = modal.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.replaceWith(closeBtn.cloneNode(true));
            modal.querySelector('.modal-close').addEventListener('click', (e) => { e.preventDefault(); closeWithCheck(); });
        }

        const previewArea = modal.querySelector('#modal-preview-area');
        function updatePreview() {
            if (!previewArea) return;
            const title = titleInput.value.trim();
            const previewUrl = previewUrlInput.value.trim();
            const text = bodyTextarea.value;
            let fullContent = '';
            if (previewUrl) fullContent += `<!-- preview: ${previewUrl} -->\n\n![Preview](${previewUrl})\n\n`;
            if (title && postType !== 'feedback') fullContent += `# ${title}\n\n`;
            fullContent += text;
            if (fullContent.trim()) {
                previewArea.innerHTML = '';
                if (!previewArea.classList.contains('markdown-body')) previewArea.classList.add('markdown-body');
                renderPostBody(previewArea, fullContent, null);
                previewArea.style.display = 'block';
            } else {
                previewArea.style.display = 'none';
            }
        }
        if (window.Editor) {
            const toolbar = Editor.createEditorToolbar(bodyTextarea, { onPreview: updatePreview, textarea: bodyTextarea });
            const toolbarContainer = modal.querySelector('#modal-editor-toolbar');
            if (toolbarContainer) toolbarContainer.appendChild(toolbar);
        }

        const submitBtn = modal.querySelector('#modal-submit');
        submitBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!GithubAuth.getToken()) { UIUtils.showToast('Вы не авторизованы. Войдите через GitHub.', 'error'); return; }
            const title = titleInput.value.trim();
            const previewUrl = previewUrlInput.value.trim();
            let body = bodyTextarea.value;
            if (!title) { UIUtils.showToast('Заполните заголовок', 'error'); titleInput.focus(); return; }
            if (!body.trim()) { UIUtils.showToast('Заполните описание', 'error'); bodyTextarea.focus(); return; }
            if (previewUrl) body = `<!-- preview: ${previewUrl} -->\n\n![Preview](${previewUrl})\n\n` + body;
            const pollMatches = body.match(/<!-- poll: .*? -->/g);
            if (pollMatches && pollMatches.length > 1) {
                if (!confirm('Обнаружено несколько блоков опроса. Будут сохранены только первые. Продолжить?')) return;
                const first = pollMatches[0];
                body = body.replace(/<!-- poll: .*? -->/g, '');
                body = first + '\n' + body;
            }
            let category = 'idea';
            if (postType === 'feedback' && categorySelect) category = categorySelect.value;
            const btn = submitBtn;
            btn.disabled = true;
            btn.textContent = 'Сохранение...';
            try {
                let labels;
                if (postType === 'feedback') {
                    if (!data.game) { UIUtils.showToast('Ошибка: не указана игра', 'error'); btn.disabled = false; btn.textContent = mode === 'edit' ? 'Сохранить' : 'Опубликовать'; return; }
                    labels = [`game:${data.game}`, `type:${category}`];
                } else if (postType === 'news') {
                    labels = ['type:news'];
                } else {
                    if (!data.game || data.game.trim() === '') { UIUtils.showToast('Ошибка: не указана игра для обновления', 'error'); btn.disabled = false; btn.textContent = mode === 'edit' ? 'Сохранить' : 'Опубликовать'; return; }
                    labels = ['type:update', `game:${data.game}`];
                }
                if (mode === 'edit') await GithubAPI.updateIssue(data.number, { title, body, labels });
                else await GithubAPI.createIssue(title, body, labels);
                UIUtils.clearDraft(draftKey);
                originalCloseModal();
                if (postType === 'feedback' && window.refreshNewsFeed) window.refreshNewsFeed();
                if (postType === 'update' && window.refreshGameUpdates) window.refreshGameUpdates(data.game);
                if (postType === 'news' && window.refreshNewsFeed) window.refreshNewsFeed();
                UIUtils.showToast(mode === 'edit' ? 'Сохранено' : 'Опубликовано', 'success');
            } catch (err) {
                console.error('Submit error:', err);
                let errorMessage = 'Ошибка при сохранении.';
                if (err.message.includes('NetworkError') || (err.name === 'TypeError' && err.message.includes('NetworkError'))) errorMessage = 'Ошибка сети. Проверьте подключение к интернету.';
                else if (err.message.includes('401')) errorMessage = 'Ошибка авторизации. Возможно, токен устарел. Войдите заново.';
                else if (err.message.includes('403')) errorMessage = 'Доступ запрещён. Проверьте права токена.';
                else if (err.message) errorMessage = 'Ошибка: ' + err.message;
                UIUtils.showToast(errorMessage, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = mode === 'edit' ? 'Сохранить' : 'Опубликовать';
            }
        });
    }

    window.UIFeedback = {
        renderReactions,
        showReactionMenu,
        renderComments,
        openFullModal,
        openEditorModal,
        renderPostBody,
        REACTION_TYPES,
        invalidateCache
    };
})();