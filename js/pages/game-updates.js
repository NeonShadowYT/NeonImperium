// game-updates.js — блок обновлений на страницах игр

(function() {
    const { cacheGet, cacheSet, renderMarkdown, escapeHtml } = GithubCore;
    const { loadIssues } = GithubAPI;

    document.addEventListener('DOMContentLoaded', () => {
        const container = document.getElementById('game-updates');
        if (container && container.dataset.game) {
            loadGameUpdates(container, container.dataset.game);
        }
    });

    window.refreshGameUpdates = (game) => {
        const container = document.getElementById('game-updates');
        if (container && container.dataset.game === game) {
            loadGameUpdates(container, game);
        }
    };

    async function loadGameUpdates(container, game) {
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>`;
        const cacheKey = `game_updates_${game}`;
        let posts = cacheGet(cacheKey);
        if (!posts) {
            const issues = await loadIssues({ labels: `update,game:${game}`, per_page: 10 });
            posts = issues
                .filter(issue => GithubCore.CONFIG.ALLOWED_AUTHORS.includes(issue.user.login))
                .map(issue => ({
                    number: issue.number,
                    title: issue.title,
                    body: issue.body,
                    date: new Date(issue.created_at),
                    author: issue.user.login
                }));
            cacheSet(cacheKey, posts.map(p => ({ ...p, date: p.date.toISOString() })));
        } else {
            posts = posts.map(p => ({ ...p, date: new Date(p.date) }));
        }

        if (posts.length === 0) {
            container.innerHTML = '<p class="text-secondary">Нет обновлений</p>';
            return;
        }

        container.innerHTML = '';
        posts.forEach(post => {
            const card = document.createElement('div');
            card.className = 'update-card';
            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <h3 style="margin:0">${escapeHtml(post.title)}</h3>
                    <span class="text-secondary">${post.date.toLocaleDateString()}</span>
                </div>
                <div class="spoiler-content">${renderMarkdown(post.body)}</div>
            `;
            container.appendChild(card);
        });
    }
})();