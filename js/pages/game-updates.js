// js/pages/game-updates.js — обновления игры с админ-кнопкой (оптимизировано)
(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG, deduplicateByNumber, createAbortable, extractSummary, extractAllowed, invalidateFetchCache } = GithubCore;
    const { loadIssues } = GithubAPI;
    const { openFullModal, canViewPost, getDisplayBody } = UIFeedback;
    const { getCurrentUser, isAdmin, hasScope } = GithubAuth;
    const DEFAULT_IMAGE = 'images/default-news.webp';

    let currentAbort = null, currentGame = null;

    document.addEventListener('DOMContentLoaded', () => {
        const container = document.getElementById('game-updates');
        if (container?.dataset.game) {
            currentGame = container.dataset.game;
            window.currentGame = currentGame;
            loadGameUpdates(container, currentGame);
        }
        window.addEventListener('github-issue-created', e => {
            const issue = e.detail;
            if (!currentGame) return;
            if (!issue.labels.some(l => l.name === 'type:update' && l.name === `game:${currentGame}`)) return;
            if (!CONFIG.ALLOWED_AUTHORS.includes(issue.user.login)) return;
            cacheRemoveByPrefix(`game_updates_${currentGame}`);
            invalidateFetchCache(`/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?labels=type:update,game:${currentGame}`);
            const cont = document.getElementById('game-updates');
            if (!cont) return;
            const newPost = { number: issue.number, title: issue.title, body: issue.body, date: new Date(issue.created_at), author: issue.user.login, game: currentGame, labels: issue.labels.map(l=>l.name) };
            let grid = cont.querySelector('.projects-grid');
            if (!grid) { grid = GithubCore.createElement('div', 'projects-grid'); cont.innerHTML = ''; cont.appendChild(grid); }
            grid.insertBefore(createUpdateCard(newPost), grid.firstChild);
        });
        window.addEventListener('github-login-success', () => { if (currentGame) refreshGameUpdates(currentGame); });
        window.addEventListener('github-logout', () => { if (currentGame) refreshGameUpdates(currentGame); });
    });

    window.refreshGameUpdates = (game) => {
        const cont = document.getElementById('game-updates');
        if (cont && cont.dataset.game === game) loadGameUpdates(cont, game);
    };

    async function loadGameUpdates(container, game) {
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>';
        if (currentAbort) currentAbort.controller.abort();
        const { controller, timeoutId } = createAbortable(10000);
        currentAbort = { controller };
        try {
            const cacheKey = `game_updates_${game}`;
            let posts = cacheGet(cacheKey);
            if (!posts) {
                const issues = await loadIssues({ labels: `type:update,game:${game}`, per_page: 10, signal: controller.signal });
                posts = deduplicateByNumber(issues).filter(i => CONFIG.ALLOWED_AUTHORS.includes(i.user.login))
                    .map(i => ({ number: i.number, title: i.title, body: i.body, date: new Date(i.created_at), author: i.user.login, game, labels: i.labels.map(l=>l.name) }));
                cacheSet(cacheKey, posts.map(p => ({ ...p, date: p.date.toISOString() })));
            } else posts = posts.map(p => ({ ...p, date: new Date(p.date) }));
            const currentUser = getCurrentUser();
            posts = posts.filter(p => canViewPost(p.body, p.labels, currentUser));
            if (posts.length === 0) { container.innerHTML = '<p class="text-secondary">Нет обновлений</p>'; return; }
            container.innerHTML = '';
            const grid = GithubCore.createElement('div', 'projects-grid');
            container.appendChild(grid);
            posts.forEach(p => grid.appendChild(createUpdateCard(p)));

            const parent = container.parentNode;
            let header = parent.querySelector('.updates-header');
            if (!header) {
                header = GithubCore.createElement('div', 'updates-header', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' });
                header.innerHTML = '<h2 data-lang="updatesTitle">Обновления</h2>';
                parent.insertBefore(header, container);
            }
            const existing = header.querySelector('.admin-update-btn');
            if (isAdmin() && hasScope('repo')) {
                if (!existing) {
                    const btn = GithubCore.createElement('button', 'button admin-update-btn');
                    btn.innerHTML = '<i class="fas fa-plus"></i> Добавить обновление';
                    btn.addEventListener('click', () => UIFeedback.openEditorModal('new', { game: currentGame }, 'update'));
                    header.appendChild(btn);
                }
            } else if (existing) existing.remove();
        } catch { container.innerHTML = '<p class="error-message">Ошибка загрузки</p>'; }
        finally { clearTimeout(timeoutId); if (currentAbort?.controller === controller) currentAbort = null; }
    }

    function createUpdateCard(post) {
        const body = getDisplayBody(post.body, post.labels, getCurrentUser());
        const card = GithubCore.createElement('div', 'project-card-link no-tilt tilt-card', { cursor: 'pointer' });
        const inner = GithubCore.createElement('div', 'project-card');
        const imgMatch = body.match(/!\[.*?\]\((.*?)\)/);
        const imgW = GithubCore.createElement('div', 'image-wrapper');
        const img = GithubCore.createElement('img', 'project-image', {}, { src: imgMatch?.[1] || DEFAULT_IMAGE, alt: post.title, loading: 'lazy' });
        img.onerror = () => img.src = DEFAULT_IMAGE;
        imgW.appendChild(img);
        const title = GithubCore.createElement('h3');
        title.textContent = post.title.length > 70 ? post.title.slice(0,70)+'…' : post.title;
        const meta = GithubCore.createElement('p', 'text-secondary', { fontSize: '12px' });
        meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(post.author)} · <i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`;
        const summary = extractSummary(body) || GithubCore.stripHtml(body).substring(0,120)+'…';
        const preview = GithubCore.createElement('p', 'text-secondary', { fontSize: '13px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' });
        preview.textContent = summary;
        inner.append(imgW, title, meta, preview);
        card.appendChild(inner);
        card.addEventListener('click', () => openFullModal({ type: 'update', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game, labels: post.labels }));
        return card;
    }
})();