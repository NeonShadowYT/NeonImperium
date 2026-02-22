(function() {
    const { cacheGet, cacheSet, cacheRemove, escapeHtml, renderMarkdown, deduplicateByNumber, createAbortable } = GithubCore;
    const { loadIssues, loadIssue, createIssue, updateIssue, closeIssue, loadComments, addComment, loadReactions, addReaction, removeReaction } = GithubAPI;
    const { renderReactions, renderComments, openFullModal, openEditorModal } = UIFeedback;
    const { isAdmin, getCurrentUser } = GithubAuth;

    const ITEMS_PER_PAGE = 10;
    let currentGame = '', currentTab = 'all', currentPage = 1, hasMorePages = true, isLoading = false;
    let allIssues = [], displayedIssues = [], container, feedbackSection;
    let currentUser = null, currentAbort = null;

    document.addEventListener('DOMContentLoaded', init);
    function init() {
        feedbackSection = document.getElementById('feedback-section');
        if (!feedbackSection) return;
        currentGame = feedbackSection.dataset.game;
        if (!currentGame) return;
        container = feedbackSection.querySelector('.feedback-container');
        if (!container) return;

        window.addEventListener('github-login-success', (e) => { currentUser = e.detail.login; checkAuthAndRender(); });
        window.addEventListener('github-logout', () => { currentUser = null; checkAuthAndRender(); });
        currentUser = getCurrentUser();
        checkAuthAndRender();
    }

    function checkAuthAndRender() {
        if (currentUser) renderFeedbackInterface();
        else renderLoginPrompt();
    }

    function renderLoginPrompt() {
        container.innerHTML = `<div class="login-prompt"><i class="fab fa-github"></i><h3 data-lang="feedbackLoginPrompt">Войдите через GitHub, чтобы участвовать</h3><p class="text-secondary" data-lang="feedbackTokenNote">Ваш токен останется только у вас в браузере.</p><button class="button" id="feedback-login-btn" data-lang="feedbackLoginBtn">Войти</button></div>`;
        document.getElementById('feedback-login-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('github-login-requested')));
    }

    async function renderFeedbackInterface() {
        container.innerHTML = `
            <div class="feedback-header">
                <div>
                    <h2 data-lang="feedbackTitle">Идеи, баги и отзывы</h2>
                    <p class="text-secondary" style="margin:4px 0 0; font-size:14px;">Делитесь мыслями, сообщайте об ошибках или предлагайте улучшения.</p>
                </div>
                ${currentUser ? '<button class="button" id="toggle-form-btn"><i class="fab fa-github"></i> + Оставить сообщение</button>' : ''}
            </div>
            <div class="feedback-tabs">
                <button class="feedback-tab active" data-tab="all">Все</button>
                <button class="feedback-tab" data-tab="idea">💡 Идеи</button>
                <button class="feedback-tab" data-tab="bug">🐛 Баги</button>
                <button class="feedback-tab" data-tab="review">⭐ Отзывы</button>
            </div>
            <div class="feedback-list" id="feedback-list"><div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div></div>
            <div style="text-align:center;margin-top:20px;" id="load-more-container"><button class="button" id="load-more" style="display:none;" data-lang="feedbackLoadMore">Загрузить ещё</button></div>
        `;
        if (currentUser) document.getElementById('toggle-form-btn').addEventListener('click', () => openEditorModal('new', { game: currentGame }, 'feedback'));
        document.querySelectorAll('.feedback-tab').forEach(tab => tab.addEventListener('click', (e) => {
            document.querySelectorAll('.feedback-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentTab = e.target.dataset.tab;
            currentPage = 1;
            allIssues = [];
            if (currentAbort) currentAbort.controller.abort();
            loadIssuesPage(1, true);
        }));
        document.getElementById('load-more').addEventListener('click', () => { if (!isLoading && hasMorePages) loadIssuesPage(currentPage + 1, false); });
        await loadIssuesPage(1, true);
    }

    async function loadIssuesPage(page, reset = false) {
        if (isLoading) return;
        isLoading = true;
        if (currentAbort) currentAbort.controller.abort();
        const { controller, timeoutId } = createAbortable(10000);
        currentAbort = { controller };

        try {
            const cacheKey = `issues_${currentGame}_page_${page}`;
            let issues;
            const cached = cacheGet(cacheKey);
            if (cached) issues = cached;
            else {
                issues = await loadIssues({ labels: `game:${currentGame}`, state: 'open', per_page: ITEMS_PER_PAGE, page: page, signal: controller.signal });
                hasMorePages = issues.length === ITEMS_PER_PAGE;
                cacheSet(cacheKey, issues);
            }
            if (reset) allIssues = deduplicateByNumber(issues);
            else allIssues = deduplicateByNumber([...allIssues, ...issues]);
            currentPage = page;
            filterAndDisplayIssues();
        } catch (error) {
            if (error.name === 'AbortError') return;
            document.getElementById('feedback-list').innerHTML = `<div class="error-message"><i class="fas fa-exclamation-triangle"></i><p data-lang="feedbackLoadError">Ошибка загрузки.</p><button class="button-small" id="retry-feedback" data-lang="feedbackRetry">Повторить</button></div>`;
            document.getElementById('retry-feedback')?.addEventListener('click', () => loadIssuesPage(1, true));
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
            isLoading = false;
            const loadMoreBtn = document.getElementById('load-more');
            if (loadMoreBtn) loadMoreBtn.style.display = hasMorePages ? 'inline-block' : 'none';
        }
    }

    function filterAndDisplayIssues() {
        let filtered = allIssues.filter(issue => issue.state === 'open');
        if (currentTab !== 'all') filtered = filtered.filter(issue => issue.labels.some(l => l.name === `type:${currentTab}`));
        displayedIssues = filtered;
        renderIssuesList(displayedIssues);
    }

    function renderIssuesList(issues) {
        const listEl = document.getElementById('feedback-list');
        if (!listEl) return;
        if (issues.length === 0) { listEl.innerHTML = `<p class="text-secondary" style="text-align:center;" data-lang="feedbackNoItems">Пока нет сообщений. Будьте первым!</p>`; return; }
        listEl.innerHTML = issues.map(issue => {
            const typeLabel = issue.labels.find(l => l.name.startsWith('type:'))?.name.split(':')[1] || 'idea';
            const preview = (issue.body || '').substring(0, 120) + (issue.body?.length > 120 ? '…' : '');
            return `<div class="feedback-item" data-issue-number="${issue.number}" data-issue-id="${issue.id}"><div class="feedback-item-header"><h4 class="feedback-item-title">${escapeHtml(issue.title)}</h4><div class="feedback-item-meta"><span class="feedback-label type-${typeLabel}">${typeLabel}</span><span class="feedback-label">#${issue.number}</span></div></div><div class="feedback-item-preview">${escapeHtml(preview).replace(/\n/g,' ')}</div><div class="reactions-container" data-target-type="issue" data-target-id="${issue.number}"></div><div class="feedback-item-footer"><span><i class="fas fa-user"></i> ${escapeHtml(issue.user.login)}</span><span><i class="fas fa-calendar-alt"></i> ${new Date(issue.created_at).toLocaleDateString()}</span><span><i class="fas fa-comment"></i> ${issue.comments}</span></div></div>`;
        }).join('');
        issues.forEach(issue => {
            const reactionsContainer = document.querySelector(`.reactions-container[data-target-id="${issue.number}"]`);
            if (reactionsContainer) loadAndRenderReactions(issue.number, reactionsContainer);
        });
        attachEventHandlers();
    }

    function attachEventHandlers() {
        document.querySelectorAll('.feedback-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('.reaction-button') || e.target.closest('.reaction-add-btn')) return;
                const issueNumber = item.dataset.issueNumber;
                const issue = allIssues.find(i => i.number == issueNumber);
                if (issue) openFullModal({ type: 'issue', id: issueNumber, title: issue.title, body: issue.body, author: issue.user.login, date: new Date(issue.created_at), game: currentGame, labels: issue.labels.map(l => l.name) });
            });
        });
    }

    async function loadAndRenderReactions(issueNumber, container) {
        try {
            const reactions = await loadReactions(issueNumber);
            const handleAdd = async (num, content) => { try { await addReaction(num, content); const updated = await loadReactions(num); renderReactions(container, num, updated, currentUser, handleAdd, handleRemove); } catch {} };
            const handleRemove = async (num, reactionId) => { try { await removeReaction(num, reactionId); const updated = await loadReactions(num); renderReactions(container, num, updated, currentUser, handleAdd, handleRemove); } catch {} };
            renderReactions(container, issueNumber, reactions, currentUser, handleAdd, handleRemove);
        } catch {}
    }
})();