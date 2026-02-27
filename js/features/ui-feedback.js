// ui-feedback.js – общие компоненты: реакции, комментарии, модалки, посты

(function() {
    const REACTION_TYPES = [
        { content: '+1', emoji: '👍' }, { content: '-1', emoji: '👎' }, { content: 'laugh', emoji: '😄' },
        { content: 'confused', emoji: '😕' }, { content: 'heart', emoji: '❤️' }, { content: 'hooray', emoji: '🎉' },
        { content: 'rocket', emoji: '🚀' }, { content: 'eyes', emoji: '👀' }
    ];
    const CACHE_TTL = 5 * 60 * 1000;
    const reactionsCache = new Map(), commentsCache = new Map(), reactionLocks = new Map();

    function getCached(key, map) { const c = map.get(key); return (c && Date.now() - c.timestamp < CACHE_TTL) ? c.data : null; }
    function setCached(key, data, map) { map.set(key, { data, timestamp: Date.now() }); }
    function invalidateCache(issueNumber) {
        reactionsCache.delete(`reactions_${issueNumber}`);
        commentsCache.delete(`comments_${issueNumber}`);
        window.reactionsListCache?.delete(`list_reactions_${issueNumber}`);
    }

    function groupReactions(reactions, user) {
        const grouped = Object.fromEntries(REACTION_TYPES.map(t => [t.content, { ...t, count:0, userReacted:false, userReactionId:null }]));
        reactions.forEach(r => {
            if (grouped[r.content]) {
                grouped[r.content].count++;
                if (user && r.user?.login === user) {
                    grouped[r.content].userReacted = true;
                    grouped[r.content].userReactionId = r.id;
                }
            }
        });
        return Object.values(grouped).filter(g => g.count > 0).sort((a,b) => b.count - a.count);
    }

    function renderReactions(container, issueNum, reactions, user, onAdd, onRemove) {
        if (!container) return;
        const grouped = groupReactions(reactions, user);
        const visible = grouped.slice(0,3), hidden = grouped.length - 3;
        container.innerHTML = visible.map(g => `<button class="reaction-button ${g.userReacted ? 'active' : ''}" data-content="${g.content}" data-reaction-id="${g.userReactionId||''}" data-count="${g.count}" ${!user ? 'disabled' : ''}><span class="reaction-emoji">${g.emoji}</span><span class="reaction-count">${g.count}</span></button>`).join('') +
            (user ? (hidden > 0 ? `<button class="reaction-add-btn" data-more><span>+${hidden}</span></button>` : `<button class="reaction-add-btn" data-add><span>+</span></button>`) : '');
        if (!user) return;

        container.querySelectorAll('.reaction-button').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const content = btn.dataset.content, rid = btn.dataset.reactionId, active = btn.classList.contains('active');
                const countSpan = btn.querySelector('.reaction-count'), old = +countSpan.textContent, lockKey = `${issueNum}_${content}`;
                if (reactionLocks.has(lockKey)) return;
                if (active && rid) {
                    reactionLocks.set(lockKey, true);
                    btn.classList.remove('active');
                    countSpan.textContent = old - 1;
                    if (old - 1 === 0) btn.style.display = 'none';
                    try { await onRemove(issueNum, +rid); } catch { UIUtils.showToast('Ошибка', 'error'); btn.classList.add('active'); countSpan.textContent = old; btn.style.display = ''; } finally { reactionLocks.delete(lockKey); }
                } else if (!active) {
                    reactionLocks.set(lockKey, true);
                    btn.classList.add('active');
                    countSpan.textContent = old + 1;
                    btn.dataset.reactionId = 'temp';
                    try { await onAdd(issueNum, content); } catch { UIUtils.showToast('Ошибка', 'error'); btn.classList.remove('active'); countSpan.textContent = old; btn.dataset.reactionId = ''; } finally { reactionLocks.delete(lockKey); }
                }
            });
        });

        const addBtn = container.querySelector('[data-add],[data-more]');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showReactionMenu(addBtn, issueNum, async (selected) => {
                    const lockKey = `${issueNum}_${selected}`;
                    if (reactionLocks.has(lockKey)) return;
                    reactionLocks.set(lockKey, true);
                    const existing = Array.from(container.querySelectorAll('.reaction-button')).find(b => b.dataset.content === selected);
                    if (existing) {
                        if (existing.classList.contains('active')) { reactionLocks.delete(lockKey); return; }
                        const countSpan = existing.querySelector('.reaction-count'), old = +countSpan.textContent;
                        existing.classList.add('active');
                        countSpan.textContent = old + 1;
                        existing.dataset.reactionId = 'temp';
                        try { await onAdd(issueNum, selected); } catch { UIUtils.showToast('Ошибка', 'error'); existing.classList.remove('active'); countSpan.textContent = old; existing.dataset.reactionId = ''; } finally { reactionLocks.delete(lockKey); }
                    } else {
                        const temp = document.createElement('button');
                        temp.className = 'reaction-button active';
                        temp.dataset.content = selected;
                        temp.dataset.reactionId = 'temp';
                        const e = REACTION_TYPES.find(t => t.content === selected).emoji;
                        temp.innerHTML = `<span class="reaction-emoji">${e}</span><span class="reaction-count">1</span>`;
                        container.insertBefore(temp, addBtn);
                        try { await onAdd(issueNum, selected); } catch { UIUtils.showToast('Ошибка', 'error'); temp.remove(); } finally { reactionLocks.delete(lockKey); }
                    }
                });
            });
        }
    }

    function showReactionMenu(relativeTo, issueNum, cb) {
        document.querySelectorAll('.reaction-menu').forEach(m => m.remove());
        const menu = document.createElement('div');
        menu.className = 'reaction-menu';
        menu.setAttribute('role', 'menu');
        Object.assign(menu.style, { position: 'absolute', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '30px', padding: '5px', display: 'flex', gap: '5px', zIndex: '10010', boxShadow: 'var(--shadow)' });
        REACTION_TYPES.forEach(t => {
            const btn = document.createElement('button');
            btn.className = 'reaction-menu-btn';
            btn.innerHTML = t.emoji;
            btn.onclick = (e) => { e.stopPropagation(); cb(t.content); document.body.removeChild(menu); relativeTo.focus(); };
            menu.appendChild(btn);
        });
        const rect = relativeTo.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + window.scrollY + 5) + 'px';
        document.body.appendChild(menu);
        setTimeout(() => {
            const close = (e) => { if (!menu.contains(e.target)) { document.body.removeChild(menu); document.removeEventListener('click', close); } };
            document.addEventListener('click', close);
        }, 100);
    }

    function renderComments(container, comments, user, issueNum) {
        const regular = comments.filter(c => !c.body.trim().startsWith('!vote'));
        container.innerHTML = regular.map(c => {
            const isAuthor = user && c.user.login === user, isAdmin = GithubAuth.isAdmin(), canEdit = isAuthor || isAdmin;
            return `<div class="comment" data-comment-id="${c.id}"><div class="comment-meta"><span class="comment-author">${GithubCore.escapeHtml(c.user.login)}</span><span>${new Date(c.created_at).toLocaleString()}</span></div><div class="comment-body">${GithubCore.escapeHtml(c.body).replace(/\n/g,'<br>')}</div>${canEdit ? `<div class="comment-actions"><button class="comment-edit" data-comment-id="${c.id}" data-comment-body="${GithubCore.escapeHtml(c.body)}" title="Редактировать"><i class="fas fa-edit"></i></button><button class="comment-delete" data-comment-id="${c.id}" title="Удалить"><i class="fas fa-trash-alt"></i></button></div>` : ''}</div>`;
        }).join('');
        if (!user) return;
        container.querySelectorAll('.comment-edit').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); openEditCommentModal(btn.dataset.commentId, btn.dataset.commentBody, issueNum); }));
        container.querySelectorAll('.comment-delete').forEach(btn => btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const div = btn.closest('.comment');
            div.remove();
            try { await GithubAPI.deleteComment(btn.dataset.commentId); invalidateCache(issueNum); UIUtils.showToast('Удалено', 'success'); } catch { UIUtils.showToast('Ошибка', 'error'); container.appendChild(div); }
        }));
    }

    function openEditCommentModal(commentId, currentBody, issueNum) {
        const { modal, closeModal } = UIUtils.createModal('Редактировать', `<div class="feedback-form"><textarea id="edit-comment-body" class="feedback-textarea" rows="5">${GithubCore.escapeHtml(currentBody)}</textarea><div style="margin-top:15px;"><button class="button" id="edit-comment-save">Сохранить</button><button class="button" id="edit-comment-cancel">Отмена</button></div></div>`, { size: 'small' });
        modal.querySelector('#edit-comment-save').addEventListener('click', async () => {
            const newBody = modal.querySelector('#edit-comment-body').value.trim();
            if (!newBody) return UIUtils.showToast('Пусто', 'error');
            try { await GithubAPI.updateComment(commentId, newBody); invalidateCache(issueNum); closeModal(); UIUtils.showToast('Обновлено', 'success'); } catch { UIUtils.showToast('Ошибка', 'error'); }
        });
        modal.querySelector('#edit-comment-cancel').addEventListener('click', closeModal);
    }

    async function loadReactionsWithCache(num) { return getCached(`reactions_${num}`, reactionsCache) || (setCached(`reactions_${num}`, await GithubAPI.loadReactions(num), reactionsCache), getCached(`reactions_${num}`, reactionsCache)); }
    async function loadCommentsWithCache(num) { return getCached(`comments_${num}`, commentsCache) || (setCached(`comments_${num}`, await GithubAPI.loadComments(num), commentsCache), getCached(`comments_${num}`, commentsCache)); }

    function extractPollFromBody(body) { const m = /<!-- poll: (.*?) -->/.exec(body); return m ? JSON.parse(m[1]) : null; }

    async function renderPostBody(container, body, issueNum) {
        container.innerHTML = GithubCore.renderMarkdown(body);
        container.classList.add('markdown-body');
        const poll = extractPollFromBody(body);
        if (poll) {
            const pc = document.createElement('div'); pc.className = 'poll-container';
            container.appendChild(pc);
            if (issueNum) await renderPoll(pc, issueNum, poll);
            else renderStaticPoll(pc, poll);
        }
    }

    function renderStaticPoll(container, poll) {
        container.innerHTML = `<div class="poll card"><h3>📊 ${GithubCore.escapeHtml(poll.question)}</h3><div class="poll-options static">${poll.options.map(o => `<div class="poll-option"><span class="poll-option-text">${GithubCore.escapeHtml(o)}</span></div>`).join('')}</div><p class="text-secondary small">(опрос после публикации)</p></div>`;
    }

    async function renderPoll(container, issueNum, poll) {
        const user = GithubAuth.getCurrentUser();
        const comments = await GithubAPI.loadComments(issueNum);
        const votes = comments.filter(c => /^!vote \d+$/.test(c.body.trim()));
        const counts = poll.options.map((_, i) => votes.filter(v => v.body.trim() === `!vote ${i}`).length);
        const total = counts.reduce((a,b)=>a+b,0);
        const userVoted = user ? votes.some(v => v.user.login === user) : false;
        let html = `<h3>📊 ${GithubCore.escapeHtml(poll.question)}</h3><div class="poll-options">`;
        poll.options.forEach((opt, i) => {
            const percent = total ? Math.round(counts[i]/total*100) : 0;
            html += `<div class="poll-option" data-index="${i}"><div class="poll-option-text">${GithubCore.escapeHtml(opt)}</div>`;
            if (!user) {}
            else if (!userVoted) html += `<button class="button poll-vote-btn" data-option="${i}">Голосовать</button>`;
            else html += `<div class="progress-bar"><div style="width:${percent}%;">${percent}% (${counts[i]})</div></div>`;
            html += '</div>';
        });
        html += '</div>';
        if (!user) html += `<p class="text-secondary small"><a href="#" id="poll-login-link">Войдите</a>, чтобы голосовать.</p>`;
        else if (!userVoted) html += '<p class="text-secondary small">Вы ещё не голосовали.</p>';
        container.innerHTML = html;
        if (user && !userVoted) {
            container.querySelectorAll('.poll-vote-btn').forEach(btn => btn.addEventListener('click', async (e) => {
                const i = btn.dataset.option;
                try { await GithubAPI.addComment(issueNum, `!vote ${i}`); UIUtils.showToast('Голос учтён', 'success'); await renderPoll(container, issueNum, poll); } catch { UIUtils.showToast('Ошибка', 'error'); }
            }));
        }
        const login = container.querySelector('#poll-login-link');
        if (login) login.addEventListener('click', (e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('github-login-requested')); });
    }

    // --- Вспомогательные функции для модалки поста ---
    async function loadReactionsAndComments(container, item, user, issue) {
        const rdiv = document.createElement('div'); rdiv.className = 'reactions-container';
        const cdiv = document.createElement('div'); cdiv.className = 'feedback-comments';
        container.append(rdiv, cdiv);
        const reactions = await loadReactionsWithCache(item.id);
        renderReactions(rdiv, item.id, reactions, user,
            (num, c) => GithubAPI.addReaction(num, c).then(() => invalidateCache(num)),
            (num, rid) => GithubAPI.removeReaction(num, rid).then(() => invalidateCache(num)));
        const comments = await loadCommentsWithCache(item.id);
        renderComments(cdiv, comments, user, item.id);
    }

    function setupCommentForm(container, item, user) {
        const form = document.createElement('div'); form.className = 'comment-form'; form.dataset.issue = item.id;
        form.innerHTML = `<input type="text" class="comment-input" placeholder="Комментарий..."><button class="button comment-submit">Отправить</button>`;
        container.appendChild(form);
        form.querySelector('.comment-submit').addEventListener('click', async (e) => {
            e.stopPropagation();
            const input = form.querySelector('.comment-input'), text = input.value.trim();
            if (!text) return;
            const temp = document.createElement('div'); temp.className = 'comment'; temp.dataset.commentId = 'temp';
            temp.innerHTML = `<div class="comment-meta"><span class="comment-author">${GithubCore.escapeHtml(user)}</span><span>только что</span></div><div>${GithubCore.escapeHtml(text).replace(/\n/g,'<br>')}</div>`;
            const commentsDiv = container.querySelector('.feedback-comments');
            commentsDiv.appendChild(temp);
            input.disabled = true; e.target.disabled = true;
            try {
                const newC = await GithubAPI.addComment(item.id, text);
                temp.dataset.commentId = newC.id;
                const span = temp.querySelector('.comment-meta span:last-child');
                span.textContent = new Date(newC.created_at).toLocaleString();
                invalidateCache(item.id);
                const upd = await GithubAPI.loadComments(item.id);
                setCached(`comments_${item.id}`, upd, commentsCache);
                renderComments(commentsDiv, upd, user, item.id);
                UIUtils.showToast('Комментарий добавлен', 'success');
            } catch { UIUtils.showToast('Ошибка', 'error'); temp.remove(); } finally { input.disabled = false; e.target.disabled = false; input.value = ''; }
        });
    }

    function setupAdminActions(container, item, issue, user, closeModal, escHandler) {
        const isAdmin = GithubAuth.isAdmin();
        if (!isAdmin && (!user || issue.user.login !== user)) return;
        const actions = document.createElement('div'); actions.className = 'feedback-item-actions';
        actions.innerHTML = '<button class="edit-issue" title="Редактировать"><i class="fas fa-edit"></i></button><button class="close-issue" title="Закрыть"><i class="fas fa-trash-alt"></i></button>';
        container.appendChild(actions);
        actions.querySelector('.edit-issue').addEventListener('click', (e) => {
            e.stopPropagation(); closeModal(); document.removeEventListener('keydown', escHandler);
            let type = 'feedback';
            if (item.labels?.includes('type:news')) type = 'news';
            else if (item.labels?.includes('type:update')) type = 'update';
            openEditorModal('edit', { number: item.id, title: issue.title, body: issue.body, game: item.game }, type);
        });
        actions.querySelector('.close-issue').addEventListener('click', async (e) => {
            e.stopPropagation(); if (!confirm('Закрыть?')) return;
            try { await GithubAPI.closeIssue(item.id); closeModal(); document.removeEventListener('keydown', escHandler); UIUtils.showToast('Закрыто', 'success'); } catch { UIUtils.showToast('Ошибка', 'error'); }
        });
    }

    function copyPostLink(issueNum) {
        const url = new URL(window.location); url.searchParams.set('post', issueNum);
        navigator.clipboard.writeText(url.toString()).then(() => UIUtils.showToast('Ссылка скопирована!', 'success')).catch(() => UIUtils.showToast('Ошибка копирования', 'error'));
    }

    async function openFullModal(item) {
        const user = GithubAuth.getCurrentUser();
        const { modal, closeModal } = UIUtils.createModal(item.title, '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>', { size: 'full' });
        const header = modal.querySelector('.modal-header');
        if (header) {
            const share = document.createElement('button');
            share.className = 'share-post-btn'; share.setAttribute('aria-label', 'Поделиться'); share.innerHTML = '<i class="fas fa-share-alt"></i>';
            share.addEventListener('click', (e) => { e.stopPropagation(); copyPostLink(item.id); });
            header.querySelector('h2').insertAdjacentElement('afterend', share);
        }
        const container = modal.querySelector('.modal-body');
        const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
        document.addEventListener('keydown', escHandler);
        try {
            const issue = await GithubAPI.loadIssue(item.id);
            container.innerHTML = '';
            const meta = document.createElement('div'); meta.className = 'modal-post-header';
            meta.style.cssText = 'display:flex; align-items:center; gap:16px; margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid var(--border); flex-wrap:wrap;';
            const typeIcon = item.labels?.includes('type:news') ? '📰' : item.labels?.includes('type:update') ? '🔄' : item.labels?.includes('type:idea') ? '💡' : item.labels?.includes('type:bug') ? '🐛' : item.labels?.includes('type:review') ? '⭐' : '📌';
            meta.innerHTML = `<div style="display:flex; align-items:center; gap:8px;"><span style="font-size:24px;">${typeIcon}</span><div><div style="font-size:14px; color:var(--accent);">${GithubCore.escapeHtml(item.author)}</div><div style="font-size:12px; color:var(--text-secondary);">${new Date(item.date).toLocaleString()}</div></div></div>${item.game ? `<span class="feedback-label" style="margin-left:auto;">${GithubCore.escapeHtml(item.game)}</span>` : ''}`;
            container.appendChild(meta);
            await renderPostBody(container, issue.body, item.id);
            await loadReactionsAndComments(container, item, user, issue);
            if (user) setupCommentForm(container, item, user);
            setupAdminActions(container, item, issue, user, closeModal, escHandler);
        } catch { container.innerHTML = '<p class="error-message">Не удалось загрузить пост</p>'; setTimeout(closeModal, 2000); }
    }

    function checkUrlForPost() {
        const id = new URLSearchParams(window.location.search).get('post');
        if (id && /^\d+$/.test(id)) {
            (async () => {
                try {
                    const issue = await GithubAPI.loadIssue(+id);
                    const game = issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null;
                    await openFullModal({ id: issue.number, title: issue.title, body: issue.body, author: issue.user.login, date: new Date(issue.created_at), game, labels: issue.labels.map(l => l.name) });
                    const url = new URL(window.location); url.searchParams.delete('post'); window.history.replaceState({}, '', url);
                } catch { UIUtils.showToast('Не удалось загрузить пост', 'error'); }
            })();
        }
    }

    function openEditorModal(mode, data, postType = 'feedback') {
        const title = mode === 'edit' ? 'Редактирование' : 'Новое сообщение';
        let previewUrl = '', body = data.body || '';
        const m = body.match(/<!--\s*preview:\s*(https?:\/\/[^\s]+)\s*-->/);
        if (m) { previewUrl = m[1]; body = body.replace(/<!--\s*preview:\s*https?:\/\/[^\s]+\s*-->\s*\n?/, ''); }
        const catHtml = postType === 'feedback' ? `<select id="modal-category" class="feedback-select"><option value="idea">💡 Идея</option><option value="bug">🐛 Баг</option><option value="review">⭐ Отзыв</option></select>` : '';
        const html = `<div class="feedback-form"><input type="text" id="modal-input-title" class="feedback-input" placeholder="Заголовок" value="${GithubCore.escapeHtml(data.title||'')}"><div class="preview-url-wrapper"><input type="url" id="modal-preview-url" class="feedback-input preview-url-input" placeholder="Ссылка на превью" value="${GithubCore.escapeHtml(previewUrl)}"><div id="preview-services-placeholder"></div></div><div id="preview-thumbnail-container" class="preview-thumbnail" style="${previewUrl ? '' : 'display:none;'}"><img id="preview-thumbnail-img" src="${previewUrl ? GithubCore.escapeHtml(previewUrl) : ''}" alt="Preview"><button type="button" class="remove-preview" id="remove-preview-btn"><i class="fas fa-times"></i></button></div>${catHtml}<div id="modal-editor-toolbar"></div><textarea id="modal-body" class="feedback-textarea" placeholder="Описание..." rows="10">${GithubCore.escapeHtml(body)}</textarea><div class="preview-area" id="modal-preview-area" style="display:none;"></div><div class="button-group" style="margin-top:10px;"><button class="button" id="modal-submit">${mode==='edit'?'Сохранить':'Опубликовать'}</button></div></div>`;

        const { modal, closeModal } = UIUtils.createModal(title, html, { size: 'full' });
        const sp = modal.querySelector('#preview-services-placeholder');
        if (sp && window.Editor) sp.appendChild(window.Editor.createImageServicesMenu());

        const previewInput = modal.querySelector('#modal-preview-url'), thumbContainer = modal.querySelector('#preview-thumbnail-container'), thumbImg = modal.querySelector('#preview-thumbnail-img'), removeBtn = modal.querySelector('#remove-preview-btn');
        const updateThumb = () => { const u = previewInput.value.trim(); if (u) { thumbImg.src = u; thumbContainer.style.display = 'block'; } else thumbContainer.style.display = 'none'; };
        previewInput.addEventListener('input', updateThumb);
        removeBtn.addEventListener('click', () => { previewInput.value = ''; updateThumb(); });

        const draftKey = `draft_${postType}_${mode}_${data.game||'global'}_${data.number||'new'}`;
        const saved = UIUtils.loadDraft(draftKey);
        if (saved && (saved.title || saved.body || saved.previewUrl) && confirm('Найден черновик. Восстановить?')) {
            modal.querySelector('#modal-input-title').value = saved.title || '';
            if (saved.previewUrl) { previewInput.value = saved.previewUrl; updateThumb(); }
            modal.querySelector('#modal-body').value = saved.body || '';
            if (saved.category && modal.querySelector('#modal-category')) modal.querySelector('#modal-category').value = saved.category;
        } else UIUtils.clearDraft(draftKey);

        let hasChanges = false;
        const titleInput = modal.querySelector('#modal-input-title'), bodyTA = modal.querySelector('#modal-body'), catSel = modal.querySelector('#modal-category');
        const saveDraft = () => { hasChanges = true; UIUtils.saveDraft(draftKey, { title: titleInput.value.trim(), previewUrl: previewInput.value.trim(), body: bodyTA.value.trim(), category: catSel?.value }); };
        titleInput.addEventListener('input', saveDraft);
        previewInput.addEventListener('input', saveDraft);
        bodyTA.addEventListener('input', saveDraft);
        catSel?.addEventListener('change', saveDraft);

        const originalClose = closeModal;
        const closeCheck = () => {
            if (hasChanges && !confirm('У вас есть несохранённые изменения. Закрыть?')) return;
            UIUtils.clearDraft(draftKey); originalClose();
        };
        modal.addEventListener('click', (e) => { if (e.target === modal) { e.preventDefault(); closeCheck(); } });
        document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { e.preventDefault(); closeCheck(); document.removeEventListener('keydown', esc); } });
        const closeBtn = modal.querySelector('.modal-close');
        if (closeBtn) { closeBtn.replaceWith(closeBtn.cloneNode(true)); modal.querySelector('.modal-close').addEventListener('click', (e) => { e.preventDefault(); closeCheck(); }); }

        const previewArea = modal.querySelector('#modal-preview-area');
        const updatePreview = () => {
            const t = titleInput.value.trim(), pu = previewInput.value.trim(), b = bodyTA.value;
            let full = '';
            if (pu) full += `<!-- preview: ${pu} -->\n\n![Preview](${pu})\n\n`;
            if (t && postType !== 'feedback') full += `# ${t}\n\n`;
            full += b;
            if (full.trim()) { previewArea.innerHTML = ''; previewArea.classList.add('markdown-body'); renderPostBody(previewArea, full, null); previewArea.style.display = 'block'; } else previewArea.style.display = 'none';
        };

        if (window.Editor) {
            const toolbar = Editor.createEditorToolbar(bodyTA, { onPreview: updatePreview, textarea: bodyTA });
            modal.querySelector('#modal-editor-toolbar').appendChild(toolbar);
        }

        modal.querySelector('#modal-submit').addEventListener('click', async (e) => {
            e.preventDefault();
            if (!GithubAuth.getToken()) return UIUtils.showToast('Вы не авторизованы', 'error');
            const title = titleInput.value.trim(), preview = previewInput.value.trim(), body = bodyTA.value;
            if (!title) return UIUtils.showToast('Заполните заголовок', 'error');
            if (!body.trim()) return UIUtils.showToast('Заполните описание', 'error');
            let finalBody = body;
            if (preview) finalBody = `<!-- preview: ${preview} -->\n\n![Preview](${preview})\n\n` + finalBody;
            const polls = finalBody.match(/<!-- poll: .*? -->/g);
            if (polls?.length > 1 && !confirm('Несколько опросов. Сохранить только первый?')) return;
            if (polls?.length > 1) { const first = polls[0]; finalBody = finalBody.replace(/<!-- poll: .*? -->/g, '') + first; }
            let category = 'idea';
            if (postType === 'feedback' && catSel) category = catSel.value;
            const btn = e.target; btn.disabled = true; btn.textContent = 'Сохранение...';
            try {
                let labels;
                if (postType === 'feedback') labels = [`game:${data.game}`, `type:${category}`];
                else if (postType === 'news') labels = ['type:news'];
                else labels = ['type:update', `game:${data.game}`];
                if (mode === 'edit') await GithubAPI.updateIssue(data.number, { title, body: finalBody, labels });
                else await GithubAPI.createIssue(title, finalBody, labels);
                UIUtils.clearDraft(draftKey);
                originalClose();
                if (postType === 'feedback' && window.refreshNewsFeed) window.refreshNewsFeed();
                if (postType === 'update' && window.refreshGameUpdates) window.refreshGameUpdates(data.game);
                if (postType === 'news' && window.refreshNewsFeed) window.refreshNewsFeed();
                UIUtils.showToast(mode === 'edit' ? 'Сохранено' : 'Опубликовано', 'success');
            } catch (err) {
                UIUtils.showToast('Ошибка: ' + (err.message || 'неизвестная'), 'error');
            } finally { btn.disabled = false; btn.textContent = mode === 'edit' ? 'Сохранить' : 'Опубликовать'; }
        });
    }

    // Инициализация при загрузке
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkUrlForPost);
    else checkUrlForPost();

    window.UIFeedback = { renderReactions, showReactionMenu, renderComments, openFullModal, openEditorModal, renderPostBody, REACTION_TYPES, invalidateCache, copyPostLink };
})();