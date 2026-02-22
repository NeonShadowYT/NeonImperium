// feedback.js — полная версия с редактированием и удалением

(function() {
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium',
        CACHE_TTL: 5 * 60 * 1000,
        ITEMS_PER_PAGE: 10
    };

    let currentGame = '';
    let currentTab = 'all';
    let currentPage = 1;
    let hasMorePages = true;
    let isLoading = false;
    let allIssues = [];
    let displayedIssues = [];
    let container, feedbackSection;

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

        checkAuthAndRender();

        // Слушаем изменения localStorage (для выхода в другой вкладке)
        window.addEventListener('storage', (e) => {
            if (e.key === 'github_token') {
                checkAuthAndRender();
            }
        });
    }

    function getCurrentUser() {
        const profile = document.querySelector('.nav-profile');
        return profile ? profile.dataset.githubLogin : null;
    }

    function checkAuthAndRender() {
        const token = localStorage.getItem('github_token');
        const currentUser = getCurrentUser();

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
                    <button class="button-small" id="show-token-info">Подробнее</button>
                </p>
                <button class="button" id="feedback-login-btn" data-lang="feedbackLoginBtn">Войти</button>
            </div>
        `;

        document.getElementById('feedback-login-btn').addEventListener('click', () => {
            // Если пользователь уже залогинен (но интерфейс не обновился), перезапустим
            if (localStorage.getItem('github_token') && getCurrentUser()) {
                checkAuthAndRender();
            } else {
                // Запрашиваем открытие модалки входа
                window.dispatchEvent(new CustomEvent('github-login-requested'));
                // Также подпишемся на однократное событие после входа
                const onLogin = () => {
                    checkAuthAndRender();
                    window.removeEventListener('github-login-success', onLogin);
                };
                window.addEventListener('github-login-success', onLogin);
            }
        });

        document.getElementById('show-token-info').addEventListener('click', () => {
            alert('Безопасность: токен хранится локально, передаётся только в GitHub API, имеет доступ только к issues этого репозитория. Вы можете отозвать его в любой момент в настройках GitHub.');
        });
    }

    async function renderFeedbackInterface(token, currentUser) {
        container.innerHTML = `
            <div class="feedback-tabs">
                <button class="feedback-tab active" data-tab="all">Все</button>
                <button class="feedback-tab" data-tab="idea">💡 Идеи</button>
                <button class="feedback-tab" data-tab="bug">🐛 Баги</button>
                <button class="feedback-tab" data-tab="review">⭐ Отзывы</button>
            </div>

            <div class="feedback-form">
                <h3 data-lang="feedbackFormTitle">Оставить сообщение</h3>
                <input type="text" id="feedback-title" placeholder="Заголовок">
                <select id="feedback-category">
                    <option value="idea">💡 Идея</option>
                    <option value="bug">🐛 Баг</option>
                    <option value="review">⭐ Отзыв</option>
                </select>
                <textarea id="feedback-body" placeholder="Подробное описание..."></textarea>
                <button class="button" id="feedback-submit">Отправить</button>
            </div>

            <div class="feedback-list" id="feedback-list">
                <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>
            </div>

            <div style="text-align: center; margin-top: 20px;" id="load-more-container">
                <button class="button" id="load-more" style="display: none;">Загрузить ещё</button>
            </div>
        `;

        await loadIssues(token, 1, true, currentUser);

        document.querySelectorAll('.feedback-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.feedback-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                currentTab = e.target.dataset.tab;
                currentPage = 1;
                filterAndDisplayIssues(currentUser);
            });
        });

        document.getElementById('feedback-submit').addEventListener('click', () => {
            submitNewIssue(token, currentUser);
        });

        document.getElementById('load-more').addEventListener('click', () => {
            if (!isLoading && hasMorePages) {
                loadIssues(token, currentPage + 1, false, currentUser);
            }
        });
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
            filterAndDisplayIssues(currentUser);

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

    function filterAndDisplayIssues(currentUser) {
        let filtered = allIssues.filter(issue => issue.state === 'open'); // показываем только открытые
        if (currentTab !== 'all') {
            filtered = filtered.filter(issue => 
                issue.labels.some(l => l.name === `type:${currentTab}`)
            );
        }
        displayedIssues = filtered;
        renderIssuesList(displayedIssues, currentUser);
    }

    function renderIssuesList(issues, currentUser) {
        const listEl = document.getElementById('feedback-list');
        if (!listEl) return;

        if (issues.length === 0) {
            listEl.innerHTML = `<p class="text-secondary" style="text-align: center;">Пока нет сообщений. Будьте первым!</p>`;
            return;
        }

        listEl.innerHTML = issues.map(issue => {
            const isAuthor = currentUser && issue.user.login === currentUser;
            const typeLabel = issue.labels.find(l => l.name.startsWith('type:'))?.name.split(':')[1] || 'idea';
            return `
            <div class="feedback-item" data-issue-number="${issue.number}">
                <div class="feedback-item-header">
                    <h4 class="feedback-item-title">${escapeHtml(issue.title)}</h4>
                    <div class="feedback-item-meta">
                        <span class="feedback-label type-${typeLabel}">${typeLabel}</span>
                        <span class="feedback-label">#${issue.number}</span>
                    </div>
                </div>
                <div class="feedback-item-body">
                    ${escapeHtml(issue.body || '').replace(/\n/g, '<br>')}
                </div>
                <div class="feedback-item-footer">
                    <span><i class="fas fa-user"></i> ${escapeHtml(issue.user.login)}</span>
                    <span><i class="fas fa-calendar-alt"></i> ${new Date(issue.created_at).toLocaleDateString()}</span>
                    <span><i class="fas fa-comment"></i> ${issue.comments}</span>
                </div>
                ${isAuthor ? `
                <div class="feedback-item-actions">
                    <button class="edit-issue" title="Редактировать"><i class="fas fa-edit"></i></button>
                    <button class="close-issue" title="Закрыть"><i class="fas fa-trash-alt"></i></button>
                </div>` : ''}
                <div class="feedback-comments" id="comments-${issue.number}"></div>
                ${issue.comments > 0 ? 
                    `<button class="button-small load-comments-btn" data-issue="${issue.number}">Загрузить комментарии (${issue.comments})</button>` : ''}
                <div class="comment-form" data-issue="${issue.number}">
                    <input type="text" placeholder="Написать комментарий..." class="comment-input">
                    <button class="button-small comment-submit">Отправить</button>
                </div>
            </div>`;
        }).join('');

        // Обработчики
        document.querySelectorAll('.load-comments-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const issueNumber = e.target.dataset.issue;
                loadComments(issueNumber, localStorage.getItem('github_token'));
            });
        });

        document.querySelectorAll('.comment-submit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const form = e.target.closest('.comment-form');
                const issueNumber = form.dataset.issue;
                const input = form.querySelector('.comment-input');
                const comment = input.value.trim();
                if (comment) {
                    submitComment(issueNumber, comment, localStorage.getItem('github_token'));
                    input.value = '';
                }
            });
        });

        document.querySelectorAll('.edit-issue').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const issueItem = e.target.closest('.feedback-item');
                const issueNumber = issueItem.dataset.issueNumber;
                editIssue(issueNumber, localStorage.getItem('github_token'), currentUser);
            });
        });

        document.querySelectorAll('.close-issue').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (!confirm('Вы уверены, что хотите закрыть это сообщение? Оно исчезнет из общего списка.')) return;
                const issueItem = e.target.closest('.feedback-item');
                const issueNumber = issueItem.dataset.issueNumber;
                closeIssue(issueNumber, localStorage.getItem('github_token'), currentUser);
            });
        });
    }

    // ---- Вспомогательные функции API ----

    async function loadComments(issueNumber, token) {
        const commentsDiv = document.getElementById(`comments-${issueNumber}`);
        if (!commentsDiv) return;
        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) throw new Error();
            const comments = await response.json();
            commentsDiv.innerHTML = comments.map(c => `
                <div class="comment">
                    <div class="comment-meta">
                        <span class="comment-author">${escapeHtml(c.user.login)}</span>
                        <span>${new Date(c.created_at).toLocaleString()}</span>
                    </div>
                    <div>${escapeHtml(c.body).replace(/\n/g, '<br>')}</div>
                </div>
            `).join('');
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
                // Обновляем счётчик комментариев в кнопке
                const btn = document.querySelector(`.load-comments-btn[data-issue="${issueNumber}"]`);
                if (btn) {
                    const current = parseInt(btn.textContent.match(/\d+/)[0]) || 0;
                    btn.textContent = `Загрузить комментарии (${current + 1})`;
                }
            }
        } catch (error) {
            console.error('Error posting comment:', error);
        }
    }

    async function editIssue(issueNumber, token, currentUser) {
        const issue = allIssues.find(i => i.number == issueNumber);
        if (!issue || issue.user.login !== currentUser) return;

        const newTitle = prompt('Редактировать заголовок:', issue.title);
        if (newTitle === null) return;
        const newBody = prompt('Редактировать описание:', issue.body);
        if (newBody === null) return;

        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title: newTitle, body: newBody })
            });
            if (response.ok) {
                sessionStorage.removeItem(`issues_${currentGame}_page_1`);
                await loadIssues(token, 1, true, currentUser);
            } else {
                alert('Не удалось отредактировать');
            }
        } catch (error) {
            console.error('Edit error:', error);
        }
    }

    async function closeIssue(issueNumber, token, currentUser) {
        const issue = allIssues.find(i => i.number == issueNumber);
        if (!issue || issue.user.login !== currentUser) return;

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

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
})();