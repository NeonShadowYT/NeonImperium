// feedback.js — обратная связь на страницах игр
(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, deduplicateByNumber, createAbortable, extractSummary, extractAllowed, decryptPrivateBody } = GithubCore;
    const { loadIssues, loadReactions, addReaction, removeReaction } = GithubAPI;
    const { renderReactions, openFullModal, openEditorModal, canViewPost } = UIFeedback;
    const { getCurrentUser, isAdmin } = GithubAuth;

    const ITEMS_PER_PAGE = 10, MAX_DISPLAY = 30, CACHE_TTL = 5*60*1000;
    let currentGame, currentTab = 'all', currentPage = 1, hasMore = true, isLoading = false;
    let allIssues = [], container, grid, sentinel, observer, currentAbort, currentUser;

    // ================== Background Sync: IndexedDB ==================
    function openSyncDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('NeonImperiumSync', 1);
            request.onupgradeneeded = event => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('mutations')) {
                    db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains('credentials')) {
                    db.createObjectStore('credentials', { keyPath: 'key' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function queueMutation(mutation) {
        const db = await openSyncDB();
        const tx = db.transaction('mutations', 'readwrite');
        const store = tx.objectStore('mutations');
        await store.add(mutation);
        await tx.done;
    }

    async function registerSync() {
        try {
            const registration = await navigator.serviceWorker.ready;
            await registration.sync.register('github-mutations');
            console.log('Background sync registered');
        } catch (e) {
            console.warn('Background sync not supported', e);
        }
    }

    async function sendTokenToSW(token) {
        if (!navigator.serviceWorker?.controller) return;
        navigator.serviceWorker.controller.postMessage({ type: 'SAVE_TOKEN', token });
    }

    // Сохраняем токен при логине
    window.addEventListener('github-login-success', () => {
        const token = GithubAuth.getToken();
        if (token) sendTokenToSW(token);
    });

    // При загрузке, если токен есть, тоже отправляем
    if (GithubAuth.getToken()) {
        sendTokenToSW(GithubAuth.getToken());
    }

    // =================================================================

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
            if (!canViewPost(issue.body, item.labels, currentUser)) return UIUtils.showToast('Нет доступа', 'error');
            openFullModal(item);
        } catch { UIUtils.showToast('Ошибка', 'error'); }
    }

    function checkAuthAndRender() {
        if (currentUser) renderInterface(); else renderLoginPrompt();
    }

    function renderLoginPrompt() {
        container.innerHTML = `<div class="login-prompt"><i class="fab fa-github"></i><h3 data-lang="feedbackLoginPrompt">Войдите через GitHub</h3><p class="text-secondary" data-lang="feedbackTokenNote">Токен останется в браузере.</p><button class="button" id="feedback-login-btn">Войти</button></div>`;
        container.querySelector('#feedback-login-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('github-login-requested')));
    }

    function renderInterface() {
        container.innerHTML = `
            <div class="feedback-header"><div><i class="fab fa-github" style="font-size:28px;color:var(--accent);"></i><h2 data-lang="feedbackTitle">Идеи, баги и отзывы</h2></div><button class="button" id="toggle-form-btn">+ Оставить сообщение</button></div>
            <p class="text-secondary" data-lang="feedbackDesc">Делитесь мыслями, сообщайте об ошибках.</p>
            <div class="feedback-tabs"><button class="feedback-tab active" data-tab="all">Все</button><button class="feedback-tab" data-tab="idea">💡 Идеи</button><button class="feedback-tab" data-tab="bug">🐛 Баги</button><button class="feedback-tab" data-tab="review">⭐ Отзывы</button></div>
            <div class="projects-grid" id="feedback-panel"></div><div id="sentinel" style="height:10px;"></div>
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
        } catch { if (controller.signal.aborted) return; UIUtils.showToast('Ошибка загрузки', 'error'); }
        finally { clearTimeout(timeoutId); if (currentAbort?.controller === controller) currentAbort = null; isLoading = false; }
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
        if (toRender.length === 0 && reset) grid.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p data-lang="feedbackNoItems">Пока нет сообщений</p></div>';
        else toRender.forEach(issue => { if (!grid.querySelector(`[data-issue-number="${issue.number}"]`)) grid.appendChild(createCard(issue)); });
    }

    function createCard(issue) {
        const type = issue.labels.find(l=>l.name.startsWith('type:'))?.name.split(':')[1] || 'idea';
        const icon = type === 'idea' ? '💡' : type === 'bug' ? '🐛' : '⭐';
        let summary = extractSummary(issue.body) || (issue.body||'').substring(0,120)+'…';
        const allowed = extractAllowed(issue.body);
        if (issue.labels.some(l=>l.name==='private') && allowed && currentUser && allowed.split(',').map(s=>s.trim()).includes(currentUser)) {
            try { summary = extractSummary(decryptPrivateBody(issue.body, allowed)) || ''; } catch {}
        }
        const card = GithubCore.createElement('div', 'project-card-link tilt-card', { cursor: 'pointer' });
        card.dataset.issueNumber = issue.number;
        const inner = GithubCore.createElement('div', 'project-card');
        const imgW = GithubCore.createElement('div', 'image-wrapper', { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)', fontSize: '48px' });
        imgW.textContent = icon;
        const title = GithubCore.createElement('h3');
        title.textContent = issue.title.length > 70 ? issue.title.slice(0,70)+'…' : issue.title;
        const preview = GithubCore.createElement('p', 'text-secondary', { fontSize: '13px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' });
        preview.textContent = summary.replace(/\n/g,' ');
        const reactionsDiv = GithubCore.createElement('div', 'reactions-container');
        const footer = GithubCore.createElement('div', '', { display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', marginTop: 'auto', paddingTop: '10px' });
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
        const cached = window.reactionsListCache?.get(key);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            renderReactions(container, num, cached.data, currentUser, addReaction, removeReaction);
            return;
        }
        try {
            const reactions = await loadReactions(num);
            if (!window.reactionsListCache) window.reactionsListCache = new Map();
            window.reactionsListCache.set(key, { data: reactions, timestamp: Date.now() });
            renderReactions(container, num, reactions, currentUser, addReaction, removeReaction);
        } catch {}
    }

    // Обёртки для реакций с поддержкой offline-очереди
    async function addReactionWithSync(issueNumber, content) {
        try {
            await addReaction(issueNumber, content);
            invalidateCache(issueNumber);
        } catch (err) {
            if (isNetworkError(err)) {
                await queueMutation({
                    type: 'addReaction',
                    issueNumber,
                    content,
                    timestamp: Date.now()
                });
                await registerSync();
                UIUtils.showToast('Реакция будет отправлена при восстановлении связи', 'info');
            } else {
                throw err;
            }
        }
    }

    async function removeReactionWithSync(issueNumber, reactionId) {
        try {
            await removeReaction(issueNumber, reactionId);
            invalidateCache(issueNumber);
        } catch (err) {
            if (isNetworkError(err)) {
                await queueMutation({
                    type: 'removeReaction',
                    issueNumber,
                    reactionId,
                    timestamp: Date.now()
                });
                await registerSync();
                UIUtils.showToast('Реакция будет удалена при восстановлении связи', 'info');
            } else {
                throw err;
            }
        }
    }

    function isNetworkError(err) {
        return err instanceof TypeError || err.name === 'AbortError' || err.message === 'Failed to fetch';
    }

    // Экспортируем функции, чтобы можно было использовать в других частях (например, в ui-feedback.js)
    window.FeedbackSync = {
        addReactionWithSync,
        removeReactionWithSync,
        queueMutation,
        registerSync,
        isNetworkError
    };
})();