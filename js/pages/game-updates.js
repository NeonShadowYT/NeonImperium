// js/pages/game-updates.js — обновления игры с админ-кнопкой
(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, deduplicateByNumber, createAbortable, stripHtml, loadModule } = window.Utils;
    const { CONFIG, extractAllowed, extractSummary, decryptPrivateBody } = window.GithubCore;
    const { loadIssues, loadIssue } = window.GithubAPI;
    const { openFullModal, canViewPost } = window.UIFeedback;
    const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;
    const DEFAULT_IMAGE = 'images/default-news.webp';

    let currentAbort = null, currentGame = null;

    document.addEventListener('DOMContentLoaded', () => {
        const container = document.getElementById('game-updates');
        if (container?.dataset.game) {
            currentGame = container.dataset.game;
            loadGameUpdates(container, currentGame);
        }
        window.addEventListener('github-issue-created', e => {
            const issue = e.detail;
            if (!currentGame) return;
            if (!issue.labels.some(l => l.name === 'type:update' && l.name === `game:${currentGame}`)) return;
            if (!CONFIG.ALLOWED_AUTHORS.includes(issue.user.login)) return;
            cacheRemoveByPrefix(`game_updates_${currentGame}`);
            const cont = document.getElementById('game-updates');
            if (!cont) return;
            refreshGameUpdates(currentGame);
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
        const { controller, timeoutId } = createAbortable(15000);
        currentAbort = { controller };
        try {
            const cacheKey = `game_updates_${game}`;
            let posts = cacheGet(cacheKey);
            if (!posts) {
                const issues = await loadIssues({ labels: `type:update,game:${game}`, per_page: 10, signal: controller.signal });
                posts = deduplicateByNumber(issues)
                    .filter(i => i.state === 'open' && CONFIG.ALLOWED_AUTHORS.includes(i.user.login))
                    .map(i => ({ number: i.number, title: i.title, body: i.body, date: new Date(i.created_at), author: i.user.login, game, labels: i.labels.map(l => l.name) }));
                cacheSet(cacheKey, posts.map(p => ({ ...p, date: p.date.toISOString() })));
            } else {
                posts = posts.map(p => ({ ...p, date: new Date(p.date) }));
            }
            const currentUser = getCurrentUser();
            posts = posts.filter(p => {
                if (!p.labels.includes('private')) return true;
                if (isAdmin()) return true;
                const allowed = extractAllowed(p.body);
                return allowed && allowed.split(',').map(s => s.trim()).includes(currentUser);
            });
            if (posts.length === 0) {
                container.innerHTML = '<p class="text-secondary">Нет обновлений</p>';
                return;
            }
            container.innerHTML = '';
            const grid = document.createElement('div');
            grid.className = 'projects-grid';
            container.appendChild(grid);
            for (const p of posts) {
                grid.appendChild(await createUpdateCard(p));
            }

            const parent = container.parentNode;
            let header = parent.querySelector('.updates-header');
            if (!header) {
                header = document.createElement('div');
                header.className = 'updates-header';
                header.style.display = 'flex';
                header.style.alignItems = 'center';
                header.style.justifyContent = 'space-between';
                header.style.marginBottom = '20px';
                header.innerHTML = '<h2 data-lang="updatesTitle">Обновления</h2>';
                parent.insertBefore(header, container);
            }
            const existing = header.querySelector('.admin-update-btn');
            if (isAdmin() && hasScope('repo')) {
                if (!existing) {
                    const btn = document.createElement('button');
                    btn.className = 'button admin-update-btn';
                    btn.innerHTML = '<i class="fas fa-plus"></i> Добавить обновление';
                    btn.addEventListener('click', () => window.UIFeedback.openEditorModal('new', { game: currentGame }, 'update'));
                    header.appendChild(btn);
                }
            } else if (existing) existing.remove();
        } catch (err) {
            console.error('Error loading updates:', err);
            container.innerHTML = '<p class="error-message">Ошибка загрузки обновлений</p>';
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
        }
    }

    async function createUpdateCard(post) {
        let previewBody = post.body;
        const allowed = extractAllowed(post.body);
        const currentUser = getCurrentUser();
        if (post.labels.includes('private') && allowed && currentUser && allowed.split(',').map(s => s.trim()).includes(currentUser)) {
            try { previewBody = decryptPrivateBody(post.body, allowed); } catch {}
        }
        const card = document.createElement('div');
        card.className = 'project-card-link no-tilt tilt-card';
        card.style.cursor = 'pointer';
        const inner = document.createElement('div');
        inner.className = 'project-card';
        const imgMatch = previewBody.match(/!\[.*?\]\((.*?)\)/);
        const imgW = document.createElement('div');
        imgW.className = 'image-wrapper';
        const img = document.createElement('img');
        img.className = 'project-image';
        img.src = imgMatch?.[1] || DEFAULT_IMAGE;
        img.alt = post.title;
        img.loading = 'lazy';
        img.onerror = () => img.src = DEFAULT_IMAGE;
        imgW.appendChild(img);
        const title = document.createElement('h3');
        title.textContent = post.title.length > 70 ? post.title.slice(0,70)+'…' : post.title;
        const meta = document.createElement('p');
        meta.className = 'text-secondary';
        meta.style.fontSize = '12px';
        meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(post.author)} · <i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`;
        const summary = extractSummary(previewBody) || stripHtml(previewBody).substring(0,120)+'…';
        const preview = document.createElement('p');
        preview.className = 'text-secondary';
        preview.style.fontSize = '13px';
        preview.style.overflow = 'hidden';
        preview.style.display = '-webkit-box';
        preview.style.webkitLineClamp = '2';
        preview.style.webkitBoxOrient = 'vertical';
        preview.textContent = summary;
        inner.append(imgW, title, meta, preview);
        card.appendChild(inner);
        card.addEventListener('click', () => openFullModal({ type: 'update', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game, labels: post.labels }));
        return card;
    }
})();