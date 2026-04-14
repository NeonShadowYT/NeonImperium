// js/features/storage.js — Хранилище закладок через GitHub Gist (с шифрованием)
(function() {
    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium bookmarks storage';
    const STORAGE_KEY_PREFIX = 'bookmarks_';
    const LOCAL_STORAGE_KEY = 'neon_imperium_bookmarks_local';

    let currentUser = null;
    let currentToken = null;
    let gistId = null;
    let tokenScopes = new Set();

    // --- Шифрование (простое XOR с ключом на основе токена) ---
    function getEncryptionKey() {
        if (!currentToken) return 'default-key';
        // Используем хеш от токена для стабильности
        let hash = 0;
        for (let i = 0; i < currentToken.length; i++) {
            hash = ((hash << 5) - hash) + currentToken.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(16);
    }

    function encryptData(data) {
        const key = getEncryptionKey();
        const json = JSON.stringify(data);
        let result = '';
        for (let i = 0; i < json.length; i++) {
            const charCode = json.charCodeAt(i) ^ key.charCodeAt(i % key.length);
            result += String.fromCharCode(charCode);
        }
        // Кодируем в base64 для безопасного хранения в JSON
        return btoa(result);
    }

    function decryptData(encrypted) {
        try {
            const key = getEncryptionKey();
            const decoded = atob(encrypted);
            let result = '';
            for (let i = 0; i < decoded.length; i++) {
                const charCode = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
                result += String.fromCharCode(charCode);
            }
            return JSON.parse(result);
        } catch (e) {
            console.warn('Decryption failed, maybe token changed?', e);
            return { bookmarks: [] };
        }
    }

    // --- Состояние авторизации ---
    function updateAuthState() {
        currentUser = GithubAuth.getCurrentUser();
        currentToken = GithubAuth.getToken();
        tokenScopes.clear();
        if (currentUser && currentToken) {
            loadGistId();
        } else {
            gistId = null;
        }
    }

    window.addEventListener('github-login-success', updateAuthState);
    window.addEventListener('github-logout', () => {
        currentUser = null;
        currentToken = null;
        gistId = null;
        tokenScopes.clear();
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

    async function checkTokenScopes() {
        if (!currentToken) return false;
        try {
            const resp = await fetch('https://api.github.com/user', {
                headers: { 'Authorization': `Bearer ${currentToken}` },
                method: 'HEAD'
            });
            const scopesHeader = resp.headers.get('X-OAuth-Scopes');
            if (scopesHeader) {
                tokenScopes = new Set(scopesHeader.split(',').map(s => s.trim()));
            }
            return tokenScopes.has('gist');
        } catch (e) {
            console.warn('Failed to check token scopes', e);
            return false;
        }
    }

    function showGistScopeError() {
        const contentHtml = `
            <div style="padding: 20px;">
                <div style="background: rgba(244,67,54,0.1); border: 1px solid #f44336; border-radius: 16px; padding: 20px; margin-bottom: 20px;">
                    <h3 style="color: #f44336; margin-top: 0;"><i class="fas fa-exclamation-triangle"></i> Требуется право gist</h3>
                    <p>Ваш токен не имеет права <code>gist</code>, необходимого для синхронизации закладок между устройствами.</p>
                    <p><strong>Как исправить:</strong></p>
                    <ol style="text-align: left; margin: 10px 0 20px 20px;">
                        <li>Перейдите в <a href="https://github.com/settings/tokens" target="_blank" style="color: var(--accent);">Personal access tokens (classic)</a>.</li>
                        <li>Создайте новый токен или отредактируйте текущий.</li>
                        <li>В разделе "Select scopes" отметьте <strong>gist</strong>.</li>
                        <li>Скопируйте новый токен и войдите с ним заново на сайте.</li>
                    </ol>
                    <p>Пока это не исправлено, закладки будут сохраняться только в этом браузере (не синхронизируются).</p>
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="button" id="use-local-storage-btn">Использовать локальное хранилище</button>
                    <button class="button" id="close-scope-error-btn">Закрыть</button>
                </div>
            </div>
        `;
        const { modal, closeModal } = UIUtils.createModal('Ошибка доступа', contentHtml, { size: 'full' });
        modal.querySelector('#use-local-storage-btn').addEventListener('click', () => {
            closeModal();
            openStorageModalContent(true);
        });
        modal.querySelector('#close-scope-error-btn').addEventListener('click', closeModal);
    }

    async function getOrCreateGist() {
        if (!currentToken) throw new Error('No token');
        
        const hasGistScope = await checkTokenScopes();
        if (!hasGistScope) {
            throw new Error('missing_gist_scope');
        }

        if (gistId) {
            try {
                const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
                    headers: { 'Authorization': `Bearer ${currentToken}` }
                });
                if (resp.ok) return gistId;
            } catch (e) {}
        }

        try {
            const resp = await fetch('https://api.github.com/gists', {
                headers: { 'Authorization': `Bearer ${currentToken}` }
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

        const createResp = await fetch('https://api.github.com/gists', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${currentToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                description: GIST_DESCRIPTION,
                public: false,
                files: {
                    [GIST_FILENAME]: {
                        content: encryptData({ bookmarks: [] })
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

    // Локальное хранилище (fallback)
    function loadBookmarksLocal() {
        try {
            const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            return [];
        }
    }

    function saveBookmarksLocal(bookmarks) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
    }

    async function loadBookmarks() {
        if (!currentToken) return loadBookmarksLocal();
        try {
            const gistId = await getOrCreateGist();
            const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const gist = await resp.json();
            const file = gist.files[GIST_FILENAME];
            if (!file) return [];
            const decrypted = decryptData(file.content);
            return decrypted.bookmarks || [];
        } catch (e) {
            if (e.message === 'missing_gist_scope') {
                throw e;
            }
            console.warn('Failed to load bookmarks from Gist, falling back to local', e);
            return loadBookmarksLocal();
        }
    }

    async function saveBookmarks(bookmarks) {
        if (!currentToken) {
            saveBookmarksLocal(bookmarks);
            return;
        }
        try {
            const gistId = await getOrCreateGist();
            const encrypted = encryptData({ bookmarks });
            const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${currentToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    files: {
                        [GIST_FILENAME]: { content: encrypted }
                    }
                })
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.message);
            }
        } catch (e) {
            if (e.message === 'missing_gist_scope') {
                throw e;
            }
            console.warn('Failed to save to Gist, using local storage', e);
            saveBookmarksLocal(bookmarks);
        }
    }

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

    async function openStorageModalContent(forceLocal = false) {
        // Компактная форма в одной строке
        const contentHtml = `
            <div id="bookmarks-container" style="display:flex; flex-direction:column; gap:16px;">
                <div style="display:flex; gap:8px; align-items:stretch;">
                    <input type="url" id="new-bookmark-url" placeholder="Ссылка..." style="flex:2; min-width:180px; padding:10px 12px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                    <input type="text" id="new-bookmark-title" placeholder="Название" style="flex:2; min-width:150px; padding:10px 12px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                    <button class="button" id="add-bookmark-btn" style="padding:10px 20px; white-space:nowrap;"><i class="fas fa-plus"></i> Добавить</button>
                </div>
                <div class="projects-grid" id="bookmarks-grid" style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px;">
                    <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>
                </div>
                <div style="margin-top:20px; padding:16px; background:var(--bg-inner-gradient); border-radius:16px;">
                    <p style="margin:0 0 8px;"><i class="fas fa-info-circle"></i> <strong>Как это работает:</strong></p>
                    <p class="text-secondary small">Закладки хранятся в вашем приватном GitHub Gist и синхронизируются между устройствами. Данные шифруются вашим токеном. Если у токена нет права <code>gist</code>, данные сохраняются только в этом браузере.</p>
                    ${forceLocal ? '<p class="text-secondary small" style="color: #f44336;"><i class="fas fa-exclamation-triangle"></i> Включено локальное хранилище. Закладки не синхронизируются.</p>' : ''}
                </div>
            </div>
        `;

        const { modal, closeModal } = UIUtils.createModal('Хранилище', contentHtml, { size: 'full' });

        const grid = modal.querySelector('#bookmarks-grid');
        const urlInput = modal.querySelector('#new-bookmark-url');
        const titleInput = modal.querySelector('#new-bookmark-title');
        const addBtn = modal.querySelector('#add-bookmark-btn');

        // Убедимся, что сетка 3 колонки, но на мобильных адаптируется через медиа-запросы в CSS
        // Добавим inline стиль для гарантии
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
        grid.style.gap = '16px';

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
                if (e.message === 'missing_gist_scope') {
                    showGistScopeError();
                } else {
                    UIUtils.showToast('Ошибка добавления: ' + e.message, 'error');
                }
            } finally {
                addBtn.disabled = false;
            }
        });
    }

    async function openStorageModal() {
        updateAuthState();
        
        if (!currentUser) {
            UIUtils.showToast('Войдите в аккаунт GitHub через кнопку в правом верхнем углу', 'error');
            return;
        }
        if (!currentToken) {
            UIUtils.showToast('Токен не найден. Попробуйте выйти и войти заново.', 'error');
            return;
        }

        try {
            await openStorageModalContent(false);
        } catch (e) {
            if (e.message === 'missing_gist_scope') {
                showGistScopeError();
            } else {
                UIUtils.showToast('Не удалось открыть хранилище: ' + e.message, 'error');
            }
        }
    }

    window.BookmarkStorage = {
        openStorageModal,
        addBookmark,
        loadBookmarks,
        removeBookmark
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateAuthState);
    } else {
        updateAuthState();
    }
})();