// storage.js — хранилище закладок через GitHub Gist
(function() {
    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium bookmarks storage';
    const STORAGE_KEY_PREFIX = 'bookmarks_';

    let currentUser = null;
    let currentToken = null;
    let gistId = null;

    // Инициализация при входе
    function init() {
        currentUser = GithubAuth.getCurrentUser();
        currentToken = GithubAuth.getToken();
        if (currentUser && currentToken) {
            loadGistId();
        }
    }

    window.addEventListener('github-login-success', () => {
        currentUser = GithubAuth.getCurrentUser();
        currentToken = GithubAuth.getToken();
        loadGistId();
    });

    window.addEventListener('github-logout', () => {
        currentUser = null;
        currentToken = null;
        gistId = null;
    });

    function getStorageKey() {
        return `${STORAGE_KEY_PREFIX}${currentUser}`;
    }

    function loadGistId() {
        const stored = localStorage.getItem(getStorageKey());
        if (stored) {
            try {
                const data = JSON.parse(stored);
                gistId = data.gistId;
            } catch (e) {}
        }
    }

    function saveGistId(id) {
        gistId = id;
        localStorage.setItem(getStorageKey(), JSON.stringify({ gistId: id }));
    }

    async function getOrCreateGist() {
        const token = currentToken;
        if (!token) throw new Error('No token');

        if (gistId) {
            // Проверяем существование
            try {
                const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (resp.ok) return gistId;
            } catch (e) {}
        }

        // Ищем существующий gist по описанию
        try {
            const resp = await fetch('https://api.github.com/gists', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const gists = await resp.json();
            const existing = gists.find(g => g.description === GIST_DESCRIPTION && g.files[GIST_FILENAME]);
            if (existing) {
                saveGistId(existing.id);
                return existing.id;
            }
        } catch (e) {}

        // Создаём новый
        const createResp = await fetch('https://api.github.com/gists', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                description: GIST_DESCRIPTION,
                public: false,
                files: {
                    [GIST_FILENAME]: {
                        content: JSON.stringify({ bookmarks: [] })
                    }
                }
            })
        });
        const gist = await createResp.json();
        if (!gist.id) throw new Error('Failed to create gist');
        saveGistId(gist.id);
        return gist.id;
    }

    async function loadBookmarks() {
        const token = currentToken;
        if (!token) return [];

        try {
            const gistId = await getOrCreateGist();
            const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const gist = await resp.json();
            const file = gist.files[GIST_FILENAME];
            if (!file) return [];
            const content = JSON.parse(file.content);
            return content.bookmarks || [];
        } catch (e) {
            console.warn('Failed to load bookmarks', e);
            return [];
        }
    }

    async function saveBookmarks(bookmarks) {
        const token = currentToken;
        if (!token) throw new Error('No token');

        const gistId = await getOrCreateGist();
        const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: {
                    [GIST_FILENAME]: {
                        content: JSON.stringify({ bookmarks })
                    }
                }
            })
        });
        if (!resp.ok) throw new Error('Failed to save bookmarks');
    }

    async function addBookmark(bookmark) {
        if (!currentUser) {
            UIUtils.showToast('Войдите в аккаунт', 'error');
            return;
        }
        const bookmarks = await loadBookmarks();
        // Проверяем дубликат по URL
        if (bookmarks.some(b => b.url === bookmark.url)) {
            UIUtils.showToast('Уже в избранном', 'info');
            return;
        }
        bookmark.id = Date.now() + '-' + Math.random().toString(36);
        bookmark.added = new Date().toISOString();
        bookmarks.push(bookmark);
        await saveBookmarks(bookmarks);
    }

    async function removeBookmark(bookmarkId) {
        const bookmarks = await loadBookmarks();
        const filtered = bookmarks.filter(b => b.id !== bookmarkId);
        await saveBookmarks(filtered);
    }

    function extractVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
            /youtube\.com\/embed\/([^&\n?#]+)/
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    function isVideoUrl(url) {
        return extractVideoId(url) !== null || /\.(mp4|webm|ogg)(\?|$)/i.test(url);
    }

    function renderBookmarkCard(bookmark, onDelete) {
        const card = document.createElement('div');
        card.className = 'project-card-link';
        card.style.cursor = 'pointer';
        card.style.marginBottom = '16px';

        const inner = document.createElement('div');
        inner.className = 'project-card';
        inner.style.position = 'relative';

        const videoId = extractVideoId(bookmark.url);
        const isVideo = videoId !== null;

        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'image-wrapper';
        let thumbnail = bookmark.thumbnail || 'images/default-news.webp';
        if (isVideo && !bookmark.thumbnail) {
            thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        }
        const img = document.createElement('img');
        img.src = thumbnail;
        img.alt = bookmark.title;
        img.loading = 'lazy';
        img.className = 'project-image';
        img.onerror = () => img.src = 'images/default-news.webp';
        imgWrapper.appendChild(img);
        inner.appendChild(imgWrapper);

        const title = document.createElement('h3');
        title.textContent = bookmark.title.length > 60 ? bookmark.title.substring(0,60)+'…' : bookmark.title;
        inner.appendChild(title);

        const meta = document.createElement('p');
        meta.className = 'text-secondary';
        meta.style.fontSize = '12px';
        meta.innerHTML = `${bookmark.author ? `<i class="fas fa-user"></i> ${GithubCore.escapeHtml(bookmark.author)} · ` : ''}<i class="fas fa-calendar-alt"></i> ${new Date(bookmark.added).toLocaleDateString()}`;
        inner.appendChild(meta);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'bookmark-delete';
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        deleteBtn.style.position = 'absolute';
        deleteBtn.style.top = '8px';
        deleteBtn.style.right = '8px';
        deleteBtn.style.background = 'rgba(0,0,0,0.6)';
        deleteBtn.style.color = 'white';
        deleteBtn.style.border = 'none';
        deleteBtn.style.borderRadius = '50%';
        deleteBtn.style.width = '30px';
        deleteBtn.style.height = '30px';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.zIndex = '2';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Удалить из избранного?')) {
                onDelete(bookmark.id);
            }
        });
        inner.appendChild(deleteBtn);

        card.appendChild(inner);

        card.addEventListener('click', () => {
            if (isVideo) {
                // Открываем плеер в модалке
                openVideoModal(videoId, bookmark.title);
            } else {
                window.open(bookmark.url, '_blank');
            }
        });

        return card;
    }

    function openVideoModal(videoId, title) {
        const content = `
            <div class="video-embed" style="width:100%;">
                <iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen style="width:100%; aspect-ratio:16/9;"></iframe>
            </div>
        `;
        UIUtils.createModal(title || 'Видео', content, { size: 'full' });
    }

    async function openStorageModal() {
        if (!currentUser) {
            UIUtils.showToast('Войдите в аккаунт', 'error');
            return;
        }

        const contentHtml = `
            <div id="bookmarks-container" style="display:flex; flex-direction:column; gap:16px;">
                <div style="display:flex; gap:10px; margin-bottom:20px;">
                    <input type="url" id="new-bookmark-url" placeholder="Вставьте ссылку..." style="flex:1; padding:10px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                    <input type="text" id="new-bookmark-title" placeholder="Название (необязательно)" style="flex:1; padding:10px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                    <button class="button" id="add-bookmark-btn"><i class="fas fa-plus"></i> Добавить</button>
                </div>
                <div class="projects-grid" id="bookmarks-grid">
                    <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>
                </div>
                <p class="text-secondary small" style="margin-top:20px;">
                    <i class="fas fa-info-circle"></i> Закладки хранятся в вашем приватном GitHub Gist. Вы можете добавлять любые ссылки, включая видео с YouTube.
                </p>
            </div>
        `;

        const { modal, closeModal } = UIUtils.createModal('Хранилище', contentHtml, { size: 'full' });

        const grid = modal.querySelector('#bookmarks-grid');
        const urlInput = modal.querySelector('#new-bookmark-url');
        const titleInput = modal.querySelector('#new-bookmark-title');
        const addBtn = modal.querySelector('#add-bookmark-btn');

        async function refreshGrid() {
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>';
            try {
                const bookmarks = await loadBookmarks();
                if (bookmarks.length === 0) {
                    grid.innerHTML = '<div class="empty-state"><i class="fas fa-bookmark"></i><p>Нет сохранённых закладок</p></div>';
                    return;
                }
                grid.innerHTML = '';
                bookmarks.sort((a,b) => new Date(b.added) - new Date(a.added));
                bookmarks.forEach(b => {
                    const card = renderBookmarkCard(b, async (id) => {
                        await removeBookmark(id);
                        refreshGrid();
                    });
                    grid.appendChild(card);
                });
            } catch (e) {
                grid.innerHTML = '<p class="error-message">Ошибка загрузки</p>';
            }
        }

        refreshGrid();

        addBtn.addEventListener('click', async () => {
            const url = urlInput.value.trim();
            if (!url) {
                UIUtils.showToast('Введите ссылку', 'error');
                return;
            }
            let title = titleInput.value.trim();
            if (!title) {
                // Пытаемся получить заголовок страницы
                try {
                    const resp = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
                    const data = await resp.json();
                    const doc = new DOMParser().parseFromString(data.contents, 'text/html');
                    title = doc.querySelector('title')?.textContent || url;
                } catch (e) {
                    title = url;
                }
            }
            addBtn.disabled = true;
            try {
                await addBookmark({
                    url,
                    title,
                    type: isVideoUrl(url) ? 'video' : 'link',
                    thumbnail: extractVideoId(url) ? `https://img.youtube.com/vi/${extractVideoId(url)}/mqdefault.jpg` : null
                });
                UIUtils.showToast('Добавлено', 'success');
                urlInput.value = '';
                titleInput.value = '';
                refreshGrid();
            } catch (e) {
                UIUtils.showToast('Ошибка добавления', 'error');
            } finally {
                addBtn.disabled = false;
            }
        });
    }

    // Экспорт
    window.BookmarkStorage = {
        openStorageModal,
        addBookmark,
        loadBookmarks,
        removeBookmark
    };

    // Инициализация после загрузки
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();