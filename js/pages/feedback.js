// feedback.js — обратная связь для страниц игр (использует общие модули)

(function() {
    // Используем глобальные объекты
    const { cacheGet, cacheSet, cacheRemove, escapeHtml } = GithubCore;
    const { loadIssues, createIssue, updateIssue, closeIssue, loadComments, addComment, loadReactions, addReaction, removeReaction } = GithubAPI;
    const { renderReactions, renderComments } = UIFeedback;

    // Конфигурация
    const ITEMS_PER_PAGE = 10;

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
    let token = null;

    // Кеши (in-memory) для комментариев и реакций
    const commentsCache = new Map();
    const reactionsCache = new Map();

    // Инициализация при загрузке DOM
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

        // Слушаем события авторизации
        window.addEventListener('github-login-success', (e) => {
            currentUser = e.detail.login;
            token = localStorage.getItem('github_token');
            checkAuthAndRender();
        });

        window.addEventListener('github-logout', () => {
            currentUser = null;
            token = null;
            commentsCache.clear();
            reactionsCache.clear();
            checkAuthAndRender();
        });

        // Проверим текущее состояние
        token = localStorage.getItem('github_token');
        const profile = document.querySelector('.nav-profile');
        currentUser = profile ? profile.dataset.githubLogin : null;

        checkAuthAndRender();
    }

    function checkAuthAndRender() {
        if (token && currentUser) {
            renderFeedbackInterface();
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
            window.dispatchEvent(new CustomEvent('github-login-requested'));
        });
    }

    async function renderFeedbackInterface() {
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

        // Обработчики кнопок
        const toggleBtn = document.getElementById('toggle-form-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', toggleForm);
        }

        document.getElementById('feedback-cancel').addEventListener('click', () => {
            document.querySelector('.feedback-form-wrapper').style.display = 'none';
            editingIssue = null;
        });

        document.getElementById('feedback-submit').addEventListener('click', () => {
            if (editingIssue) {
                updateIssue();
            } else {
                submitNewIssue();
            }
        });

        document.querySelectorAll('.feedback-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.feedback-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                currentTab = e.target.dataset.tab;
                currentPage = 1;
                filterAndDisplayIssues();
            });
        });

        document.getElementById('load-more').addEventListener('click', () => {
            if (!isLoading && hasMorePages) {
                loadIssuesPage(currentPage + 1, false);
            }
        });

        // Загружаем первую страницу
        await loadIssuesPage(1, true);
    }

    function toggleForm() {
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
    }

    async function loadIssuesPage(page, reset = false) {
        if (isLoading) return;
        isLoading = true;

        try {
            const cacheKey = `issues_${currentGame}_page_${page}`;
            let issues;
            const cached = cacheGet(cacheKey);
            if (cached) {
                issues = cached;
            } else {
                // Загружаем с API
                issues = await loadIssues({
                    labels: `game:${currentGame}`,
                    state: 'open',
                    per_page: ITEMS_PER_PAGE,
                    page: page
                });
                // Проверяем, есть ли следующая страница (по количеству полученных)
                hasMorePages = issues.length === ITEMS_PER_PAGE;
                cacheSet(cacheKey, issues);
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
                    <p data-lang="feedbackLoadError">Ошибка загрузки.</p>
                    <button class="button-small" id="retry-feedback" data-lang="feedbackRetry">Повторить</button>
                </div>
            `;
            document.getElementById('retry-feedback')?.addEventListener('click', () => {
                loadIssuesPage(1, true);
            });
        } finally {
            isLoading = false;
            const loadMoreBtn = document.getElementById('load-more');
            if (loadMoreBtn) loadMoreBtn.style.display = hasMorePages ? 'inline-block' : 'none';
        }
    }

    function filterAndDisplayIssues() {
        let filtered = allIssues.filter(issue => issue.state === 'open');
        if (currentTab !== 'all') {
            filtered = filtered.filter(issue =>
                issue.labels.some(l => l.name === `type:${currentTab}`)
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

        // Загружаем реакции для каждого issue
        issues.forEach(issue => {
            const container = document.querySelector(`.reactions-container[data-target-id="${issue.number}"]`);
            if (container) {
                loadAndRenderReactions(issue.number, container);
            }
        });

        attachEventHandlers();
    }

    async function loadAndRenderReactions(issueNumber, container) {
        const cacheKey = `reactions_${issueNumber}`;
        let reactions = reactionsCache.get(cacheKey);
        if (!reactions) {
            try {
                reactions = await loadReactions(issueNumber);
                reactionsCache.set(cacheKey, reactions);
            } catch (err) {
                console.error('Failed to load reactions', err);
                return;
            }
        }

        renderReactions(
            container,
            issueNumber,
            reactions,
            currentUser,
            async (num, content) => {
                // add reaction
                const newReaction = await addReaction(num, content);
                // обновляем кеш и перерисовываем
                const updated = await loadReactions(num);
                reactionsCache.set(`reactions_${num}`, updated);
                renderReactions(container, num, updated, currentUser, arguments.callee, arguments.callee);
            },
            async (num, reactionId) => {
                // remove reaction
                await removeReaction(num, reactionId);
                const updated = await loadReactions(num);
                reactionsCache.set(`reactions_${num}`, updated);
                renderReactions(container, num, updated, currentUser, arguments.callee, arguments.callee);
            }
        );
    }

    function attachEventHandlers() {
        // Раскрытие/сворачивание
        document.querySelectorAll('.feedback-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('.reaction-button') ||
                    e.target.closest('.reaction-add-btn') || e.target.closest('.comment-input') ||
                    e.target.closest('.comment-submit')) return;

                const details = item.querySelector('.feedback-item-details');
                const expanded = item.classList.contains('expanded');

                // Закрываем все другие
                document.querySelectorAll('.feedback-item.expanded').forEach(el => {
                    if (el !== item) {
                        el.classList.remove('expanded');
                        el.querySelector('.feedback-item-details').style.display = 'none';
                    }
                });

                if (expanded) {
                    item.classList.remove('expanded');
                    details.style.display = 'none';
                } else {
                    item.classList.add('expanded');
                    details.style.display = 'block';
                    const issueNumber = item.dataset.issueNumber;
                    // Загружаем комментарии, если ещё не загружены
                    if (!item.querySelector('.comment')) {
                        loadAndRenderComments(issueNumber, document.getElementById(`comments-${issueNumber}`));
                    }
                }
            });
        });

        // Отправка комментария
        document.querySelectorAll('.comment-submit').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const form = e.target.closest('.comment-form');
                const issueNumber = form.dataset.issue;
                const input = form.querySelector('.comment-input');
                const comment = input.value.trim();
                if (!comment) return;

                btn.disabled = true;
                try {
                    await addComment(issueNumber, comment);
                    input.value = '';
                    // Обновляем комментарии
                    const commentsDiv = document.getElementById(`comments-${issueNumber}`);
                    await loadAndRenderComments(issueNumber, commentsDiv);
                    // Увеличиваем счётчик комментариев
                    const item = document.querySelector(`.feedback-item[data-issue-number="${issueNumber}"]`);
                    const commentsSpan = item.querySelector('.feedback-item-footer span:last-child');
                    const current = parseInt(commentsSpan.textContent.match(/\d+/)[0]) || 0;
                    commentsSpan.innerHTML = `<i class="fas fa-comment"></i> ${current + 1}`;
                } catch (err) {
                    alert('Не удалось отправить комментарий');
                } finally {
                    btn.disabled = false;
                }
            });
        });

        // Редактирование
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

        // Закрытие (удаление) issue
        document.querySelectorAll('.close-issue').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('Вы уверены, что хотите закрыть это сообщение?')) return;
                const issueItem = e.target.closest('.feedback-item');
                const issueNumber = issueItem.dataset.issueNumber;
                try {
                    await closeIssue(issueNumber);
                    // Очищаем кеш и перезагружаем
                    cacheRemove(`issues_${currentGame}_page_1`);
                    await loadIssuesPage(1, true);
                } catch (err) {
                    alert('Не удалось закрыть сообщение');
                }
            });
        });
    }

    async function loadAndRenderComments(issueNumber, container) {
        const cacheKey = `comments_${issueNumber}`;
        let comments = commentsCache.get(cacheKey);
        if (!comments) {
            try {
                comments = await loadComments(issueNumber);
                commentsCache.set(cacheKey, comments);
            } catch (err) {
                console.error('Failed to load comments', err);
                container.innerHTML = '<p class="error-message">Ошибка загрузки комментариев</p>';
                return;
            }
        }
        renderComments(container, comments);
    }

    function startEditing(issue) {
        editingIssue = issue;
        document.querySelector('.feedback-form-wrapper').style.display = 'block';
        document.getElementById('feedback-title').value = issue.title;
        document.getElementById('feedback-body').value = issue.body;
        const typeLabel = issue.labels.find(l => l.name.startsWith('type:'))?.name.split(':')[1] || 'idea';
        document.getElementById('feedback-category').value = typeLabel;
    }

    async function updateIssue() {
        if (!editingIssue) return;
        const title = document.getElementById('feedback-title').value.trim();
        const category = document.getElementById('feedback-category').value;
        const body = document.getElementById('feedback-body').value.trim();

        if (!title || !body) {
            alert('Заполните заголовок и описание');
            return;
        }

        try {
            await updateIssue(editingIssue.number, {
                title: title,
                body: body,
                labels: [`game:${currentGame}`, `type:${category}`]
            });
            document.querySelector('.feedback-form-wrapper').style.display = 'none';
            editingIssue = null;
            // Очищаем кеш и перезагружаем
            cacheRemove(`issues_${currentGame}_page_1`);
            await loadIssuesPage(1, true);
        } catch (error) {
            console.error('Update error:', error);
            alert('Не удалось обновить сообщение');
        }
    }

    async function submitNewIssue() {
        const title = document.getElementById('feedback-title').value.trim();
        const category = document.getElementById('feedback-category').value;
        const body = document.getElementById('feedback-body').value.trim();

        if (!title || !body) {
            alert('Заполните заголовок и описание');
            return;
        }

        try {
            await createIssue(title, body, [`game:${currentGame}`, `type:${category}`]);
            document.getElementById('feedback-title').value = '';
            document.getElementById('feedback-body').value = '';
            document.querySelector('.feedback-form-wrapper').style.display = 'none';
            // Очищаем кеш и перезагружаем
            cacheRemove(`issues_${currentGame}_page_1`);
            await loadIssuesPage(1, true);
        } catch (error) {
            console.error('Error creating issue:', error);
            alert('Не удалось создать сообщение');
        }
    }
})();