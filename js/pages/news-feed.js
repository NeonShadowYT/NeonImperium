// news-feed.js — лента новостей на главной (новости + обновления) с видео

(function() {
    const { cacheGet, cacheSet, escapeHtml, renderMarkdown, CONFIG, deduplicateByNumber, createAbortable, stripHtml } = GithubCore;
    const { loadIssues, loadIssue, loadComments, addComment, loadReactions, addReaction, removeReaction, closeIssue } = GithubAPI;
    const { renderReactions, renderComments, openFullModal } = UIFeedback;
    const { isAdmin, getCurrentUser } = GithubAuth;

    const YT_CHANNELS = [
        { id: 'UC2pH2qNfh2sEAeYEGs1k_Lg', name: 'Neon Shadow' },
        { id: 'UCxuByf9jKs6ijiJyrMKBzdA', name: 'Оборотень' },
        { id: 'UCQKVSv62dLsK3QnfIke24uQ', name: 'Golden Creeper' },
        { id: 'UCcuqf3fNtZ2UP5MO89kVKLw', name: 'Новый канал' } // добавлен
    ];
    const DEFAULT_IMAGE = 'images/default-news.jpg';
    const RETRY_COOLDOWN = 60000;

    let container, posts = [], videos = [], postsLoaded = false, videosLoaded = false;
    let currentUser = null, currentAbort = null;
    let videoLoading = false, videoError = false;

    document.addEventListener('DOMContentLoaded', () => {
        const section = document.getElementById('news-section');
        if (!section) return;
        // Создаём заголовок и описание, если их нет
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
            currentUser = getCurrentUser();
            loadNewsFeed();
        }
        window.addEventListener('github-login-success', (e) => { currentUser = e.detail.login; refreshNewsFeed(); });
        window.addEventListener('github-logout', () => { currentUser = null; refreshNewsFeed(); });
    });

    window.refreshNewsFeed = () => {
        if (container) {
            if (currentAbort) currentAbort.controller.abort();
            posts = []; videos = []; postsLoaded = false; videosLoaded = false;
            videoLoading = false; videoError = false;
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
        renderMixed();
        loadVideosAsync();
    }

    async function loadVideosAsync() {
        if (videoLoading) return;
        videoLoading = true;
        videoError = false;
        try {
            videos = await loadVideos();
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

    function renderMixed() {
        if (!postsLoaded) {
            container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка новостей...</p></div>`;
            return;
        }

        const grid = document.createElement('div'); grid.className = 'projects-grid';
        
        posts.slice(0, 6).forEach(post => {
            grid.appendChild(createPostCard(post));
        });

        if (videoLoading) {
            for (let i = 0; i < 3; i++) {
                grid.appendChild(createSkeletonCard());
            }
        } else if (videoError && videos.length === 0) {
            const errorCard = document.createElement('div');
            errorCard.className = 'project-card';
            errorCard.style.display = 'flex';
            errorCard.style.flexDirection = 'column';
            errorCard.style.alignItems = 'center';
            errorCard.style.justifyContent = 'center';
            errorCard.style.minHeight = '200px';
            errorCard.innerHTML = `
                <p class="text-secondary">Не удалось загрузить видео</p>
                <button class="button small" id="retry-videos">Повторить</button>
            `;
            grid.appendChild(errorCard);
            setTimeout(() => {
                document.getElementById('retry-videos')?.addEventListener('click', () => {
                    loadVideosAsync();
                });
            }, 0);
        } else {
            videos.slice(0, 3).forEach(video => {
                grid.appendChild(createVideoCard(video));
            });
        }

        container.innerHTML = '';
        container.appendChild(grid);
    }

    function createSkeletonCard() {
        const card = document.createElement('div'); card.className = 'project-card';
        card.style.background = 'var(--bg-inner-gradient)';
        card.style.opacity = '0.5';
        card.innerHTML = `
            <div class="image-wrapper" style="background: var(--border);"></div>
            <div style="height: 20px; width: 80%; background: var(--border); margin: 10px 0;"></div>
            <div style="height: 14px; width: 60%; background: var(--border);"></div>
        `;
        return card;
    }

    async function loadVideos() {
        const cacheKey = 'youtube_videos_v2';
        const cached = cacheGet(cacheKey);
        if (cached) return cached.map(v => ({ ...v, date: new Date(v.date) }));

        const { controller, timeoutId } = createAbortable(15000);
        currentAbort = { controller };
        try {
            // Расширенный список инстансов Invidious
            const instances = [
                'invidious.privacyredirect.com',
                'yewtu.be',
                'inv.riverside.rocks',
                'invidious.snopyta.org',
                'vid.puffyan.us',
                'invidious.xyz',
                'invidious.kavin.rocks',
                'invidious.ggc-project.de',
                'invidious.tiekoetter.com'
            ];
            let videos = [];
            for (const instance of instances) {
                try {
                    const fetched = await fetchFromInvidious(instance, controller.signal);
                    if (fetched.length) { videos = fetched; break; }
                } catch { continue; }
            }
            if (!videos.length) videos = await fetchViaRSS(controller.signal);
            const serialized = videos.map(v => ({ ...v, date: v.published.toISOString() }));
            cacheSet(cacheKey, serialized);
            return videos;
        } catch (err) {
            if (err.name === 'AbortError') {
                UIUtils.showToast('Таймаут при загрузке видео', 'warning');
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
        }
    }

    async function fetchFromInvidious(instance, signal) {
        const all = [];
        for (const channel of YT_CHANNELS) {
            const res = await fetch(`https://${instance}/api/v1/channels/${channel.id}/videos`, { signal });
            if (!res.ok) continue;
            const data = await res.json();
            const channelVids = data.slice(0, 5).map(v => ({
                type: 'video', id: v.videoId, title: v.title, author: channel.name,
                date: new Date(v.published * 1000), published: new Date(v.published * 1000),
                thumbnail: v.videoThumbnails?.find(t => t.quality === 'medium')?.url || '',
                channel: channel.name
            }));
            all.push(...channelVids);
        }
        return all.sort((a,b) => b.date - a.date).slice(0, 10);
    }

    async function fetchViaRSS(signal) {
        const all = [];
        for (const channel of YT_CHANNELS) {
            try {
                const url = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`)}`;
                const res = await fetch(url, { signal });
                if (!res.ok) continue;
                const data = await res.json();
                const parser = new DOMParser();
                const xml = parser.parseFromString(data.contents, 'text/xml');
                const entries = Array.from(xml.querySelectorAll('entry')).slice(0, 3);
                entries.forEach(entry => {
                    const title = entry.querySelector('title')?.textContent || 'Без названия';
                    const videoId = entry.querySelector('yt\\:videoId, videoId')?.textContent || '';
                    const published = new Date(entry.querySelector('published')?.textContent || Date.now());
                    const mediaGroup = entry.querySelector('media\\:group, group');
                    const thumbnail = mediaGroup?.querySelector('media\\:thumbnail, thumbnail')?.getAttribute('url') || '';
                    all.push({ type: 'video', id: videoId, title, author: channel.name, date: published, published, thumbnail, channel: channel.name });
                });
            } catch { continue; }
        }
        return all.sort((a,b) => b.date - a.date).slice(0, 10);
    }

    async function loadPosts() {
        const cacheKey = 'posts_news+update_v2';
        const cached = cacheGet(cacheKey);
        if (cached) return cached.map(p => ({ ...p, date: new Date(p.date) }));

        const { controller, timeoutId } = createAbortable(10000);
        currentAbort = { controller };
        try {
            const [newsIssues, updateIssues] = await Promise.all([
                loadIssues({ labels: 'type:news', per_page: 20, signal: controller.signal }),
                loadIssues({ labels: 'type:update', per_page: 20, signal: controller.signal })
            ]);
            const allIssues = deduplicateByNumber([...newsIssues, ...updateIssues]);
            const posts = allIssues
                .filter(issue => CONFIG.ALLOWED_AUTHORS.includes(issue.user.login))
                .map(issue => ({
                    type: 'post', number: issue.number, title: issue.title, body: issue.body,
                    author: issue.user.login, date: new Date(issue.created_at),
                    labels: issue.labels.map(l => l.name),
                    game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null
                }));
            const serialized = posts.map(p => ({ ...p, date: p.date.toISOString() }));
            cacheSet(cacheKey, serialized);
            return posts;
        } catch (err) {
            if (err.name === 'AbortError') {
                UIUtils.showToast('Таймаут при загрузке новостей', 'warning');
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
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
        const meta = document.createElement('p'); meta.className = 'text-secondary'; meta.style.fontSize='12px'; meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(video.author)} · <i class="fas fa-calendar-alt"></i> ${video.date.toLocaleDateString()}`;
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
        const meta = document.createElement('p'); meta.className = 'text-secondary'; meta.style.fontSize='12px'; meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(post.author)} · <i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`;
        const preview = document.createElement('p'); preview.className = 'text-secondary'; preview.style.fontSize='13px'; preview.style.overflow='hidden'; preview.style.display='-webkit-box'; preview.style.webkitLineClamp='2'; preview.style.webkitBoxOrient='vertical'; preview.textContent = stripHtml(post.body).substring(0,120)+'…';
        inner.append(imgWrapper, title, meta, preview); card.appendChild(inner);
        card.addEventListener('click', (e) => { e.preventDefault(); openFullModal({ type: 'post', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game, labels: post.labels }); });
        return card;
    }
})();