// js/features/updates.js
(function() {
    const { cacheGet, cacheSet, showToast, deduplicateByNumber } = NeonUtils;
    const { createCard } = UIComponents;
    const { getCurrentUser, isAdmin } = GithubAuth;
    const { loadIssues } = NeonAPI;
    const { on } = NeonState;

    document.addEventListener('DOMContentLoaded', () => {
        const container = document.getElementById('game-updates');
        if (!container) return;
        const game = container.dataset.game;
        loadUpdates(container, game);
        window.addEventListener('issue-created', (e) => {
            const issue = e.detail;
            if (issue.labels.some(l => l.name === `game:${game}` && l.name === 'type:update')) {
                cacheSet(`updates_${game}`, null);
                loadUpdates(container, game);
            }
        });
        on('login-success', () => loadUpdates(container, game));
        on('logout', () => loadUpdates(container, game));
    });

    async function loadUpdates(container, game) {
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-pulse"></i></div>';
        try {
            const cacheKey = `updates_${game}`;
            let posts = cacheGet(cacheKey);
            if (!posts) {
                const issues = await loadIssues({ labels: `game:${game},type:update`, per_page: 10 });
                posts = deduplicateByNumber(issues)
                    .filter(i => NeonConfig.ALLOWED_AUTHORS.includes(i.user.login))
                    .map(i => ({
                        type: 'post',
                        number: i.number, title: i.title, body: i.body,
                        author: i.user.login, date: i.created_at, labels: i.labels.map(l => l.name)
                    }));
                cacheSet(cacheKey, posts);
            }
            const user = getCurrentUser();
            posts = posts.filter(p => {
                if (!p.labels.includes('private')) return true;
                if (isAdmin()) return true;
                const allowed = NeonUtils.extractAllowed(p.body);
                return allowed && allowed.split(',').map(s => s.trim()).includes(user);
            });
            container.innerHTML = '';
            if (posts.length === 0) {
                container.innerHTML = '<p class="text-secondary">Нет обновлений</p>';
                return;
            }
            const grid = document.createElement('div');
            grid.className = 'projects-grid';
            posts.forEach(p => grid.appendChild(createCard(p, (post) => UIFeedback.openFullModal(post))));
            container.appendChild(grid);
        } catch (err) {
            container.innerHTML = '<p class="error-message">Ошибка загрузки</p>';
        }
    }
})();