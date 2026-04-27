// game-updates.js — обновления игры с оптимистичным UI и периодическим опросом
(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, deduplicateByNumber, createAbortable, extractSummary, extractAllowed, decryptPrivateBody, createElement } = GithubCore;
    const { loadIssues, createIssue } = GithubAPI;
    const { openFullModal } = UIFeedback;
    const { getCurrentUser, isAdmin, hasScope } = GithubAuth;
    const DEFAULT_IMAGE = 'images/default-news.webp';

    let currentAbort = null, currentGame = null;
    let updateInterval = null;
    const POLL_INTERVAL = 5 * 60 * 1000; // 5 минут

    document.addEventListener('DOMContentLoaded', () => {
        const container = document.getElementById('game-updates');
        if (container?.dataset.game) {
            currentGame = container.dataset.game;
            window.currentGame = currentGame;
            loadGameUpdates(container, currentGame);
            startPolling();
        }
        window.addEventListener('github-issue-created', e => {
            const issue = e.detail;
            if (!currentGame) return;
            if (!issue.labels.some(l => l.name === 'type:update' && l.name === `game:${currentGame}`)) return;
            if (!GithubCore.CONFIG.ALLOWED_AUTHORS.includes(issue.user.login)) return;
            cacheRemoveByPrefix(`game_updates_${currentGame}`);
            const cont = document.getElementById('game-updates');
            if (!cont) return;
            const grid = cont.querySelector('.projects-grid') || (() => {
                const g = createElement('div', 'projects-grid');
                cont.appendChild(g);
                return g;
            })();
            const newPost = {
                number: issue.number, title: issue.title, body: issue.body,
                date: new Date(issue.created_at), author: issue.user.login,
                game: currentGame, labels: issue.labels.map(l => l.name)
            };
            grid.insertBefore(createUpdateCard(newPost), grid.firstChild);
        });
        window.addEventListener('github-login-success', () => { if (currentGame) refreshGameUpdates(currentGame); });
        window.addEventListener('github-logout', () => { if (currentGame) refreshGameUpdates(currentGame); });
    });

    function startPolling() {
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = setInterval(() => {
            if (currentGame && document.visibilityState === 'visible') {
                refreshGameUpdates(currentGame);
            }
        }, POLL_INTERVAL);
    }

    window.refreshGameUpdates = (game) => {
        const cont = document.getElementById('game-updates');
        if (cont && cont.dataset.game === game) loadGameUpdates(cont, game);
    };

    async function loadGameUpdates(container, game) {
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> ${I18n.translate('newsLoading')}</div>`;
        if (currentAbort) currentAbort.controller.abort();
        const { controller, timeoutId } = createAbortable(10000);
        currentAbort = { controller };
        try {
            const cacheKey = `game_updates_${game}`;
            let posts = cacheGet(cacheKey);
            if (!posts) {
                const issues = await loadIssues({ labels: `type:update,game:${game}`, per_page: 10, signal: controller.signal });
                posts = deduplicateByNumber(issues)
                    .filter(i => GithubCore.CONFIG.ALLOWED_AUTHORS.includes(i.user.login))
                    .map(i => ({
                        number: i.number, title: i.title, body: i.body,
                        date: new Date(i.created_at), author: i.user.login, game, labels: i.labels.map(l => l.name)
                    }));
                cacheSet(cacheKey, posts.map(p => ({ ...p, date: p.date.toISOString() })));
            } else posts = posts.map(p => ({ ...p, date: new Date(p.date) }));
            const currentUser = getCurrentUser();
            posts = posts.filter(p => {
                if (!p.labels.includes('private')) return true;
                if (isAdmin()) return true;
                const allowed = extractAllowed(p.body);
                return allowed && allowed.split(',').map(s=>s.trim()).includes(currentUser);
            });
            container.innerHTML = '';
            const grid = createElement('div', 'projects-grid');
            container.appendChild(grid);
            posts.forEach(p => grid.appendChild(createUpdateCard(p)));

            // Добавить кнопку "создать обновление" для админа
            const parent = container.parentNode;
            let header = parent.querySelector('.updates-header');
            if (!header) {
                header = createElement('div', 'updates-header', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' });
                header.innerHTML = `<h2>${I18n.translate('updatesTitle')}</h2>`;
                parent.insertBefore(header, container);
            }
            if (isAdmin() && hasScope('repo')) {
                if (!header.querySelector('.admin-update-btn')) {
                    const btn = createElement('button', 'button admin-update-btn');
                    btn.innerHTML = `<i class="fas fa-plus"></i> ${I18n.translate('newsTitle')}`;
                    btn.addEventListener('click', () => UIFeedback.openEditorModal('new', { game: currentGame }, 'update'));
                    header.appendChild(btn);
                }
            }
        } catch {
            container.innerHTML = `<p class="error-message">${I18n.translate('feedbackLoadError')}</p>`;
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
        }
    }

    function createUpdateCard(post) {
        let previewBody = post.body;
        const allowed = extractAllowed(post.body);
        const currentUser = getCurrentUser();
        if (post.labels.includes('private') && allowed && currentUser && allowed.split(',').map(s=>s.trim()).includes(currentUser)) {
            try { previewBody = decryptPrivateBody(post.body, allowed); } catch {}
        }
        const card = createElement('div', 'project-card-link no-tilt tilt-card', { cursor: 'pointer' });
        const inner = createElement('div', 'project-card');
        const imgMatch = previewBody.match(/!\[.*?\]\((.*?)\)/);
        const imgW = createElement('div', 'image-wrapper');
        const img = createElement('img', 'project-image', {}, { src: imgMatch?.[1] || DEFAULT_IMAGE, alt: post.title, loading: 'lazy' });
        img.onerror = () => img.src = DEFAULT_IMAGE;
        imgW.appendChild(img);
        const title = createElement('h3');
        title.textContent = post.title.length > 70 ? post.title.slice(0,70)+'…' : post.title;
        const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
        meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(post.author)} · <i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`;
        const summary = extractSummary(previewBody) || GithubCore.stripHtml(previewBody).substring(0,120)+'…';
        const preview = createElement('p', 'text-secondary line-clamp-2');
        preview.textContent = summary;
        inner.append(imgW, title, meta, preview);
        card.appendChild(inner);
        card.addEventListener('click', () => openFullModal({ type: 'update', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game, labels: post.labels }));
        return card;
    }
})();