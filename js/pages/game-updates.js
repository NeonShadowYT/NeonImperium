(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG, deduplicateByNumber, createAbortable } = GithubCore;
    const { loadIssues } = GithubAPI;
    const { openFullModal } = UIFeedback;
    const { getCurrentUser } = GithubAuth;

    const DEFAULT_IMAGE = 'images/default-news.webp';
    let currentAbort = null;
    let currentGame = null;

    document.addEventListener('DOMContentLoaded', () => {
        const container = document.getElementById('game-updates');
        if (container && container.dataset.game) {
            currentGame = container.dataset.game;
            loadGameUpdates(container, currentGame);
        }

        window.addEventListener('github-issue-created', (e) => {
            const issue = e.detail;
            if (!currentGame) return;
            const hasUpdateLabel = issue.labels.some(l => l.name === 'type:update');
            const hasGameLabel = issue.labels.some(l => l.name === `game:${currentGame}`);
            if (!hasUpdateLabel || !hasGameLabel) return;
            if (!CONFIG.ALLOWED_AUTHORS.includes(issue.user.login)) return;

            // Инвалидируем кеш обновлений для этой игры
            cacheRemoveByPrefix(`game_updates_${currentGame}`);

            const container = document.getElementById('game-updates');
            if (!container) return;

            const newPost = {
                number: issue.number,
                title: issue.title,
                body: issue.body,
                date: new Date(issue.created_at),
                author: issue.user.login,
                game: currentGame
            };
            let grid = container.querySelector('.projects-grid');
            if (!grid) {
                grid = document.createElement('div');
                grid.className = 'projects-grid';
                container.innerHTML = '';
                container.appendChild(grid);
            }
            const card = createUpdateCard(newPost);
            grid.insertBefore(card, grid.firstChild);
        });
    });

    window.refreshGameUpdates = (game) => {
        const container = document.getElementById('game-updates');
        if (container && container.dataset.game === game) loadGameUpdates(container, game);
    };

    async function loadGameUpdates(container, game) {
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>`;
        if (currentAbort) currentAbort.controller.abort();
        const { controller, timeoutId } = createAbortable(10000);
        currentAbort = { controller };
        try {
            const cacheKey = `game_updates_${game}`;
            let posts = cacheGet(cacheKey);
            if (!posts) {
                const issues = await loadIssues({ labels: `type:update,game:${game}`, per_page: 10, signal: controller.signal });
                posts = deduplicateByNumber(issues)
                    .filter(issue => CONFIG.ALLOWED_AUTHORS.includes(issue.user.login))
                    .map(issue => ({ number: issue.number, title: issue.title, body: issue.body, date: new Date(issue.created_at), author: issue.user.login, game }));
                cacheSet(cacheKey, posts.map(p => ({ ...p, date: p.date.toISOString() })));
            } else posts = posts.map(p => ({ ...p, date: new Date(p.date) }));
            if (posts.length === 0) { container.innerHTML = '<p class="text-secondary">Нет обновлений</p>'; return; }
            container.innerHTML = '';
            const grid = document.createElement('div'); grid.className = 'projects-grid'; container.appendChild(grid);
            posts.forEach(post => grid.appendChild(createUpdateCard(post)));
        } catch (err) {
            if (err.name === 'AbortError') return;
            container.innerHTML = '<p class="error-message">Ошибка загрузки</p>';
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
        }
    }

    function createUpdateCard(post) {
        const card = document.createElement('div'); card.className = 'project-card-link no-tilt'; card.style.cursor = 'pointer';
        const inner = document.createElement('div'); inner.className = 'project-card';
        const imgMatch = post.body.match(/!\[.*?\]\((.*?)\)/);
        const thumbnail = imgMatch ? imgMatch[1] : DEFAULT_IMAGE;
        const imgWrapper = document.createElement('div'); imgWrapper.className = 'image-wrapper';
        const img = document.createElement('img'); img.src = thumbnail; img.alt = post.title; img.loading = 'lazy'; img.className = 'project-image'; img.onerror = () => img.src = DEFAULT_IMAGE;
        imgWrapper.appendChild(img);
        const title = document.createElement('h3'); title.textContent = post.title.length > 70 ? post.title.substring(0,70)+'…' : post.title;
        const meta = document.createElement('p'); meta.className = 'text-secondary'; meta.style.fontSize='12px'; meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(post.author)} · <i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`;
        const preview = document.createElement('p'); preview.className = 'text-secondary'; preview.style.fontSize='13px'; preview.style.overflow='hidden'; preview.style.display='-webkit-box'; preview.style.webkitLineClamp='2'; preview.style.webkitBoxOrient='vertical'; preview.textContent = GithubCore.stripHtml(post.body).substring(0,120)+'…';
        inner.append(imgWrapper, title, meta, preview); card.appendChild(inner);
        card.addEventListener('click', (e) => { e.preventDefault(); openFullModal({ type: 'update', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game }); });
        return card;
    }
})();