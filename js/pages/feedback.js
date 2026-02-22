// feedback.js — обратная связь для страниц игр

(function() {
    const { cacheGet, cacheSet, cacheRemove, escapeHtml, renderMarkdown } = GithubCore;
    const { loadIssues, createIssue, updateIssue, closeIssue, loadComments, addComment, loadReactions, addReaction, removeReaction } = GithubAPI;
    const { renderReactions, renderComments } = UIFeedback;

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
                    <input type="text" id="feedback-title" class="feedback-input" data-lang="feedbackTitlePlaceholder" placeholder="Заголовок">
                    <select id="feedback-category" class="feedback-select">
                        <option value="idea" data-lang="feedbackCategoryIdea">💡 Идея</option>
                        <option value="bug" data-lang="feedbackCategoryBug">🐛 Баг</option>
                        <option value="review" data-lang="feedbackCategoryReview">⭐ Отзыв</option>
                    </select>

                    <div id="feedback-editor-toolbar"></div>

                    <textarea id="feedback-body" class="feedback-textarea" data-lang="feedbackBodyPlaceholder" placeholder="Подробное описание..." rows="6"></textarea>
                    <div class="preview-area" id="preview-area-feedback" style="display: none; background: var(--bg-primary); border-radius: 16px; padding: 16px; margin-top: 10px;"></div>

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

        const textarea = document.getElementById('feedback-body');
        const toolbarContainer = document.getElementById('feedback-editor-toolbar');

        const toolbar = Editor.createEditorToolbar(textarea, {
            previewId: 'preview-btn-feedback',
            previewAreaId: 'preview-area-feedback',
            onPreview: () => {
                const previewArea = document.getElementById('preview-area-feedback');
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

        document.getElementById('feedback-cancel').addEventListener('click', () => {
            document.querySelector('.feedback-form-wrapper').style.display = 'none';
            editingIssue = null;
        });

        document.getElementById('feedback-submit').addEventListener('click', () => {
            if (editingIssue) {
                updateExistingIssue();
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

    function attachEventHandlers() {
        document.querySelectorAll('.feedback-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('.reaction-button') ||
                    e.target.closest('.reaction-add-btn') || e.target.closest('.comment-input') ||
                    e.target.closest('.comment-submit')) return;

                const details = item.querySelector('.feedback-item-details');
                const expanded = item.classList.contains('expanded');

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
                    if (!item.querySelector('.comment')) {
                        loadAndRenderComments(issueNumber, document.getElementById(`comments-${issueNumber}`));
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
                if (!comment) return;

                const commentsDiv = document.getElementById(`comments-${issueNumber}`);
                const tempComment = document.createElement('div');
                tempComment.className = 'comment temp';
                tempComment.innerHTML = `
                    <div class="comment-meta">
                        <span class="comment-author">${escapeHtml(currentUser)}</span>
                        <span>только что</span>
                    </div>
                    <div>${escapeHtml(comment)} <em>(отправка...)</em></div>
                `;
                commentsDiv.appendChild(tempComment);
                input.value = '';
                btn.disabled = true;

                try {
                    await addComment(issueNumber, comment);
                    const updatedComments = await loadComments(issueNumber);
                    commentsCache.set(`comments_${issueNumber}`, updatedComments);
                    renderComments(commentsDiv, updatedComments);
                } catch (err) {
                    console.error('Failed to add comment', err);
                    tempComment.remove();
                    alert('Не удалось отправить комментарий');
                } finally {
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
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('Вы уверены, что хотите закрыть это сообщение?')) return;
                const issueItem = e.target.closest('.feedback-item');
                const issueNumber = issueItem.dataset.issueNumber;
                issueItem.style.opacity = '0.5';
                btn.disabled = true;
                try {
                    await closeIssue(issueNumber);
                    cacheRemove(`issues_${currentGame}_page_1`);
                    await loadIssuesPage(1, true);
                } catch (err) {
                    console.error('Failed to close issue', err);
                    issueItem.style.opacity = '1';
                    btn.disabled = false;
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

    async function updateExistingIssue() {
        if (!editingIssue) return;
        const title = document.getElementById('feedback-title').value.trim();
        const category = document.getElementById('feedback-category').value;
        const bodyRaw = document.getElementById('feedback-body').value;
        const bodyTrimmed = bodyRaw.trim();

        if (!title || !bodyTrimmed) {
            alert('Заполните заголовок и описание');
            return;
        }

        const issueItem = document.querySelector(`.feedback-item[data-issue-number="${editingIssue.number}"]`);
        const titleEl = issueItem.querySelector('.feedback-item-title');
        const previewEl = issueItem.querySelector('.feedback-item-preview');
        const oldTitle = titleEl.textContent;
        const oldPreview = previewEl.textContent;
        titleEl.textContent = title;
        previewEl.textContent = bodyTrimmed.substring(0, 120) + (bodyTrimmed.length > 120 ? '…' : '');

        try {
            await updateIssue(editingIssue.number, {
                title: title,
                body: bodyRaw,
                labels: [`game:${currentGame}`, `type:${category}`]
            });
            document.querySelector('.feedback-form-wrapper').style.display = 'none';
            editingIssue = null;
            cacheRemove(`issues_${currentGame}_page_1`);
            await loadIssuesPage(1, true);
        } catch (error) {
            console.error('Update error:', error);
            titleEl.textContent = oldTitle;
            previewEl.textContent = oldPreview;
            alert('Не удалось обновить сообщение');
        }
    }

    async function submitNewIssue() {
        const title = document.getElementById('feedback-title').value.trim();
        const category = document.getElementById('feedback-category').value;
        const bodyRaw = document.getElementById('feedback-body').value;
        const bodyTrimmed = bodyRaw.trim();

        if (!title || !bodyTrimmed) {
            alert('Заполните заголовок и описание');
            return;
        }

        const tempId = 'temp-' + Date.now();
        const tempCard = document.createElement('div');
        tempCard.className = 'feedback-item temp';
        tempCard.dataset.issueNumber = tempId;
        tempCard.innerHTML = `
            <div class="feedback-item-header">
                <h4 class="feedback-item-title">${escapeHtml(title)}</h4>
                <div class="feedback-item-meta">
                    <span class="feedback-label type-${category}">${category}</span>
                    <span class="feedback-label">#...</span>
                </div>
            </div>
            <div class="feedback-item-preview">${escapeHtml(bodyTrimmed.substring(0, 120))}...</div>
            <div class="reactions-container"></div>
            <div class="feedback-item-footer">
                <span><i class="fas fa-user"></i> ${escapeHtml(currentUser)}</span>
                <span><i class="fas fa-calendar-alt"></i> только что</span>
                <span><i class="fas fa-comment"></i> 0</span>
            </div>
        `;
        const list = document.getElementById('feedback-list');
        list.insertBefore(tempCard, list.firstChild);

        try {
            await createIssue(title, bodyRaw, [`game:${currentGame}`, `type:${category}`]);
            document.getElementById('feedback-title').value = '';
            document.getElementById('feedback-body').value = '';
            document.querySelector('.feedback-form-wrapper').style.display = 'none';
            cacheRemove(`issues_${currentGame}_page_1`);
            await loadIssuesPage(1, true);
        } catch (error) {
            console.error('Error creating issue:', error);
            tempCard.remove();
            alert('Не удалось создать сообщение');
        }
    }
})();