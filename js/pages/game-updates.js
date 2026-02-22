// game-updates.js — блок обновлений на страницах игр

(function() {
    const { cacheGet, cacheSet, renderMarkdown, escapeHtml, CONFIG } = GithubCore;
    const { loadIssues, loadIssue, loadComments, addComment, loadReactions, addReaction, removeReaction, closeIssue } = GithubAPI;
    const { renderReactions, renderComments } = UIFeedback;
    const { isAdmin, getCurrentUser } = GithubAuth;

    const DEFAULT_IMAGE = 'images/default-news.jpg';

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
            const issues = await loadIssues({ labels: `type:update,game:${game}`, per_page: 10 });
            posts = issues
                .filter(issue => CONFIG.ALLOWED_AUTHORS.includes(issue.user.login))
                .map(issue => ({
                    number: issue.number,
                    title: issue.title,
                    body: issue.body,
                    date: new Date(issue.created_at),
                    author: issue.user.login,
                    game: game
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
            const card = createUpdateCard(post);
            container.appendChild(card);
        });
    }

    function createUpdateCard(post) {
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
                // Закрываем другие раскрытые карточки
                document.querySelectorAll('#game-updates .feedback-item-details[style*="display: block"]').forEach(el => {
                    el.style.display = 'none';
                });

                if (!detailsDiv.hasChildNodes()) {
                    await loadUpdateDetails(post, detailsDiv);
                }
                detailsDiv.style.display = 'block';
            } else {
                detailsDiv.style.display = 'none';
            }
        });

        return card;
    }

    async function loadUpdateDetails(post, container) {
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>`;

        try {
            const issue = await loadIssue(post.number);
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'spoiler-content';
            bodyDiv.innerHTML = renderMarkdown(issue.body);

            const reactionsDiv = document.createElement('div');
            reactionsDiv.className = 'reactions-container';

            const commentsDiv = document.createElement('div');
            commentsDiv.className = 'feedback-comments';
            commentsDiv.id = `comments-${post.number}`;

            const commentForm = document.createElement('div');
            commentForm.className = 'comment-form';
            commentForm.dataset.issue = post.number;
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
            const reactions = await loadReactions(post.number);
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

            renderReactions(reactionsDiv, post.number, reactions, currentUser, handleAdd, handleRemove);

            // Комментарии
            const comments = await loadComments(post.number);
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
                    await addComment(post.number, comment);
                    const updatedComments = await loadComments(post.number);
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
                    window.AdminNews.openEditForm('update', {
                        number: post.number,
                        title: issue.title,
                        body: issue.body,
                        game: post.game
                    });
                });

                adminActions.querySelector('.close-issue').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (!confirm('Вы уверены, что хотите закрыть это обновление?')) return;
                    try {
                        await closeIssue(post.number);
                        container.closest('.project-card-link').remove(); // удаляем карточку
                    } catch (err) {
                        alert('Ошибка при закрытии');
                    }
                });
            }

        } catch (err) {
            console.error('Ошибка загрузки деталей обновления', err);
            container.innerHTML = '<p class="error-message">Не удалось загрузить содержимое.</p>';
        }
    }

    function stripHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }
})();