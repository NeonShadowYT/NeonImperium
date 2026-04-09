// js/components/ui.js
(function() {
    const { escapeHtml, stripHtml, renderMarkdown, createModal, showToast, loadMarked } = NeonUtils;
    const { REACTION_TYPES, DEFAULT_IMAGE } = NeonConfig;
    const { getState } = NeonState;

    // ---------- Реакции ----------
    function renderReactions(container, issueNumber, reactions, onAdd, onRemove) {
        const currentUser = getState('currentUser');
        const grouped = {};
        REACTION_TYPES.forEach(t => grouped[t.content] = { ...t, count: 0, userReacted: false, userReactionId: null });
        reactions.forEach(r => {
            if (grouped[r.content]) {
                grouped[r.content].count++;
                if (currentUser && r.user?.login === currentUser) {
                    grouped[r.content].userReacted = true;
                    grouped[r.content].userReactionId = r.id;
                }
            }
        });
        const sorted = Object.values(grouped).filter(g => g.count > 0).sort((a,b) => b.count - a.count);
        const visible = sorted.slice(0,3);
        const hiddenCount = sorted.length - 3;

        let html = visible.map(g => `
            <button class="reaction-button ${g.userReacted ? 'active' : ''}" data-content="${g.content}" data-reaction-id="${g.userReactionId||''}" ${!currentUser?'disabled':''}>
                <span class="reaction-emoji">${g.emoji}</span><span class="reaction-count">${g.count}</span>
            </button>
        `).join('');

        if (currentUser) {
            html += hiddenCount > 0
                ? `<button class="reaction-add-btn" data-more>+${hiddenCount}</button>`
                : `<button class="reaction-add-btn" data-add>+</button>`;
        }
        container.innerHTML = html;

        if (!currentUser) return;

        container.querySelectorAll('.reaction-button:not([disabled])').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const content = btn.dataset.content;
                const reactionId = btn.dataset.reactionId;
                const isActive = btn.classList.contains('active');
                if (isActive && reactionId) {
                    btn.classList.remove('active');
                    const countSpan = btn.querySelector('.reaction-count');
                    countSpan.textContent = parseInt(countSpan.textContent) - 1;
                    try {
                        await onRemove(issueNumber, parseInt(reactionId));
                    } catch (err) {
                        btn.classList.add('active');
                        countSpan.textContent = parseInt(countSpan.textContent) + 1;
                        showToast('Ошибка удаления реакции', 'error');
                    }
                } else if (!isActive) {
                    btn.classList.add('active');
                    const countSpan = btn.querySelector('.reaction-count');
                    countSpan.textContent = parseInt(countSpan.textContent) + 1;
                    try {
                        await onAdd(issueNumber, content);
                    } catch (err) {
                        btn.classList.remove('active');
                        countSpan.textContent = parseInt(countSpan.textContent) - 1;
                        showToast('Ошибка добавления реакции', 'error');
                    }
                }
            });
        });

        const addBtn = container.querySelector('[data-add],[data-more]');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showReactionMenu(addBtn, issueNumber, onAdd);
            });
        }
    }

    function showReactionMenu(anchor, issueNumber, onAdd) {
        document.querySelector('.reaction-menu')?.remove();
        const menu = document.createElement('div');
        menu.className = 'reaction-menu';
        menu.style.cssText = 'position:absolute;background:var(--bg-card);border:1px solid var(--border);border-radius:30px;padding:5px;display:flex;gap:5px;z-index:10010;box-shadow:var(--shadow);';
        REACTION_TYPES.forEach(type => {
            const btn = document.createElement('button');
            btn.className = 'reaction-menu-btn';
            btn.innerHTML = type.emoji;
            btn.addEventListener('click', async () => {
                menu.remove();
                await onAdd(issueNumber, type.content);
            });
            menu.appendChild(btn);
        });
        const rect = anchor.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + window.scrollY + 5) + 'px';
        document.body.appendChild(menu);
        const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); } };
        setTimeout(() => document.addEventListener('click', close), 10);
    }

    // ---------- Комментарии ----------
    function renderComments(container, comments, issueNumber, currentUser) {
        container.innerHTML = '';
        comments.filter(c => !c.body.trim().startsWith('!vote')).forEach(c => {
            const div = document.createElement('div');
            div.className = 'comment';
            div.dataset.commentId = c.id;
            const isAuthor = currentUser && c.user.login === currentUser;
            const isAdmin = GithubAuth.isAdmin();
            const canEdit = isAuthor || isAdmin;
            div.innerHTML = `
                <div class="comment-meta"><span class="comment-author">${escapeHtml(c.user.login)}</span></div>
                <div class="comment-body">${escapeHtml(c.body).replace(/\n/g,'<br>')}</div>
                ${canEdit ? `<div class="comment-actions">
                    <button class="comment-edit" data-id="${c.id}" data-body="${escapeHtml(c.body)}"><i class="fas fa-edit"></i></button>
                    <button class="comment-delete" data-id="${c.id}"><i class="fas fa-trash-alt"></i></button>
                </div>` : ''}
            `;
            container.appendChild(div);
        });

        if (currentUser) {
            container.querySelectorAll('.comment-edit').forEach(btn => {
                btn.addEventListener('click', () => openEditCommentModal(btn.dataset.id, btn.dataset.body, issueNumber));
            });
            container.querySelectorAll('.comment-delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const div = btn.closest('.comment');
                    div.remove();
                    try {
                        await NeonAPI.deleteComment(btn.dataset.id);
                        showToast('Комментарий удалён', 'success');
                    } catch (err) {
                        showToast('Ошибка удаления', 'error');
                        container.appendChild(div);
                    }
                });
            });
        }
    }

    function openEditCommentModal(commentId, currentBody, issueNumber) {
        const { modal, closeModal } = createModal('Редактировать комментарий', `
            <div class="feedback-form">
                <div id="edit-toolbar"></div>
                <textarea id="edit-comment-body" class="feedback-textarea" rows="10">${currentBody}</textarea>
                <div class="button-group">
                    <button class="button" id="edit-save">Сохранить</button>
                    <button class="button" id="edit-cancel">Отмена</button>
                </div>
            </div>
        `, { size: 'full' });
        const textarea = modal.querySelector('#edit-comment-body');
        const toolbar = modal.querySelector('#edit-toolbar');
        if (window.Editor) {
            toolbar.appendChild(Editor.createEditorToolbar(textarea));
        }
        modal.querySelector('#edit-save').addEventListener('click', async () => {
            const newBody = textarea.value.trim();
            if (!newBody) return showToast('Комментарий не может быть пустым', 'error');
            try {
                await NeonAPI.updateComment(commentId, newBody);
                closeModal();
                showToast('Комментарий обновлён', 'success');
                window.dispatchEvent(new CustomEvent('comment-updated', { detail: { issueNumber } }));
            } catch (err) {
                showToast('Ошибка сохранения', 'error');
            }
        });
        modal.querySelector('#edit-cancel').addEventListener('click', closeModal);
    }

    // ---------- Опросы ----------
    async function renderPoll(container, issueNumber, pollData, existingComments) {
        const currentUser = getState('currentUser');
        const voteComments = existingComments.filter(c => /^!vote \d+$/.test(c.body.trim()));
        const voteCounts = pollData.options.map((_, idx) => voteComments.filter(c => c.body.trim() === `!vote ${idx}`).length);
        const totalVotes = voteCounts.reduce((s,v)=>s+v,0);
        const userVoted = currentUser ? voteComments.some(c => c.user.login === currentUser) : false;

        const pollDiv = document.createElement('div');
        pollDiv.className = 'poll card';
        pollDiv.dataset.issue = issueNumber;
        let html = `<h3>📊 ${escapeHtml(pollData.question)}</h3><div class="poll-options">`;

        pollData.options.forEach((option, index) => {
            const count = voteCounts[index];
            const percent = totalVotes > 0 ? Math.round((count/totalVotes)*100) : 0;
            html += `<div class="poll-option" data-index="${index}">
                <div class="poll-option-text">${escapeHtml(option)}</div>`;
            if (!currentUser) {
                // ничего
            } else if (!userVoted) {
                html += `<button class="button poll-vote-btn" data-option="${index}">Голосовать</button>`;
            } else {
                html += `<div class="progress-bar"><div style="width:${percent}%;">${percent}% (${count})</div></div>`;
            }
            html += '</div>';
        });
        html += '</div>';
        if (!currentUser) html += '<p class="text-secondary small"><i class="fas fa-info-circle"></i> Чтобы голосовать, <a href="#" id="poll-login-link">войдите</a>.</p>';
        else if (!userVoted) html += '<p class="text-secondary small">Вы ещё не голосовали.</p>';
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
                        await NeonAPI.addComment(issueNumber, `!vote ${optionIndex}`);
                        showToast('Голос учтён', 'success');
                        const updatedComments = await NeonAPI.loadComments(issueNumber);
                        await renderPoll(container, issueNumber, pollData, updatedComments);
                    } catch (err) {
                        showToast('Ошибка при голосовании', 'error');
                        btn.disabled = false;
                    }
                });
            });
        }

        const loginLink = pollDiv.querySelector('#poll-login-link');
        if (loginLink) {
            loginLink.addEventListener('click', (e) => {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('github-login-requested'));
            });
        }
    }

    // ---------- Универсальная карточка ----------
    function createCard(item, onClick) {
        const card = document.createElement('div');
        card.className = 'project-card-link';
        card.style.cursor = 'pointer';
        const inner = document.createElement('div');
        inner.className = 'project-card';

        let thumbnail, title, meta, preview;
        if (item.type === 'video') {
            thumbnail = item.thumbnail;
            title = item.title;
            meta = `<i class="fas fa-user"></i> ${escapeHtml(item.author)} · ${new Date(item.date).toLocaleDateString()}`;
            preview = '';
        } else {
            const imgMatch = item.body?.match(/!\[.*?\]\((.*?)\)/);
            thumbnail = imgMatch ? imgMatch[1] : DEFAULT_IMAGE;
            title = item.title;
            meta = `<i class="fas fa-user"></i> ${escapeHtml(item.author)} · ${new Date(item.date).toLocaleDateString()}`;
            preview = NeonUtils.extractSummary(item.body) || stripHtml(item.body).substring(0,120)+'…';
        }

        inner.innerHTML = `
            <div class="image-wrapper"><img src="${thumbnail}" alt="${escapeHtml(title)}" class="project-image" loading="lazy" onerror="this.src='${DEFAULT_IMAGE}'"></div>
            <h3>${escapeHtml(title.length > 70 ? title.substring(0,70)+'…' : title)}</h3>
            <p class="text-secondary" style="font-size:12px">${meta}</p>
            ${preview ? `<p class="text-secondary" style="font-size:13px; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;">${escapeHtml(preview)}</p>` : ''}
            ${item.type === 'video' ? '<span class="button"><i class="fas fa-play"></i> Смотреть</span>' : ''}
        `;
        card.appendChild(inner);
        card.addEventListener('click', (e) => { e.preventDefault(); onClick(item); });
        return card;
    }

    window.UIComponents = {
        renderReactions,
        showReactionMenu,
        renderComments,
        openEditCommentModal,
        renderPoll,
        createCard
    };
})();