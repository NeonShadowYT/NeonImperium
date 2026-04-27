// feedback.js — обратная связь на страницах игр с оптимистичным UI и кэшированием
(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, deduplicateByNumber, createAbortable, extractSummary, extractAllowed, decryptPrivateBody, createElement } = GithubCore;
    const { loadIssues, loadReactions, addReaction, removeReaction, createIssue } = GithubAPI;
    const { renderReactions, openFullModal, openEditorModal, canViewPost, invalidateCache } = UIFeedback;
    const { getCurrentUser, isAdmin, hasScope } = GithubAuth;

    const ITEMS_PER_PAGE = 10, MAX_DISPLAY = 30, CACHE_TTL = 5*60*1000;
    let currentGame, currentTab = 'all', currentPage = 1, hasMore = true, isLoading = false;
    let allIssues = [], container, grid, sentinel, observer, currentAbort, currentUser;

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        const section = document.getElementById('feedback-section');
        if (!section) return;
        currentGame = section.dataset.game;
        if (!currentGame) return;
        container = section.querySelector('.feedback-container');
        if (!container) return;

        window.addEventListener('github-login-success', e => { currentUser = e.detail.login; checkAuthAndRender(); });
        window.addEventListener('github-logout', () => { currentUser = null; checkAuthAndRender(); });
        window.addEventListener('github-issue-created', e => {
            const issue = e.detail;
            if (!issue.labels.some(l => l.name === `game:${currentGame}`)) return;
            cacheRemoveByPrefix(`issues_${currentGame}_page_`);
            allIssues = [issue, ...allIssues];
            filterAndDisplay(true);
        });

        currentUser = getCurrentUser();
        checkAuthAndRender();

        const postId = new URLSearchParams(location.search).get('post');
        if (postId) setTimeout(() => openPostFromUrl(postId), 1000);
    }

    async function openPostFromUrl(id) {
        try {
            const issue = await GithubAPI.loadIssue(id);
            const gameLabel = issue.labels.find(l => l.name.startsWith('game:'));
            if (!gameLabel || gameLabel.name.split(':')[1] !== currentGame) return;
            const item = { id: issue.number, title: issue.title, body: issue.body, author: issue.user.login, date: new Date(issue.created_at), game: currentGame, labels: issue.labels.map(l=>l.name) };
            if (!canViewPost(issue.body, item.labels, currentUser)) return UIUtils.showToast(I18n.translate('githubError'), 'error');
            openFullModal(item);
        } catch { UIUtils.showToast(I18n.translate('githubError'), 'error'); }
    }

    function checkAuthAndRender() {
        if (currentUser) renderInterface(); else renderLoginPrompt();
    }

    function renderLoginPrompt() {
        container.innerHTML = `<div class="login-prompt"><i class="fab fa-github"></i><h3>${I18n.translate('feedbackLoginPrompt')}</h3><p class="text-secondary">${I18n.translate('feedbackTokenNote')}</p><button class="button" id="feedback-login-btn">${I18n.translate('feedbackLoginBtn')}</button></div>`;
        container.querySelector('#feedback-login-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('github-login-requested')));
    }

    function renderInterface() {
        container.innerHTML = `
            <div class="feedback-header">
                <div>
                    <i class="fab fa-github" style="font-size:28px;color:var(--accent);"></i>
                    <h2>${I18n.translate('feedbackTitle')}</h2>
                </div>
                <button class="button" id="toggle-form-btn">${I18n.translate('feedbackNewBtn')}</button>
            </div>
            <p class="text-secondary">${I18n.translate('feedbackDesc')}</p>
            <div class="feedback-tabs">
                <button class="feedback-tab active" data-tab="all">${I18n.translate('feedbackTabAll')}</button>
                <button class="feedback-tab" data-tab="idea">${I18n.translate('feedbackTabIdea')}</button>
                <button class="feedback-tab" data-tab="bug">${I18n.translate('feedbackTabBug')}</button>
                <button class="feedback-tab" data-tab="review">${I18n.translate('feedbackTabReview')}</button>
            </div>
            <div class="projects-grid" id="feedback-panel"></div>
            <div id="sentinel" style="height:10px;"></div>
        `;
        document.getElementById('toggle-form-btn').addEventListener('click', () => openEditorModal('new', { game: currentGame }, 'feedback'));
        grid = document.getElementById('feedback-panel');
        sentinel = document.getElementById('sentinel');
        const tabs = container.querySelectorAll('.feedback-tab');
        tabs.forEach(t => t.addEventListener('click', e => {
            tabs.forEach(tt => { tt.classList.remove('active'); tt.setAttribute('aria-selected','false'); });
            t.classList.add('active'); t.setAttribute('aria-selected','true');
            currentTab = t.dataset.tab; currentPage = 1; allIssues = []; grid.innerHTML = '';
            if (currentAbort) currentAbort.controller.abort();
            observer?.disconnect();
            loadPage(1, true);
        }));
        observer = new IntersectionObserver(e => { if (e[0].isIntersecting && !isLoading && hasMore) loadPage(currentPage+1, false); }, { threshold: 0.1 });
        observer.observe(sentinel);
        loadPage(1, true);
    }

    async function loadPage(page, reset) {
        if (isLoading) return;
        isLoading = true;
        if (currentAbort) currentAbort.controller.abort();
        const { controller, timeoutId } = createAbortable(10000);
        currentAbort = { controller };
        try {
            const key = `issues_${currentGame}_page_${page}`;
            let issues = cacheGet(key);
            if (!issues) {
                issues = await loadIssues({ labels: `game:${currentGame}`, per_page: ITEMS_PER_PAGE, page, signal: controller.signal });
                hasMore = issues.length === ITEMS_PER_PAGE;
                cacheSet(key, issues);
            }
            allIssues = reset ? deduplicateByNumber(issues) : deduplicateByNumber([...allIssues, ...issues]);
            currentPage = page;
            filterAndDisplay(reset);
        } catch {
            if (controller.signal.aborted) return;
            UIUtils.showToast(I18n.translate('feedbackLoadError'), 'error');
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
            isLoading = false;
        }
    }

    function filterAndDisplay(reset) {
        let filtered = allIssues.filter(i => i.state === 'open').filter(i => {
            const labels = i.labels.map(l=>l.name);
            if (!labels.includes('private')) return true;
            if (isAdmin()) return true;
            const allowed = extractAllowed(i.body);
            return allowed && allowed.split(',').map(s=>s.trim()).includes(currentUser);
        });
        if (currentTab !== 'all') filtered = filtered.filter(i => i.labels.some(l => l.name === `type:${currentTab}`));
        if (reset) grid.innerHTML = '';
        const toRender = filtered.slice(0, MAX_DISPLAY);
        if (toRender.length === 0 && reset) {
            grid.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><p>${I18n.translate('feedbackNoItems')}</p></div>`;
        } else {
            toRender.forEach(issue => {
                if (!grid.querySelector(`[data-issue-number="${issue.number}"]`)) {
                    grid.appendChild(createCard(issue));
                }
            });
        }
    }

    function createCard(issue) {
        const type = issue.labels.find(l=>l.name.startsWith('type:'))?.name.split(':')[1] || 'idea';
        const icon = type === 'idea' ? '💡' : type === 'bug' ? '🐛' : '⭐';
        let summary = extractSummary(issue.body) || (issue.body||'').substring(0,120)+'…';
        const allowed = extractAllowed(issue.body);
        if (issue.labels.some(l=>l.name==='private') && allowed && currentUser && allowed.split(',').map(s=>s.trim()).includes(currentUser)) {
            try { summary = extractSummary(decryptPrivateBody(issue.body, allowed)) || ''; } catch {}
        }
        const card = createElement('div', 'project-card-link tilt-card', { cursor: 'pointer' });
        card.dataset.issueNumber = issue.number;
        const inner = createElement('div', 'project-card');
        const imgW = createElement('div', 'image-wrapper', { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', fontSize: '48px' });
        imgW.textContent = icon;
        const title = createElement('h3');
        title.textContent = issue.title.length > 70 ? issue.title.slice(0,70)+'…' : issue.title;
        const preview = createElement('p', 'text-secondary line-clamp-2');
        preview.textContent = summary.replace(/\n/g,' ');
        const reactionsDiv = createElement('div', 'reactions-container');
        const footer = createElement('div', '', { display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', marginTop: 'auto', paddingTop: '10px' });
        footer.innerHTML = `<span><i class="fas fa-user"></i> ${escapeHtml(issue.user.login)}</span><span><i class="fas fa-calendar-alt"></i> ${new Date(issue.created_at).toLocaleDateString()}</span><span><i class="fas fa-comment"></i> ${issue.comments}</span>`;
        inner.append(imgW, title, preview, reactionsDiv, footer);
        card.appendChild(inner);
        loadReactionsForCard(issue.number, reactionsDiv);
        card.addEventListener('click', e => {
            if (e.target.closest('button')) return;
            openFullModal({ id: issue.number, title: issue.title, body: issue.body, author: issue.user.login, date: new Date(issue.created_at), game: currentGame, labels: issue.labels.map(l=>l.name) });
        });
        return card;
    }

    async function loadReactionsForCard(num, container) {
        const key = `list_reactions_${num}`;
        let cached = cacheGet(key);
        if (!cached) {
            cached = await loadReactions(num);
            cacheSet(key, cached);
        }
        if (cached) renderReactions(container, num, cached, currentUser, addReaction, removeReaction);
    }
})();