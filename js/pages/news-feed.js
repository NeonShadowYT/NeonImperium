// news-feed.js — лента новостей на главной (type:news и type:update)

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
    const PROXY_URL = 'https://api.allorigins.win/get?url=';
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

        try {
            posts = await loadPosts();
            postsLoaded = true;
            postsError = false;
        } catch (err) {
            console.warn('Posts failed', err);
            postsLoaded = true;
            postsError = true;
        }

        try {
            videos = await loadVideos();
            videosLoaded = true;
            videosError = false;
        } catch (err) {
            console.warn('Videos failed', err);
            videosLoaded = true;
            videosError = true;
        }

        renderMixed();
    }

    function renderMixed() {
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
    }

    async function loadVideos() {
        // без изменений
    }

    async function fetchChannelFeed(channel) {
        // без изменений
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
        // без изменений
    }

    function createPostCard(post) {
        const card = document.createElement('div');
        card.className = 'project-card-link';
        card.style.cursor = 'pointer';

        const inner = document.createElement('div');
        inner.className = 'project-card tilt-card';

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
                document.querySelectorAll('#news-feed .feedback-item-details[style*="display: block"]').forEach(el => {
                    el.style.display = 'none';
                });

                if (!detailsDiv.hasChildNodes()) {
                    await loadPostDetails(post, detailsDiv);
                }
                detailsDiv.style.display = 'block';
            } else {
                detailsDiv.style.display = 'none';
            }
        });

        return card;
    }

    async function loadPostDetails(post, container) {
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>`;

        try {
            const issue = await loadIssue(post.id);
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'spoiler-content';
            bodyDiv.innerHTML = renderMarkdown(issue.body);

            const reactionsDiv = document.createElement('div');
            reactionsDiv.className = 'reactions-container';

            const commentsDiv = document.createElement('div');
            commentsDiv.className = 'feedback-comments';
            commentsDiv.id = `comments-${post.id}`;

            const commentForm = document.createElement('div');
            commentForm.className = 'comment-form';
            commentForm.dataset.issue = post.id;
            commentForm.innerHTML = `
                <input type="text" class="comment-input" placeholder="Написать комментарий...">
                <button class="button comment-submit">Отправить</button>
            `;

            // Кнопки для администраторов
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
            container.appendChild(commentForm);

            // Реакции
            const reactions = await loadReactions(post.id);
            const currentUser = getCurrentUser();

            const handleAdd = async (num, content) => {
                await addReaction(num, content);
                const updated = await loadReactions(num);
                renderReactions(reactionsDiv, num, updated, currentUser, handleAdd, handleRemove);
            };
            const handleRemove = async (num, reactionId) => {
                await removeReaction(num, reactionId);
                const updated = await loadReactions(num);
                renderReactions(reactionsDiv, num, updated, currentUser, handleAdd, handleRemove);
            };

            renderReactions(reactionsDiv, post.id, reactions, currentUser, handleAdd, handleRemove);

            // Комментарии
            const comments = await loadComments(post.id);
            renderComments(commentsDiv, comments);

            // Обработчик отправки комментария
            commentForm.querySelector('.comment-submit').addEventListener('click', async (e) => {
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
                    // Определяем тип поста
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
                        container.closest('.project-card-link').remove(); // удаляем карточку
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