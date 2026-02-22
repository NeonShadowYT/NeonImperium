// news-feed.js — лента новостей на главной с модальными окнами

(function() {
    const { cacheGet, cacheSet, renderMarkdown, escapeHtml, CONFIG } = GithubCore;
    const { loadIssues, loadIssue, loadComments, addComment, loadReactions, addReaction, removeReaction, closeIssue } = GithubAPI;
    const { renderReactions, renderComments } = UIFeedback;
    const { isAdmin, getCurrentUser } = GithubAuth;

    const YT_CHANNELS = [
        { id: 'UC2pH2qNfh2sEAeYEGs1k_Lg', name: 'Neon Shadow' },
        { id: 'UCxuByf9jKs6ijiJyrMKBzdA', name: 'Оборотень' },
        { id: 'UCQKVSv62dLsK3QnfIke24uQ', name: 'Golden Creeper' }
    ];
    const YT_FALLBACK_PROXY = 'https://api.allorigins.win/get?url=';
    const DEFAULT_IMAGE = 'images/default-news.jpg';
    const RETRY_COOLDOWN = 60000;

    let container;
    let posts = [];
    let videos = [];
    let postsLoaded = false;
    let videosLoaded = false;
    let postsError = false;
    let videosError = false;
    let currentUser = null;

    document.addEventListener('DOMContentLoaded', () => {
        container = document.getElementById('news-feed');
        if (container) {
            currentUser = getCurrentUser();
            loadNewsFeed();
        }

        window.addEventListener('github-login-success', (e) => {
            currentUser = e.detail.login;
            if (container) refreshNewsFeed();
        });
        window.addEventListener('github-logout', () => {
            currentUser = null;
            if (container) refreshNewsFeed();
        });
    });

    window.refreshNewsFeed = () => {
        if (container) {
            posts = [];
            videos = [];
            postsLoaded = false;
            videosLoaded = false;
            postsError = false;
            videosError = false;
            loadNewsFeed();
        }
    };

    async function loadNewsFeed() {
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка новостей...</p></div>`;

        // Сначала загружаем посты (они критичны)
        try {
            posts = await loadPosts();
            postsLoaded = true;
            postsError = false;
        } catch (err) {
            console.warn('Posts failed', err);
            posts = [];
            postsLoaded = true;
            postsError = true;
        }

        // Отображаем то, что есть (только посты)
        renderMixed();

        // Затем асинхронно загружаем видео
        loadVideosAsync();
    }

    async function loadVideosAsync() {
        try {
            videos = await loadVideos();
            videosLoaded = true;
            videosError = false;
        } catch (err) {
            console.warn('Videos failed', err);
            videos = [];
            videosLoaded = true;
            videosError = true;
        }
        // Перерисовываем уже с видео
        renderMixed();
    }

    function renderMixed() {
        // Проверка на наличие ошибок и пустоту
        if (postsLoaded && videosLoaded && posts.length === 0 && videos.length === 0) {
            container.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Не удалось загрузить новости.</p>
                    <button class="button" id="retry-news-feed">Повторить</button>
                </div>
            `;
            document.getElementById('retry-news-feed')?.addEventListener('click', () => {
                const lastRetry = localStorage.getItem('news_retry_time');
                if (lastRetry && Date.now() - parseInt(lastRetry) < RETRY_COOLDOWN) {
                    const remaining = Math.ceil((RETRY_COOLDOWN - (Date.now() - parseInt(lastRetry))) / 1000);
                    alert(`Повтор доступен через ${remaining} сек.`);
                    return;
                }
                localStorage.setItem('news_retry_time', Date.now().toString());
                refreshNewsFeed();
            });
            return;
        }

        const mixed = [...posts, ...videos].sort((a, b) => b.date - a.date).slice(0, 6);

        if (container.querySelector('.loading-spinner')) {
            container.innerHTML = '';
        }

        if (mixed.length === 0) {
            container.innerHTML = `<p class="text-secondary">Нет новостей.</p>`;
            return;
        }

        // Создаём сетку карточек
        const grid = document.createElement('div');
        grid.className = 'projects-grid'; // используем ту же сетку, что и для проектов
        container.appendChild(grid);

        mixed.forEach(item => {
            const card = item.type === 'video' ? createVideoCard(item) : createPostCard(item);
            grid.appendChild(card);
        });
    }

    async function loadVideos() {
        const cacheKey = 'youtube_videos';
        const cached = cacheGet(cacheKey);
        if (cached) return cached.map(v => ({ ...v, date: new Date(v.date) }));

        const promises = YT_CHANNELS.map(channel => fetchChannelFeedWithFallback(channel));
        const results = await Promise.allSettled(promises);
        const videos = results
            .filter(r => r.status === 'fulfilled')
            .flatMap(r => r.value)
            .filter(v => v && v.id) // отфильтровываем пустые результаты
            .sort((a, b) => b.published - a.published)
            .slice(0, 10);

        const serialized = videos.map(v => ({
            ...v,
            date: v.published.toISOString()
        }));
        cacheSet(cacheKey, serialized);
        return videos;
    }

    async function fetchChannelFeedWithFallback(channel) {
        // Попытка 1: RSS через прокси
        try {
            return await fetchChannelFeedRSS(channel);
        } catch (rssError) {
            console.warn(`RSS failed for ${channel.id}, trying fallback`, rssError);
            // Попытка 2: Используем yt-dlp прокси (если доступен)
            try {
                return await fetchChannelFeedYtDlp(channel);
            } catch (ytdlpError) {
                console.warn(`yt-dlp fallback also failed for ${channel.id}`, ytdlpError);
                return []; // возвращаем пустой массив, чтобы не ломать всё
            }
        }
    }

    async function fetchChannelFeedRSS(channel) {
        const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;
        const response = await fetch(YT_FALLBACK_PROXY + encodeURIComponent(url));
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
                published,
                thumbnail,
                channel: channel.name
            };
        });
    }

    async function fetchChannelFeedYtDlp(channel) {
        // Используем публичный прокси-сервис для yt-dlp (например, invidious)
        // В реальном проекте лучше поднять свой прокси или использовать библиотеку на сервере
        const INVIOUS_URL = 'https://inv.riverside.rocks/api/v1/channels/';
        try {
            const response = await fetch(`${INVIOUS_URL}${channel.id}/videos`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            return data.map(video => ({
                type: 'video',
                id: video.videoId,
                title: video.title,
                author: video.author,
                date: new Date(video.published * 1000),
                published: new Date(video.published * 1000),
                thumbnail: video.videoThumbnails.find(t => t.quality === 'medium')?.url || '',
                channel: channel.name
            }));
        } catch (e) {
            console.warn('Invidious fallback failed', e);
            return [];
        }
    }

    async function loadPosts() {
        const cacheKey = 'posts_news+update';
        const cached = cacheGet(cacheKey);
        if (cached) return cached.map(p => ({ ...p, date: new Date(p.date) }));

        const [newsIssues, updateIssues] = await Promise.all([
            loadIssues({ labels: 'type:news', per_page: 20 }),
            loadIssues({ labels: 'type:update', per_page: 20 })
        ]);

        const allIssues = [...newsIssues, ...updateIssues];
        const unique = {};
        allIssues.forEach(issue => unique[issue.number] = issue);
        const issues = Object.values(unique);

        // Фильтруем по авторам (админы) для обоих типов
        const posts = issues
            .filter(issue => CONFIG.ALLOWED_AUTHORS.includes(issue.user.login))
            .map(issue => ({
                type: 'post',
                id: issue.number,
                title: issue.title,
                body: issue.body,
                author: issue.user.login,
                date: new Date(issue.created_at),
                labels: issue.labels.map(l => l.name),
                game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null
            }));

        const serialized = posts.map(p => ({ ...p, date: p.date.toISOString() }));
        cacheSet(cacheKey, serialized);
        return posts;
    }

    function createVideoCard(video) {
        const card = document.createElement('div');
        card.className = 'project-card-link';
        card.style.cursor = 'pointer';

        const inner = document.createElement('div');
        inner.className = 'project-card tilt-card'; // tilt-card оставлен для видео, если нужно

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

        card.addEventListener('click', (e) => {
            e.preventDefault();
            window.open(`https://www.youtube.com/watch?v=${video.id}`, '_blank');
        });

        return card;
    }

    function createPostCard(post) {
        const card = document.createElement('div');
        card.className = 'project-card-link no-tilt'; // убираем tilt эффект
        card.style.cursor = 'pointer';

        const inner = document.createElement('div');
        inner.className = 'project-card'; // убрали tilt-card

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

        card.addEventListener('click', (e) => {
            e.preventDefault();
            openPostModal(post);
        });

        return card;
    }

    async function openPostModal(post) {
        // Создаём модальное окно
        const modal = document.createElement('div');
        modal.className = 'modal modal-fullscreen';
        modal.innerHTML = `
            <div class="modal-content modal-content-full">
                <div class="modal-header">
                    <h2>${escapeHtml(post.title)}</h2>
                    <button class="modal-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body" id="modal-post-body">
                    <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        const closeModal = () => {
            modal.remove();
            document.body.style.overflow = '';
        };

        modal.querySelector('.modal-close').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        // Добавляем обработку клавиши Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        const container = document.getElementById('modal-post-body');

        try {
            const issue = await loadIssue(post.id);
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'spoiler-content';
            bodyDiv.innerHTML = renderMarkdown(issue.body);

            const reactionsDiv = document.createElement('div');
            reactionsDiv.className = 'reactions-container';

            const commentsDiv = document.createElement('div');
            commentsDiv.className = 'feedback-comments';
            commentsDiv.id = `modal-comments-${post.id}`;

            const commentForm = document.createElement('div');
            commentForm.className = 'comment-form';
            commentForm.dataset.issue = post.id;
            commentForm.innerHTML = `
                <input type="text" class="comment-input" placeholder="Написать комментарий...">
                <button class="button comment-submit">Отправить</button>
            `;

            // Кнопки для администраторов (только иконки)
            const adminActions = document.createElement('div');
            adminActions.className = 'feedback-item-actions';
            if (isAdmin()) {
                adminActions.innerHTML = `
                    <button class="edit-issue" title="Редактировать"><i class="fas fa-edit"></i></button>
                    <button class="close-issue" title="Закрыть"><i class="fas fa-trash-alt"></i></button>
                `;
            }

            container.innerHTML = '';
            container.appendChild(bodyDiv);
            container.appendChild(reactionsDiv);
            if (isAdmin()) container.appendChild(adminActions);
            container.appendChild(commentsDiv);
            if (currentUser) container.appendChild(commentForm); // форму только для авторизованных

            // Реакции
            const reactions = await loadReactions(post.id);
            const handleAdd = async (num, content) => {
                try {
                    await addReaction(num, content);
                    const updated = await loadReactions(num);
                    renderReactions(reactionsDiv, num, updated, currentUser, handleAdd, handleRemove);
                } catch (err) {
                    console.error('Failed to add reaction', err);
                }
            };
            const handleRemove = async (num, reactionId) => {
                try {
                    await removeReaction(num, reactionId);
                    const updated = await loadReactions(num);
                    renderReactions(reactionsDiv, num, updated, currentUser, handleAdd, handleRemove);
                } catch (err) {
                    console.error('Failed to remove reaction', err);
                }
            };
            renderReactions(reactionsDiv, post.id, reactions, currentUser, handleAdd, handleRemove);

            // Комментарии
            const comments = await loadComments(post.id);
            renderComments(commentsDiv, comments);

            // Обработчик отправки комментария
            commentForm.querySelector('.comment-submit')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                const input = commentForm.querySelector('.comment-input');
                const comment = input.value.trim();
                if (!comment) return;

                input.disabled = true;
                e.target.disabled = true;
                try {
                    await addComment(post.id, comment);
                    const updatedComments = await loadComments(post.id);
                    renderComments(commentsDiv, updatedComments);
                    input.value = '';
                } catch (err) {
                    alert('Ошибка при отправке комментария');
                } finally {
                    input.disabled = false;
                    e.target.disabled = false;
                }
            });

            // Обработчики для администраторов
            if (isAdmin()) {
                adminActions.querySelector('.edit-issue').addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeModal();
                    document.removeEventListener('keydown', escHandler);
                    const type = post.labels.includes('type:news') ? 'news' : 'update';
                    window.AdminNews.openEditForm(type, {
                        number: post.id,
                        title: issue.title,
                        body: issue.body,
                        game: post.game
                    });
                });

                adminActions.querySelector('.close-issue').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!confirm('Вы уверены, что хотите закрыть это сообщение?')) return;
                    try {
                        await closeIssue(post.id);
                        closeModal();
                        document.removeEventListener('keydown', escHandler);
                        refreshNewsFeed();
                    } catch (err) {
                        alert('Ошибка при закрытии');
                    }
                });
            }

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