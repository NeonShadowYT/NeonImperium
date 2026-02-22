// news-feed.js — лента новостей на главной (сначала посты, потом видео)

(function() {
    const { cacheGet, cacheSet, renderMarkdown, escapeHtml, CONFIG } = GithubCore;
    const { loadIssues, loadIssue, loadReactions, addReaction, removeReaction } = GithubAPI;
    const { renderReactions } = UIFeedback;

    const YT_CHANNELS = [
        { id: 'UC2pH2qNfh2sEAeYEGs1k_Lg', name: 'Neon Shadow' },
        { id: 'UCxuByf9jKs6ijiJyrMKBzdA', name: 'Оборотень' },
        { id: 'UCQKVSv62dLsK3QnfIke24uQ', name: 'Golden Creeper' }
    ];
    const PROXY_URL = 'https://api.allorigins.win/get?url=';
    const DEFAULT_IMAGE = 'images/default-news.jpg';

    let container;
    let posts = [];
    let videos = [];
    let postsLoaded = false;
    let videosLoaded = false;

    document.addEventListener('DOMContentLoaded', () => {
        container = document.getElementById('news-feed');
        if (container) {
            loadNewsFeed();
        }
    });

    window.refreshNewsFeed = () => {
        if (container) loadNewsFeed();
    };

    async function loadNewsFeed() {
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка новостей...</p></div>`;

        // Сначала загружаем посты (они из GitHub, обычно быстрее)
        loadPosts().then(p => {
            posts = p;
            postsLoaded = true;
            renderMixed();
        }).catch(err => {
            console.warn('Posts failed', err);
            postsLoaded = true; // всё равно попытаемся рендерить, но с пустыми постами
            renderMixed();
        });

        // Параллельно загружаем видео
        loadVideos().then(v => {
            videos = v;
            videosLoaded = true;
            renderMixed();
        }).catch(err => {
            console.warn('Videos failed', err);
            videosLoaded = true;
            renderMixed();
        });
    }

    function renderMixed() {
        // Ждём хотя бы одну загрузку
        if (!postsLoaded && !videosLoaded) return;

        const mixed = [...posts, ...videos].sort((a, b) => b.date - a.date).slice(0, 6);

        if (mixed.length === 0) {
            container.innerHTML = `<p class="text-secondary">Нет новостей.</p>`;
            return;
        }

        // Если это первый рендер, очищаем контейнер
        if (container.querySelector('.loading-spinner')) {
            container.innerHTML = '';
        }

        // Добавляем карточки, которых ещё нет (по id)
        const existingIds = new Set();
        container.querySelectorAll('[data-news-id]').forEach(el => {
            existingIds.add(el.dataset.newsId);
        });

        mixed.forEach(item => {
            const id = item.type === 'video' ? `yt-${item.id}` : `post-${item.id}`;
            if (!existingIds.has(id)) {
                const card = item.type === 'video' ? createVideoCard(item) : createPostCard(item);
                card.dataset.newsId = id;
                container.appendChild(card);
                existingIds.add(id);
            }
        });

        // Если после добавления карточек их меньше 6, можно показать сообщение, но у нас уже есть
    }

    async function loadVideos() {
        const cacheKey = 'youtube_videos';
        const cached = cacheGet(cacheKey);
        if (cached) return cached.map(v => ({ ...v, date: new Date(v.date) }));

        const promises = YT_CHANNELS.map(channel => fetchChannelFeed(channel));
        const results = await Promise.allSettled(promises);
        const videos = results
            .filter(r => r.status === 'fulfilled')
            .flatMap(r => r.value)
            .sort((a, b) => b.published - a.published)
            .slice(0, 10);

        const serialized = videos.map(v => ({
            ...v,
            date: v.published.toISOString()
        }));
        cacheSet(cacheKey, serialized);
        return videos;
    }

    async function fetchChannelFeed(channel) {
        try {
            const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;
            const response = await fetch(PROXY_URL + encodeURIComponent(url));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const parser = new DOMParser();
            const xml = parser.parseFromString(data.contents, 'text/xml');
            const entries = Array.from(xml.querySelectorAll('entry'));
            return entries.map(entry => {
                const title = entry.querySelector('title')?.textContent || 'Без названия';
                const videoId = entry.getElementsByTagNameNS('*', 'videoId')[0]?.textContent || '';
                const published = new Date(entry.querySelector('published')?.textContent || Date.now());
                const author = entry.querySelector('author name')?.textContent || channel.name;
                const mediaGroup = entry.getElementsByTagNameNS('*', 'group')[0];
                const thumbnail = mediaGroup?.getElementsByTagNameNS('*', 'thumbnail')[0]?.getAttribute('url') || '';
                return {
                    type: 'video',
                    id: videoId,
                    title,
                    author,
                    date: published,
                    thumbnail,
                    channel: channel.name
                };
            });
        } catch (err) {
            console.warn('Ошибка загрузки канала', channel.id, err);
            return [];
        }
    }

    async function loadPosts() {
        const cacheKey = 'posts_news+update';
        const cached = cacheGet(cacheKey);
        if (cached) return cached.map(p => ({ ...p, date: new Date(p.date) }));

        // Загружаем новости и обновления отдельно (OR)
        const [newsIssues, updateIssues] = await Promise.all([
            loadIssues({ labels: 'news', per_page: 20 }),
            loadIssues({ labels: 'update', per_page: 20 })
        ]);

        const allIssues = [...newsIssues, ...updateIssues];
        // Убираем дубликаты по номеру
        const unique = {};
        allIssues.forEach(issue => unique[issue.number] = issue);
        const issues = Object.values(unique);

        const posts = issues
            .filter(issue => CONFIG.ALLOWED_AUTHORS.includes(issue.user.login))
            .map(issue => ({
                type: 'post',
                id: issue.number,
                title: issue.title,
                body: issue.body,
                author: issue.user.login,
                date: new Date(issue.created_at),
                labels: issue.labels.map(l => l.name)
            }));

        const serialized = posts.map(p => ({ ...p, date: p.date.toISOString() }));
        cacheSet(cacheKey, serialized);
        return posts;
    }

    function createVideoCard(video) {
        const card = document.createElement('a');
        card.href = `https://www.youtube.com/watch?v=${video.id}`;
        card.target = '_blank';
        card.className = 'project-card-link';

        const inner = document.createElement('div');
        inner.className = 'project-card tilt-card';

        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'image-wrapper';
        const img = document.createElement('img');
        img.src = video.thumbnail;
        img.alt = video.title;
        img.loading = 'lazy';
        img.className = 'project-image';
        imgWrapper.appendChild(img);

        const title = document.createElement('h3');
        title.textContent = video.title.length > 70 ? video.title.substring(0, 70) + '…' : video.title;

        const meta = document.createElement('p');
        meta.className = 'text-secondary';
        meta.style.fontSize = '12px';
        meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(video.author)} · <i class="fas fa-calendar-alt"></i> ${video.date.toLocaleDateString()}`;

        const button = document.createElement('span');
        button.className = 'button';
        button.innerHTML = '<i class="fas fa-play"></i> Смотреть';

        inner.appendChild(imgWrapper);
        inner.appendChild(title);
        inner.appendChild(meta);
        inner.appendChild(button);
        card.appendChild(inner);
        return card;
    }

    function createPostCard(post) {
        const card = document.createElement('div');
        card.className = 'project-card-link';
        card.style.cursor = 'pointer';

        const inner = document.createElement('div');
        inner.className = 'project-card tilt-card';

        // Поиск первого изображения в теле для превью
        const imgMatch = post.body.match(/!\[.*?\]\((.*?)\)/);
        const thumbnail = imgMatch ? imgMatch[1] : DEFAULT_IMAGE;

        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'image-wrapper';
        const img = document.createElement('img');
        img.src = thumbnail;
        img.alt = post.title;
        img.loading = 'lazy';
        img.className = 'project-image';
        img.onerror = () => { img.src = DEFAULT_IMAGE; };
        imgWrapper.appendChild(img);

        const title = document.createElement('h3');
        title.textContent = post.title.length > 70 ? post.title.substring(0, 70) + '…' : post.title;

        const meta = document.createElement('p');
        meta.className = 'text-secondary';
        meta.style.fontSize = '12px';
        meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(post.author)} · <i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`;

        const preview = document.createElement('p');
        preview.className = 'text-secondary';
        preview.style.fontSize = '13px';
        preview.style.overflow = 'hidden';
        preview.style.display = '-webkit-box';
        preview.style.webkitLineClamp = '2';
        preview.style.webkitBoxOrient = 'vertical';
        preview.textContent = stripHtml(post.body).substring(0, 120) + '…';

        inner.appendChild(imgWrapper);
        inner.appendChild(title);
        inner.appendChild(meta);
        inner.appendChild(preview);

        card.appendChild(inner);

        // Контейнер для раскрытого содержимого
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'feedback-item-details';
        detailsDiv.style.display = 'none';
        detailsDiv.style.marginTop = '20px';
        detailsDiv.style.paddingTop = '20px';
        detailsDiv.style.borderTop = '1px solid var(--border)';
        card.appendChild(detailsDiv);

        card.addEventListener('click', async (e) => {
            if (e.target.closest('button') || e.target.closest('.reaction-button') || e.target.closest('.reaction-add-btn')) return;

            if (detailsDiv.style.display === 'none') {
                // Закрываем другие раскрытые карточки
                document.querySelectorAll('#news-feed .feedback-item-details[style*="display: block"]').forEach(el => {
                    el.style.display = 'none';
                });

                if (!detailsDiv.hasChildNodes()) {
                    await loadPostDetails(post.id, detailsDiv);
                }
                detailsDiv.style.display = 'block';
            } else {
                detailsDiv.style.display = 'none';
            }
        });

        return card;
    }

    async function loadPostDetails(issueNumber, container) {
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>`;

        try {
            const issue = await loadIssue(issueNumber);
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'spoiler-content';
            bodyDiv.innerHTML = renderMarkdown(issue.body);

            const reactionsDiv = document.createElement('div');
            reactionsDiv.className = 'reactions-container';

            container.innerHTML = '';
            container.appendChild(bodyDiv);
            container.appendChild(reactionsDiv);

            const reactions = await loadReactions(issueNumber);
            const currentUser = GithubAuth.getCurrentUser();

            const addReactionHandler = async (num, content) => {
                await addReaction(num, content);
                const updated = await loadReactions(num);
                renderReactions(reactionsDiv, num, updated, currentUser, addReactionHandler, removeReactionHandler);
            };

            const removeReactionHandler = async (num, reactionId) => {
                await removeReaction(num, reactionId);
                const updated = await loadReactions(num);
                renderReactions(reactionsDiv, num, updated, currentUser, addReactionHandler, removeReactionHandler);
            };

            renderReactions(reactionsDiv, issueNumber, reactions, currentUser, addReactionHandler, removeReactionHandler);
        } catch (err) {
            console.error('Ошибка загрузки деталей поста', err);
            container.innerHTML = '<p class="error-message">Не удалось загрузить содержимое.</p>';
        }
    }

    function stripHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }
})();