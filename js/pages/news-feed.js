// news-feed.js – лента новостей (посты + видео YouTube)
(function() {
    const YT_CHANNELS = [
        { id: 'UC2pH2qNfh2sEAeYEGs1k_Lg', name: 'Neon Shadow' },
        { id: 'UCxuByf9jKs6ijiJyrMKBzdA', name: 'Оборотень' },
        { id: 'UCQKVSv62dLsK3QnfIke24uQ', name: 'Golden Creeper' },
        { id: 'UCcuqf3fNtZ2UP5MO89kVKLw', name: 'Mitmi' }
    ];
    const DEFAULT_IMAGE = 'images/default-news.webp';

    let container, posts = [], videos = [], postsLoaded = false, videosLoaded = false;
    let currentUser = null, currentAbort = null;
    let videoLoading = false, videoError = false;
    let displayLimit = 6;

    document.addEventListener('DOMContentLoaded', () => {
        const section = document.getElementById('news-section');
        if (!section) return;
        let header = section.querySelector('.news-header');
        if (!header) {
            header = document.createElement('div');
            header.className = 'news-header';
            header.style.display = 'flex';
            header.style.alignItems = 'center';
            header.style.justifyContent = 'space-between';
            header.style.marginBottom = '20px';
            header.style.flexWrap = 'wrap';
            header.style.gap = '15px';
            const titleWrapper = document.createElement('div');
            titleWrapper.innerHTML = '<h2 data-lang="newsTitle" style="margin: 0;">📰 Последние новости</h2><p class="text-secondary" data-lang="newsDesc" style="margin: 4px 0 0;">Свежие видео и обновления</p>';
            header.appendChild(titleWrapper);
            section.prepend(header);
        }
        container = document.getElementById('news-feed');
        if (container) {
            currentUser = GithubAuth.getCurrentUser();
            loadNewsFeed();
        }
        window.addEventListener('github-login-success', (e) => { currentUser = e.detail.login; refreshNewsFeed(); });
        window.addEventListener('github-logout', () => { currentUser = null; refreshNewsFeed(); });
        window.addEventListener('github-issue-created', (e) => {
            const issue = e.detail;
            const typeLabel = issue.labels.find(l => l.name === 'type:news' || l.name === 'type:update');
            if (!typeLabel) return;
            if (!GithubAuth.isAdmin()) return;
            Core.cacheRemoveByPrefix('posts_news+update_v4');
            const newPost = {
                type: 'post',
                number: issue.number,
                title: issue.title,
                body: issue.body,
                author: issue.user.login,
                date: new Date(issue.created_at),
                labels: issue.labels.map(l => l.name),
                game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null
            };
            posts = [newPost, ...posts];
            displayLimit = 6;
            renderMixed();
        });

        const urlParams = new URLSearchParams(window.location.search);
        const postId = urlParams.get('post');
        if (postId) {
            setTimeout(async () => {
                try {
                    const issue = await GithubAPI.loadIssue(postId);
                    if (issue.state === 'closed') {
                        Core.showToast('Этот пост был закрыт и больше не доступен', 'error');
                        return;
                    }
                    const item = {
                        type: 'post',
                        id: issue.number,
                        title: issue.title,
                        body: issue.body,
                        author: issue.user.login,
                        date: new Date(issue.created_at),
                        game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null,
                        labels: issue.labels.map(l => l.name)
                    };
                    if (!UIFeedback.canViewPost(issue.body, issue.labels.map(l => l.name), currentUser)) {
                        Core.showToast('У вас нет доступа к этому посту', 'error');
                        return;
                    }
                    UIFeedback.openFullModal(item);
                } catch (err) {
                    console.error('Ошибка загрузки поста по ссылке:', err);
                    Core.showToast('Пост не найден или произошла ошибка', 'error');
                }
            }, 1500);
        }
    });

    window.refreshNewsFeed = () => {
        if (container) {
            if (currentAbort) currentAbort.controller.abort();
            posts = []; videos = []; postsLoaded = false; videosLoaded = false;
            videoLoading = false; videoError = false;
            displayLimit = 6;
            loadNewsFeed();
        }
    };

    async function loadNewsFeed() {
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка новостей...</p></div>`;
        try {
            posts = await loadPosts();
            postsLoaded = true;
        } catch (err) {
            if (err.name === 'AbortError') return;
            posts = []; postsLoaded = true;
        }
        loadVideosAsync();
    }

    async function loadVideosAsync() {
        if (videoLoading) return;
        videoLoading = true;
        videoError = false;
        try {
            videos = await loadVideosFromRSS2JSON();
            videosLoaded = true;
        } catch (err) {
            if (err.name === 'AbortError') return;
            videos = []; videosLoaded = true;
            videoError = true;
        } finally {
            videoLoading = false;
            renderMixed();
        }
    }

    async function loadVideosFromRSS2JSON() {
        const cacheKey = 'youtube_videos_rss2json_v4';
        let cached = Core.cacheGet(cacheKey);
        if (cached) return cached.map(v => ({ ...v, date: new Date(v.date) }));

        const { controller, timeoutId } = Core.createAbortable(15000);
        currentAbort = { controller };
        try {
            const allVideos = [];
            for (const channel of YT_CHANNELS) {
                const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;
                const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
                const response = await fetch(apiUrl, { signal: controller.signal });
                if (!response.ok) continue;
                const data = await response.json();
                if (data.status !== 'ok') continue;

                const videosFromChannel = (data.items || []).slice(0, 9).map(item => {
                    const link = item.link;
                    let videoId = null;
                    try {
                        const url = new URL(link);
                        if (url.hostname === 'youtu.be') {
                            videoId = url.pathname.slice(1);
                        } else {
                            videoId = url.searchParams.get('v');
                        }
                    } catch (e) { return null; }
                    if (!videoId) return null;
                    return {
                        type: 'video',
                        id: videoId,
                        title: item.title,
                        author: channel.name,
                        date: new Date(item.pubDate),
                        thumbnail: item.thumbnail || `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
                        channel: channel.name
                    };
                }).filter(v => v !== null);
                allVideos.push(...videosFromChannel);
            }
            const sorted = allVideos.sort((a, b) => b.date - a.date).slice(0, 20);
            Core.cacheSet(cacheKey, sorted.map(v => ({ ...v, date: v.date.toISOString() })));
            return sorted;
        } catch (err) {
            if (err.name === 'AbortError') Core.showToast('Таймаут при загрузке видео', 'warning');
            throw err;
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
        }
    }

    async function loadPosts() {
        const cacheKey = 'posts_news+update_v4';
        let cached = Core.cacheGet(cacheKey);
        if (cached) return cached.map(p => ({ ...p, date: new Date(p.date) }));

        const { controller, timeoutId } = Core.createAbortable(10000);
        currentAbort = { controller };
        try {
            const [newsIssues, updateIssues] = await Promise.all([
                GithubAPI.loadIssues({ labels: 'type:news', per_page: 15, signal: controller.signal }),
                GithubAPI.loadIssues({ labels: 'type:update', per_page: 15, signal: controller.signal })
            ]);
            const allIssues = Core.deduplicateByNumber([...newsIssues, ...updateIssues]);
            const postsData = allIssues
                .filter(issue => issue.state === 'open' && GithubAuth.isAdmin())
                .map(issue => ({
                    type: 'post',
                    number: issue.number,
                    title: issue.title,
                    body: issue.body,
                    author: issue.user.login,
                    date: new Date(issue.created_at),
                    labels: issue.labels.map(l => l.name),
                    game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null
                }));
            Core.cacheSet(cacheKey, postsData.map(p => ({ ...p, date: p.date.toISOString() })));
            return postsData;
        } catch (err) {
            if (err.name === 'AbortError') Core.showToast('Таймаут при загрузке новостей', 'warning');
            throw err;
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
        }
    }

    function renderMixed() {
        if (!postsLoaded) {
            container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка новостей...</p></div>`;
            return;
        }

        let filteredPosts = posts.filter(post => {
            if (!post.labels.includes('private')) return true;
            if (GithubAuth.isAdmin()) return true;
            const allowed = Core.extractAllowed(post.body);
            if (!allowed) return false;
            const allowedList = allowed.split(',').map(s => s.trim()).filter(Boolean);
            return allowedList.includes(currentUser);
        });

        let allItems = [...filteredPosts];
        if (videosLoaded) allItems = allItems.concat(videos);
        allItems.sort((a, b) => b.date - a.date);
        
        const itemsToShow = allItems.slice(0, displayLimit);
        const hasMore = allItems.length > displayLimit;

        const grid = document.createElement('div'); grid.className = 'projects-grid';
        if (itemsToShow.length === 0) {
            grid.innerHTML = '<p class="text-secondary" style="grid-column:1/-1; text-align:center;">Пока нет новостей</p>';
        } else {
            itemsToShow.forEach(item => {
                if (item.type === 'video') grid.appendChild(createVideoCard(item));
                else grid.appendChild(createPostCard(item));
            });
        }

        container.innerHTML = '';
        container.appendChild(grid);
        
        let loadMoreBtn = container.querySelector('.load-more-btn');
        if (!loadMoreBtn && hasMore) {
            loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'load-more-btn';
            loadMoreBtn.textContent = 'Загрузить ещё';
            loadMoreBtn.setAttribute('aria-label', 'Загрузить следующие новости');
            loadMoreBtn.addEventListener('click', () => {
                displayLimit += 6;
                renderMixed();
            });
            container.appendChild(loadMoreBtn);
        } else if (loadMoreBtn && !hasMore) {
            loadMoreBtn.remove();
        }
    }

    function createVideoCard(video) {
        const card = document.createElement('div'); card.className = 'project-card-link'; card.style.cursor = 'pointer';
        card.setAttribute('aria-label', `Смотреть видео: ${video.title}`);
        const inner = document.createElement('div'); inner.className = 'project-card';
        const imgWrapper = document.createElement('div'); imgWrapper.className = 'image-wrapper';
        const img = document.createElement('img'); img.src = video.thumbnail; img.alt = video.title; img.loading = 'lazy'; img.className = 'project-image';
        imgWrapper.appendChild(img);
        const title = document.createElement('h3'); title.textContent = video.title.length > 70 ? video.title.substring(0,70)+'…' : video.title;
        const meta = document.createElement('p'); meta.className = 'text-secondary'; meta.style.fontSize='12px'; meta.innerHTML = `<i class="fas fa-user"></i> ${Core.escapeHtml(video.author)} · <i class="fas fa-calendar-alt"></i> ${video.date.toLocaleDateString()}`;
        const button = document.createElement('span'); button.className = 'button'; button.innerHTML = '<i class="fas fa-play"></i> Смотреть';
        inner.append(imgWrapper, title, meta, button); card.appendChild(inner);
        card.addEventListener('click', (e) => { e.preventDefault(); window.open(`https://www.youtube.com/watch?v=${video.id}`, '_blank'); });
        return card;
    }

    function createPostCard(post) {
        const card = document.createElement('div'); card.className = 'project-card-link no-tilt'; card.style.cursor = 'pointer';
        card.setAttribute('aria-label', `Читать пост: ${post.title}`);
        const inner = document.createElement('div'); inner.className = 'project-card';
        const imgMatch = post.body.match(/!\[.*?\]\((.*?)\)/);
        const thumbnail = imgMatch ? imgMatch[1] : DEFAULT_IMAGE;
        const imgWrapper = document.createElement('div'); imgWrapper.className = 'image-wrapper';
        const img = document.createElement('img'); img.src = thumbnail; img.alt = post.title; img.loading = 'lazy'; img.className = 'project-image'; img.onerror = () => img.src = DEFAULT_IMAGE;
        imgWrapper.appendChild(img);
        const title = document.createElement('h3'); title.textContent = post.title.length > 70 ? post.title.substring(0,70)+'…' : post.title;
        const meta = document.createElement('p'); meta.className = 'text-secondary'; meta.style.fontSize='12px'; meta.innerHTML = `<i class="fas fa-user"></i> ${Core.escapeHtml(post.author)} · <i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`;
        const summary = Core.extractSummary(post.body) || Core.stripHtml(post.body).substring(0,120)+'…';
        const preview = document.createElement('p'); preview.className = 'text-secondary'; preview.style.fontSize='13px'; preview.style.overflow='hidden'; preview.style.display='-webkit-box'; preview.style.webkitLineClamp='2'; preview.style.webkitBoxOrient='vertical'; preview.textContent = summary;
        inner.append(imgWrapper, title, meta, preview); card.appendChild(inner);
        card.addEventListener('click', (e) => { e.preventDefault(); UIFeedback.openFullModal({ type: 'post', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game, labels: post.labels }); });
        return card;
    }
})();