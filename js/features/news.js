// js/features/news.js
(function() {
    const { cacheGet, cacheSet, deduplicateByNumber, fetchWithTimeout, showToast } = NeonUtils;
    const { createCard } = UIComponents;
    const { getCurrentUser, isAdmin } = GithubAuth;
    const { loadIssues } = NeonAPI;
    const { on } = NeonState;

    let container, posts = [], videos = [];

    document.addEventListener('DOMContentLoaded', () => {
        const section = document.getElementById('news-section');
        if (!section) return;
        container = document.getElementById('news-feed');
        if (!container) return;
        loadFeed();
        window.addEventListener('issue-created', (e) => {
            const issue = e.detail;
            if (issue.labels.some(l => l.name === 'type:news' || l.name === 'type:update')) {
                cacheSet('news_posts', null);
                loadFeed();
            }
        });
        on('login-success', loadFeed);
        on('logout', loadFeed);
    });

    async function loadFeed() {
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-pulse"></i></div>';
        try {
            const [postsData, videosData] = await Promise.all([loadPosts(), loadVideos()]);
            posts = postsData;
            videos = videosData;
            renderMixed();
        } catch (err) {
            container.innerHTML = '<p class="error-message">Ошибка загрузки</p>';
        }
    }

    async function loadPosts() {
        const cacheKey = 'news_posts';
        let cached = cacheGet(cacheKey);
        if (cached) return cached;
        const [news, updates] = await Promise.all([
            loadIssues({ labels: 'type:news', per_page: 15 }),
            loadIssues({ labels: 'type:update', per_page: 15 })
        ]);
        const all = deduplicateByNumber([...news, ...updates])
            .filter(i => i.state === 'open' && NeonConfig.ALLOWED_AUTHORS.includes(i.user.login))
            .map(i => ({
                type: 'post', number: i.number, title: i.title, body: i.body,
                author: i.user.login, date: i.created_at, labels: i.labels.map(l => l.name)
            }));
        cacheSet(cacheKey, all);
        return all;
    }

    async function loadVideos() {
        const cacheKey = 'yt_videos';
        const cached = cacheGet(cacheKey);
        if (cached) return cached;
        const promises = NeonConfig.YOUTUBE_CHANNELS.map(ch => fetchWithTimeout(
            `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`)}`
        ).then(r => r.json()).catch(() => null));
        const results = await Promise.allSettled(promises);
        const all = [];
        results.forEach((res, idx) => {
            if (res.status === 'fulfilled' && res.value?.status === 'ok') {
                const ch = NeonConfig.YOUTUBE_CHANNELS[idx];
                res.value.items.slice(0, 9).forEach(item => {
                    const id = item.link.includes('youtu.be') ? item.link.split('/').pop() : new URL(item.link).searchParams.get('v');
                    if (id) all.push({
                        type: 'video', id, title: item.title, author: ch.name,
                        date: item.pubDate, thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg`
                    });
                });
            }
        });
        const sorted = all.sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 20);
        cacheSet(cacheKey, sorted);
        return sorted;
    }

    function renderMixed() {
        const user = getCurrentUser();
        const filteredPosts = posts.filter(p => {
            if (!p.labels.includes('private')) return true;
            if (isAdmin()) return true;
            const allowed = NeonUtils.extractAllowed(p.body);
            return allowed && allowed.split(',').map(s => s.trim()).includes(user);
        });
        const allItems = [...filteredPosts, ...videos].sort((a,b) => new Date(b.date) - new Date(a.date));
        const items = allItems.slice(0, 6);
        const grid = document.createElement('div');
        grid.className = 'projects-grid';
        items.forEach(item => {
            const card = createCard(item, (post) => {
                if (item.type === 'video') window.open(`https://www.youtube.com/watch?v=${item.id}`, '_blank');
                else UIFeedback.openFullModal(post);
            });
            grid.appendChild(card);
        });
        container.innerHTML = '';
        container.appendChild(grid);
    }
})();