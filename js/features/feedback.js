// js/features/feedback.js
(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, deduplicateByNumber, createAbortable, showToast, createModal, escapeHtml, extractAllowed } = NeonUtils;
    const { renderReactions, renderComments, createCard } = UIComponents;
    const { getCurrentUser, isAdmin } = GithubAuth;
    const { loadIssues, loadIssue, createIssue, updateIssue, closeIssue, loadComments, addComment, loadReactions, addReaction, removeReaction } = NeonAPI;
    const { on } = NeonState;

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

        checkAuthAndRender();
    }

    function checkAuthAndRender() {
        if (getCurrentUser()) renderInterface();
        else renderLoginPrompt();
    }

    function renderLoginPrompt() {
        container.innerHTML = `<div class="login-prompt"><i class="fab fa-github"></i><h3>Войдите через GitHub, чтобы участвовать</h3><p>Ваш токен останется только у вас в браузере.</p><button class="button" id="feedback-login-btn">Войти</button></div>`;
        container.querySelector('#feedback-login-btn').addEventListener('click', () => NeonState.emit('login-requested'));
    }

    async function renderInterface() {
        container.innerHTML = `
            <div class="feedback-header">
                <div><i class="fab fa-github"></i> <h2 style="display:inline">Идеи, баги и отзывы</h2></div>
                <button class="button" id="new-feedback-btn">+ Оставить сообщение</button>
            </div>
            <div class="feedback-tabs">
                <button class="feedback-tab active" data-tab="all">Все</button>
                <button class="feedback-tab" data-tab="idea">💡 Идеи</button>
                <button class="feedback-tab" data-tab="bug">🐛 Баги</button>
                <button class="feedback-tab" data-tab="review">⭐ Отзывы</button>
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
            header.innerHTML = `<span>${escapeHtml(issue.user.login)} · ${new Date(issue.created_at).toLocaleString()}</span>`;
            bodyContainer.appendChild(header);
            const content = document.createElement('div');
            content.className = 'markdown-body';
            content.innerHTML = NeonUtils.renderMarkdown(issue.body);
            bodyContainer.appendChild(content);

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
            renderReactions(reactionsDiv, issue.number, reactions, (num, content) => addReaction(num, content).then(() => loadReactions(num)), (num, id) => removeReaction(num, id).then(() => loadReactions(num)));
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
                    window.dispatchEvent(new CustomEvent('open-comment-editor', { detail: { issueNumber: issue.number } }));
                });
            }
        } catch (err) {
            bodyContainer.innerHTML = '<p class="error-message">Ошибка загрузки</p>';
        }
    }

    // Заглушка для поддержки
    window.UIFeedback = { openSupportModal: () => {} };
})();