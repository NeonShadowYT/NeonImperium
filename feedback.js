// feedback.js — с поддержкой реакций, оптимистичные обновления, кеширование

(function() {
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium',
        CACHE_TTL: 10 * 60 * 1000, // 10 минут
        ITEMS_PER_PAGE: 10
    };

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

    let currentGame = '';
    let currentTab = 'all';
    let currentPage = 1;
    let hasMorePages = true;
    let isLoading = false;
    let allIssues = [];
    let displayedIssues = [];
    let container, feedbackSection;
    let currentUser = null;
    let editingIssue = null;
    let reactionsCache = new Map(); // кеш реакций { issueId: [{ id, content, user }] }
    let commentsCache = new Map();   // кеш комментариев { issueId: [comment] }
    let processingReaction = false;  // защита от спама

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        feedbackSection = document.getElementById('feedback-section');
        if (!feedbackSection) return;

        currentGame = feedbackSection.dataset.game;
        if (!currentGame) {
            console.warn('Game not specified');
            return;
        }

        container = feedbackSection.querySelector('.feedback-container');
        if (!container) return;

        window.addEventListener('github-login-success', (e) => {
            currentUser = e.detail.login;
            checkAuthAndRender();
        });

        window.addEventListener('github-logout', () => {
            currentUser = null;
            reactionsCache.clear();
            commentsCache.clear();
            checkAuthAndRender();
        });

        checkAuthAndRender();
    }

    function getCurrentUser() {
        const profile = document.querySelector('.nav-profile');
        return profile ? profile.dataset.githubLogin : null;
    }

    function checkAuthAndRender() {
        const token = localStorage.getItem('github_token');
        currentUser = getCurrentUser();

        if (token && currentUser) {
            renderFeedbackInterface(token, currentUser);
        } else {
            renderLoginPrompt();
        }
    }

    function renderLoginPrompt() {
        container.innerHTML = `
            <div class="login-prompt">
                <i class="fab fa-github"></i>
                <h3 data-lang="feedbackLoginPrompt">Войдите через GitHub, чтобы участвовать</h3>
                <p class="text-secondary" data-lang="feedbackTokenNote">
                    Ваш токен останется только у вас в браузере.
                </p>
                <button class="button" id="feedback-login-btn" data-lang="feedbackLoginBtn">Войти</button>
            </div>
        `;

        document.getElementById('feedback-login-btn').addEventListener('click', () => {
            if (localStorage.getItem('github_token') && getCurrentUser()) {
                checkAuthAndRender();
            } else {
                window.dispatchEvent(new CustomEvent('github-login-requested'));
            }
        });
    }

    async function renderFeedbackInterface(token, currentUser) {
        container.innerHTML = `
            <div class="feedback-tabs">
                <button class="feedback-tab active" data-tab="all" data-lang="feedbackTabAll">Все</button>
                <button class="feedback-tab" data-tab="idea" data-lang="feedbackTabIdea">💡 Идеи</button>
                <button class="feedback-tab" data-tab="bug" data-lang="feedbackTabBug">🐛 Баги</button>
                <button class="feedback-tab" data-tab="review" data-lang="feedbackTabReview">⭐ Отзывы</button>
            </div>

            <div class="feedback-form-wrapper" style="display: none;">
                <div class="feedback-form" id="feedback-form">
                    <h3 data-lang="feedbackFormTitle">Оставить сообщение</h3>
                    <input type="text" id="feedback-title" data-lang="feedbackTitlePlaceholder" placeholder="Заголовок">
                    <select id="feedback-category">
                        <option value="idea" data-lang="feedbackCategoryIdea">💡 Идея</option>
                        <option value="bug" data-lang="feedbackCategoryBug">🐛 Баг</option>
                        <option value="review" data-lang="feedbackCategoryReview">⭐ Отзыв</option>
                    </select>
                    <textarea id="feedback-body" data-lang="feedbackBodyPlaceholder" placeholder="Подробное описание..."></textarea>
                    <div class="button-group">
                        <button class="button button-secondary" id="feedback-cancel" data-lang="feedbackCancel">Отмена</button>
                        <button class="button" id="feedback-submit" data-lang="feedbackSubmitBtn">Отправить</button>
                    </div>
                </div>
            </div>

            <div class="feedback-list" id="feedback-list">
                <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>
            </div>

            <div style="text-align: center; margin-top: 20px;" id="load-more-container">
                <button class="button" id="load-more" style="display: none;" data-lang="feedbackLoadMore">Загрузить ещё</button>
            </div>
        `;

        const toggleBtn = document.getElementById('toggle-form-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const wrapper = document.querySelector('.feedback-form-wrapper');
                if (wrapper.style.display === 'none') {
                    wrapper.style.display = 'block';
                    editingIssue = null;
                    document.getElementById('feedback-title').value = '';
                    document.getElementById('feedback-body').value = '';
                    document.getElementById('feedback-category').value = 'idea';
                } else {
                    wrapper.style.display = 'none';
                }
            });
        }

        document.getElementById('feedback-cancel').addEventListener('click', () => {
            document.querySelector('.feedback-form-wrapper').style.display = 'none';
            editingIssue = null;
        });

        document.getElementById('feedback-submit').addEventListener('click', () => {
            if (editingIssue) {
                updateIssue(token, currentUser);
            } else {
                submitNewIssue(token, currentUser);
            }
        });

        document.querySelectorAll('.feedback-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.feedback-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                currentTab = e.target.dataset.tab;
                currentPage = 1;
                filterAndDisplayIssues(currentUser, token);
            });
        });

        document.getElementById('load-more').addEventListener('click', () => {
            if (!isLoading && hasMorePages) {
                loadIssues(token, currentPage + 1, false, currentUser);
            }
        });

        await loadIssues(token, 1, true, currentUser);
    }

    async function loadIssues(token, page, reset = false, currentUser) {
        if (isLoading) return;
        isLoading = true;

        try {
            const cacheKey = `issues_${currentGame}_page_${page}`;
            const cached = sessionStorage.getItem(cacheKey);
            const cachedTime = sessionStorage.getItem(`${cacheKey}_time`);
            let issues = [];

            if (cached && cachedTime && (Date.now() - parseInt(cachedTime) < CONFIG.CACHE_TTL)) {
                issues = JSON.parse(cached);
            } else {
                const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?state=all&per_page=${CONFIG.ITEMS_PER_PAGE}&page=${page}&labels=game:${currentGame}`;
                const response = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                issues = await response.json();

                const linkHeader = response.headers.get('Link');
                hasMorePages = linkHeader && linkHeader.includes('rel="next"');

                sessionStorage.setItem(cacheKey, JSON.stringify(issues));
                sessionStorage.setItem(`${cacheKey}_time`, Date.now().toString());
            }

            if (reset) {
                allIssues = issues;
            } else {
                allIssues = [...allIssues, ...issues];
            }

            currentPage = page;
            filterAndDisplayIssues(currentUser, token);

        } catch (error) {
            console.error('Error loading issues:', error);
            document.getElementById('feedback-list').innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p data-lang="feedbackLoadError">Ошибка загрузки.</p>
                    <button class="button-small" id="retry-feedback" data-lang="feedbackRetry">Повторить</button>
                </div>
            `;
            document.getElementById('retry-feedback')?.addEventListener('click', () => {
                loadIssues(token, 1, true, currentUser);
            });
        } finally {
            isLoading = false;
            const loadMoreBtn = document.getElementById('load-more');
            if (loadMoreBtn) loadMoreBtn.style.display = hasMorePages ? 'inline-block' : 'none';
        }
    }

    function filterAndDisplayIssues(currentUser, token) {
        let filtered = allIssues.filter(issue => issue.state === 'open');
        if (currentTab !== 'all') {
            filtered = filtered.filter(issue => 
                issue.labels.some(l => l.name === `type:${currentTab}`)
            );
        }
        displayedIssues = filtered;
        renderIssuesList(displayedIssues, currentUser, token);
    }

    function renderIssuesList(issues, currentUser, token) {
        const listEl = document.getElementById('feedback-list');
        if (!listEl) return;

        if (issues.length === 0) {
            listEl.innerHTML = `<p class="text-secondary" style="text-align: center;" data-lang="feedbackNoItems">Пока нет сообщений. Будьте первым!</p>`;
            return;
        }

        listEl.innerHTML = issues.map(issue => {
            const isAuthor = currentUser && issue.user.login === currentUser;
            const typeLabel = issue.labels.find(l => l.name.startsWith('type:'))?.name.split(':')[1] || 'idea';
            const preview = (issue.body || '').substring(0, 120) + (issue.body?.length > 120 ? '…' : '');
            
            return `
            <div class="feedback-item" data-issue-number="${issue.number}" data-issue-id="${issue.id}">
                <div class="feedback-item-header">
                    <h4 class="feedback-item-title">${escapeHtml(issue.title)}</h4>
                    <div class="feedback-item-meta">
                        <span class="feedback-label type-${typeLabel}">${typeLabel}</span>
                        <span class="feedback-label">#${issue.number}</span>
                    </div>
                </div>
                <div class="feedback-item-preview">
                    ${escapeHtml(preview).replace(/\n/g, ' ')}
                </div>
                <div class="reactions-container" data-target-type="issue" data-target-id="${issue.number}"></div>
                <div class="feedback-item-footer">
                    <span><i class="fas fa-user"></i> ${escapeHtml(issue.user.login)}</span>
                    <span><i class="fas fa-calendar-alt"></i> ${new Date(issue.created_at).toLocaleDateString()}</span>
                    <span><i class="fas fa-comment"></i> ${issue.comments}</span>
                    ${isAuthor ? `
                    <div class="feedback-item-actions">
                        <button class="edit-issue" title="Редактировать"><i class="fas fa-edit"></i></button>
                        <button class="close-issue" title="Закрыть"><i class="fas fa-trash-alt"></i></button>
                    </div>` : ''}
                </div>
                <div class="feedback-item-details" style="display: none;">
                    <div class="feedback-comments" id="comments-${issue.number}"></div>
                    <div class="comment-form" data-issue="${issue.number}">
                        <input type="text" class="comment-input" data-lang="feedbackAddComment" placeholder="Написать комментарий...">
                        <button class="button comment-submit" data-lang="feedbackSendBtn">Отправить</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        issues.forEach(issue => {
            const cacheKey = `issue_${issue.number}`;
            if (reactionsCache.has(cacheKey)) {
                const container = document.querySelector(`.reactions-container[data-target-type="issue"][data-target-id="${issue.number}"]`);
                if (container) updateReactionsContainer(container, 'issue', issue.number, token, reactionsCache.get(cacheKey));
            } else {
                loadReactions('issue', issue.number, token);
            }
        });

        attachEventHandlers(token);
    }

    function attachEventHandlers(token) {
        document.querySelectorAll('.feedback-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('.reaction-button') || 
                    e.target.closest('.reaction-add-btn') || e.target.closest('.comment-input') ||
                    e.target.closest('.comment-submit')) return;
                
                document.querySelectorAll('.feedback-item.expanded').forEach(el => {
                    if (el !== item) {
                        el.classList.remove('expanded');
                        el.querySelector('.feedback-item-details').style.display = 'none';
                    }
                });
                
                const details = item.querySelector('.feedback-item-details');
                if (item.classList.contains('expanded')) {
                    item.classList.remove('expanded');
                    details.style.display = 'none';
                } else {
                    item.classList.add('expanded');
                    details.style.display = 'block';
                    const issueNumber = item.dataset.issueNumber;
                    if (!item.querySelector('.comment')) {
                        loadComments(issueNumber, token);
                    }
                }
            });
        });

        document.querySelectorAll('.comment-submit').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const form = e.target.closest('.comment-form');
                const issueNumber = form.dataset.issue;
                const input = form.querySelector('.comment-input');
                const comment = input.value.trim();
                if (comment) {
                    btn.disabled = true;
                    await submitComment(issueNumber, comment, token);
                    input.value = '';
                    btn.disabled = false;
                }
            });
        });

        document.querySelectorAll('.edit-issue').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const issueItem = e.target.closest('.feedback-item');
                const issueNumber = issueItem.dataset.issueNumber;
                const issue = allIssues.find(i => i.number == issueNumber);
                if (issue && issue.user.login === currentUser) {
                    startEditing(issue);
                }
            });
        });

        document.querySelectorAll('.close-issue').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!confirm('Вы уверены, что хотите закрыть это сообщение?')) return;
                const issueItem = e.target.closest('.feedback-item');
                const issueNumber = issueItem.dataset.issueNumber;
                closeIssue(issueNumber, token, currentUser);
            });
        });
    }

    function showReactionMenu(container, targetType, targetId, token) {
        const menu = document.createElement('div');
        menu.className = 'reaction-menu';
        menu.style.position = 'absolute';
        menu.style.background = 'var(--bg-card)';
        menu.style.border = '1px solid var(--border)';
        menu.style.borderRadius = '30px';
        menu.style.padding = '5px';
        menu.style.display = 'flex';
        menu.style.gap = '5px';
        menu.style.zIndex = '1000';
        menu.style.boxShadow = 'var(--shadow)';

        REACTION_TYPES.forEach(type => {
            const btn = document.createElement('button');
            btn.className = 'reaction-menu-btn';
            btn.innerHTML = type.emoji;
            btn.style.background = 'transparent';
            btn.style.border = 'none';
            btn.style.fontSize = '20px';
            btn.style.cursor = 'pointer';
            btn.style.padding = '5px 10px';
            btn.style.borderRadius = '20px';
            btn.style.transition = 'background 0.2s';
            btn.onmouseover = () => btn.style.background = 'var(--bg-inner-gradient)';
            btn.onmouseout = () => btn.style.background = 'transparent';
            btn.onclick = (e) => {
                e.stopPropagation();
                optimisticAddReaction(targetType, targetId, type.content, token, container);
                document.body.removeChild(menu);
            };
            menu.appendChild(btn);
        });

        const rect = container.getBoundingClientRect();
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

    function optimisticAddReaction(targetType, targetId, content, token, container) {
        if (!currentUser) return;
        const cacheKey = `${targetType}_${targetId}`;
        let reactions = reactionsCache.get(cacheKey) || [];

        const existing = reactions.find(r => r.content === content && r.user?.login === currentUser);
        if (existing) return;

        const tempReaction = {
            id: 'temp-' + Date.now(),
            content: content,
            user: { login: currentUser }
        };
        reactions.push(tempReaction);
        reactionsCache.set(cacheKey, reactions);
        updateReactionsContainer(container, targetType, targetId, token, reactions);

        fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${targetId}/reactions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content })
        })
        .then(response => {
            if (!response.ok) throw new Error();
            return response.json();
        })
        .then(realReaction => {
            const updated = reactionsCache.get(cacheKey) || [];
            const index = updated.findIndex(r => r.id === tempReaction.id);
            if (index !== -1) {
                updated[index] = realReaction;
                reactionsCache.set(cacheKey, updated);
                updateReactionsContainer(container, targetType, targetId, token, updated);
            }
        })
        .catch(error => {
            console.error('Error adding reaction:', error);
            const rolledBack = reactionsCache.get(cacheKey).filter(r => r.id !== tempReaction.id);
            reactionsCache.set(cacheKey, rolledBack);
            updateReactionsContainer(container, targetType, targetId, token, rolledBack);
            alert('Не удалось добавить реакцию. Попробуйте позже.');
        });
    }

    function optimisticRemoveReaction(targetType, targetId, reactionId, token, container) {
        const cacheKey = `${targetType}_${targetId}`;
        let reactions = reactionsCache.get(cacheKey) || [];
        const reactionToRemove = reactions.find(r => r.id == reactionId);
        if (!reactionToRemove) return;

        const newReactions = reactions.filter(r => r.id != reactionId);
        reactionsCache.set(cacheKey, newReactions);
        updateReactionsContainer(container, targetType, targetId, token, newReactions);

        fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${targetId}/reactions/${reactionId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        })
        .catch(error => {
            console.error('Error removing reaction:', error);
            reactionsCache.set(cacheKey, reactions);
            updateReactionsContainer(container, targetType, targetId, token, reactions);
            alert('Не удалось удалить реакцию.');
        });
    }

    async function loadReactions(targetType, targetId, token) {
        if (targetType !== 'issue') return;
        const cacheKey = `${targetType}_${targetId}`;
        
        try {
            const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${targetId}/reactions`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (response.ok) {
                const reactions = await response.json();
                reactionsCache.set(cacheKey, reactions);
                const container = document.querySelector(`.reactions-container[data-target-type="${targetType}"][data-target-id="${targetId}"]`);
                if (container) updateReactionsContainer(container, targetType, targetId, token, reactions);
            }
        } catch (error) {
            console.error('Error loading reactions:', error);
        }
    }

    function updateReactionsContainer(container, targetType, targetId, token, reactions) {
        const currentUserLogin = currentUser;

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
                if (currentUserLogin && r.user && r.user.login === currentUserLogin) {
                    grouped[r.content].userReacted = true;
                    grouped[r.content].userReactionId = r.id;
                }
            }
        });

        let sorted = Object.values(grouped)
            .filter(g => g.count > 0)
            .sort((a, b) => b.count - a.count);

        const totalTypes = sorted.length;
        const showCount = Math.min(3, totalTypes);
        const visible = sorted.slice(0, showCount);
        const hiddenCount = totalTypes - showCount;

        let html = '';
        if (totalTypes === 0 && currentUser) {
            html = `<button class="reaction-add-btn" title="Добавить реакцию"><span>+</span></button>`;
        } else {
            html = visible.map(g => `
                <button class="reaction-button ${g.userReacted ? 'active' : ''}" 
                        data-target-type="${targetType}" 
                        data-target-id="${targetId}" 
                        data-content="${g.content}"
                        data-reaction-id="${g.userReactionId || ''}">
                    <span class="reaction-emoji">${g.emoji}</span>
                    <span class="reaction-count">${g.count}</span>
                </button>
            `).join('');
            if (hiddenCount > 0) {
                html += `<button class="reaction-add-btn" title="Добавить реакцию"><span>+${hiddenCount}</span></button>`;
            } else if (currentUser) {
                html += `<button class="reaction-add-btn" title="Добавить реакцию"><span>+</span></button>`;
            }
        }

        container.innerHTML = html;

        container.querySelectorAll('.reaction-button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const content = btn.dataset.content;
                const reactionId = btn.dataset.reactionId;
                const isActive = btn.classList.contains('active');
                
                if (isActive && reactionId) {
                    optimisticRemoveReaction(targetType, targetId, reactionId, token, container);
                } else {
                    showReactionMenu(container, targetType, targetId, token);
                }
            });
        });

        const addBtn = container.querySelector('.reaction-add-btn');
        if (addBtn) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showReactionMenu(container, targetType, targetId, token);
            });
        }
    }

    function startEditing(issue) {
        editingIssue = issue;
        document.querySelector('.feedback-form-wrapper').style.display = 'block';
        document.getElementById('feedback-title').value = issue.title;
        document.getElementById('feedback-body').value = issue.body;
        const typeLabel = issue.labels.find(l => l.name.startsWith('type:'))?.name.split(':')[1] || 'idea';
        document.getElementById('feedback-category').value = typeLabel;
    }

    async function updateIssue(token, currentUser) {
        if (!editingIssue) return;
        const title = document.getElementById('feedback-title').value.trim();
        const category = document.getElementById('feedback-category').value;
        const body = document.getElementById('feedback-body').value.trim();

        if (!title || !body) {
            alert('Заполните заголовок и описание');
            return;
        }

        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${editingIssue.number}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title: title,
                    body: body,
                    labels: [`game:${currentGame}`, `type:${category}`]
                })
            });

            if (response.ok) {
                document.querySelector('.feedback-form-wrapper').style.display = 'none';
                editingIssue = null;
                sessionStorage.removeItem(`issues_${currentGame}_page_1`);
                await loadIssues(token, 1, true, currentUser);
            } else {
                const error = await response.json();
                alert(`Ошибка: ${error.message}`);
            }
        } catch (error) {
            console.error('Update error:', error);
            alert('Не удалось обновить сообщение');
        }
    }

    async function closeIssue(issueNumber, token, currentUser) {
        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ state: 'closed' })
            });
            if (response.ok) {
                sessionStorage.removeItem(`issues_${currentGame}_page_1`);
                await loadIssues(token, 1, true, currentUser);
            } else {
                alert('Не удалось закрыть сообщение');
            }
        } catch (error) {
            console.error('Close error:', error);
        }
    }

    async function submitNewIssue(token, currentUser) {
        const title = document.getElementById('feedback-title').value.trim();
        const category = document.getElementById('feedback-category').value;
        const body = document.getElementById('feedback-body').value.trim();

        if (!title || !body) {
            alert('Заполните заголовок и описание');
            return;
        }

        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title: title,
                    body: body,
                    labels: [`game:${currentGame}`, `type:${category}`]
                })
            });

            if (response.ok) {
                document.getElementById('feedback-title').value = '';
                document.getElementById('feedback-body').value = '';
                document.querySelector('.feedback-form-wrapper').style.display = 'none';
                sessionStorage.removeItem(`issues_${currentGame}_page_1`);
                await loadIssues(token, 1, true, currentUser);
            } else {
                const error = await response.json();
                alert(`Ошибка: ${error.message}`);
            }
        } catch (error) {
            console.error('Error creating issue:', error);
            alert('Не удалось создать сообщение. Проверьте соединение.');
        }
    }

    async function loadComments(issueNumber, token) {
        const commentsDiv = document.getElementById(`comments-${issueNumber}`);
        if (!commentsDiv) return;

        const cacheKey = `comments_${issueNumber}`;
        if (commentsCache.has(cacheKey)) {
            renderComments(commentsDiv, commentsCache.get(cacheKey));
            return;
        }
        
        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error();
            const comments = await response.json();
            commentsCache.set(cacheKey, comments);
            renderComments(commentsDiv, comments);
        } catch (error) {
            console.error('Error loading comments:', error);
        }
    }

    function renderComments(container, comments) {
        container.innerHTML = comments.map(c => {
            return `
                <div class="comment" data-comment-id="${c.id}">
                    <div class="comment-meta">
                        <span class="comment-author">${escapeHtml(c.user.login)}</span>
                        <span>${new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <div>${escapeHtml(c.body).replace(/\n/g, '<br>')}</div>
                </div>
            `;
        }).join('');
    }

    async function submitComment(issueNumber, comment, token) {
        const commentsDiv = document.getElementById(`comments-${issueNumber}`);
        const cacheKey = `comments_${issueNumber}`;
        const currentComments = commentsCache.get(cacheKey) || [];

        const tempComment = {
            id: 'temp-' + Date.now(),
            user: { login: currentUser },
            body: comment,
            created_at: new Date().toISOString()
        };
        const newComments = [...currentComments, tempComment]; // добавляем в конец
        commentsCache.set(cacheKey, newComments);
        renderComments(commentsDiv, newComments);

        const item = document.querySelector(`.feedback-item[data-issue-number="${issueNumber}"]`);
        if (item) {
            const commentsSpan = item.querySelector('.feedback-item-footer span:last-child');
            if (commentsSpan) {
                const current = parseInt(commentsSpan.textContent.match(/\d+/)[0]) || 0;
                commentsSpan.innerHTML = `<i class="fas fa-comment"></i> ${current + 1}`;
            }
        }

        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ body: comment })
            });
            if (response.ok) {
                const realComment = await response.json();
                const updated = newComments.map(c => c.id === tempComment.id ? realComment : c);
                commentsCache.set(cacheKey, updated);
                renderComments(commentsDiv, updated);
            } else {
                throw new Error();
            }
        } catch (error) {
            console.error('Error posting comment:', error);
            const rolledBack = commentsCache.get(cacheKey).filter(c => c.id !== tempComment.id);
            commentsCache.set(cacheKey, rolledBack);
            renderComments(commentsDiv, rolledBack);
            if (item) {
                const commentsSpan = item.querySelector('.feedback-item-footer span:last-child');
                if (commentsSpan) {
                    const current = parseInt(commentsSpan.textContent.match(/\d+/)[0]) || 0;
                    commentsSpan.innerHTML = `<i class="fas fa-comment"></i> ${Math.max(0, current - 1)}`;
                }
            }
            alert('Не удалось отправить комментарий.');
        }
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
})();