// js/features/feedback.js
(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, deduplicateByNumber, createAbortable, showToast, createModal, escapeHtml, extractAllowed, extractMeta, loadMarked } = NeonUtils;
    const { renderReactions, renderComments, createCard, renderPoll } = UIComponents;
    const { getCurrentUser, isAdmin } = GithubAuth;
    const { loadIssues, loadIssue, loadComments, addComment, loadReactions, addReaction, removeReaction, closeIssue } = NeonAPI;
    const { on } = NeonState;
    const { openEditorModal } = Editor;

    const ITEMS_PER_PAGE = 10;
    let currentGame, currentTab = 'all', currentPage = 1, isLoading = false;
    let allIssues = [], container, observer, sentinel, currentAbort = null;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        const section = document.getElementById('feedback-section');
        if (!section) return;
        currentGame = section.dataset.game;
        if (!currentGame) return;
        container = section.querySelector('.feedback-container');
        if (!container) return;

        on('login-success', () => checkAuthAndRender());
        on('logout', () => checkAuthAndRender());
        window.addEventListener('issue-created', (e) => {
            const issue = e.detail;
            if (issue.labels.some(l => l.name === `game:${currentGame}`) && !issue.labels.some(l => l.name === 'type:update' || l.name === 'type:news')) {
                cacheRemoveByPrefix(`issues_${currentGame}_`);
                allIssues = [issue, ...allIssues];
                filterAndDisplay(true);
            }
        });
        window.addEventListener('comment-updated', () => {});

        checkAuthAndRender();
    }

    function checkAuthAndRender() {
        if (getCurrentUser()) renderInterface();
        else renderLoginPrompt();
    }

    function renderLoginPrompt() {
        container.innerHTML = `<div class="login-prompt"><i class="fab fa-github" style="font-size:48px;"></i><h3 data-lang="feedbackLoginPrompt">Войдите через GitHub, чтобы участвовать</h3><p data-lang="feedbackTokenNote">Ваш токен останется только у вас в браузере.</p><button class="button" id="feedback-login-btn" data-lang="feedbackLoginBtn">Войти</button></div>`;
        container.querySelector('#feedback-login-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('github-login-requested')));
    }

    async function renderInterface() {
        container.innerHTML = `
            <div class="feedback-header">
                <div style="display:flex; align-items:center; gap:12px;">
                    <i class="fab fa-github" style="font-size:32px; color:var(--accent);"></i>
                    <h2 data-lang="feedbackTitle" style="margin:0;">Идеи, баги и отзывы</h2>
                </div>
                <button class="button" id="new-feedback-btn" data-lang="feedbackNewBtn">+ Оставить сообщение</button>
            </div>
            <div class="feedback-tabs">
                <button class="feedback-tab active" data-tab="all" data-lang="feedbackTabAll">Все</button>
                <button class="feedback-tab" data-tab="idea" data-lang="feedbackTabIdea">💡 Идеи</button>
                <button class="feedback-tab" data-tab="bug" data-lang="feedbackTabBug">🐛 Баги</button>
                <button class="feedback-tab" data-tab="review" data-lang="feedbackTabReview">⭐ Отзывы</button>
            </div>
            <div class="projects-grid" id="feedback-grid"></div>
            <div id="sentinel" style="height:10px;"></div>
        `;

        document.getElementById('new-feedback-btn').addEventListener('click', () => openEditorModal('new', { game: currentGame }, 'feedback'));

        const tabs = container.querySelectorAll('.feedback-tab');
        tabs.forEach(t => t.addEventListener('click', (e) => {
            tabs.forEach(tb => tb.classList.remove('active'));
            e.target.classList.add('active');
            currentTab = e.target.dataset.tab;
            currentPage = 1;
            allIssues = [];
            document.getElementById('feedback-grid').innerHTML = '';
            loadPage(1, true);
        }));

        sentinel = document.getElementById('sentinel');
        observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !isLoading) loadPage(currentPage + 1, false);
        }, { threshold: 0.1 });
        observer.observe(sentinel);

        await loadPage(1, true);
    }

    async function loadPage(page, reset = false) {
        if (isLoading) return;
        isLoading = true;
        if (currentAbort) currentAbort.controller.abort();
        const { controller, timeoutId } = createAbortable(10000);
        currentAbort = { controller };
        try {
            const cacheKey = `issues_${currentGame}_${page}`;
            let issues = cacheGet(cacheKey);
            if (!issues) {
                issues = await loadIssues({ labels: `game:${currentGame}`, state: 'open', per_page: ITEMS_PER_PAGE, page, signal: controller.signal });
                cacheSet(cacheKey, issues);
            }
            if (reset) allIssues = deduplicateByNumber(issues);
            else allIssues = deduplicateByNumber([...allIssues, ...issues]);
            currentPage = page;
            filterAndDisplay(reset);
        } catch (err) {
            if (err.name !== 'AbortError') showToast('Ошибка загрузки', 'error');
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
            isLoading = false;
        }
    }

    function filterAndDisplay(reset) {
        let filtered = allIssues.filter(issue => {
            const labels = issue.labels.map(l => l.name);
            if (labels.includes('type:update') || labels.includes('type:news')) return false;
            if (!labels.includes('private')) return true;
            if (isAdmin()) return true;
            const allowed = extractAllowed(issue.body);
            return allowed && allowed.split(',').map(s => s.trim()).includes(getCurrentUser());
        });
        if (currentTab !== 'all') {
            filtered = filtered.filter(issue => issue.labels.some(l => l.name === `type:${currentTab}`));
        }
        const grid = document.getElementById('feedback-grid');
        if (reset) grid.innerHTML = '';
        filtered.forEach(issue => {
            if (grid.querySelector(`[data-issue="${issue.number}"]`)) return;
            const card = createCard({
                type: 'post',
                number: issue.number,
                title: issue.title,
                body: issue.body,
                author: issue.user.login,
                date: issue.created_at,
                labels: issue.labels.map(l => l.name)
            }, (post) => openFullModal(post));
            card.dataset.issue = issue.number;
            grid.appendChild(card);
        });
    }

    async function openFullModal(post) {
        const user = getCurrentUser();
        const { modal, closeModal } = createModal(post.title, '<div class="loading-spinner"><i class="fas fa-spinner fa-pulse"></i> Загрузка...</div>', { size: 'full' });
        const bodyContainer = modal.querySelector('.modal-body');
        try {
            const issue = await loadIssue(post.number);
            if (issue.state === 'closed') {
                bodyContainer.innerHTML = '<p class="error-message">Пост закрыт.</p>';
                return;
            }
            bodyContainer.innerHTML = '';
            const header = document.createElement('div');
            header.className = 'modal-post-header';
            header.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:16px;';
            header.innerHTML = `<span><i class="fas fa-user"></i> ${escapeHtml(issue.user.login)} · ${new Date(issue.created_at).toLocaleString()}</span>`;
            if (isAdmin() || (user && issue.user.login === user)) {
                const actions = document.createElement('div');
                actions.innerHTML = `
                    <button class="action-btn edit-post" title="Редактировать"><i class="fas fa-edit"></i></button>
                    <button class="action-btn close-post" title="Закрыть"><i class="fas fa-trash-alt"></i></button>
                    <button class="action-btn share-post" title="Поделиться"><i class="fas fa-share-alt"></i></button>
                `;
                actions.querySelector('.edit-post').addEventListener('click', () => {
                    closeModal();
                    openEditorModal('edit', {
                        number: issue.number,
                        title: issue.title,
                        body: issue.body,
                        game: currentGame,
                        labels: issue.labels.map(l => l.name)
                    }, 'feedback');
                });
                actions.querySelector('.close-post').addEventListener('click', async () => {
                    if (confirm('Закрыть пост?')) {
                        await closeIssue(issue.number);
                        closeModal();
                        showToast('Пост закрыт', 'success');
                        cacheRemoveByPrefix(`issues_${currentGame}_`);
                        renderInterface();
                    }
                });
                actions.querySelector('.share-post').addEventListener('click', () => {
                    const url = `${location.origin}${location.pathname}?post=${issue.number}`;
                    navigator.clipboard?.writeText(url).then(() => showToast('Ссылка скопирована', 'success')).catch(() => showToast('Не удалось скопировать', 'error'));
                });
                header.appendChild(actions);
            }
            bodyContainer.appendChild(header);

            const content = document.createElement('div');
            content.className = 'markdown-body';
            await loadMarked();
            content.innerHTML = NeonUtils.renderMarkdown(issue.body);
            bodyContainer.appendChild(content);

            const pollData = extractMeta(issue.body, 'poll');
            if (pollData) {
                try {
                    const poll = JSON.parse(pollData);
                    const pollContainer = document.createElement('div');
                    bodyContainer.appendChild(pollContainer);
                    const comments = await loadComments(issue.number);
                    await renderPoll(pollContainer, issue.number, poll, comments);
                } catch (e) {}
            }

            const reactionsDiv = document.createElement('div');
            reactionsDiv.className = 'reactions-container';
            bodyContainer.appendChild(reactionsDiv);
            const commentsDiv = document.createElement('div');
            commentsDiv.className = 'feedback-comments';
            bodyContainer.appendChild(commentsDiv);

            const [reactions, comments] = await Promise.all([
                loadReactions(issue.number),
                loadComments(issue.number)
            ]);
            renderReactions(reactionsDiv, issue.number, reactions, 
                (num, content) => addReaction(num, content).then(() => loadReactions(num)), 
                (num, id) => removeReaction(num, id).then(() => loadReactions(num))
            );
            renderComments(commentsDiv, comments, issue.number, user);

            if (user) {
                const form = document.createElement('div');
                form.className = 'comment-form';
                form.innerHTML = `
                    <input type="text" class="comment-input" placeholder="Написать комментарий...">
                    <button class="button comment-submit">Отправить</button>
                    <button class="button comment-editor-btn" title="Редактор"><i class="fas fa-pencil-alt"></i></button>
                `;
                bodyContainer.appendChild(form);
                const input = form.querySelector('.comment-input');
                form.querySelector('.comment-submit').addEventListener('click', async () => {
                    const text = input.value.trim();
                    if (!text) return;
                    try {
                        await addComment(issue.number, text);
                        const updated = await loadComments(issue.number);
                        renderComments(commentsDiv, updated, issue.number, user);
                        input.value = '';
                    } catch (err) { showToast('Ошибка отправки', 'error'); }
                });
                form.querySelector('.comment-editor-btn').addEventListener('click', () => {
                    Editor.openCommentEditor(issue.number);
                });
            }
        } catch (err) {
            bodyContainer.innerHTML = '<p class="error-message">Ошибка загрузки</p>';
        }
    }

    async function openSupportModal() {
        const currentUser = getCurrentUser();
        if (!currentUser) {
            showToast('Войдите в аккаунт', 'error');
            window.dispatchEvent(new CustomEvent('github-login-requested'));
            return;
        }
        const { modal, closeModal } = createModal('Поддержка', '<div class="loading-spinner"><i class="fas fa-spinner fa-pulse"></i></div>', { size: 'full' });
        const body = modal.querySelector('.modal-body');
        try {
            const issues = await loadIssues({ labels: 'type:support', state: 'open', per_page: 100 });
            const isUserAdmin = isAdmin();
            const filtered = issues.filter(i => {
                if (isUserAdmin) return true;
                const allowed = extractAllowed(i.body);
                return allowed === currentUser;
            }).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

            body.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom:20px;">
                    <h3><i class="fas fa-headset"></i> Мои обращения</h3>
                    <button class="button" id="new-support-btn"><i class="fas fa-plus"></i> Новое обращение</button>
                </div>
                <div id="support-list" style="max-height:500px; overflow-y:auto;"></div>
            `;
            const list = body.querySelector('#support-list');
            if (filtered.length === 0) {
                list.innerHTML = '<p class="text-secondary">У вас нет обращений.</p>';
            } else {
                filtered.forEach(issue => {
                    const card = document.createElement('div');
                    card.className = 'support-ticket-card';
                    card.style.cssText = 'background:var(--bg-inner-gradient); border-radius:16px; padding:12px; margin-bottom:8px; cursor:pointer;';
                    card.innerHTML = `
                        <div><strong>${escapeHtml(issue.title)}</strong> <span style="color:var(--text-secondary);">#${issue.number}</span></div>
                        <div style="font-size:12px;">${new Date(issue.created_at).toLocaleString()}</div>
                    `;
                    card.addEventListener('click', () => {
                        closeModal();
                        openFullModal({
                            type: 'post',
                            id: issue.number,
                            title: issue.title,
                            body: issue.body,
                            author: issue.user.login,
                            date: issue.created_at,
                            game: null,
                            labels: issue.labels.map(l => l.name)
                        });
                    });
                    list.appendChild(card);
                });
            }
            body.querySelector('#new-support-btn').addEventListener('click', () => {
                closeModal();
                openEditorModal('new', { game: null }, 'support');
            });
        } catch (err) {
            body.innerHTML = '<p class="error-message">Ошибка загрузки</p>';
        }
    }

    window.UIFeedback = { openFullModal, openSupportModal };
})();