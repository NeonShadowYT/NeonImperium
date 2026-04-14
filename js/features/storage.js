// js/features/storage.js — хранилище закладок через GitHub Gist (исправленная версия)
(function() {
    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium bookmarks storage';
    const STORAGE_KEY_PREFIX = 'bookmarks_';

    let currentUser = null;
    let currentToken = null;
    let gistId = null;

    // Обновление состояния авторизации из GithubAuth
    function updateAuthState() {
        currentUser = GithubAuth.getCurrentUser();
        currentToken = GithubAuth.getToken();
        if (currentUser && currentToken) {
            loadGistId();
        } else {
            gistId = null;
        }
    }

    // Слушаем события входа/выхода
    window.addEventListener('github-login-success', updateAuthState);
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
        if (currentUser) {
            localStorage.setItem(getStorageKey(), JSON.stringify({ gistId: id }));
        }
    }

    // Получить или создать приватный Gist
    async function getOrCreateGist() {
        const token = currentToken;
        if (!token) throw new Error('No token');

        // Если уже есть ID, проверяем, существует ли Gist
        if (gistId) {
            try {
                const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (resp.ok) return gistId;
            } catch (e) {}
        }

        // Ищем существующий Gist по описанию
        try {
            const resp = await fetch('https://api.github.com/gists', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const gists = await resp.json();
            const existing = gists.find(g => g.description === GIST_DESCRIPTION && g.files && g.files[GIST_FILENAME]);
            if (existing) {
                saveGistId(existing.id);
                return existing.id;
            }
        } catch (e) {
            console.warn('Failed to list gists', e);
        }

        // Создаём новый приватный Gist
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
        if (!createResp.ok) {
            const err = await createResp.json();
            throw new Error(`Failed to create gist: ${err.message}`);
        }
        const gist = await createResp.json();
        saveGistId(gist.id);
        return gist.id;
    }

    // Загрузить закладки из Gist
    async function loadBookmarks() {
        const token = currentToken;
        if (!token) return [];

        try {
            const gistId = await getOrCreateGist();
            const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const gist = await resp.json();
            const file = gist.files[GIST_FILENAME];
            if (!file) return [];
            const content = JSON.parse(file.content);
            return content.bookmarks || [];
        } catch (e) {
            console.warn('Failed to load bookmarks', e);
            UIUtils.showToast('Ошибка загрузки закладок: ' + e.message, 'error');
            return [];
        }
    }

    // Сохранить закладки в Gist
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
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.message);
        }
    }

    // Добавить новую закладку
    async function addBookmark(bookmark) {
        if (!currentUser) {
            UIUtils.showToast('Войдите в аккаунт', 'error');
            return;
        }
        const bookmarks = await loadBookmarks();
        if (bookmarks.some(b => b.url === bookmark.url)) {
            UIUtils.showToast('Уже в избранном', 'info');
            return;
        }
        bookmark.id = Date.now() + '-' + Math.random().toString(36);
        bookmark.added = new Date().toISOString();
        bookmarks.push(bookmark);
        await saveBookmarks(bookmarks);
    }

    // Удалить закладку по ID
    async function removeBookmark(bookmarkId) {
        const bookmarks = await loadBookmarks();
        const filtered = bookmarks.filter(b => b.id !== bookmarkId);
        await saveBookmarks(filtered);
    }

    // Извлечь YouTube ID из URL
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

    // Карточка закладки (как в новостях)
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

        // Кнопка удаления
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

    // Главная модалка хранилища
    async function openStorageModal() {
        // Принудительно обновляем состояние перед открытием
        updateAuthState();
        
        if (!currentUser) {
            UIUtils.showToast('Войдите в аккаунт GitHub через кнопку в правом верхнем углу', 'error');
            return;
        }
        if (!currentToken) {
            UIUtils.showToast('Токен не найден. Попробуйте выйти и войти заново.', 'error');
            return;
        }

        const contentHtml = `
            <div id="bookmarks-container" style="display:flex; flex-direction:column; gap:16px;">
                <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
                    <input type="url" id="new-bookmark-url" placeholder="Вставьте ссылку..." style="flex:2; min-width:200px; padding:10px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                    <input type="text" id="new-bookmark-title" placeholder="Название (необязательно)" style="flex:2; min-width:200px; padding:10px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                    <button class="button" id="add-bookmark-btn"><i class="fas fa-plus"></i> Добавить</button>
                </div>
                <div class="projects-grid" id="bookmarks-grid">
                    <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>
                </div>
                <div style="margin-top:20px; padding:16px; background:var(--bg-inner-gradient); border-radius:16px;">
                    <p style="margin:0 0 8px;"><i class="fas fa-info-circle"></i> <strong>Как это работает:</strong></p>
                    <p class="text-secondary small">Закладки хранятся в вашем приватном GitHub Gist. Токен должен иметь права <code>repo</code> (для создания Gist). Вы можете добавлять любые ссылки, включая видео с YouTube — они будут воспроизводиться прямо на сайте.</p>
                    <p class="text-secondary small" style="margin-top:8px;"><i class="fas fa-shield-alt"></i> Данные синхронизируются между устройствами, если вы вошли с тем же токеном.</p>
                </div>
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
                console.error(e);
                grid.innerHTML = `<p class="error-message">Ошибка загрузки: ${e.message}</p>`;
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
            addBtn.disabled = true;
            try {
                if (!title) {
                    // Попытка получить заголовок страницы через allorigins
                    try {
                        const resp = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
                        const data = await resp.json();
                        const doc = new DOMParser().parseFromString(data.contents, 'text/html');
                        title = doc.querySelector('title')?.textContent || url;
                    } catch (e) {
                        title = url;
                    }
                }
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
                UIUtils.showToast('Ошибка добавления: ' + e.message, 'error');
            } finally {
                addBtn.disabled = false;
            }
        });
    }

    // Экспорт в глобальную область
    window.BookmarkStorage = {
        openStorageModal,
        addBookmark,
        loadBookmarks,
        removeBookmark
    };

    // Инициализация при загрузке страницы
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateAuthState);
    } else {
        updateAuthState();
    }
})();