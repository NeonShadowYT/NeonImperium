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

    // Группировка реакций
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

    // Рендер контейнера реакций
    function renderReactions(container, issueNumber, reactions, currentUser, onAdd, onRemove) {
        if (!container || typeof container.querySelectorAll !== 'function') {
            console.warn('renderReactions: container is not a valid element');
            return;
        }

        const grouped = groupReactions(reactions, currentUser);
        const visible = grouped.slice(0, 3);
        const hiddenCount = grouped.length - 3;

        let html = visible.map(g => `
            <button class="reaction-button ${g.userReacted ? 'active' : ''}" 
                    data-content="${g.content}" 
                    data-reaction-id="${g.userReactionId || ''}"
                    data-count="${g.count}">
                <span class="reaction-emoji">${g.emoji}</span>
                <span class="reaction-count">${g.count}</span>
            </button>
        `).join('');

        if (hiddenCount > 0) {
            html += `<button class="reaction-add-btn" data-more><span>+${hiddenCount}</span></button>`;
        } else if (currentUser) {
            html += `<button class="reaction-add-btn" data-add><span>+</span></button>`;
        }

        container.innerHTML = html;

        // Обработчики
        container.querySelectorAll('.reaction-button').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const content = btn.dataset.content;
                const reactionId = btn.dataset.reactionId;
                const isActive = btn.classList.contains('active');

                if (isActive && reactionId) {
                    // Оптимистичное удаление: сразу убираем активный класс и уменьшаем счётчик
                    const countSpan = btn.querySelector('.reaction-count');
                    const currentCount = parseInt(countSpan.textContent, 10);
                    btn.classList.remove('active');
                    countSpan.textContent = currentCount - 1;
                    if (currentCount - 1 === 0) {
                        btn.style.display = 'none';
                    }
                    // Вызываем колбэк удаления, но не ждём
                    onRemove(issueNumber, parseInt(reactionId, 10)).catch(err => {
                        console.error('Failed to remove reaction, reverting', err);
                        // В случае ошибки возвращаем как было
                        btn.classList.add('active');
                        countSpan.textContent = currentCount;
                        btn.style.display = '';
                    });
                } else {
                    // Показываем меню выбора реакции
                    showReactionMenu(container, issueNumber, async (selectedContent) => {
                        await onAdd(issueNumber, selectedContent);
                    });
                }
            });
        });

        const addBtn = container.querySelector('[data-add], [data-more]');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showReactionMenu(container, issueNumber, async (selectedContent) => {
                    await onAdd(issueNumber, selectedContent);
                });
            });
        }
    }

    // Показать меню выбора реакции
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

    // Рендер комментариев (простой)
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

    // Экспорт
    window.UIFeedback = {
        renderReactions,
        showReactionMenu,
        renderComments,
        REACTION_TYPES
    };
})();