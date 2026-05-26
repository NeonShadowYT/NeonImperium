// js/pages/news-feed.js – лента новостей, исправленная версия
(function() {
    const { cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG, deduplicateByNumber, createAbortable, stripHtml, loadModule } = window.GithubCore;
    const { loadIssues, loadIssue } = window.GithubAPI;
    const { openFullModal, canViewPost } = window.UIFeedback;
    const { getCurrentUser, isAdmin, hasScope } = window.GithubAuth;

    const YT_CHANNELS = [
        { id: 'UC2pH2qNfh2sEAeYEGs1k_Lg', name: 'Neon Shadow' },
        { id: 'UCxuByf9jKs6ijiJyrMKBzdA', name: 'Оборотень' },
        { id: 'UCQKVSv62dLsK3QnfIke24uQ', name: 'Golden Creeper' },
        { id: 'UCcuqf3fNtZ2UP5MO89kVKLw', name: 'Mitmi' }
    ];
    const DEFAULT_IMAGE = 'images/default-news.webp';

    let container, posts = [], videos = [], postsLoaded = false, videosLoaded = false;
    let currentUser = null;
    let loading = false;

    async function ensureLoggedInAndGist() {
        if (getCurrentUser() && hasScope('gist')) return true;
        window.dispatchEvent(new CustomEvent('github-login-requested'));
        return new Promise((resolve) => {
            const onLogin = (e) => {
                if (e.detail?.scopes?.includes('gist')) {
                    window.removeEventListener('github-login-success', onLogin);
                    resolve(true);
                } else if (e.detail?.scopes) {
                    window.UIUtils.showToast('Для закладок требуется scope "gist". Войдите заново с правами gist.', 'error');
                    window.removeEventListener('github-login-success', onLogin);
                    resolve(false);
                }
            };
            const onLogout = () => {
                window.removeEventListener('github-login-success', onLogin);
                window.removeEventListener('github-logout', onLogout);
                resolve(false);
            };
            window.addEventListener('github-login-success', onLogin);
            window.addEventListener('github-logout', onLogout);
            setTimeout(() => {
                window.removeEventListener('github-login-success', onLogin);
                window.removeEventListener('github-logout', onLogout);
                resolve(false);
            }, 60000);
        });
    }

    async function handleBookmark(item) {
        if (!(await ensureLoggedInAndGist())) {
            window.UIUtils.showToast('Необходимо войти с правами gist', 'error');
            return;
        }
        if (!window.BookmarkStorage) {
            try { await loadModule('js/features/storage.js'); } catch { return window.UIUtils.showToast('Не удалось загрузить хранилище', 'error'); }
        }
        const bookmark = {
            url: item.type === 'video'
                ? `https://www.youtube.com/watch?v=${item.id}`
                : `${location.origin}${location.pathname}?post=${item.number}`,
            title: item.title,
            type: item.type === 'video' ? 'video' : 'post',
            thumbnail: item.thumbnail || DEFAULT_IMAGE,
            author: item.author,
            date: item.date,
            postData: item.type === 'post' ? {
                id: item.number,
                title: item.title,
                body: item.body,
                author: item.author,
                date: item.date instanceof Date ? item.date.toISOString() : item.date,
                labels: item.labels,
                game: item.game
            } : undefined
        };
        try {
            await window.BookmarkStorage.addBookmark(bookmark);
            window.UIUtils.showToast('Добавлено в избранное', 'success');
        } catch (err) {
            if (err.message === 'password_required') {
                window.UIUtils.showToast('Для сохранения нужен мастер-пароль. Откройте хранилище.', 'error');
            } else if (err.message !== 'duplicate') {
                window.UIUtils.showToast('Ошибка: ' + err.message, 'error');
            }
        }
    }

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
            header.innerHTML = '<div><h2 data-lang="newsTitle">📰 Последние новости</h2><p class="text-secondary" data-lang="newsDesc">Свежие видео и обновления</p></div>';
            section.prepend(header);
        }
        container = document.getElementById('news-feed');
        if (container) {
            currentUser = getCurrentUser();
            loadNewsFeed();
        }
        window.addEventListener('github-login-success', e => {
            currentUser = e.detail.login;
            refreshNewsFeed();
        });
        window.addEventListener('github-logout', () => {
            currentUser = null;
            refreshNewsFeed();
        });
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
            if (issue.state === 'closed') return window.UIUtils.showToast('Пост закрыт', 'error');
            const item = {
                type: 'post', id: issue.number, title: issue.title, body: issue.body,
                author: issue.user.login, date: new Date(issue.created_at),
                game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null,
                labels: issue.labels.map(l => l.name)
            };
            if (!canViewPost(issue.body, item.labels, currentUser)) return window.UIUtils.showToast('Нет доступа', 'error');
            openFullModal(item);
        } catch (err) {
            console.error('Failed to open post from URL:', err);
            window.UIUtils.showToast('Ошибка загрузки поста', 'error');
        }
    }

    window.refreshNewsFeed = () => {
        if (!container || loading) return;
        posts = []; videos = []; postsLoaded = videosLoaded = false;
        loadNewsFeed();
    };

    function loadNewsFeed() {
        if (loading) return;
        loading = true;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p data-lang="newsLoading">Загрузка новостей...</p></div>';
        Promise.all([
            loadPosts(),
            loadVideos()
        ]).then(([loadedPosts, loadedVideos]) => {
            posts = loadedPosts;
            videos = loadedVideos;
            postsLoaded = videosLoaded = true;
            renderMixed();
        }).catch(err => {
            console.error('Ошибка загрузки новостей:', err);
            postsLoaded = videosLoaded = true;
            posts = [];
            videos = [];
            renderMixed();
        }).finally(() => {
            loading = false;
        });
    }

    async function loadVideos() {
        try {
            return await loadVideosFromRSS2JSON();
        } catch (err) {
            console.warn('Ошибка загрузки видео:', err);
            return [];
        }
    }

    async function loadVideosFromRSS2JSON() {
        const cacheKey = 'youtube_videos_rss2json_v3';
        const cached = cacheGet(cacheKey);
        if (cached) return cached.map(v => ({ ...v, date: new Date(v.date) }));
        const all = [];
        for (const ch of YT_CHANNELS) {
            const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`)}`;
            try {
                const resp = await fetch(apiUrl);
                if (!resp.ok) continue;
                const data = await resp.json();
                if (data.status !== 'ok') continue;
                const items = data.items.slice(0, 9).map(item => {
                    const vid = item.link.match(/(?:youtu\.be\/|v=)([^&\n?#]+)/)?.[1];
                    if (!vid) return null;
                    return {
                        type: 'video', id: vid, title: item.title, author: ch.name,
                        date: new Date(item.pubDate),
                        thumbnail: item.thumbnail || `https://img.youtube.com/vi/${vid}/mqdefault.jpg`
                    };
                }).filter(v => v);
                all.push(...items);
            } catch (err) {
                console.warn(`Ошибка загрузки видео для канала ${ch.name}:`, err);
            }
        }
        const sorted = all.sort((a, b) => b.date - a.date).slice(0, 20);
        cacheSet(cacheKey, sorted.map(v => ({ ...v, date: v.date.toISOString() })));
        return sorted;
    }

    async function loadPosts() {
        const cacheKey = 'posts_news+update_v3';
        const cached = cacheGet(cacheKey);
        if (cached) return cached.map(p => ({ ...p, date: new Date(p.date) }));
        try {
            const [newsResp, updatesResp] = await Promise.all([
                fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?state=open&per_page=15&page=1&labels=type:news`),
                fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues?state=open&per_page=15&page=1&labels=type:update`)
            ]);
            const news = newsResp.ok ? await newsResp.json() : [];
            const updates = updatesResp.ok ? await updatesResp.json() : [];
            const all = deduplicateByNumber([...news, ...updates]).filter(i => i.state === 'open' && CONFIG.ALLOWED_AUTHORS.includes(i.user.login));
            const result = all.map(i => ({
                type: 'post', number: i.number, title: i.title, body: i.body,
                author: i.user.login, date: new Date(i.created_at),
                labels: i.labels.map(l => l.name),
                game: i.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null
            }));
            cacheSet(cacheKey, result.map(p => ({ ...p, date: p.date.toISOString() })));
            return result;
        } catch (err) {
            console.error('Failed to load posts:', err);
            return [];
        }
    }

    function renderMixed() {
        if (!postsLoaded || !videosLoaded) return;
        const filteredPosts = posts.filter(p => {
            if (!p.labels.includes('private')) return true;
            if (isAdmin()) return true;
            const allowed = extractAllowed(p.body);
            return allowed && allowed.split(',').map(s => s.trim()).includes(currentUser);
        });
        let items = [...filteredPosts, ...videos];
        items.sort((a, b) => b.date - a.date);
        const showItems = items.slice(0, 6);
        const grid = document.createElement('div');
        grid.className = 'projects-grid';
        if (showItems.length === 0) {
            grid.innerHTML = '<div class="empty-state"><i class="fas fa-newspaper"></i><p data-lang="newsNoItems">Пока нет новостей</p></div>';
        } else {
            showItems.forEach(item => grid.appendChild(item.type === 'video' ? createVideoCard(item) : createPostCard(item)));
        }
        container.innerHTML = '';
        container.appendChild(grid);
        const header = document.querySelector('.news-header');
        if (header) {
            const existing = header.querySelector('.admin-news-btn');
            if (isAdmin() && hasScope('repo')) {
                if (!existing) {
                    const btn = document.createElement('button');
                    btn.className = 'button admin-news-btn';
                    btn.innerHTML = '<i class="fas fa-plus"></i> Добавить новость';
                    btn.addEventListener('click', () => window.UIFeedback.openEditorModal('new', { game: null }, 'news'));
                    header.appendChild(btn);
                }
            } else if (existing) existing.remove();
        }
    }

    function createVideoCard(video) {
        const card = document.createElement('div');
        card.className = 'project-card-link card-interactive';
        const inner = document.createElement('div');
        inner.className = 'project-card';
        const imgW = document.createElement('div');
        imgW.className = 'image-wrapper';
        const img = document.createElement('img');
        img.className = 'project-image';
        img.src = video.thumbnail;
        img.alt = video.title;
        img.loading = 'lazy';
        imgW.appendChild(img);
        inner.appendChild(imgW);
        const titleEl = document.createElement('h3');
        titleEl.style.cursor = 'default';
        titleEl.textContent = video.title.length > 70 ? video.title.slice(0,70)+'…' : video.title;
        inner.appendChild(titleEl);
        const meta = document.createElement('p');
        meta.className = 'text-secondary';
        meta.style.fontSize = '12px';
        meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(video.author)} · <i class="fas fa-calendar-alt"></i> ${video.date.toLocaleDateString()}`;
        inner.appendChild(meta);
        if (currentUser && hasScope('gist')) {
            const favBtn = document.createElement('div');
            favBtn.className = 'news-bookmark-btn';
            favBtn.title = 'В избранное';
            favBtn.innerHTML = '<i class="far fa-bookmark"></i>';
            favBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleBookmark(video);
            });
            inner.appendChild(favBtn);
        }
        card.appendChild(inner);
        card.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('.news-bookmark-btn')) return;
            const mediaContainer = card.querySelector('.image-wrapper');
            if (!mediaContainer || mediaContainer.querySelector('iframe')) return;
            const src = `https://www.youtube.com/embed/${video.id}`;
            const iframe = document.createElement('iframe');
            iframe.style.position = 'absolute';
            iframe.style.top = '0';
            iframe.style.left = '0';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.style.borderRadius = '12px';
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
        const card = document.createElement('div');
        card.className = 'project-card-link card-interactive';
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
        inner.appendChild(imgW);
        const titleEl = document.createElement('h3');
        titleEl.style.cursor = 'pointer';
        titleEl.textContent = post.title.length > 70 ? post.title.slice(0,70)+'…' : post.title;
        inner.appendChild(titleEl);
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
        inner.append(meta, preview);
        if (currentUser && hasScope('gist')) {
            const favBtn = document.createElement('div');
            favBtn.className = 'news-bookmark-btn';
            favBtn.title = 'В избранное';
            favBtn.innerHTML = '<i class="far fa-bookmark"></i>';
            favBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleBookmark({ type: 'post', ...post, thumbnail: imgMatch?.[1] || DEFAULT_IMAGE });
            });
            inner.appendChild(favBtn);
        }
        card.appendChild(inner);
        card.addEventListener('click', (e) => {
            if (!e.target.closest('button') && !e.target.closest('.news-bookmark-btn')) {
                openFullModal({ type: 'post', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game, labels: post.labels });
            }
        });
        return card;
    }

    function extractAllowed(body) {
        const match = /<!--\s*allowed:\s*(.*?)\s*-->/i.exec(body);
        return match ? match[1].trim() : null;
    }

    function extractSummary(body) {
        const match = /<!--\s*summary:\s*(.*?)\s*-->/i.exec(body);
        return match ? match[1].trim() : null;
    }

    function decryptPrivateBody(encBase64, allowedStr) {
        if (!allowedStr) return encBase64;
        try {
            const encrypted = decodeURIComponent(escape(atob(encBase64)));
            let key = '';
            let hash = 0;
            for (let i = 0; i < allowedStr.length; i++) {
                hash = ((hash << 5) - hash) + allowedStr.charCodeAt(i);
                hash |= 0;
            }
            const keyStr = Math.abs(hash).toString(16);
            let result = '';
            for (let i = 0; i < encrypted.length; i++) {
                result += String.fromCharCode(encrypted.charCodeAt(i) ^ keyStr.charCodeAt(i % keyStr.length));
            }
            return result;
        } catch (e) {
            console.warn('Decrypt failed', e);
            return encBase64;
        }
    }
})();