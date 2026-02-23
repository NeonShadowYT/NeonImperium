// feedback.js — обратная связь для страниц игр с кешированием реакций и карточками в стиле проектов

(function() {
    const { cacheGet, cacheSet, cacheRemove, escapeHtml, renderMarkdown, deduplicateByNumber, createAbortable } = GithubCore;
    const { loadIssues, loadIssue, createIssue, updateIssue, closeIssue, loadComments, addComment, loadReactions, addReaction, removeReaction } = GithubAPI;
    const { renderReactions, renderComments, openFullModal, openEditorModal } = UIFeedback;
    const { isAdmin, getCurrentUser } = GithubAuth;

    const ITEMS_PER_PAGE = 10;
    const REACTIONS_CACHE_TTL = 5 * 60 * 1000; // 5 минут
    const reactionsListCache = new Map(); // кеш для реакций в списке

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
            <div class="feedback-tabs" role="tablist" aria-label="Категории обратной связи">
                <button class="feedback-tab active" data-tab="all" role="tab" aria-selected="true" aria-controls="feedback-panel">Все</button>
                <button class="feedback-tab" data-tab="idea" role="tab" aria-selected="false" aria-controls="feedback-panel">💡 Идеи</button>
                <button class="feedback-tab" data-tab="bug" role="tab" aria-selected="false" aria-controls="feedback-panel">🐛 Баги</button>
                <button class="feedback-tab" data-tab="review" role="tab" aria-selected="false" aria-controls="feedback-panel">⭐ Отзывы</button>
            </div>
            <div class="feedback-list" id="feedback-panel" role="tabpanel" aria-labelledby="active-tab">
                <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>
            </div>
            <div style="text-align:center;margin-top:20px;" id="load-more-container"><button class="button" id="load-more" style="display:none;" data-lang="feedbackLoadMore">Загрузить ещё</button></div>
        `;

        if (currentUser) {
            document.getElementById('toggle-form-btn').addEventListener('click', () => openEditorModal('new', { game: currentGame }, 'feedback'));
        }

        const tabs = document.querySelectorAll('.feedback-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                tabs.forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                e.target.classList.add('active');
                e.target.setAttribute('aria-selected', 'true');

                currentTab = e.target.dataset.tab;
                currentPage = 1;
                allIssues = [];
                const loadMoreBtn = document.getElementById('load-more');
                if (loadMoreBtn) loadMoreBtn.style.display = 'none';
                if (currentAbort) currentAbort.controller.abort();
                loadIssuesPage(1, true);
            });

            tab.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const tabsArray = Array.from(tabs);
                    const currentIndex = tabsArray.indexOf(e.target);
                    let newIndex;
                    if (e.key === 'ArrowRight') {
                        newIndex = (currentIndex + 1) % tabsArray.length;
                    } else {
                        newIndex = (currentIndex - 1 + tabsArray.length) % tabsArray.length;
                    }
                    tabsArray[newIndex].focus();
                    tabsArray[newIndex].click();
                }
            });
        });

        document.getElementById('load-more').addEventListener('click', () => {
            if (!isLoading && hasMorePages) loadIssuesPage(currentPage + 1, false);
        });

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
        if (issues.length === 0) {
            listEl.innerHTML = `<p class="text-secondary" style="text-align:center;" data-lang="feedbackNoItems">Пока нет сообщений. Будьте первым!</p>`;
            return;
        }
        listEl.innerHTML = issues.map(issue => {
            const typeLabel = issue.labels.find(l => l.name.startsWith('type:'))?.name.split(':')[1] || 'idea';
            const typeIcon = typeLabel === 'idea' ? '💡' : typeLabel === 'bug' ? '🐛' : '⭐';
            const preview = (issue.body || '').substring(0, 120) + (issue.body?.length > 120 ? '…' : '');
            const date = new Date(issue.created_at).toLocaleDateString();
            return `
                <div class="project-card-link" data-issue-number="${issue.number}" data-issue-id="${issue.id}" style="cursor: pointer;">
                    <div class="project-card">
                        <div class="image-wrapper" style="display: flex; align-items: center; justify-content: center; background: var(--bg-primary); font-size: 48px;">
                            ${typeIcon}
                        </div>
                        <h3>${escapeHtml(issue.title)}</h3>
                        <p class="text-secondary" style="font-size: 13px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${escapeHtml(preview).replace(/\n/g,' ')}</p>
                        <div class="reactions-container" data-target-type="issue" data-target-id="${issue.number}" style="margin: 8px 0;"></div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-secondary);">
                            <span><i class="fas fa-user"></i> ${escapeHtml(issue.user.login)}</span>
                            <span><i class="fas fa-calendar-alt"></i> ${date}</span>
                            <span><i class="fas fa-comment"></i> ${issue.comments}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        issues.forEach(issue => {
            const reactionsContainer = document.querySelector(`.reactions-container[data-target-id="${issue.number}"]`);
            if (reactionsContainer) loadAndRenderReactionsWithCache(issue.number, reactionsContainer);
        });
        attachEventHandlers();
    }

    // Функция загрузки реакций с кешированием для списка
    async function loadAndRenderReactionsWithCache(issueNumber, container) {
        const cacheKey = `list_reactions_${issueNumber}`;
        const cached = reactionsListCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < REACTIONS_CACHE_TTL) {
            renderReactionsFromCache(cached.data, container, issueNumber);
            return;
        }

        try {
            const reactions = await loadReactions(issueNumber);
            reactionsListCache.set(cacheKey, { data: reactions, timestamp: Date.now() });
            renderReactionsFromCache(reactions, container, issueNumber);
        } catch (err) {
            UIUtils.showToast('Ошибка загрузки реакций', 'error');
        }
    }

    function renderReactionsFromCache(reactions, container, issueNumber) {
        const handleAdd = async (num, content) => { 
            try { 
                await addReaction(num, content); 
                reactionsListCache.delete(`list_reactions_${num}`);
                const updated = await loadReactions(num);
                renderReactions(container, num, updated, currentUser, handleAdd, handleRemove); 
                UIUtils.showToast('Реакция добавлена', 'success');
            } catch (err) { 
                UIUtils.showToast('Ошибка при добавлении реакции', 'error');
            }
        };
        const handleRemove = async (num, reactionId) => { 
            try { 
                await removeReaction(num, reactionId); 
                reactionsListCache.delete(`list_reactions_${num}`);
                const updated = await loadReactions(num);
                renderReactions(container, num, updated, currentUser, handleAdd, handleRemove); 
                UIUtils.showToast('Реакция убрана', 'success');
            } catch (err) { 
                UIUtils.showToast('Ошибка при удалении реакции', 'error');
            }
        };
        renderReactions(container, issueNumber, reactions, currentUser, handleAdd, handleRemove);
    }

    function attachEventHandlers() {
        document.querySelectorAll('.project-card-link[data-issue-number]').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('.reaction-button') || e.target.closest('.reaction-add-btn')) return;
                const issueNumber = item.dataset.issueNumber;
                const issue = allIssues.find(i => i.number == issueNumber);
                if (issue) openFullModal({ 
                    type: 'issue', 
                    id: issueNumber, 
                    title: issue.title, 
                    body: issue.body, 
                    author: issue.user.login, 
                    date: new Date(issue.created_at), 
                    game: currentGame, 
                    labels: issue.labels.map(l => l.name) 
                });
            });
        });
    }
})();