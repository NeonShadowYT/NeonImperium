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
    const postsCache = new Map();

    function getCached(key, cacheMap) {
        const cached = cacheMap.get(key);
        return (cached && Date.now() - cached.timestamp < CACHE_TTL) ? cached.data : null;
    }
    function setCached(key, data, cacheMap) { cacheMap.set(key, { data, timestamp: Date.now() }); }
    function invalidateCache(issueNumber) {
        reactionsCache.delete(`reactions_${issueNumber}`);
        commentsCache.delete(`comments_${issueNumber}`);
        postsCache.delete(`post_${issueNumber}`);
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

    async function loadPostByNumber(issueNumber) {
        const cacheKey = `post_${issueNumber}`;
        const cached = getCached(cacheKey, postsCache);
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
            setCached(cacheKey, postData, postsCache);
            return postData;
        } catch (err) {
            console.warn('Failed to load post', issueNumber, err);
            return null;
        }
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
            openFullModal({
                type: 'issue',
                id: post.number,
                title: post.title,
                body: post.body,
                author: post.author,
                date: post.date,
                game: post.game,
                labels: post.labels
            });
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
                    renderPostBody(previewArea, text, null).catch(e => console.warn('Preview error', e));
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
            if (newBody === currentBody) { UIUtils.showToast('Нет изменений', 'warning'); return; }
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
        const links = extractPostLinks(body);
        for (const link of links) {
            await renderMiniPostCard(container, link);
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
                setCached(`comments_${item.id}`, updated, commentsCache);
                renderComments(commentsDiv, updated, currentUser, item.id);
                UIUtils.showToast('Комментарий добавлен', 'success');
            } catch (err) {
                UIUtils.showToast('Ошибка при отправке комментария', 'error');
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
            await loadReactionsAndComments(container, item, currentUser, issue);
            if (currentUser) setupCommentForm(container, item, currentUser);
        } catch (err) {
            console.error('Error loading post:', err);
            container.innerHTML = '<p class="error-message">Пост не найден или произошла ошибка загрузки.</p>';
            setTimeout(() => { closeModal(); document.removeEventListener('keydown', escHandler); }, 3000);
        }
    }

    function canViewPost(body, labels, currentUser) {
        if (!labels.includes('private')) return true;
        if (GithubAuth.isAdmin()) return true;
        const allowed = GithubCore.extractAllowed(body);
        if (!allowed) return false;
        const allowedList = allowed.split(',').map(s => s.trim()).filter(Boolean);
        return allowedList.includes(currentUser);
    }

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
        
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.style.display = dropdownMenu.style.display === 'block' ? 'none' : 'block';
        });
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) dropdownMenu.style.display = 'none';
        });
        
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
        const updatePreview = async () => {
            if (updateTimeout) clearTimeout(updateTimeout);
            updateTimeout = setTimeout(async () => {
                const text = textarea.value;
                if (text.trim()) {
                    previewDiv.innerHTML = '';
                    try {
                        await renderPostBody(previewDiv, text, null);
                    } catch (e) {
                        console.warn('Preview render error', e);
                        previewDiv.innerHTML = '<p class="error-message">Ошибка предпросмотра</p>';
                    }
                } else {
                    previewDiv.innerHTML = '<p class="text-secondary">Предпросмотр будет здесь...</p>';
                }
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
        
        if (window.Editor) {
            const toolbar = Editor.createEditorToolbar(textarea, { preview: false });
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
            try {
                await onSave(textarea.value.trim());
            } finally {
                isSubmitting = false;
                saveBtn.disabled = false;
            }
        });
        
        return { container, textarea, previewDiv, updatePreview };
    }

    let currentPrivateUsersInput = null;

    function openEditorModal(mode, data, postType = 'feedback') {
        const currentUser = GithubAuth.getCurrentUser();
        const title = mode === 'edit' ? 'Редактирование' : 'Новое сообщение';
        
        let previewUrl = '';
        let allowedUsers = '';
        let bodyContent = data.body || '';
        const previewMatch = bodyContent.match(/<!--\s*preview:\s*(https?:\/\/[^\s]+)\s*-->/);
        if (previewMatch) {
            previewUrl = previewMatch[1];
            bodyContent = bodyContent.replace(/<!--\s*preview:\s*https?:\/\/[^\s]+\s*-->\s*\n?/, '');
        }
        const allowedMatch = bodyContent.match(/<!--\s*allowed:\s*(.*?)\s*-->/);
        if (allowedMatch) {
            allowedUsers = allowedMatch[1];
            bodyContent = bodyContent.replace(/<!--\s*allowed:\s*.*?\s*-->\s*\n?/, '');
        }

        let categoryHtml = '';
        let currentCategory = 'idea';
        if (postType === 'feedback') {
            if (data.labels) {
                const typeLabel = data.labels.find(l => l.startsWith('type:'));
                if (typeLabel) currentCategory = typeLabel.split(':')[1];
            }
            categoryHtml = `<select id="modal-category" class="feedback-select">
                <option value="idea" ${currentCategory==='idea'?'selected':''}>💡 Идея</option>
                <option value="bug" ${currentCategory==='bug'?'selected':''}>🐛 Баг</option>
                <option value="review" ${currentCategory==='review'?'selected':''}>⭐ Отзыв</option>
            </select>`;
        }

        let draftKey;
        if (postType === 'comment') {
            draftKey = `draft_comment_${data.issueNumber || 'new'}`;
        } else {
            draftKey = `draft_${postType}_${mode}_${data.game || 'global'}_${data.number || 'new'}`;
        }

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
            if (mode === 'edit') {
                const oldPreviewMatch = data.body?.match(/<!--\s*preview:\s*(https?:\/\/[^\s]+)\s*-->/);
                if (oldPreviewMatch) existingPreviewUrl = oldPreviewMatch[1];
            }
            if (newPreviewUrl) {
                if (mode !== 'edit' || newPreviewUrl !== existingPreviewUrl) {
                    finalProcessedBody = `<!-- preview: ${newPreviewUrl} -->\n\n![Preview](${newPreviewUrl})\n\n` + finalProcessedBody;
                } else {
                    const originalPreviewTag = `<!-- preview: ${existingPreviewUrl} -->`;
                    if (!finalProcessedBody.includes(originalPreviewTag)) {
                        finalProcessedBody = originalPreviewTag + '\n\n![Preview](' + existingPreviewUrl + ')\n\n' + finalProcessedBody;
                    }
                }
            }
            
            const newSummary = modal.querySelector('#modal-summary')?.value.trim();
            if (newSummary) {
                finalProcessedBody = `<!-- summary: ${newSummary} -->\n\n` + finalProcessedBody;
            }
            
            if (isPrivate && allowedUsersValue && postType !== 'support') {
                finalProcessedBody = `<!-- allowed: ${allowedUsersValue} -->\n\n` + finalProcessedBody;
            } else if (postType === 'support') {
                finalProcessedBody = `<!-- allowed: ${currentUser} -->\n\n` + finalProcessedBody;
            }
            
            const pollMatches = finalProcessedBody.match(/<!-- poll: .*? -->/g);
            if (pollMatches && pollMatches.length > 1) {
                if (!confirm('Обнаружено несколько блоков опроса. Будут сохранены только первые. Продолжить?')) throw new Error('Cancel');
                const first = pollMatches[0];
                finalProcessedBody = finalProcessedBody.replace(/<!-- poll: .*? -->/g, '');
                finalProcessedBody = first + '\n' + finalProcessedBody;
            }
            
            let category = 'idea';
            if (postType === 'feedback' && modal.querySelector('#modal-category')) category = modal.querySelector('#modal-category').value;
            
            if (mode === 'edit') {
                const originalTitle = data.title || '';
                const originalBody = data.body || '';
                if (title === originalTitle && finalProcessedBody === originalBody) {
                    UIUtils.showToast('Нет изменений', 'warning');
                    throw new Error('No changes');
                }
            }
            
            let labels;
            if (postType === 'feedback') {
                if (!data.game) throw new Error('Не указана игра');
                labels = [`game:${data.game}`, `type:${category}`];
            } else if (postType === 'news') {
                labels = ['type:news'];
            } else if (postType === 'support') {
                labels = ['type:support', 'private'];
            } else {
                if (!data.game || data.game.trim() === '') throw new Error('Не указана игра для обновления');
                labels = ['type:update', `game:${data.game}`];
            }
            if (isPrivate && !labels.includes('private') && postType !== 'support') {
                labels.push('private');
            }
            
            if (mode === 'edit') {
                await GithubAPI.updateIssue(data.number, { title, body: finalProcessedBody, labels });
            } else {
                await GithubAPI.createIssue(title, finalProcessedBody, labels);
            }
            
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
            if (window.Editor) servicesPlaceholder.appendChild(window.Editor.createImageServicesMenu());
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
            const removePreviewBtn = document.createElement('button');
            removePreviewBtn.type = 'button';
            removePreviewBtn.className = 'remove-preview';
            removePreviewBtn.innerHTML = '<i class="fas fa-times"></i>';
            removePreviewBtn.addEventListener('click', () => {
                previewUrlInput.value = '';
                thumbnailContainer.style.display = 'none';
                thumbnailImg.src = '';
                if (syncToBody) syncToBody();
            });
            thumbnailContainer.appendChild(thumbnailImg);
            thumbnailContainer.appendChild(removePreviewBtn);
            settingsCard.appendChild(thumbnailContainer);
            
            previewUrlInput.addEventListener('input', (e) => {
                const val = e.target.value.trim();
                if (val) {
                    thumbnailImg.src = val;
                    thumbnailContainer.style.display = 'block';
                } else {
                    thumbnailContainer.style.display = 'none';
                    thumbnailImg.src = '';
                }
                if (syncToBody) syncToBody();
            });
            
            if (postType === 'feedback') {
                const categorySelect = document.createElement('select');
                categorySelect.id = 'modal-category';
                categorySelect.className = 'feedback-select';
                categorySelect.innerHTML = `
                    <option value="idea" ${currentCategory==='idea'?'selected':''}>💡 Идея</option>
                    <option value="bug" ${currentCategory==='bug'?'selected':''}>🐛 Баг</option>
                    <option value="review" ${currentCategory==='review'?'selected':''}>⭐ Отзыв</option>
                `;
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
            const onAccessToggle = (isPrivate, allowedVal) => {
                if (postType === 'support') return;
                currentIsPrivate = isPrivate;
                privateUsersInput.style.display = isPrivate ? 'block' : 'none';
                if (isPrivate && allowedVal) privateUsersInput.value = allowedVal;
                if (syncToBody) syncToBody();
            };
            const accessDropdown = createAccessDropdown(currentIsPrivate, allowedUsers, onAccessToggle);
            if (postType === 'support') {
                accessDropdown.style.display = 'none';
                const supportInfo = document.createElement('div');
                supportInfo.style.cssText = 'background: rgba(244,67,54,0.15); border-left: 4px solid #f44336; padding: 10px 12px; border-radius: 12px; margin-bottom: 10px;';
                supportInfo.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #f44336;"></i> <strong>Внимание:</strong> На сайте это обращение увидят только вы и администратор. Однако оно сохраняется в <strong>публичном репозитории GitHub</strong>, и любой, у кого есть прямая ссылка, потенциально может его увидеть. Не публикуйте конфиденциальные данные (пароли, ключи).';
                accessPlaceholder.appendChild(supportInfo);
            } else {
                accessPlaceholder.appendChild(accessDropdown);
            }
            accessRow.appendChild(accessPlaceholder);
            if (postType !== 'support') {
                privateUsersInput.style.display = currentIsPrivate ? 'block' : 'none';
                privateUsersInput.style.flex = '1';
                accessRow.appendChild(privateUsersInput);
            }
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
                if (newPreview) {
                    body = `<!-- preview: ${newPreview} -->\n\n![Preview](${newPreview})\n\n` + body;
                }
                const newSummary = summaryInput.value.trim();
                if (newSummary) {
                    body = `<!-- summary: ${newSummary} -->\n\n` + body;
                }
                if (postType === 'support') {
                    body = `<!-- allowed: ${currentUser} -->\n\n` + body;
                } else if (currentIsPrivate && privateUsersInput.value.trim()) {
                    body = `<!-- allowed: ${privateUsersInput.value.trim()} -->\n\n` + body;
                }
                textarea.value = body;
                updatePreview();
            };
            
            titleInput.addEventListener('input', () => {});
            summaryInput.addEventListener('input', syncToBody);
            previewUrlInput.addEventListener('input', syncToBody);
            if (postType !== 'support') privateUsersInput.addEventListener('input', syncToBody);
            if (postType === 'feedback') {
                const categorySelect = settingsCard.querySelector('#modal-category');
                if (categorySelect) categorySelect.addEventListener('change', syncToBody);
            }
            
            const savedDraft = UIUtils.loadDraft(draftKey);
            if (savedDraft && (savedDraft.title || savedDraft.body || savedDraft.previewUrl || savedDraft.summary || savedDraft.access || savedDraft.privateUsers)) {
                if (confirm('Найден несохранённый черновик. Восстановить?')) {
                    titleInput.value = savedDraft.title || '';
                    if (savedDraft.previewUrl) {
                        previewUrlInput.value = savedDraft.previewUrl;
                        thumbnailImg.src = savedDraft.previewUrl;
                        thumbnailContainer.style.display = 'block';
                    }
                    if (savedDraft.summary) summaryInput.value = savedDraft.summary;
                    textarea.value = savedDraft.body || '';
                    if (savedDraft.category && settingsCard.querySelector('#modal-category')) {
                        settingsCard.querySelector('#modal-category').value = savedDraft.category;
                    }
                    if (postType !== 'support' && savedDraft.access) {
                        const isPrivate = savedDraft.access === 'private';
                        if (isPrivate !== currentIsPrivate) {
                            currentIsPrivate = isPrivate;
                            const btn = accessDropdown.querySelector('.access-dropdown-btn');
                            if (btn) btn.innerHTML = isPrivate ? '<i class="fas fa-lock"></i> Приватный' : '<i class="fas fa-globe"></i> Публичный';
                            if (privateUsersInput) privateUsersInput.style.display = isPrivate ? 'block' : 'none';
                        }
                    }
                    if (savedDraft.privateUsers && privateUsersInput) privateUsersInput.value = savedDraft.privateUsers;
                    syncToBody();
                } else {
                    UIUtils.clearDraft(draftKey);
                }
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
                UIUtils.saveDraft(draftKey, {
                    title: currentTitle,
                    previewUrl: currentPreview,
                    summary: currentSummary,
                    body: currentBody,
                    category: currentCategory,
                    access: currentAccess,
                    privateUsers: currentPrivateUsers
                });
                hasChanges = true;
            };
            titleInput.addEventListener('input', updateDraft);
            previewUrlInput.addEventListener('input', updateDraft);
            summaryInput.addEventListener('input', updateDraft);
            textarea.addEventListener('input', updateDraft);
            if (settingsCard.querySelector('#modal-category')) {
                settingsCard.querySelector('#modal-category').addEventListener('change', updateDraft);
            }
            if (postType !== 'support' && privateUsersInput) privateUsersInput.addEventListener('input', updateDraft);
            
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
            
            let isSubmitting = false;
            const saveHandler = async () => {
                if (isSubmitting) return;
                isSubmitting = true;
                saveBtn.disabled = true;
                try {
                    await handleSave(textarea.value.trim());
                } finally {
                    isSubmitting = false;
                    saveBtn.disabled = false;
                }
            };
            saveBtn.addEventListener('click', saveHandler);
        }
    }

    async function openSupportModal() {
        const currentUser = GithubAuth.getCurrentUser();
        if (!currentUser) {
            UIUtils.showToast('Войдите в аккаунт, чтобы использовать поддержку', 'error');
            window.dispatchEvent(new CustomEvent('github-login-requested'));
            return;
        }

        const modalContent = `
            <div style="display: flex; flex-direction: column; gap: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                    <h3 style="margin: 0;"><i class="fas fa-headset"></i> <span data-lang="supportTitle">Поддержка</span></h3>
                    <button class="button" id="new-support-btn"><i class="fas fa-plus"></i> <span data-lang="supportNewBtn">Новое обращение</span></button>
                </div>
                <div class="text-secondary" style="font-size: 12px; background: rgba(244,67,54,0.1); border-left: 3px solid #f44336; padding: 8px 12px; border-radius: 8px;">
                    <i class="fas fa-exclamation-triangle"></i> <strong>Конфиденциальность:</strong> На сайте ваше обращение увидят только вы и администратор. Но оно хранится в <strong>публичном репозитории GitHub</strong>. Любой, у кого есть прямая ссылка, может его прочитать. Не публикуйте пароли или личные данные.
                </div>
                <div id="support-list" style="display: flex; flex-direction: column; gap: 12px; max-height: 500px; overflow-y: auto;">
                    <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>
                </div>
                <div class="text-secondary" style="font-size: 12px; text-align: center; border-top: 1px solid var(--border); padding-top: 12px;">
                    <i class="fas fa-lock"></i> Все обращения приватны на сайте: их видят только вы и администратор.
                </div>
            </div>
        `;
        const { modal, closeModal } = UIUtils.createModal('Поддержка', modalContent, { size: 'full' });
        const listContainer = modal.querySelector('#support-list');
        const newBtn = modal.querySelector('#new-support-btn');

        newBtn.addEventListener('click', () => {
            closeModal();
            openEditorModal('new', { game: null }, 'support');
        });

        try {
            const issues = await GithubAPI.loadIssues({ labels: 'type:support', state: 'open', per_page: 100 });
            const isAdmin = GithubAuth.isAdmin();
            let filtered = issues.filter(issue => {
                if (isAdmin) return true;
                const allowed = GithubCore.extractAllowed(issue.body);
                return allowed === currentUser;
            });
            filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

            if (filtered.length === 0) {
                listContainer.innerHTML = '<p class="text-secondary" style="text-align: center;">У вас нет обращений. Нажмите «Новое обращение».</p>';
                return;
            }

            listContainer.innerHTML = '';
            for (const issue of filtered) {
                const card = document.createElement('div');
                card.className = 'support-ticket-card';
                card.style.cssText = 'background: var(--bg-inner-gradient); border: 1px solid var(--border); border-radius: 16px; padding: 12px 16px; cursor: pointer; transition: all 0.2s;';
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <div>
                            <div style="font-weight: bold; color: var(--accent);">${GithubCore.escapeHtml(issue.title)}</div>
                            <div style="font-size: 12px; color: var(--text-secondary);">${new Date(issue.created_at).toLocaleString()}</div>
                        </div>
                        <div style="font-size: 12px; background: var(--bg-primary); padding: 4px 8px; border-radius: 20px;">#${issue.number}</div>
                    </div>
                    <div class="text-secondary" style="font-size: 13px; margin-top: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                        ${GithubCore.stripHtml(issue.body).substring(0, 100)}...
                    </div>
                `;
                card.addEventListener('click', () => {
                    closeModal();
                    openFullModal({
                        type: 'issue',
                        id: issue.number,
                        title: issue.title,
                        body: issue.body,
                        author: issue.user.login,
                        date: new Date(issue.created_at),
                        game: null,
                        labels: issue.labels.map(l => l.name)
                    });
                });
                listContainer.appendChild(card);
            }
        } catch (err) {
            console.error('Failed to load support tickets', err);
            listContainer.innerHTML = '<p class="error-message">Ошибка загрузки обращений</p>';
        }
    }

    window.addEventListener('open-comment-editor', (e) => {
        const { issueNumber } = e.detail;
        if (!issueNumber) return;
        openEditorModal('new', { issueNumber }, 'comment');
    });

    window.UIFeedback = {
        renderReactions,
        showReactionMenu,
        renderComments,
        openFullModal,
        openEditorModal,
        openSupportModal,
        renderPostBody,
        canViewPost,
        REACTION_TYPES,
        invalidateCache
    };
})();