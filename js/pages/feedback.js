// feedback.js — обратная связь для страниц игр с модальными окнами и проверкой авторизации

(function() {
    const { cacheGet, cacheSet, cacheRemove, escapeHtml, renderMarkdown } = GithubCore;
    const { loadIssues, createIssue, updateIssue, closeIssue, loadComments, addComment, loadReactions, addReaction, removeReaction } = GithubAPI;
    const { renderReactions, renderComments } = UIFeedback;
    const { isAdmin, getCurrentUser } = GithubAuth;

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
    let token = null;

    const commentsCache = new Map();
    const reactionsCache = new Map();

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

        token = localStorage.getItem('github_token');
        currentUser = getCurrentUser();

        checkAuthAndRender();
    }

    function checkAuthAndRender() {
        if (token && currentUser) {
            renderFeedbackInterface();
        } else {
            renderFeedbackInterface(true); // передаём флаг, что пользователь неавторизован
        }
    }

    async function renderFeedbackInterface(isGuest = false) {
        container.innerHTML = `
            <div class="feedback-header">
                <h2 data-lang="feedbackTitle">Идеи, баги и отзывы</h2>
                ${!isGuest ? `<button class="button" id="toggle-form-btn" data-lang="feedbackNewBtn">Оставить сообщение</button>` : ''}
            </div>

            <div class="feedback-tabs">
                <button class="feedback-tab active" data-tab="all" data-lang="feedbackTabAll">Все</button>
                <button class="feedback-tab" data-tab="idea" data-lang="feedbackTabIdea">💡 Идеи</button>
                <button class="feedback-tab" data-tab="bug" data-lang="feedbackTabBug">🐛 Баги</button>
                <button class="feedback-tab" data-tab="review" data-lang="feedbackTabReview">⭐ Отзывы</button>
            </div>

            <div class="feedback-list" id="feedback-list">
                <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>
            </div>

            <div style="text-align: center; margin-top: 20px;" id="load-more-container">
                <button class="button" id="load-more" style="display: none;" data-lang="feedbackLoadMore">Загрузить ещё</button>
            </div>
        `;

        if (!isGuest) {
            document.getElementById('toggle-form-btn').addEventListener('click', () => {
                openEditorModal('new');
            });
        }

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

        await loadIssuesPage(1, true);
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
                issues = await loadIssues({
                    labels: `game:${currentGame}`,
                    state: 'open',
                    per_page: ITEMS_PER_PAGE,
                    page: page
                });
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
                </div>
            </div>`;
        }).join('');

        issues.forEach(issue => {
            const reactionsContainer = document.querySelector(`.reactions-container[data-target-id="${issue.number}"]`);
            if (reactionsContainer) {
                loadAndRenderReactions(issue.number, reactionsContainer);
            }
        });

        attachEventHandlers();
    }

    function attachEventHandlers() {
        document.querySelectorAll('.feedback-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('.reaction-button') || e.target.closest('.reaction-add-btn')) return;

                const issueNumber = item.dataset.issueNumber;
                const issue = allIssues.find(i => i.number == issueNumber);
                if (issue) openFeedbackModal(issue);
            });
        });
    }

    async function openFeedbackModal(issue) {
        const modal = document.createElement('div');
        modal.className = 'modal modal-fullscreen';
        modal.innerHTML = `
            <div class="modal-content modal-content-full">
                <button class="modal-close"><i class="fas fa-times"></i></button>
                <div class="modal-body" id="modal-feedback-body">
                    <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        const closeModal = () => {
            modal.remove();
            document.body.style.overflow = '';
        };

        modal.querySelector('.modal-close').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        // Закрытие по Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        const container = document.getElementById('modal-feedback-body');

        try {
            const fullIssue = await loadIssue(issue.number);
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'spoiler-content';
            bodyDiv.innerHTML = renderMarkdown(fullIssue.body);

            const reactionsDiv = document.createElement('div');
            reactionsDiv.className = 'reactions-container';

            const commentsDiv = document.createElement('div');
            commentsDiv.className = 'feedback-comments';
            commentsDiv.id = `modal-comments-${issue.number}`;

            const commentForm = document.createElement('div');
            commentForm.className = 'comment-form';
            commentForm.dataset.issue = issue.number;
            if (currentUser) {
                commentForm.innerHTML = `
                    <input type="text" class="comment-input" placeholder="Написать комментарий...">
                    <button class="button comment-submit">Отправить</button>
                `;
            }

            // Кнопки для автора и администраторов
            const actionButtons = document.createElement('div');
            actionButtons.className = 'feedback-item-actions';
            const isAuthor = currentUser && fullIssue.user.login === currentUser;
            if (isAuthor || isAdmin()) {
                actionButtons.innerHTML = `
                    <button class="edit-issue" title="Редактировать"><i class="fas fa-edit"></i></button>
                    <button class="close-issue" title="Закрыть"><i class="fas fa-trash-alt"></i></button>
                `;
            }

            container.innerHTML = '';
            container.appendChild(bodyDiv);
            container.appendChild(reactionsDiv);
            if (isAuthor || isAdmin()) container.appendChild(actionButtons);
            container.appendChild(commentsDiv);
            if (currentUser) container.appendChild(commentForm);

            // Реакции
            const reactions = await loadReactions(issue.number);
            const handleAdd = async (num, content) => {
                await addReaction(num, content);
                const updated = await loadReactions(num);
                renderReactions(reactionsDiv, num, updated, currentUser, handleAdd, handleRemove);
            };
            const handleRemove = async (num, reactionId) => {
                await removeReaction(num, reactionId);
                const updated = await loadReactions(num);
                renderReactions(reactionsDiv, num, updated, currentUser, handleAdd, handleRemove);
            };
            renderReactions(reactionsDiv, issue.number, reactions, currentUser, handleAdd, handleRemove);

            // Комментарии
            const comments = await loadComments(issue.number);
            renderComments(commentsDiv, comments);

            // Обработчик отправки комментария
            if (currentUser) {
                commentForm.querySelector('.comment-submit').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const input = commentForm.querySelector('.comment-input');
                    const comment = input.value.trim();
                    if (!comment) return;

                    input.disabled = true;
                    e.target.disabled = true;
                    try {
                        await addComment(issue.number, comment);
                        const updatedComments = await loadComments(issue.number);
                        renderComments(commentsDiv, updatedComments);
                        input.value = '';
                    } catch (err) {
                        alert('Ошибка при отправке комментария');
                    } finally {
                        input.disabled = false;
                        e.target.disabled = false;
                    }
                });
            }

            // Обработчики для кнопок
            if (isAuthor || isAdmin()) {
                actionButtons.querySelector('.edit-issue').addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeModal();
                    document.removeEventListener('keydown', escHandler);
                    openEditorModal('edit', fullIssue);
                });

                actionButtons.querySelector('.close-issue').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!confirm('Вы уверены, что хотите закрыть это сообщение?')) return;
                    try {
                        await closeIssue(issue.number);
                        closeModal();
                        document.removeEventListener('keydown', escHandler);
                        cacheRemove(`issues_${currentGame}_page_1`);
                        await loadIssuesPage(1, true);
                    } catch (err) {
                        alert('Ошибка при закрытии');
                    }
                });
            }

        } catch (err) {
            console.error('Ошибка загрузки деталей', err);
            container.innerHTML = '<p class="error-message">Не удалось загрузить содержимое.</p>';
        }
    }

    function openEditorModal(mode, issue = null) {
        const modal = document.createElement('div');
        modal.className = 'modal modal-fullscreen';
        modal.innerHTML = `
            <div class="modal-content modal-content-full">
                <button class="modal-close"><i class="fas fa-times"></i></button>
                <div class="modal-body" id="modal-editor-body">
                    <div class="feedback-form" id="feedback-form-modal">
                        <h3>${mode === 'edit' ? 'Редактирование' : 'Новое сообщение'}</h3>
                        <input type="text" id="modal-feedback-title" class="feedback-input" placeholder="Заголовок" value="${issue ? escapeHtml(issue.title) : ''}">
                        <select id="modal-feedback-category" class="feedback-select">
                            <option value="idea" ${issue && issue.labels.find(l => l.name === 'type:idea') ? 'selected' : ''}>💡 Идея</option>
                            <option value="bug" ${issue && issue.labels.find(l => l.name === 'type:bug') ? 'selected' : ''}>🐛 Баг</option>
                            <option value="review" ${issue && issue.labels.find(l => l.name === 'type:review') ? 'selected' : ''}>⭐ Отзыв</option>
                        </select>
                        <div id="modal-editor-toolbar"></div>
                        <textarea id="modal-feedback-body" class="feedback-textarea" placeholder="Подробное описание..." rows="10">${issue ? escapeHtml(issue.body) : ''}</textarea>
                        <div class="preview-area" id="modal-preview-area" style="display: none;"></div>
                        <div class="button-group">
                            <button class="button button-secondary" id="modal-cancel">Отмена</button>
                            <button class="button" id="modal-submit">${mode === 'edit' ? 'Сохранить' : 'Опубликовать'}</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        const closeModal = () => {
            modal.remove();
            document.body.style.overflow = '';
        };

        modal.querySelector('.modal-close').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        const textarea = document.getElementById('modal-feedback-body');
        const toolbarContainer = document.getElementById('modal-editor-toolbar');

        if (typeof Editor !== 'undefined') {
            const toolbar = Editor.createEditorToolbar(textarea, {
                previewId: 'modal-preview-btn',
                previewAreaId: 'modal-preview-area',
                onPreview: () => {
                    const previewArea = document.getElementById('modal-preview-area');
                    const body = textarea.value;
                    if (!body.trim()) {
                        previewArea.style.display = 'none';
                        return;
                    }
                    previewArea.innerHTML = renderMarkdown(body);
                    previewArea.style.display = 'block';
                }
            });
            toolbarContainer.appendChild(toolbar);
        }

        document.getElementById('modal-cancel').addEventListener('click', () => {
            closeModal();
            document.removeEventListener('keydown', escHandler);
        });
        document.getElementById('modal-submit').addEventListener('click', async () => {
            const title = document.getElementById('modal-feedback-title').value.trim();
            const category = document.getElementById('modal-feedback-category').value;
            const body = document.getElementById('modal-feedback-body').value;

            if (!title || !body.trim()) {
                alert('Заполните заголовок и описание');
                return;
            }

            const submitBtn = document.getElementById('modal-submit');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Сохранение...';

            try {
                if (mode === 'edit' && issue) {
                    await updateIssue(issue.number, {
                        title: title,
                        body: body,
                        labels: [`game:${currentGame}`, `type:${category}`]
                    });
                } else {
                    await createIssue(title, body, [`game:${currentGame}`, `type:${category}`]);
                }
                closeModal();
                document.removeEventListener('keydown', escHandler);
                cacheRemove(`issues_${currentGame}_page_1`);
                await loadIssuesPage(1, true);
            } catch (err) {
                console.error(err);
                alert('Ошибка: ' + err.message);
                submitBtn.disabled = false;
                submitBtn.textContent = mode === 'edit' ? 'Сохранить' : 'Опубликовать';
            }
        });
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

        const handleAdd = async (num, content) => {
            try {
                await addReaction(num, content);
                const updated = await loadReactions(num);
                reactionsCache.set(`reactions_${num}`, updated);
                renderReactions(container, num, updated, currentUser, handleAdd, handleRemove);
            } catch (err) {
                console.error('Failed to add reaction', err);
                const updated = await loadReactions(num);
                reactionsCache.set(`reactions_${num}`, updated);
                renderReactions(container, num, updated, currentUser, handleAdd, handleRemove);
            }
        };

        const handleRemove = async (num, reactionId) => {
            try {
                await removeReaction(num, reactionId);
                const updated = await loadReactions(num);
                reactionsCache.set(`reactions_${num}`, updated);
                renderReactions(container, num, updated, currentUser, handleAdd, handleRemove);
            } catch (err) {
                console.error('Failed to remove reaction', err);
                const updated = await loadReactions(num);
                reactionsCache.set(`reactions_${num}`, updated);
                renderReactions(container, num, updated, currentUser, handleAdd, handleRemove);
            }
        };

        renderReactions(container, issueNumber, reactions, currentUser, handleAdd, handleRemove);
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
})();