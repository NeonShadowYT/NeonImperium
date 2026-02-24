// feedback.js — обратная связь для страниц игр с бесконечной прокруткой и лимитом DOM-элементов

(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, renderMarkdown, deduplicateByNumber, createAbortable } = GithubCore;
    const { loadIssues, loadIssue, createIssue, updateIssue, closeIssue, loadComments, addComment, loadReactions, addReaction, removeReaction } = GithubAPI;
    const { renderReactions, renderComments, openFullModal, openEditorModal } = UIFeedback;
    const { isAdmin, getCurrentUser } = GithubAuth;

    const ITEMS_PER_PAGE = 10;
    const MAX_DISPLAY_ITEMS = 30;
    const REACTIONS_CACHE_TTL = 5 * 60 * 1000;

    let currentGame = '', currentTab = 'all', currentPage = 1, hasMorePages = true, isLoading = false;
    let allIssues = [], displayedIssues = [], container, feedbackSection, gridContainer;
    let currentUser = null, currentAbort = null;
    let observer = null;
    let sentinel = null;

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

        window.addEventListener('github-issue-created', (e) => {
            const issue = e.detail;
            const hasGameLabel = issue.labels.some(l => l.name === `game:${currentGame}`);
            if (!hasGameLabel) return;
            cacheRemoveByPrefix(`issues_${currentGame}_page_`);
            allIssues = [issue, ...allIssues];
            filterAndDisplayIssues(true);
        });

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
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fab fa-github" style="font-size: 28px; color: var(--accent);"></i>
                    <h2 data-lang="feedbackTitle" style="margin: 0;">Идеи, баги и отзывы</h2>
                </div>
                ${currentUser ? '<button class="button" id="toggle-form-btn">+ Оставить сообщение</button>' : ''}
            </div>
            <p class="text-secondary" style="margin:0 0 20px; font-size:14px;" data-lang="feedbackDesc">Делитесь мыслями, сообщайте об ошибках или предлагайте улучшения.</p>
            <div class="feedback-tabs" role="tablist" aria-label="Категории обратной связи">
                <button class="feedback-tab active" data-tab="all" role="tab" aria-selected="true" aria-controls="feedback-panel">Все</button>
                <button class="feedback-tab" data-tab="idea" role="tab" aria-selected="false" aria-controls="feedback-panel">💡 Идеи</button>
                <button class="feedback-tab" data-tab="bug" role="tab" aria-selected="false" aria-controls="feedback-panel">🐛 Баги</button>
                <button class="feedback-tab" data-tab="review" role="tab" aria-selected="false" aria-controls="feedback-panel">⭐ Отзывы</button>
            </div>
            <div class="projects-grid" id="feedback-panel" role="tabpanel" aria-labelledby="active-tab"></div>
            <div id="sentinel" style="height: 10px; margin-top: 10px;"></div>
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
                displayedIssues = [];
                gridContainer = document.getElementById('feedback-panel');
                if (gridContainer) gridContainer.innerHTML = '';
                if (currentAbort) currentAbort.controller.abort();
                if (observer) observer.disconnect();
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

        gridContainer = document.getElementById('feedback-panel');
        sentinel = document.getElementById('sentinel');

        // Настраиваем Intersection Observer для подгрузки
        observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !isLoading && hasMorePages) {
                loadIssuesPage(currentPage + 1, false);
            }
        }, { threshold: 0.1 });

        observer.observe(sentinel);

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
            filterAndDisplayIssues(reset);
        } catch (error) {
            if (error.name === 'AbortError') return;
            UIUtils.showToast('Ошибка загрузки', 'error');
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
            isLoading = false;
        }
    }

    function filterAndDisplayIssues(reset = false) {
        let filtered = allIssues.filter(issue => issue.state === 'open');
        if (currentTab !== 'all') filtered = filtered.filter(issue => issue.labels.some(l => l.name === `type:${currentTab}`));
        displayedIssues = filtered;

        // Ограничиваем количество отображаемых в DOM элементов (для производительности)
        let issuesToRender = displayedIssues;
        if (displayedIssues.length > MAX_DISPLAY_ITEMS) {
            // Показываем последние MAX_DISPLAY_ITEMS (самые новые)
            issuesToRender = displayedIssues.slice(-MAX_DISPLAY_ITEMS);
        }

        if (reset) {
            gridContainer.innerHTML = '';
        }

        renderIssuesList(issuesToRender, reset);
    }

    function renderIssuesList(issues, reset) {
        if (reset) {
            gridContainer.innerHTML = '';
        }

        // Создаём карточки для новых элементов (тех, которых ещё нет в DOM)
        // Для простоты будем добавлять все issues в конец. Если общее количество превысит лимит, удалим старые.
        issues.forEach(issue => {
            // Проверяем, есть ли уже такая карточка (по номеру)
            if (document.querySelector(`.project-card-link[data-issue-number="${issue.number}"]`)) return;

            const card = createIssueCard(issue);
            gridContainer.appendChild(card);
        });

        // Если общее количество карточек превысило MAX_DISPLAY_ITEMS, удаляем лишние сверху
        const cards = gridContainer.querySelectorAll('.project-card-link');
        if (cards.length > MAX_DISPLAY_ITEMS) {
            const toRemove = cards.length - MAX_DISPLAY_ITEMS;
            for (let i = 0; i < toRemove; i++) {
                cards[i].remove();
            }
        }
    }

    function createIssueCard(issue) {
        const typeLabel = issue.labels.find(l => l.name.startsWith('type:'))?.name.split(':')[1] || 'idea';
        const typeIcon = typeLabel === 'idea' ? '💡' : typeLabel === 'bug' ? '🐛' : '⭐';
        const preview = (issue.body || '').substring(0, 120) + (issue.body?.length > 120 ? '…' : '');
        const date = new Date(issue.created_at).toLocaleDateString();

        const cardLink = document.createElement('div');
        cardLink.className = 'project-card-link';
        cardLink.dataset.issueNumber = issue.number;
        cardLink.dataset.issueId = issue.id;
        cardLink.style.cursor = 'pointer';

        const card = document.createElement('div');
        card.className = 'project-card';

        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'image-wrapper';
        imageWrapper.style.display = 'flex';
        imageWrapper.style.alignItems = 'center';
        imageWrapper.style.justifyContent = 'center';
        imageWrapper.style.background = 'var(--bg-primary)';
        imageWrapper.style.fontSize = '48px';
        imageWrapper.textContent = typeIcon;

        const title = document.createElement('h3');
        title.textContent = issue.title.length > 70 ? issue.title.substring(0,70)+'…' : issue.title;

        const previewP = document.createElement('p');
        previewP.className = 'text-secondary';
        previewP.style.fontSize = '13px';
        previewP.style.overflow = 'hidden';
        previewP.style.display = '-webkit-box';
        previewP.style.webkitLineClamp = '2';
        previewP.style.webkitBoxOrient = 'vertical';
        previewP.textContent = preview.replace(/\n/g,' ');

        const reactionsDiv = document.createElement('div');
        reactionsDiv.className = 'reactions-container';
        reactionsDiv.dataset.targetType = 'issue';
        reactionsDiv.dataset.targetId = issue.number;

        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.justifyContent = 'space-between';
        footer.style.alignItems = 'center';
        footer.style.fontSize = '12px';
        footer.style.color = 'var(--text-secondary)';
        footer.innerHTML = `
            <span><i class="fas fa-user"></i> ${escapeHtml(issue.user.login)}</span>
            <span><i class="fas fa-calendar-alt"></i> ${date}</span>
            <span><i class="fas fa-comment"></i> ${issue.comments}</span>
        `;

        card.append(imageWrapper, title, previewP, reactionsDiv, footer);
        cardLink.appendChild(card);

        // Загружаем реакции
        loadAndRenderReactionsWithCache(issue.number, reactionsDiv);

        // Обработчик клика на карточку
        cardLink.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('.reaction-button') || e.target.closest('.reaction-add-btn')) return;
            openFullModal({
                type: 'issue',
                id: issue.number,
                title: issue.title,
                body: issue.body,
                author: issue.user.login,
                date: new Date(issue.created_at),
                game: currentGame,
                labels: issue.labels.map(l => l.name)
            });
        });

        return cardLink;
    }

    async function loadAndRenderReactionsWithCache(issueNumber, container) {
        const cacheKey = `list_reactions_${issueNumber}`;
        const cached = window.reactionsListCache?.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < REACTIONS_CACHE_TTL) {
            renderReactionsFromCache(cached.data, container, issueNumber);
            return;
        }

        try {
            const reactions = await loadReactions(issueNumber);
            if (!window.reactionsListCache) window.reactionsListCache = new Map();
            window.reactionsListCache.set(cacheKey, { data: reactions, timestamp: Date.now() });
            renderReactionsFromCache(reactions, container, issueNumber);
        } catch (err) {
            UIUtils.showToast('Ошибка загрузки реакций', 'error');
        }
    }

    function renderReactionsFromCache(reactions, container, issueNumber) {
        const handleAdd = async (num, content) => { 
            try { 
                await addReaction(num, content); 
                if (window.reactionsListCache) window.reactionsListCache.delete(`list_reactions_${num}`);
                if (window.UIFeedback) window.UIFeedback.invalidateCache(num);
            } catch (err) { 
                UIUtils.showToast('Ошибка при добавлении реакции', 'error');
                throw err;
            }
        };
        const handleRemove = async (num, reactionId) => { 
            try { 
                await removeReaction(num, reactionId); 
                if (window.reactionsListCache) window.reactionsListCache.delete(`list_reactions_${num}`);
                if (window.UIFeedback) window.UIFeedback.invalidateCache(num);
            } catch (err) { 
                UIUtils.showToast('Ошибка при удалении реакции', 'error');
                throw err;
            }
        };
        renderReactions(container, issueNumber, reactions, currentUser, handleAdd, handleRemove);
    }
})();