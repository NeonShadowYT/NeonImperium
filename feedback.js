// feedback.js — Обратная связь через GitHub Issues
// Зависит от github-auth.js (должен быть загружен ранее)

(function() {
    // Конфигурация — замените на свои данные
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium',
        CACHE_TTL: 1 * 60 * 1000, // 5 минут в миллисекундах, для тестов 1
        ITEMS_PER_PAGE: 10
    };

    // Текущее состояние
    let currentGame = '';
    let currentTab = 'all'; // all, idea, bug, review
    let currentPage = 1;
    let hasMorePages = true;
    let isLoading = false;
    let allIssues = [];
    let displayedIssues = [];

    // DOM элементы
    let container, feedbackSection;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        feedbackSection = document.getElementById('feedback-section');
        if (!feedbackSection) return;

        currentGame = feedbackSection.dataset.game;
        if (!currentGame) {
            console.warn('Game not specified in feedback-section');
            return;
        }

        container = feedbackSection.querySelector('.feedback-container');
        if (!container) return;

        // Проверяем, залогинен ли пользователь
        checkAuthAndRender();
    }

    function checkAuthAndRender() {
        const token = localStorage.getItem('github_token');
        const profile = document.querySelector('.nav-profile');
        const isLoggedIn = token && profile && profile.dataset.githubLogin;

        if (isLoggedIn) {
            renderFeedbackInterface(token);
        } else {
            renderLoginPrompt();
        }
    }

    function renderLoginPrompt() {
        container.innerHTML = `
            <div class="login-prompt">
                <i class="fab fa-github"></i>
                <h3 data-lang="feedbackLoginPrompt">Войдите через GitHub, чтобы участвовать в обсуждениях</h3>
                <button class="button" id="feedback-login-btn" data-lang="feedbackLoginBtn">Войти</button>
            </div>
        `;
        document.getElementById('feedback-login-btn').addEventListener('click', () => {
            // Ищем кнопку входа в профиле и кликаем по ней
            const profile = document.querySelector('.nav-profile');
            if (profile) {
                profile.click();
                // После входа перезагрузим блок
                setTimeout(checkAuthAndRender, 1000);
            }
        });
    }

    async function renderFeedbackInterface(token) {
        container.innerHTML = `
            <div class="feedback-tabs">
                <button class="feedback-tab active" data-tab="all">Все</button>
                <button class="feedback-tab" data-tab="idea">💡 Идеи</button>
                <button class="feedback-tab" data-tab="bug">🐛 Баги</button>
                <button class="feedback-tab" data-tab="review">⭐ Отзывы</button>
            </div>

            <div class="feedback-form">
                <h3 data-lang="feedbackFormTitle">Оставить сообщение</h3>
                <input type="text" id="feedback-title" placeholder="Заголовок" data-lang="feedbackTitlePlaceholder">
                <select id="feedback-category">
                    <option value="idea" data-lang="feedbackCategoryIdea">💡 Идея</option>
                    <option value="bug" data-lang="feedbackCategoryBug">🐛 Баг</option>
                    <option value="review" data-lang="feedbackCategoryReview">⭐ Отзыв</option>
                </select>
                <textarea id="feedback-body" placeholder="Подробное описание..." data-lang="feedbackBodyPlaceholder"></textarea>
                <button class="button" id="feedback-submit" data-lang="feedbackSubmitBtn">Отправить</button>
            </div>

            <div class="feedback-list" id="feedback-list">
                <div class="loading-spinner">
                    <i class="fas fa-circle-notch fa-spin"></i>
                </div>
            </div>

            <div style="text-align: center; margin-top: 20px;" id="load-more-container">
                <button class="button" id="load-more" style="display: none;" data-lang="feedbackLoadMore">Загрузить ещё</button>
            </div>
        `;

        // Загружаем issues
        await loadIssues(token, 1, true);

        // Привязываем обработчики
        document.querySelectorAll('.feedback-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.feedback-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                currentTab = e.target.dataset.tab;
                currentPage = 1;
                filterAndDisplayIssues();
            });
        });

        document.getElementById('feedback-submit').addEventListener('click', () => {
            submitNewIssue(token);
        });

        document.getElementById('load-more').addEventListener('click', () => {
            if (!isLoading && hasMorePages) {
                loadIssues(token, currentPage + 1, false);
            }
        });
    }

    async function loadIssues(token, page, reset = false) {
        if (isLoading) return;
        isLoading = true;

        try {
            // Проверяем кеш
            const cacheKey = `issues_${currentGame}_page_${page}`;
            const cached = sessionStorage.getItem(cacheKey);
            const cachedTime = sessionStorage.getItem(`${cacheKey}_time`);
            let issues = [];

            if (cached && cachedTime && (Date.now() - parseInt(cachedTime) < CONFIG.CACHE_TTL)) {
                issues = JSON.parse(cached);
            } else {
                // Запрашиваем с сервера
                const url = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?state=all&per_page=${CONFIG.ITEMS_PER_PAGE}&page=${page}&labels=game:${currentGame}`;
                
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                issues = await response.json();
                
                // Проверяем, есть ли следующая страница
                const linkHeader = response.headers.get('Link');
                hasMorePages = linkHeader && linkHeader.includes('rel="next"');

                // Кешируем
                sessionStorage.setItem(cacheKey, JSON.stringify(issues));
                sessionStorage.setItem(`${cacheKey}_time`, Date.now().toString());
            }

            if (reset) {
                allIssues = issues;
            } else {
                allIssues = [...allIssues, ...issues];
            }

            currentPage = page;
            filterAndDisplayIssues();

        } catch (error) {
            console.error('Error loading issues:', error);
            document.getElementById('feedback-list').innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Ошибка загрузки. Попробуйте позже.</p>
                </div>
            `;
        } finally {
            isLoading = false;
            const loadMoreBtn = document.getElementById('load-more');
            if (loadMoreBtn) {
                loadMoreBtn.style.display = hasMorePages ? 'inline-block' : 'none';
            }
        }
    }

    function filterAndDisplayIssues() {
        let filtered = [...allIssues];

        // Фильтр по типу (через labels)
        if (currentTab !== 'all') {
            filtered = filtered.filter(issue => 
                issue.labels.some(label => label.name === `type:${currentTab}`)
            );
        }

        displayedIssues = filtered;
        renderIssuesList(displayedIssues);
    }

    function renderIssuesList(issues) {
        const listEl = document.getElementById('feedback-list');
        if (!listEl) return;

        if (issues.length === 0) {
            listEl.innerHTML = `<p class="text-secondary" style="text-align: center;" data-lang="feedbackNoItems">Пока нет сообщений. Будьте первым!</p>`;
            return;
        }

        listEl.innerHTML = issues.map(issue => `
            <div class="feedback-item" data-issue-number="${issue.number}">
                <div class="feedback-item-header">
                    <h4 class="feedback-item-title">${escapeHtml(issue.title)}</h4>
                    <div class="feedback-item-meta">
                        ${issue.labels.filter(l => l.name.startsWith('type:')).map(l => 
                            `<span class="feedback-label type-${l.name.split(':')[1]}">${l.name.split(':')[1]}</span>`
                        ).join('')}
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
                <div class="feedback-comments" id="comments-${issue.number}">
                    <!-- Комментарии будут загружены по клику -->
                </div>
                ${issue.comments > 0 ? 
                    `<button class="button small load-comments-btn" data-issue="${issue.number}">Загрузить комментарии (${issue.comments})</button>` : 
                    ''}
                <div class="comment-form" data-issue="${issue.number}">
                    <input type="text" placeholder="Написать комментарий..." class="comment-input">
                    <button class="button small comment-submit">Отправить</button>
                </div>
            </div>
        `).join('');

        // Привязываем обработчики для загрузки комментариев и отправки
        document.querySelectorAll('.load-comments-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const issueNumber = e.target.dataset.issue;
                loadComments(issueNumber);
            });
        });

        document.querySelectorAll('.comment-submit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const form = e.target.closest('.comment-form');
                const issueNumber = form.dataset.issue;
                const input = form.querySelector('.comment-input');
                const comment = input.value.trim();
                if (comment) {
                    submitComment(issueNumber, comment);
                    input.value = '';
                }
            });
        });
    }

    async function loadComments(issueNumber) {
        const token = localStorage.getItem('github_token');
        if (!token) return;

        const commentsDiv = document.getElementById(`comments-${issueNumber}`);
        if (!commentsDiv) return;

        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!response.ok) throw new Error();

            const comments = await response.json();
            
            if (comments.length === 0) {
                commentsDiv.innerHTML = '<p class="text-secondary">Нет комментариев</p>';
            } else {
                commentsDiv.innerHTML = comments.map(c => `
                    <div class="comment">
                        <div class="comment-meta">
                            <span class="comment-author">${escapeHtml(c.user.login)}</span>
                            <span>${new Date(c.created_at).toLocaleString()}</span>
                        </div>
                        <div>${escapeHtml(c.body).replace(/\n/g, '<br>')}</div>
                    </div>
                `).join('');
            }
        } catch (error) {
            console.error('Error loading comments:', error);
        }
    }

    async function submitComment(issueNumber, comment) {
        const token = localStorage.getItem('github_token');
        if (!token) return;

        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${issueNumber}/comments`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ body: comment })
            });

            if (response.ok) {
                // Перезагружаем комментарии
                loadComments(issueNumber);
                // Увеличиваем счётчик комментариев в заголовке
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

    async function submitNewIssue(token) {
        const title = document.getElementById('feedback-title').value.trim();
        const category = document.getElementById('feedback-category').value;
        const body = document.getElementById('feedback-body').value.trim();

        if (!title || !body) {
            alert('Заполните заголовок и описание');
            return;
        }

        const issueData = {
            title: title,
            body: body,
            labels: [
                `game:${currentGame}`,
                `type:${category}`
            ]
        };

        try {
            const response = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(issueData)
            });

            if (response.ok) {
                // Очищаем форму
                document.getElementById('feedback-title').value = '';
                document.getElementById('feedback-body').value = '';
                
                // Сбрасываем кеш для первой страницы и перезагружаем
                sessionStorage.removeItem(`issues_${currentGame}_page_1`);
                sessionStorage.removeItem(`issues_${currentGame}_page_1_time`);
                await loadIssues(token, 1, true);
            } else {
                const error = await response.json();
                alert(`Ошибка: ${error.message}`);
            }
        } catch (error) {
            console.error('Error creating issue:', error);
            alert('Не удалось создать сообщение. Попробуйте позже.');
        }
    }

    // Вспомогательная функция для экранирования HTML
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
})();