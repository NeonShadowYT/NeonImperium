// feedback.js — с поддержкой реакций

(function() {
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium',
        CACHE_TTL: 5 * 60 * 1000,
        ITEMS_PER_PAGE: 10
    };

    // Доступные типы реакций (из документации GitHub API)
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

    // Кеш реакций для быстрого доступа
    let reactionsCache = new Map();

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
                <p class="text-secondary">
                    Ваш токен останется только у вас в браузере.
                </p>
                <button class="button" id="feedback-login-btn">Войти</button>
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
            <div class="feedback-header">
                <h2><i class="fab fa-github"></i> <span data-lang="feedbackTitle">Идеи, баги и отзывы</span></h2>
                <button class="button" id="toggle-form-btn"><i class="fas fa-plus"></i> <span data-lang="feedbackNewBtn">Оставить сообщение</span></button>
            </div>

            <div class="feedback-tabs">
                <button class="feedback-tab active" data-tab="all">Все</button>
                <button class="feedback-tab" data-tab="idea">💡 Идеи</button>
                <button class="feedback-tab" data-tab="bug">🐛 Баги</button>
                <button class="feedback-tab" data-tab="review">⭐ Отзывы</button>
            </div>

            <div class="feedback-form-wrapper" style="display: none;">
                <div class="feedback-form" id="feedback-form">
                    <h3 data-lang="feedbackFormTitle">Оставить сообщение</h3>
                    <input type="text" id="feedback-title" placeholder="Заголовок">
                    <select id="feedback-category">
                        <option value="idea">💡 Идея</option>
                        <option value="bug">🐛 Баг</option>
                        <option value="review">⭐ Отзыв</option>
                    </select>
                    <textarea id="feedback-body" placeholder="Подробное описание..."></textarea>
                    <div class="button-group">
                        <button class="button button-secondary" id="feedback-cancel">Отмена</button>
                        <button class="button" id="feedback-submit">Отправить</button>
                    </div>
                </div>
            </div>

            <div class="feedback-list" id="feedback-list">
                <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>
            </div>

            <div style="text-align: center; margin-top: 20px;" id="load-more-container">
                <button class="button" id="load-more" style="display: none;">Загрузить ещё</button>
            </div>
        `;

        document.getElementById('toggle-form-btn').addEventListener('click', () => {
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
                    <p>Ошибка загрузки. <button class="button-small" onclick="location.reload()">Повторить</button></p>
                </div>
            `;
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
            listEl.innerHTML = `<p class="text-secondary" style="text-align: center;">Пока нет сообщений. Будьте первым!</p>`;
            return;
        }

        listEl.innerHTML = issues.map(issue => {
            const isAuthor = currentUser && issue.user.login === currentUser;
            const typeLabel = issue.labels.find(l => l.name.startsWith('type:'))?.name.split(':')[1] || 'idea';
            const preview = (issue.body || '').substring(0, 120) + (issue.body?.length > 120 ? '…' : '');
            
            // Получаем реакции из кеша или инициализируем
            if (!reactionsCache.has(`issue_${issue.number}`)) {
                reactionsCache.set(`issue_${issue.number}`, []);
            }
            
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
                <div class="reactions-container" data-target-type="issue" data-target-id="${issue.number}">
                    ${renderReactionButtons('issue', issue.number, currentUser)}
                </div>
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
                        <input type="text" placeholder="Написать комментарий..." class="comment-input">
                        <button class="button-small comment-submit">Отправить</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Загружаем реакции для всех отображаемых issues
        issues.forEach(issue => {
            if (!reactionsCache.has(`issue_${issue.number}`)) {
                loadReactions('issue', issue.number, token);
            }
        });

        // Обработчики
        document.querySelectorAll('.feedback-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('.reaction-button')) return;
                
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
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const form = e.target.closest('.comment-form');
                const issueNumber = form.dataset.issue;
                const input = form.querySelector('.comment-input');
                const comment = input.value.trim();
                if (comment) {
                    submitComment(issueNumber, comment, token);
                    input.value = '';
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

        // Обработчики реакций
        document.querySelectorAll('.reaction-button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const reactionBtn = e.currentTarget;
                const targetType = reactionBtn.dataset.targetType;
                const targetId = reactionBtn.dataset.targetId;
                const content = reactionBtn.dataset.content;
                const isActive = reactionBtn.classList.contains('active');
                
                handleReaction(targetType, targetId, content, isActive, token);
            });
        });
    }

    function renderReactionButtons(targetType, targetId, currentUser) {
        const cacheKey = `${targetType}_${targetId}`;
        const reactions = reactionsCache.get(cacheKey) || [];
        
        // Группируем реакции по типу
        const grouped = {};
        REACTION_TYPES.forEach(type => {
            grouped[type.content] = {
                count: 0,
                userReacted: false
            };
        });
        
        reactions.forEach(r => {
            if (grouped[r.content]) {
                grouped[r.content].count++;
                if (currentUser && r.user && r.user.login === currentUser) {
                    grouped[r.content].userReacted = true;
                }
            }
        });
        
        return REACTION_TYPES.map(type => {
            const data = grouped[type.content];
            const activeClass = data.userReacted ? 'active' : '';
            return `
                <button class="reaction-button ${activeClass}" 
                        data-target-type="${targetType}" 
                        data-target-id="${targetId}" 
                        data-content="${type.content}">
                    <span class="reaction-emoji">${type.emoji}</span>
                    <span class="reaction-count">${data.count}</span>
                </button>
            `;
        }).join('');
    }

    async function loadReactions(targetType, targetId, token) {
        const cacheKey = `${targetType}_${targetId}`;
        
        try {
            let url;
            if (targetType === 'issue') {
                url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${targetId}/reactions`;
            } else {
                url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/comments/${targetId}/reactions`;
            }
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (response.ok) {
                const reactions = await response.json();
                reactionsCache.set(cacheKey, reactions);
                
                // Обновляем отображение кнопок
                const container = document.querySelector(`.reactions-container[data-target-type="${targetType}"][data-target-id="${targetId}"]`);
                if (container) {
                    container.innerHTML = renderReactionButtons(targetType, targetId, currentUser);
                }
            }
        } catch (error) {
            console.error('Error loading reactions:', error);
        }
    }

    async function handleReaction(targetType, targetId, content, isActive, token) {
        if (!token || !currentUser) {
            alert('Войдите через GitHub, чтобы ставить реакции');
            return;
        }
        
        try {
            if (isActive) {
                // Находим ID реакции пользователя
                const cacheKey = `${targetType}_${targetId}`;
                const reactions = reactionsCache.get(cacheKey) || [];
                const userReaction = reactions.find(r => 
                    r.content === content && r.user && r.user.login === currentUser
                );
                
                if (userReaction) {
                    // Удаляем реакцию
                    let url;
                    if (targetType === 'issue') {
                        url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${targetId}/reactions/${userReaction.id}`;
                    } else {
                        url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/comments/${targetId}/reactions/${userReaction.id}`;
                    }
                    
                    const response = await fetch(url, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    });
                    
                    if (response.status === 204) {
                        // Перезагружаем реакции
                        await loadReactions(targetType, targetId, token);
                    }
                }
            } else {
                // Создаём реакцию
                let url;
                if (targetType === 'issue') {
                    url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${targetId}/reactions`;
                } else {
                    url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/comments/${targetId}/reactions`;
                }
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ content })
                });
                
                if (response.ok || response.status === 200) {
                    // Перезагружаем реакции
                    await loadReactions(targetType, targetId, token);
                }
            }
        } catch (error) {
            console.error('Error handling reaction:', error);
            alert('Не удалось поставить реакцию. Попробуйте позже.');
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
        
        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error();
            const comments = await response.json();
            
            commentsDiv.innerHTML = comments.map(c => {
                // Инициализируем кеш для комментариев
                if (!reactionsCache.has(`comment_${c.id}`)) {
                    reactionsCache.set(`comment_${c.id}`, []);
                }
                
                return `
                    <div class="comment" data-comment-id="${c.id}">
                        <div class="comment-meta">
                            <span class="comment-author">${escapeHtml(c.user.login)}</span>
                            <span>${new Date(c.created_at).toLocaleString()}</span>
                        </div>
                        <div>${escapeHtml(c.body).replace(/\n/g, '<br>')}</div>
                        <div class="reactions-container" data-target-type="comment" data-target-id="${c.id}">
                            ${renderReactionButtons('comment', c.id, currentUser)}
                        </div>
                    </div>
                `;
            }).join('');
            
            // Загружаем реакции для комментариев
            comments.forEach(c => {
                if (!reactionsCache.has(`comment_${c.id}`)) {
                    loadReactions('comment', c.id, token);
                }
            });
            
        } catch (error) {
            console.error('Error loading comments:', error);
        }
    }

    async function submitComment(issueNumber, comment, token) {
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
                loadComments(issueNumber, token);
                const item = document.querySelector(`.feedback-item[data-issue-number="${issueNumber}"]`);
                if (item) {
                    const commentsSpan = item.querySelector('.feedback-item-footer span:last-child');
                    if (commentsSpan) {
                        const current = parseInt(commentsSpan.textContent.match(/\d+/)[0]) || 0;
                        commentsSpan.innerHTML = `<i class="fas fa-comment"></i> ${current + 1}`;
                    }
                }
            }
        } catch (error) {
            console.error('Error posting comment:', error);
        }
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
})();