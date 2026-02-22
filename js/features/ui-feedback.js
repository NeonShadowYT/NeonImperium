// ui-feedback.js — общие компоненты для реакций и комментариев

(function() {
    const REACTION_TYPES = [
        { content: '+1', emoji: '👍' },
        { content: '-1', emoji: '👎' },
        { content: 'laugh', emoji: '😄' },
        { content: 'confused', emoji: '😕' },
        { content: 'heart', emoji: '❤️' },
        { content: 'hooray', emoji: '🎉' },
        { content: 'rocket', emoji: '🚀' },
        { content: 'eyes', emoji: '👀' }
    ];

    function groupReactions(reactions, currentUser) {
        const grouped = {};
        REACTION_TYPES.forEach(type => {
            grouped[type.content] = {
                content: type.content,
                emoji: type.emoji,
                count: 0,
                userReacted: false,
                userReactionId: null
            };
        });
        reactions.forEach(r => {
            if (grouped[r.content]) {
                grouped[r.content].count++;
                if (currentUser && r.user && r.user.login === currentUser) {
                    grouped[r.content].userReacted = true;
                    grouped[r.content].userReactionId = r.id;
                }
            }
        });
        return Object.values(grouped).filter(g => g.count > 0).sort((a, b) => b.count - a.count);
    }

    function renderReactions(container, issueNumber, reactions, currentUser, onAdd, onRemove) {
        if (!container || typeof container.querySelectorAll !== 'function') {
            console.warn('renderReactions: container is not a valid element');
            return;
        }

        const grouped = groupReactions(reactions, currentUser);
        const visible = grouped.slice(0, 3);
        const hiddenCount = grouped.length - 3;

        let html = visible.map(g => {
            // Если пользователь не авторизован, делаем кнопки неактивными (только для просмотра)
            const disabledAttr = !currentUser ? ' disabled' : '';
            return `
            <button class="reaction-button ${g.userReacted ? 'active' : ''}" 
                    data-content="${g.content}" 
                    data-reaction-id="${g.userReactionId || ''}"
                    data-count="${g.count}"${disabledAttr}>
                <span class="reaction-emoji">${g.emoji}</span>
                <span class="reaction-count">${g.count}</span>
            </button>
        `}).join('');

        if (currentUser) {
            if (hiddenCount > 0) {
                html += `<button class="reaction-add-btn" data-more><span>+${hiddenCount}</span></button>`;
            } else {
                html += `<button class="reaction-add-btn" data-add><span>+</span></button>`;
            }
        }

        container.innerHTML = html;

        // Добавляем обработчики только если есть пользователь
        if (currentUser) {
            container.querySelectorAll('.reaction-button:not([disabled])').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const content = btn.dataset.content;
                    const reactionId = btn.dataset.reactionId;
                    const isActive = btn.classList.contains('active');
                    const countSpan = btn.querySelector('.reaction-count');
                    const oldCount = parseInt(countSpan.textContent, 10);
                    const wasVisible = btn.style.display !== 'none';

                    if (isActive && reactionId) {
                        // Оптимистичное удаление
                        btn.classList.remove('active');
                        countSpan.textContent = oldCount - 1;
                        if (oldCount - 1 === 0) {
                            btn.style.display = 'none';
                        }
                        try {
                            await onRemove(issueNumber, parseInt(reactionId, 10));
                        } catch (err) {
                            console.error('Failed to remove reaction, reverting', err);
                            btn.classList.add('active');
                            countSpan.textContent = oldCount;
                            btn.style.display = wasVisible ? '' : 'none';
                        }
                    } else {
                        showReactionMenu(container, issueNumber, async (selectedContent) => {
                            const tempBtn = document.createElement('button');
                            tempBtn.className = 'reaction-button active';
                            tempBtn.dataset.content = selectedContent;
                            tempBtn.dataset.reactionId = 'temp';
                            tempBtn.innerHTML = `<span class="reaction-emoji">${REACTION_TYPES.find(t => t.content === selectedContent).emoji}</span><span class="reaction-count">1</span>`;
                            const addBtn = container.querySelector('.reaction-add-btn');
                            if (addBtn) {
                                container.insertBefore(tempBtn, addBtn);
                            } else {
                                container.appendChild(tempBtn);
                            }
                            try {
                                await onAdd(issueNumber, selectedContent);
                                const updated = await GithubAPI.loadReactions(issueNumber);
                                renderReactions(container, issueNumber, updated, currentUser, onAdd, onRemove);
                            } catch (err) {
                                console.error('Failed to add reaction', err);
                                tempBtn.remove();
                            }
                        });
                    }
                });
            });

            const addBtn = container.querySelector('[data-add], [data-more]');
            if (addBtn) {
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showReactionMenu(container, issueNumber, async (selectedContent) => {
                        const tempBtn = document.createElement('button');
                        tempBtn.className = 'reaction-button active';
                        tempBtn.dataset.content = selectedContent;
                        tempBtn.dataset.reactionId = 'temp';
                        tempBtn.innerHTML = `<span class="reaction-emoji">${REACTION_TYPES.find(t => t.content === selectedContent).emoji}</span><span class="reaction-count">1</span>`;
                        container.insertBefore(tempBtn, addBtn);
                        try {
                            await onAdd(issueNumber, selectedContent);
                            const updated = await GithubAPI.loadReactions(issueNumber);
                            renderReactions(container, issueNumber, updated, currentUser, onAdd, onRemove);
                        } catch (err) {
                            tempBtn.remove();
                        }
                    });
                });
            }
        }
    }

    function showReactionMenu(relativeTo, issueNumber, callback) {
        document.querySelectorAll('.reaction-menu').forEach(menu => menu.remove());

        const menu = document.createElement('div');
        menu.className = 'reaction-menu';
        Object.assign(menu.style, {
            position: 'absolute',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '30px',
            padding: '5px',
            display: 'flex',
            gap: '5px',
            zIndex: '1000',
            boxShadow: 'var(--shadow)'
        });

        REACTION_TYPES.forEach(type => {
            const btn = document.createElement('button');
            btn.className = 'reaction-menu-btn';
            btn.innerHTML = type.emoji;
            Object.assign(btn.style, {
                background: 'transparent',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                padding: '5px 10px',
                borderRadius: '20px',
                transition: 'background 0.2s'
            });
            btn.onmouseover = () => btn.style.background = 'var(--bg-inner-gradient)';
            btn.onmouseout = () => btn.style.background = 'transparent';
            btn.onclick = (e) => {
                e.stopPropagation();
                callback(type.content);
                document.body.removeChild(menu);
            };
            menu.appendChild(btn);
        });

        const rect = relativeTo.getBoundingClientRect();
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + window.scrollY + 5) + 'px';
        document.body.appendChild(menu);

        setTimeout(() => {
            const closeMenu = (e) => {
                if (!menu.contains(e.target)) {
                    if (document.body.contains(menu)) document.body.removeChild(menu);
                    document.removeEventListener('click', closeMenu);
                }
            };
            document.addEventListener('click', closeMenu);
        }, 100);
    }

    function renderComments(container, comments) {
        container.innerHTML = comments.map(c => `
            <div class="comment" data-comment-id="${c.id}">
                <div class="comment-meta">
                    <span class="comment-author">${GithubCore.escapeHtml(c.user.login)}</span>
                    <span>${new Date(c.created_at).toLocaleString()}</span>
                </div>
                <div>${GithubCore.escapeHtml(c.body).replace(/\n/g, '<br>')}</div>
            </div>
        `).join('');
    }

    window.UIFeedback = {
        renderReactions,
        showReactionMenu,
        renderComments,
        REACTION_TYPES
    };
})();