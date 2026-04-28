// js/features/ui-feedback.js — интерфейс обратной связи с динамической подгрузкой хранилища
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
    // кэш загруженных превью‑URL (чтобы не дёргать сеть повторно)
    const loadedPreviewUrls = new Set();

    const { escapeHtml, renderMarkdown, extractAllowed, decryptPrivateBody, createElement, loadModule } = GithubCore;

    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

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
        REACTION_TYPES.forEach(t => grouped[t.content] = { ...t, count: 0, userReacted: false, userReactionId: null });
        reactions.forEach(r => {
            if (r.content.startsWith('vote:')) return;
            if (grouped[r.content]) {
                grouped[r.content].count++;
                if (currentUser && r.user?.login === currentUser) {
                    grouped[r.content].userReacted = true;
                    grouped[r.content].userReactionId = r.id;
                }
            }
        });
        return Object.values(grouped).filter(g => g.count > 0).sort((a,b) => b.count - a.count);
    }

    function renderReactions(container, issueNumber, reactions, currentUser, onAdd, onRemove) {
        if (!container) return;
        const hasRepo = GithubAuth.hasScope('repo');
        const grouped = groupReactions(reactions, currentUser);
        const visible = grouped.slice(0,3);
        const hiddenCount = grouped.length - 3;
        container.innerHTML = '';
        visible.forEach(g => {
            const btn = createElement('button', `reaction-button ${g.userReacted ? 'active' : ''}`, {}, {
                'data-content': g.content,
                'data-reaction-id': g.userReactionId || '',
                'data-count': g.count,
                disabled: !currentUser || !hasRepo,
                'aria-label': `${g.emoji} (${g.count})`
            });
            btn.innerHTML = `<span class="reaction-emoji">${g.emoji}</span><span class="reaction-count">${g.count}</span>`;
            container.appendChild(btn);
        });
        if (currentUser && hasRepo) {
            const addBtn = createElement('button', 'reaction-add-btn', {}, {
                'data-add': hiddenCount === 0 ? '' : undefined,
                'data-more': hiddenCount > 0 ? '' : undefined,
                'aria-label': hiddenCount > 0 ? 'Показать ещё реакции' : 'Добавить реакцию'
            });
            addBtn.innerHTML = `<span>${hiddenCount > 0 ? '+' + hiddenCount : '+'}</span>`;
            container.appendChild(addBtn);
        }

        if (!currentUser || !hasRepo) return;
        container.querySelectorAll('.reaction-button:not([disabled])').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const content = btn.dataset.content;
                const reactionId = btn.dataset.reactionId;
                const isActive = btn.classList.contains('active');
                const countSpan = btn.querySelector('.reaction-count');
                const oldCount = parseInt(countSpan.textContent, 10);
                const lockKey = `${issueNumber}_${content}`;
                if (reactionLocks.has(lockKey)) return;

                if (isActive && reactionId) {
                    reactionLocks.set(lockKey, true);
                    btn.classList.remove('active');
                    countSpan.textContent = oldCount - 1;
                    try {
                        await onRemove(issueNumber, parseInt(reactionId, 10));
                    } catch {
                        UIUtils.showToast('Ошибка при удалении реакции', 'error');
                        btn.classList.add('active');
                        countSpan.textContent = oldCount;
                    } finally { reactionLocks.delete(lockKey); }
                } else if (!isActive) {
                    reactionLocks.set(lockKey, true);
                    btn.classList.add('active');
                    countSpan.textContent = oldCount + 1;
                    btn.dataset.reactionId = 'temp';
                    try {
                        await onAdd(issueNumber, content);
                    } catch {
                        UIUtils.showToast('Ошибка при добавлении реакции', 'error');
                        btn.classList.remove('active');
                        countSpan.textContent = oldCount;
                        btn.dataset.reactionId = '';
                    } finally { reactionLocks.delete(lockKey); }
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
                    const existing = Array.from(container.querySelectorAll('.reaction-button')).find(b => b.dataset.content === selected);
                    if (existing) {
                        if (existing.classList.contains('active')) { reactionLocks.delete(lockKey); return; }
                        const countSpan = existing.querySelector('.reaction-count');
                        const old = parseInt(countSpan.textContent, 10);
                        existing.classList.add('active');
                        countSpan.textContent = old + 1;
                        existing.dataset.reactionId = 'temp';
                        try { await onAdd(issueNumber, selected); }
                        catch {
                            existing.classList.remove('active');
                            countSpan.textContent = old;
                            existing.dataset.reactionId = '';
                        } finally { reactionLocks.delete(lockKey); }
                    } else {
                        const tempBtn = createElement('button', 'reaction-button active', {}, {
                            'data-content': selected,
                            'data-reaction-id': 'temp'
                        });
                        const emoji = REACTION_TYPES.find(t => t.content === selected).emoji;
                        tempBtn.innerHTML = `<span class="reaction-emoji">${emoji}</span><span class="reaction-count">1</span>`;
                        container.insertBefore(tempBtn, addBtn);
                        try { await onAdd(issueNumber, selected); }
                        catch { tempBtn.remove(); }
                        finally { reactionLocks.delete(lockKey); }
                    }
                });
            });
        }
    }

    function showReactionMenu(relativeTo, issueNumber, callback) {
        document.querySelectorAll('.reaction-menu').forEach(m => m.remove());
        const menu = createElement('div', 'reaction-menu', {
            position: 'absolute', background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: '30px', padding: '5px', display: 'flex', gap: '5px', zIndex: '10010', boxShadow: 'var(--shadow)'
        }, { role: 'menu' });
        REACTION_TYPES.forEach(t => {
            const btn = createElement('button', 'reaction-menu-btn', {}, { role: 'menuitem' });
            btn.innerHTML = t.emoji;
            btn.onclick = (e) => { e.stopPropagation(); callback(t.content); menu.remove(); };
            menu.appendChild(btn);
        });
        const rect = relativeTo.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + window.scrollY + 5) + 'px';
        document.body.appendChild(menu);
        const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
        setTimeout(() => document.addEventListener('click', close), 100);
    }

    function renderComments(container, comments, currentUser, issueNumber) {
        const hasRepo = GithubAuth.hasScope('repo');
        const regular = comments.filter(c => !c.body.trim().startsWith('!vote'));
        container.innerHTML = regular.map(c => {
            const isAuthor = currentUser && c.user.login === currentUser;
            const canEdit = hasRepo && (isAuthor || GithubAuth.isAdmin());
            let actions = '';
            if (canEdit) {
                actions = `<div class="comment-actions"><button class="comment-edit" data-comment-id="${c.id}" data-body="${escapeHtml(c.body)}"><i class="fas fa-edit"></i></button><button class="comment-delete" data-comment-id="${c.id}"><i class="fas fa-trash-alt"></i></button></div>`;
            }
            return `<div class="comment" data-comment-id="${c.id}"><div class="comment-meta"><span class="comment-author">${escapeHtml(c.user.login)}</span></div><div class="comment-body">${escapeHtml(c.body).replace(/\n/g,'<br>')}</div>${actions}</div>`;
        }).join('');

        if (currentUser && hasRepo) {
            container.querySelectorAll('.comment-edit').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditCommentModal(btn.dataset.commentId, btn.dataset.body, issueNumber);
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
                    } catch {
                        UIUtils.showToast('Ошибка при удалении', 'error');
                        if (!commentDiv.parentNode) container.appendChild(commentDiv);
                    }
                });
            });
        }
    }

    function openEditCommentModal(commentId, currentBody, issueNumber) {
        const html = `
            <div class="feedback-form">
                <div id="modal-editor-toolbar"></div>
                <textarea id="edit-comment-body" class="feedback-textarea" rows="10">${escapeHtml(currentBody)}</textarea>
                <div class="button-group" style="margin-top:15px; display:flex; gap:10px; justify-content:flex-end;">
                    <button class="button" id="edit-comment-save">Сохранить</button>
                    <button class="button" id="edit-comment-cancel">Отмена</button>
                </div>
            </div>
        `;
        const { modal, closeModal } = UIUtils.createModal('Редактировать комментарий', html, { size: 'full' });
        const textarea = modal.querySelector('#edit-comment-body');
        const toolbarContainer = modal.querySelector('#modal-editor-toolbar');
        if (window.Editor) toolbarContainer.appendChild(Editor.createEditorToolbar(textarea));

        modal.querySelector('#edit-comment-save').addEventListener('click', async () => {
            const newBody = textarea.value.trim();
            if (!newBody) return UIUtils.showToast('Комментарий не может быть пустым', 'error');
            try {
                await GithubAPI.updateComment(commentId, newBody);
                invalidateCache(issueNumber);
                closeModal();
                UIUtils.showToast('Комментарий обновлён', 'success');
            } catch { UIUtils.showToast('Ошибка при сохранении', 'error'); }
        });
        modal.querySelector('#edit-comment-cancel').addEventListener('click', closeModal);
    }

    async function loadReactionsWithCache(issueNumber) {
        const key = `reactions_${issueNumber}`;
        const cached = getCached(key, reactionsCache);
        if (cached) return cached;
        const reactions = await GithubAPI.loadReactions(issueNumber);
        setCached(key, reactions, reactionsCache);
        return reactions;
    }

    async function loadCommentsWithCache(issueNumber) {
        const key = `comments_${issueNumber}`;
        const cached = getCached(key, commentsCache);
        if (cached) return cached;
        const comments = await GithubAPI.loadComments(issueNumber);
        setCached(key, comments, commentsCache);
        return comments;
    }

    function extractPollFromBody(body) {
        const match = /<!-- poll: (.*?) -->/.exec(body);
        if (match) try { return JSON.parse(match[1]); } catch { return null; }
        return null;
    }

    async function renderPostBody(container, body, issueNumber) {
        const html = renderMarkdown(body);
        container.innerHTML = `<div class="markdown-body">${html}</div>`;
        const pollData = extractPollFromBody(body);
        if (pollData) {
            const pollContainer = createElement('div', 'poll-container');
            container.appendChild(pollContainer);
            if (issueNumber) await renderPoll(pollContainer, issueNumber, pollData);
            else renderStaticPoll(pollContainer, pollData);
        }
    }

    function renderStaticPoll(container, pollData) {
        const pollDiv = createElement('div', 'poll card');
        pollDiv.innerHTML = `<h3>📊 ${escapeHtml(pollData.question)}</h3><div class="poll-options static">${pollData.options.map(opt => `<div class="poll-option"><span>${escapeHtml(opt)}</span></div>`).join('')}</div><p class="text-secondary small">(опрос будет доступен после публикации)</p>`;
        container.appendChild(pollDiv);
    }

    async function renderPoll(container, issueNumber, pollData) {
        const currentUser = GithubAuth.getCurrentUser();
        const hasRepo = GithubAuth.hasScope('repo');
        const comments = await GithubAPI.loadComments(issueNumber);
        const votes = comments.filter(c => /^!vote \d+$/.test(c.body.trim()));
        const counts = pollData.options.map((_,i) => votes.filter(c => c.body.trim() === `!vote ${i}`).length);
        const total = counts.reduce((a,b)=>a+b,0);
        const userVoted = currentUser && votes.some(c => c.user.login === currentUser);

        const pollDiv = createElement('div', 'poll card');
        pollDiv.dataset.issue = issueNumber;
        let html = `<h3>📊 ${escapeHtml(pollData.question)}</h3><div class="poll-options">`;
        pollData.options.forEach((opt, i) => {
            const cnt = counts[i];
            const pct = total ? Math.round((cnt/total)*100) : 0;
            html += `<div class="poll-option"><span>${escapeHtml(opt)}</span>`;
            if (!currentUser || !hasRepo) {}
            else if (!userVoted) html += `<button class="button poll-vote-btn" data-option="${i}">Голосовать</button>`;
            else html += `<div class="progress-bar"><div style="width:${pct}%;">${pct}% (${cnt})</div></div>`;
            html += '</div>';
        });
        html += '</div>';
        if (!currentUser || !hasRepo) html += '<p class="text-secondary small"><i class="fas fa-info-circle"></i> Войдите с scope "repo" для голосования.</p>';
        else if (!userVoted) html += '<p class="text-secondary small">Вы ещё не голосовали.</p>';
        pollDiv.innerHTML = html;
        container.innerHTML = '';
        container.appendChild(pollDiv);

        if (currentUser && hasRepo && !userVoted) {
            pollDiv.querySelectorAll('.poll-vote-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const idx = btn.dataset.option;
                    btn.disabled = true;
                    try {
                        await GithubAPI.addComment(issueNumber, `!vote ${idx}`);
                        UIUtils.showToast('Голос учтён', 'success');
                        await renderPoll(container, issueNumber, pollData);
                    } catch { UIUtils.showToast('Ошибка', 'error'); }
                });
            });
        }
    }

    async function loadReactionsAndComments(container, item, currentUser) {
        const reactionsDiv = createElement('div', 'reactions-container');
        const commentsDiv = createElement('div', 'feedback-comments');
        container.appendChild(reactionsDiv);
        container.appendChild(commentsDiv);
        const reactions = await loadReactionsWithCache(item.id);
        renderReactions(reactionsDiv, item.id, reactions, currentUser,
            (num, content) => GithubAPI.addReaction(num, content).then(() => invalidateCache(num)),
            (num, id) => GithubAPI.removeReaction(num, id).then(() => invalidateCache(num))
        );
        const comments = await loadCommentsWithCache(item.id);
        renderComments(commentsDiv, comments, currentUser, item.id);
    }

    function setupCommentForm(container, item, currentUser) {
        if (!GithubAuth.hasScope('repo')) return;
        const form = createElement('div', 'comment-form', { display: 'flex', gap: '8px', marginTop: '16px' });
        form.innerHTML = `
            <input type="text" class="comment-input" placeholder="Написать комментарий..." style="flex:1; padding:10px 12px; border-radius:30px; background:var(--bg-primary); border:1px solid var(--border); color:var(--text-primary);">
            <div class="button-group" style="display:flex; gap:8px;">
                <button class="button comment-submit">Отправить</button>
                <button class="button comment-editor-btn"><i class="fas fa-pencil-alt"></i> Редактор</button>
            </div>
        `;
        container.appendChild(form);
        const input = form.querySelector('.comment-input');
        const submit = form.querySelector('.comment-submit');
        const editorBtn = form.querySelector('.comment-editor-btn');

        submit.addEventListener('click', async (e) => {
            e.stopPropagation();
            const text = input.value.trim();
            if (!text) return;
            const tempDiv = createElement('div', 'comment');
            tempDiv.dataset.commentId = 'temp-' + Date.now();
            tempDiv.innerHTML = `<div class="comment-meta"><span class="comment-author">${escapeHtml(currentUser)}</span></div><div>${escapeHtml(text).replace(/\n/g,'<br>')}</div>`;
            container.querySelector('.feedback-comments').appendChild(tempDiv);
            input.disabled = submit.disabled = editorBtn.disabled = true;
            try {
                const newComment = await GithubAPI.addComment(item.id, text);
                tempDiv.dataset.commentId = newComment.id;
                invalidateCache(item.id);
                const updated = await GithubAPI.loadComments(item.id);
                setCached(`comments_${item.id}`, updated, commentsCache);
                renderComments(container.querySelector('.feedback-comments'), updated, currentUser, item.id);
                UIUtils.showToast('Комментарий добавлен', 'success');
            } catch {
                UIUtils.showToast('Ошибка', 'error');
                tempDiv.remove();
            } finally {
                input.disabled = submit.disabled = editorBtn.disabled = false;
                input.value = '';
            }
        });

        editorBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('open-comment-editor', { detail: { issueNumber: item.id } }));
        });
    }

    function addHeaderActions(modalHeader, item, issue, currentUser, closeModal, escHandler) {
        const isAdmin = GithubAuth.isAdmin();
        const hasRepo = GithubAuth.hasScope('repo');
        const hasGist = GithubAuth.hasScope('gist');
        const postUrl = `${location.origin}${location.pathname}?post=${item.id}`;
        const actions = createElement('div', 'modal-header-actions', { display: 'flex', gap: '4px', alignItems: 'center', marginRight: 'auto' });

        let btns = '';
        if (hasRepo && (isAdmin || (currentUser && issue.user.login === currentUser))) {
            btns += `<button class="action-btn edit-issue" title="Редактировать"><i class="fas fa-edit"></i></button>`;
            btns += `<button class="action-btn close-issue" title="Закрыть"><i class="fas fa-trash-alt"></i></button>`;
        }
        btns += `<button class="action-btn share-post" title="Поделиться"><i class="fas fa-share-alt"></i></button>`;
        if (currentUser) {
            btns += `<button class="action-btn bookmark-post" title="В избранное"><i class="fas fa-bookmark"></i></button>`;
        }
        actions.innerHTML = btns;
        modalHeader.querySelector('.modal-close')?.before(actions);

        actions.querySelector('.edit-issue')?.addEventListener('click', (e) => {
            e.stopPropagation(); closeModal(); document.removeEventListener('keydown', escHandler);
            let postType = 'feedback';
            if (item.labels?.includes('type:news')) postType = 'news';
            else if (item.labels?.includes('type:update')) postType = 'update';
            openEditorModal('edit', { number: item.id, title: issue.title, body: issue.body, game: item.game }, postType);
        });
        actions.querySelector('.close-issue')?.addEventListener('click', async (e) => {
            e.stopPropagation(); if (!confirm('Закрыть?')) return;
            try {
                await GithubAPI.closeIssue(item.id);
                closeModal(); document.removeEventListener('keydown', escHandler);
                if (window.refreshNewsFeed) window.refreshNewsFeed();
                if (window.refreshGameUpdates && item.game) window.refreshGameUpdates(item.game);
                UIUtils.showToast('Закрыто', 'success');
            } catch { UIUtils.showToast('Ошибка', 'error'); }
        });
        actions.querySelector('.share-post')?.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(postUrl).then(() => UIUtils.showToast('Ссылка скопирована', 'success')).catch(() => UIUtils.showToast('Ошибка', 'error'));
        });
        actions.querySelector('.bookmark-post')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!window.BookmarkStorage) {
                try {
                    await loadModule('js/features/storage.js');
                } catch (err) {
                    return UIUtils.showToast('Не удалось загрузить хранилище', 'error');
                }
            }
            if (!window.BookmarkStorage) return UIUtils.showToast('Хранилище не загружено', 'error');
            BookmarkStorage.addBookmark({
                url: postUrl,
                title: item.title,
                type: 'post',
                thumbnail: extractFirstImage(issue.body) || 'images/default-news.webp',
                postData: {
                    id: item.id,
                    title: item.title,
                    body: issue.body,
                    author: item.author,
                    date: item.date instanceof Date ? item.date.toISOString() : item.date,
                    labels: item.labels,
                    game: item.game
                }
            }).then(() => UIUtils.showToast('Добавлено в избранное', 'success'))
              .catch(err => UIUtils.showToast('Ошибка: ' + err.message, 'error'));
        });
    }

    function extractFirstImage(body) {
        const m = body?.match(/!\[.*?\]\((.*?)\)/);
        return m ? m[1] : null;
    }

    async function openFullModal(item) {
        const currentUser = GithubAuth.getCurrentUser();
        const { modal, closeModal } = UIUtils.createModal(item.title, '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>', { size: 'full' });
        const container = modal.querySelector('.modal-body');
        const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
        document.addEventListener('keydown', escHandler);
        try {
            const issue = await GithubAPI.loadIssue(item.id);
            if (issue.state === 'closed') {
                container.innerHTML = '<p class="error-message">Пост закрыт.</p>';
                return;
            }
            container.innerHTML = '';
            const header = createElement('div', 'modal-post-header', { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' });
            const icon = item.labels?.includes('type:news') ? '📰' : item.labels?.includes('type:update') ? '🔄' : item.labels?.includes('type:idea') ? '💡' : item.labels?.includes('type:bug') ? '🐛' : item.labels?.includes('type:review') ? '⭐' : '📌';
            header.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:24px;">${icon}</span><span style="color:var(--accent);">${escapeHtml(item.author)}</span></div>${item.game ? `<span class="feedback-label">${escapeHtml(item.game)}</span>` : ''}`;
            container.appendChild(header);
            addHeaderActions(modal.querySelector('.modal-header'), item, issue, currentUser, closeModal, escHandler);

            let finalBody = issue.body;
            const allowed = extractAllowed(issue.body);
            if (item.labels?.includes('private') && allowed && currentUser && allowed.split(',').map(s=>s.trim()).includes(currentUser)) {
                try { finalBody = decryptPrivateBody(finalBody, allowed); } catch {}
            }
            await renderPostBody(container, finalBody, item.id);
            await loadReactionsAndComments(container, item, currentUser);
            if (currentUser) setupCommentForm(container, item, currentUser);
        } catch {
            container.innerHTML = '<p class="error-message">Ошибка загрузки.</p>';
            setTimeout(() => { closeModal(); document.removeEventListener('keydown', escHandler); }, 3000);
        }
    }

    function canViewPost(body, labels, currentUser) {
        if (!labels.includes('private')) return true;
        if (GithubAuth.isAdmin()) return true;
        const allowed = extractAllowed(body);
        if (!allowed) return false;
        return allowed.split(',').map(s=>s.trim()).includes(currentUser);
    }

    // ---------- openEditorModal (исправлен) ----------
    function openEditorModal(mode, data, postType = 'feedback') {
        if (!GithubAuth.hasScope('repo')) return UIUtils.showToast('Нужен scope "repo"', 'error');
        const currentUser = GithubAuth.getCurrentUser();
        const title = mode === 'edit' ? 'Редактирование' : 'Новое сообщение';

        let previewUrl = '';
        let bodyContent = data.body || '';
        const previewMatch = bodyContent.match(/<!--\s*preview:\s*(https?:\/\/[^\s]+)\s*-->/);
        if (previewMatch) {
            previewUrl = previewMatch[1];
            bodyContent = bodyContent.replace(previewMatch[0]+'\n', '');
        }

        let allowedUsers = '';
        const allowedMatch = bodyContent.match(/<!--\s*allowed:\s*(.*?)\s*-->/);
        if (allowedMatch) {
            allowedUsers = allowedMatch[1];
            bodyContent = bodyContent.replace(allowedMatch[0]+'\n', '');
        }

        let categoryHtml = '';
        if (postType === 'feedback') {
            let curCat = 'idea';
            if (data.labels) {
                const tl = data.labels.find(l => l.startsWith('type:'));
                if (tl) curCat = tl.split(':')[1];
            }
            categoryHtml = `<select id="modal-category" class="feedback-select"><option value="idea" ${curCat==='idea'?'selected':''}>💡 Идея</option><option value="bug" ${curCat==='bug'?'selected':''}>🐛 Баг</option><option value="review" ${curCat==='review'?'selected':''}>⭐ Отзыв</option></select>`;
        }

        const draftKey = postType === 'comment' ? `draft_comment_${data.issueNumber||'new'}` : `draft_${postType}_${mode}_${data.game||'global'}_${data.number||'new'}`;
        const isPrivate = data.labels?.includes('private') || false;

        const html = postType === 'comment' ? `
            <div class="feedback-form">
                <div id="modal-editor-toolbar"></div>
                <textarea id="modal-body" class="feedback-textarea" rows="10">${escapeHtml(bodyContent)}</textarea>
                <div class="button-group" style="display:flex; justify-content:flex-end; margin-top:15px;">
                    <button class="button" id="modal-submit">${mode==='edit'?'Сохранить':'Отправить'}</button>
                </div>
            </div>
        ` : `
            <div class="feedback-form">
                <input type="text" id="modal-input-title" class="feedback-input" placeholder="Заголовок" value="${escapeHtml(data.title||'')}">
                <div class="preview-url-wrapper">
                    <input type="url" id="modal-preview-url" class="feedback-input" placeholder="Ссылка на превью" value="${escapeHtml(previewUrl)}">
                    <div id="preview-services-placeholder"></div>
                </div>
                <div class="preview-thumbnail" id="modal-preview-thumb" style="display: ${previewUrl ? 'block' : 'none'}; position:relative;">
                    <img id="modal-preview-img" src="" alt="preview" style="max-width:100%; border-radius:12px;">
                    <button class="remove-preview" id="modal-remove-preview" type="button">×</button>
                </div>
                ${categoryHtml}
                <div id="modal-editor-toolbar"></div>
                <div class="editor-split">
                    <div class="editor-split-left">
                        <textarea id="modal-body" class="feedback-textarea" rows="12">${escapeHtml(bodyContent)}</textarea>
                    </div>
                    <div class="editor-split-right" id="modal-preview-area"></div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px; flex-wrap:wrap; gap:10px;">
                    <div class="access-switch">
                        <button type="button" class="access-switch-btn ${!isPrivate?'active':''}" data-access="public">Публичный</button>
                        <button type="button" class="access-switch-btn ${isPrivate?'active':''}" data-access="private">Приватный</button>
                    </div>
                    <input type="text" id="private-users" class="private-users-input" placeholder="Ники через запятую" value="${escapeHtml(allowedUsers)}" style="${isPrivate?'':'display:none;'}">
                    <button class="button" id="modal-submit">${mode==='edit'?'Сохранить':'Опубликовать'}</button>
                </div>
            </div>
        `;

        const { modal, closeModal } = UIUtils.createModal(title, html, { size: 'full' });
        const textarea = modal.querySelector('#modal-body');
        const toolbarDiv = modal.querySelector('#modal-editor-toolbar');
        if (window.Editor) toolbarDiv.appendChild(Editor.createEditorToolbar(textarea));

        if (postType !== 'comment') {
            const previewArea = modal.querySelector('#modal-preview-area');
            const previewUrlInput = modal.querySelector('#modal-preview-url');
            const previewThumb = modal.querySelector('#modal-preview-thumb');
            const previewImg = modal.querySelector('#modal-preview-img');
            const removeBtn = modal.querySelector('#modal-remove-preview');
            const servicesPlaceholder = modal.querySelector('#preview-services-placeholder');

            // синхронизация высоты
            const syncHeight = () => {
                const left = modal.querySelector('.editor-split-left');
                const right = modal.querySelector('.editor-split-right');
                if (left && right) {
                    right.style.height = left.offsetHeight + 'px';
                }
            };
            textarea.addEventListener('input', syncHeight);
            new ResizeObserver(syncHeight).observe(textarea);

            // предпросмотр Markdown
            const updatePreview = () => {
                previewArea.innerHTML = textarea.value ? renderMarkdown(textarea.value) : '<p class="text-secondary">Предпросмотр</p>';
                syncHeight();
            };
            textarea.addEventListener('input', updatePreview);
            updatePreview();

            // превью‑изображение (без fetch, кэшируем URL)
            let lastPreviewUrl = previewUrl;
            const loadPreviewThumb = () => {
                const url = previewUrlInput.value.trim();
                if (!url) {
                    previewThumb.style.display = 'none';
                    lastPreviewUrl = '';
                    return;
                }
                if (url === lastPreviewUrl) return; // уже показано
                // показываем картинку, браузер закэширует
                previewImg.src = url;
                previewThumb.style.display = 'block';
                lastPreviewUrl = url;
            };
            previewUrlInput.addEventListener('input', debounce(loadPreviewThumb, 300));
            loadPreviewThumb(); // начальная установка

            removeBtn.addEventListener('click', () => {
                previewUrlInput.value = '';
                previewThumb.style.display = 'none';
                lastPreviewUrl = '';
            });

            if (servicesPlaceholder && window.Editor) servicesPlaceholder.appendChild(Editor.createImageServicesMenu());

            // переключатель доступа
            const publicBtn = modal.querySelector('[data-access="public"]');
            const privateBtn = modal.querySelector('[data-access="private"]');
            const privateInput = modal.querySelector('#private-users');
            publicBtn.addEventListener('click', () => {
                publicBtn.classList.add('active');
                privateBtn.classList.remove('active');
                privateInput.style.display = 'none';
            });
            privateBtn.addEventListener('click', () => {
                privateBtn.classList.add('active');
                publicBtn.classList.remove('active');
                privateInput.style.display = 'block';
            });
        }

        // отправка формы
        modal.querySelector('#modal-submit').addEventListener('click', async (e) => {
            e.preventDefault();
            if (!GithubAuth.hasScope('repo')) return UIUtils.showToast('Недостаточно прав', 'error');
            const body = textarea.value.trim();
            if (!body) return UIUtils.showToast('Заполните описание', 'error');

            if (postType === 'comment') {
                try {
                    await GithubAPI.addComment(data.issueNumber, body);
                    UIUtils.clearDraft(draftKey);
                    closeModal();
                    window.dispatchEvent(new CustomEvent('github-comment-created', { detail: { issueNumber: data.issueNumber } }));
                    UIUtils.showToast('Комментарий добавлен', 'success');
                } catch (err) { UIUtils.showToast('Ошибка: ' + err.message, 'error'); }
                return;
            }

            const titleVal = modal.querySelector('#modal-input-title').value.trim();
            if (!titleVal) return UIUtils.showToast('Заполните заголовок', 'error');

            let finalBody = body;
            const newPreviewUrl = modal.querySelector('#modal-preview-url').value.trim();
            const isPrivate = modal.querySelector('[data-access="private"]').classList.contains('active');
            const allowed = isPrivate ? modal.querySelector('#private-users').value.trim() : '';

            const existingPreview = finalBody.match(/<!--\s*preview:\s*(https?:\/\/[^\s]+)\s*-->/);
            if (newPreviewUrl) {
                if (existingPreview) {
                    finalBody = finalBody.replace(existingPreview[0], `<!-- preview: ${newPreviewUrl} -->`);
                    if (!/!\[Preview\]\(/.test(finalBody)) {
                        finalBody = finalBody.replace(/(<!-- preview: .*? -->)/, `$1\n\n![Preview](${newPreviewUrl})`);
                    }
                } else {
                    finalBody = `<!-- preview: ${newPreviewUrl} -->\n\n![Preview](${newPreviewUrl})\n\n` + finalBody;
                }
            } else if (existingPreview) {
                finalBody = finalBody.replace(existingPreview[0], '').replace(/!\[Preview\]\(.*?\)\n?/g, '');
            }

            if (isPrivate && allowed) {
                finalBody = `<!-- allowed: ${allowed} -->\n\n` + finalBody;
                finalBody = GithubCore.encryptPrivateBody(finalBody, allowed);
                finalBody = `<!-- encrypted -->\n\n` + finalBody;
            }

            let category = 'idea';
            if (postType === 'feedback') category = modal.querySelector('#modal-category').value;
            const labels = postType === 'feedback' ? [`game:${data.game}`, `type:${category}`] : postType === 'news' ? ['type:news'] : ['type:update', `game:${data.game}`];
            if (isPrivate) labels.push('private');

            try {
                if (mode === 'edit') await GithubAPI.updateIssue(data.number, { title: titleVal, body: finalBody, labels });
                else await GithubAPI.createIssue(titleVal, finalBody, labels);
                UIUtils.clearDraft(draftKey);
                closeModal();
                if (postType === 'feedback' && window.refreshNewsFeed) window.refreshNewsFeed();
                if (postType === 'update' && window.refreshGameUpdates) window.refreshGameUpdates(data.game);
                if (postType === 'news' && window.refreshNewsFeed) window.refreshNewsFeed();
                UIUtils.showToast(mode === 'edit' ? 'Сохранено' : 'Опубликовано', 'success');
            } catch (err) { UIUtils.showToast('Ошибка: ' + err.message, 'error'); }
        });
    }

    window.addEventListener('open-comment-editor', (e) => openEditorModal('new', { issueNumber: e.detail.issueNumber }, 'comment'));

    window.UIFeedback = {
        renderReactions, renderComments, openFullModal, openEditorModal,
        renderPostBody, canViewPost, REACTION_TYPES, invalidateCache
    };
})();