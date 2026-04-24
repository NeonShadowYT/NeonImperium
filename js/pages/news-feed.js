// js/pages/news-feed.js – лента новостей, видео проигрываются в карточке, посты в модалке, оптимизировано
(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG, deduplicateByNumber, createAbortable, stripHtml, extractSummary, extractAllowed, decryptPrivateBody, loadModule } = GithubCore;
    const { loadIssues, loadIssue } = GithubAPI;
    const { openFullModal, canViewPost } = UIFeedback;
    const { getCurrentUser, isAdmin, hasScope } = GithubAuth;

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

    document.addEventListener('DOMContentLoaded', () => {
        const section = document.getElementById('news-section');
        if (!section) return;
        let header = section.querySelector('.news-header');
        if (!header) {
            header = GithubCore.createElement('div', 'news-header', {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '20px', flexWrap: 'wrap', gap: '15px'
            });
            header.innerHTML = '<div><h2 data-lang="newsTitle">📰 Последние новости</h2><p class="text-secondary" data-lang="newsDesc">Свежие видео и обновления</p></div>';
            section.prepend(header);
        }
        container = document.getElementById('news-feed');
        if (container) {
            currentUser = getCurrentUser();
            loadNewsFeed();
        }
        window.addEventListener('github-login-success', e => { currentUser = e.detail.login; refreshNewsFeed(); });
        window.addEventListener('github-logout', () => { currentUser = null; refreshNewsFeed(); });
        window.addEventListener('github-issue-created', e => {
            const issue = e.detail;
            const typeLabel = issue.labels.find(l => l.name === 'type:news' || l.name === 'type:update');
            if (!typeLabel || !CONFIG.ALLOWED_AUTHORS.includes(issue.user.login)) return;
            cacheRemoveByPrefix('posts_news+update_v3');
            const newPost = {
                type: 'post', number: issue.number, title: issue.title, body: issue.body,
                author: issue.user.login, date: new Date(issue.created_at),
                labels: issue.labels.map(l => l.name),
                game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null
            };
            posts = [newPost, ...posts];
            renderMixed();
        });

        const postId = new URLSearchParams(location.search).get('post');
        if (postId) setTimeout(() => openPostFromUrl(postId), 1500);
    });

    async function openPostFromUrl(postId) {
        try {
            const issue = await loadIssue(postId);
            if (issue.state === 'closed') return UIUtils.showToast('Пост закрыт', 'error');
            const item = {
                type: 'post', id: issue.number, title: issue.title, body: issue.body,
                author: issue.user.login, date: new Date(issue.created_at),
                game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null,
                labels: issue.labels.map(l => l.name)
            };
            if (!canViewPost(issue.body, item.labels, currentUser)) return UIUtils.showToast('Нет доступа', 'error');
            openFullModal(item);
        } catch { UIUtils.showToast('Ошибка загрузки', 'error'); }
    }

    window.refreshNewsFeed = () => {
        if (!container) return;
        if (currentAbort) currentAbort.controller.abort();
        posts = []; videos = []; postsLoaded = videosLoaded = false;
        videoLoading = videoError = false;
        loadNewsFeed();
    };

    async function loadNewsFeed() {
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка новостей...</p></div>';
        try { posts = await loadPosts(); postsLoaded = true; } catch { posts = []; postsLoaded = true; }
        loadVideosAsync();
    }

    async function loadVideosAsync() {
        if (videoLoading) return;
        videoLoading = true;
        try { videos = await loadVideosFromRSS2JSON(); videosLoaded = true; } catch { videos = []; videosLoaded = true; videoError = true; }
        finally { videoLoading = false; renderMixed(); }
    }

    async function loadVideosFromRSS2JSON() {
        const cacheKey = 'youtube_videos_rss2json_v3';
        const cached = cacheGet(cacheKey);
        if (cached) return cached.map(v => ({ ...v, date: new Date(v.date) }));
        const { controller, timeoutId } = createAbortable(15000);
        currentAbort = { controller };
        try {
            const all = [];
            for (const ch of YT_CHANNELS) {
                const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`)}`;
                const resp = await fetch(apiUrl, { signal: controller.signal });
                if (!resp.ok) continue;
                const data = await resp.json();
                if (data.status !== 'ok') continue;
                const items = data.items.slice(0,9).map(item => {
                    const vid = item.link.match(/(?:youtu\.be\/|v=)([^&\n?#]+)/)?.[1];
                    if (!vid) return null;
                    return { type: 'video', id: vid, title: item.title, author: ch.name, date: new Date(item.pubDate), thumbnail: item.thumbnail || `https://img.youtube.com/vi/${vid}/mqdefault.jpg` };
                }).filter(v => v);
                all.push(...items);
            }
            const sorted = all.sort((a,b) => b.date - a.date).slice(0,20);
            cacheSet(cacheKey, sorted.map(v => ({ ...v, date: v.date.toISOString() })));
            return sorted;
        } finally { clearTimeout(timeoutId); if (currentAbort?.controller === controller) currentAbort = null; }
    }

    async function loadPosts() {
        const cacheKey = 'posts_news+update_v3';
        const cached = cacheGet(cacheKey);
        if (cached) return cached.map(p => ({ ...p, date: new Date(p.date) }));
        const { controller, timeoutId } = createAbortable(10000);
        currentAbort = { controller };
        try {
            const [news, updates] = await Promise.all([
                loadIssues({ labels: 'type:news', per_page: 15, signal: controller.signal }),
                loadIssues({ labels: 'type:update', per_page: 15, signal: controller.signal })
            ]);
            const all = deduplicateByNumber([...news, ...updates]).filter(i => i.state === 'open' && CONFIG.ALLOWED_AUTHORS.includes(i.user.login));
            const posts = all.map(i => ({
                type: 'post', number: i.number, title: i.title, body: i.body,
                author: i.user.login, date: new Date(i.created_at),
                labels: i.labels.map(l => l.name),
                game: i.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null
            }));
            cacheSet(cacheKey, posts.map(p => ({ ...p, date: p.date.toISOString() })));
            return posts;
        } finally { clearTimeout(timeoutId); if (currentAbort?.controller === controller) currentAbort = null; }
    }

    function renderMixed() {
        if (!postsLoaded) return;
        const filteredPosts = posts.filter(p => {
            if (!p.labels.includes('private')) return true;
            if (isAdmin()) return true;
            const allowed = extractAllowed(p.body);
            return allowed && allowed.split(',').map(s=>s.trim()).includes(currentUser);
        });
        let items = [...filteredPosts];
        if (videosLoaded) items = items.concat(videos);
        items.sort((a,b) => b.date - a.date);
        const showItems = items.slice(0,6);

        const grid = GithubCore.createElement('div', 'projects-grid');
        if (showItems.length === 0) {
            grid.innerHTML = '<div class="empty-state"><i class="fas fa-newspaper"></i><p data-lang="newsNoItems">Пока нет новостей</p></div>';
        } else {
            showItems.forEach(item => grid.appendChild(item.type === 'video' ? createVideoCard(item) : createPostCard(item)));
        }
        if (videoError) {
            const retry = GithubCore.createElement('button', 'button small', { marginTop: '20px' });
            retry.innerHTML = '<i class="fas fa-sync-alt"></i> Повторить загрузку видео';
            retry.addEventListener('click', () => { videoError = false; videosLoaded = false; loadVideosAsync(); retry.remove(); });
            grid.appendChild(retry);
        }
        container.innerHTML = '';
        container.appendChild(grid);

        const header = document.querySelector('.news-header');
        if (header) {
            const existing = header.querySelector('.admin-news-btn');
            if (isAdmin() && hasScope('repo')) {
                if (!existing) {
                    const btn = GithubCore.createElement('button', 'button admin-news-btn');
                    btn.innerHTML = '<i class="fas fa-plus"></i> Добавить новость';
                    btn.addEventListener('click', () => UIFeedback.openEditorModal('new', { game: null }, 'news'));
                    header.appendChild(btn);
                }
            } else if (existing) existing.remove();
        }
    }

    async function handleBookmark(item) {
        if (!window.BookmarkStorage) {
            try { await loadModule('js/features/storage.js'); }
            catch (e) { return UIUtils.showToast('Не удалось загрузить хранилище', 'error'); }
        }
        const bookmark = {
            url: item.type === 'video'
                ? `https://www.youtube.com/watch?v=${item.id}`
                : `${location.origin}${location.pathname}?post=${item.id}`,
            title: item.title,
            type: item.type === 'video' ? 'video' : 'post',
            thumbnail: item.thumbnail || DEFAULT_IMAGE,
            author: item.author,
            date: item.date
        };
        try {
            await BookmarkStorage.addBookmark(bookmark);
            UIUtils.showToast('Добавлено в избранное', 'success');
        } catch (err) {
            if (err.message === 'password_required') {
                UIUtils.showToast('Для сохранения нужен мастер-пароль. Откройте хранилище.', 'error');
            } else if (err.message !== 'duplicate') {
                UIUtils.showToast('Ошибка: ' + err.message, 'error');
            }
        }
    }

    function createVideoCard(video) {
        const card = GithubCore.createElement('div', 'project-card-link card-interactive');
        const inner = GithubCore.createElement('div', 'project-card');

        const imgW = GithubCore.createElement('div', 'image-wrapper');
        const img = GithubCore.createElement('img', 'project-image', {}, { src: video.thumbnail, alt: video.title, loading: 'lazy' });
        imgW.appendChild(img);
        inner.appendChild(imgW);

        const titleEl = GithubCore.createElement('h3', '', { cursor: 'default' });
        titleEl.textContent = video.title.length > 70 ? video.title.slice(0,70)+'…' : video.title;
        inner.appendChild(titleEl);

        const meta = GithubCore.createElement('p', 'text-secondary', { fontSize: '12px' });
        meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(video.author)} · <i class="fas fa-calendar-alt"></i> ${video.date.toLocaleDateString()}`;
        inner.appendChild(meta);

        const favBtn = GithubCore.createElement('div', 'news-bookmark-btn', {}, { title: 'В избранное' });
        favBtn.innerHTML = '<i class="far fa-bookmark"></i>';
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleBookmark(video);
        });
        inner.appendChild(favBtn);

        card.appendChild(inner);

        card.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('.news-bookmark-btn')) return;
            const mediaContainer = card.querySelector('.image-wrapper');
            if (!mediaContainer || mediaContainer.querySelector('iframe')) return;
            const src = `https://www.youtube.com/embed/${video.id}`;
            const iframe = GithubCore.createElement('iframe', '', {
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none', borderRadius: '12px'
            });
            iframe.src = src;
            iframe.setAttribute('allowfullscreen', 'true');
            iframe.loading = 'lazy';
            iframe.allow = 'autoplay; encrypted-media; gyroscope; picture-in-picture';
            iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms allow-presentation';
            mediaContainer.innerHTML = '';
            mediaContainer.style.background = '#000';
            mediaContainer.appendChild(iframe);
        });

        return card;
    }

    function createPostCard(post) {
        let previewBody = post.body;
        const allowed = extractAllowed(post.body);
        if (post.labels.includes('private') && allowed && currentUser && allowed.split(',').map(s=>s.trim()).includes(currentUser)) {
            try { previewBody = decryptPrivateBody(post.body, allowed); } catch {}
        }
        const card = GithubCore.createElement('div', 'project-card-link card-interactive');
        const inner = GithubCore.createElement('div', 'project-card');

        const imgMatch = previewBody.match(/!\[.*?\]\((.*?)\)/);
        const imgW = GithubCore.createElement('div', 'image-wrapper');
        const img = GithubCore.createElement('img', 'project-image', {}, { src: imgMatch?.[1] || DEFAULT_IMAGE, alt: post.title, loading: 'lazy' });
        img.onerror = () => img.src = DEFAULT_IMAGE;
        imgW.appendChild(img);
        inner.appendChild(imgW);

        const titleEl = GithubCore.createElement('h3', '', { cursor: 'pointer' });
        titleEl.textContent = post.title.length > 70 ? post.title.slice(0,70)+'…' : post.title;
        inner.appendChild(titleEl);

        const meta = GithubCore.createElement('p', 'text-secondary', { fontSize: '12px' });
        meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(post.author)} · <i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`;
        const summary = extractSummary(previewBody) || stripHtml(previewBody).substring(0,120)+'…';
        const preview = GithubCore.createElement('p', 'text-secondary', { fontSize: '13px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' });
        preview.textContent = summary;
        inner.append(meta, preview);

        const favBtn = GithubCore.createElement('div', 'news-bookmark-btn', {}, { title: 'В избранное' });
        favBtn.innerHTML = '<i class="far fa-bookmark"></i>';
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleBookmark({ type: 'post', ...post, thumbnail: imgMatch?.[1] || DEFAULT_IMAGE });
        });
        inner.appendChild(favBtn);

        card.appendChild(inner);
        card.addEventListener('click', (e) => {
            if (!e.target.closest('button') && !e.target.closest('.news-bookmark-btn')) {
                openFullModal({ type: 'post', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game, labels: post.labels });
            }
        });
        return card;
    }
})();