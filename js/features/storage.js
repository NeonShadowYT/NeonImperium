// js/features/storage.js — Хранилище закладок через GitHub Gist (с шифрованием, авто‑парсером, оптимистичным UI и редактированием)
(function() {
    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium bookmarks storage';
    const STORAGE_KEY_PREFIX = 'bookmarks_';
    const LOCAL_STORAGE_KEY = 'neon_imperium_bookmarks_local';
    const LOCAL_BACKUP_KEY = 'neon_imperium_bookmarks_backup';

    let currentUser = null;
    let currentToken = null;
    let gistId = null;
    let tokenScopes = new Set();

    // --- Шифрование (XOR с ключом на основе токена) ---
    function getEncryptionKey() {
        if (!currentToken) return 'default-key';
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

    // --- Надёжный fetch с цепочкой прокси ---
    const PROXY_SERVICES = [
        { url: 'https://api.allorigins.win/raw?url=', parse: (text) => text },
        { url: 'https://corsproxy.io/?', parse: (text) => text },
        { url: 'https://cors-anywhere-9bln.onrender.com/', parse: (text) => text },
        { url: 'https://thingproxy.freeboard.io/fetch/', parse: (text) => text },
        { url: 'https://cors.bridged.cc/', parse: (text) => text },
        { url: 'https://api.codetabs.com/v1/proxy?quest=', parse: (text) => text }
    ];

    async function fetchWithRetry(url, options = {}, retries = 2) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const resp = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return resp;
        } catch (e) {
            clearTimeout(timeout);
            if (retries > 0) {
                await new Promise(r => setTimeout(r, 800));
                return fetchWithRetry(url, options, retries - 1);
            }
            throw e;
        }
    }

    async function fetchWithProxies(url, options = {}, proxyIndex = 0) {
        if (proxyIndex >= PROXY_SERVICES.length) {
            return fetchWithRetry(url, options);
        }
        const proxy = PROXY_SERVICES[proxyIndex];
        try {
            const proxyUrl = proxy.url + encodeURIComponent(url);
            const resp = await fetchWithRetry(proxyUrl, options);
            const text = await resp.text();
            return { text, url: proxyUrl };
        } catch (e) {
            return fetchWithProxies(url, options, proxyIndex + 1);
        }
    }

    // --- Универсальный парсер метаданных (oEmbed, OpenGraph, JSON‑LD, HTML‑теги) ---
    const OEMBED_PROVIDERS = [
        { pattern: /youtube\.com|youtu\.be/, endpoint: 'https://www.youtube.com/oembed?url=' },
        { pattern: /vimeo\.com/, endpoint: 'https://vimeo.com/api/oembed.json?url=' },
        { pattern: /dailymotion\.com/, endpoint: 'https://www.dailymotion.com/services/oembed?url=' },
        { pattern: /rutube\.ru/, endpoint: 'https://rutube.ru/api/oembed/?url=' },
        { pattern: /vk\.com/, endpoint: 'https://vk.com/dev/oembed?url=' },
        { pattern: /ok\.ru/, endpoint: 'https://ok.ru/dk?cmd=videoOEmbed&url=' },
        { pattern: /twitch\.tv/, endpoint: 'https://api.twitch.tv/v5/oembed?url=' },
        { pattern: /tiktok\.com/, endpoint: 'https://www.tiktok.com/oembed?url=' },
        { pattern: /coub\.com/, endpoint: 'https://coub.com/api/oembed.json?url=' },
        { pattern: /instagram\.com/, endpoint: 'https://graph.facebook.com/v17.0/instagram_oembed?url=' },
        { pattern: /facebook\.com/, endpoint: 'https://graph.facebook.com/v17.0/oembed_video?url=' }
    ];

    async function extractMetadata(url) {
        // 1. Попробовать oEmbed от известных провайдеров
        for (const provider of OEMBED_PROVIDERS) {
            if (provider.pattern.test(url)) {
                try {
                    const resp = await fetchWithRetry(provider.endpoint + encodeURIComponent(url));
                    const data = await resp.json();
                    if (data) {
                        return {
                            title: data.title || '',
                            thumbnail: data.thumbnail_url || '',
                            embedUrl: data.html ? extractEmbedUrlFromHtml(data.html) : null,
                            type: data.type === 'video' ? 'video' : 'link',
                            provider: data.provider_name || ''
                        };
                    }
                } catch (e) { /* fallthrough */ }
                break; // не пытаемся другие провайдеры для этого домена
            }
        }

        // 2. Загрузить HTML и извлечь метаданные
        try {
            const { text } = await fetchWithProxies(url);
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');

            let title = doc.querySelector('meta[property="og:title"]')?.content ||
                       doc.querySelector('meta[name="twitter:title"]')?.content ||
                       doc.querySelector('title')?.textContent || '';
            let description = doc.querySelector('meta[property="og:description"]')?.content ||
                              doc.querySelector('meta[name="description"]')?.content || '';
            let thumbnail = doc.querySelector('meta[property="og:image"]')?.content ||
                            doc.querySelector('meta[name="twitter:image"]')?.content ||
                            doc.querySelector('link[rel="image_src"]')?.href || '';
            let embedUrl = doc.querySelector('meta[property="og:video"]')?.content ||
                           doc.querySelector('meta[property="og:video:url"]')?.content ||
                           doc.querySelector('meta[name="twitter:player"]')?.content ||
                           doc.querySelector('iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="dailymotion"], iframe[src*="rutube"], iframe[src*="vk.com"]')?.src || null;

            // JSON‑LD (schema.org)
            const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
            for (const script of jsonLdScripts) {
                try {
                    const data = JSON.parse(script.textContent);
                    const video = findVideoObject(data);
                    if (video) {
                        title = title || video.name || '';
                        thumbnail = thumbnail || video.thumbnailUrl || (video.thumbnail && video.thumbnail[0]) || '';
                        embedUrl = embedUrl || video.embedUrl || video.contentUrl || '';
                        break;
                    }
                } catch (e) {}
            }

            // Если embedUrl не найден, но есть og:video, используем его
            return {
                title: title || url,
                description,
                thumbnail,
                embedUrl,
                type: embedUrl ? 'video' : 'link',
                provider: new URL(url).hostname
            };
        } catch (e) {
            return { title: url, type: 'link' };
        }
    }

    function findVideoObject(data) {
        if (!data) return null;
        if (data['@type'] === 'VideoObject') return data;
        if (Array.isArray(data['@graph'])) {
            return data['@graph'].find(item => item['@type'] === 'VideoObject');
        }
        return null;
    }

    function extractEmbedUrlFromHtml(html) {
        const match = html.match(/src=["']([^"']*)["']/);
        return match ? match[1] : null;
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
            if (e.message === 'missing_gist_scope') throw e;
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
            if (e.message === 'missing_gist_scope') throw e;
            console.warn('Failed to save to Gist, using local storage', e);
            saveBookmarksLocal(bookmarks);
        }
    }

    // --- Основные операции с закладками (экспортируются) ---
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

    // --- Рендеринг карточки ---
    function renderBookmarkCard(bookmark, onDelete, onEdit) {
        const card = document.createElement('div');
        card.className = 'project-card-link';
        card.style.cursor = 'pointer';

        const inner = document.createElement('div');
        inner.className = 'project-card';
        inner.style.position = 'relative';

        const isVideo = bookmark.type === 'video' || (bookmark.embedUrl && bookmark.embedUrl.includes('youtube'));

        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'image-wrapper';
        let thumbnail = bookmark.thumbnail || 'images/default-news.webp';
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

        const actionsDiv = document.createElement('div');
        actionsDiv.style.position = 'absolute';
        actionsDiv.style.top = '8px';
        actionsDiv.style.right = '8px';
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '6px';
        actionsDiv.style.zIndex = '2';

        const editBtn = document.createElement('button');
        editBtn.className = 'bookmark-edit';
        editBtn.innerHTML = '<i class="fas fa-pen"></i>';
        editBtn.style.background = 'rgba(0,0,0,0.6)';
        editBtn.style.color = 'white';
        editBtn.style.border = 'none';
        editBtn.style.borderRadius = '50%';
        editBtn.style.width = '30px';
        editBtn.style.height = '30px';
        editBtn.style.cursor = 'pointer';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            onEdit(bookmark);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'bookmark-delete';
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        deleteBtn.style.background = 'rgba(0,0,0,0.6)';
        deleteBtn.style.color = 'white';
        deleteBtn.style.border = 'none';
        deleteBtn.style.borderRadius = '50%';
        deleteBtn.style.width = '30px';
        deleteBtn.style.height = '30px';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Удалить из избранного?')) {
                onDelete(bookmark.id);
            }
        });

        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);
        inner.appendChild(actionsDiv);

        card.appendChild(inner);

        card.addEventListener('click', () => {
            if (bookmark.embedUrl) {
                openVideoModal(bookmark.embedUrl, bookmark.title);
            } else if (bookmark.type === 'video') {
                window.open(bookmark.url, '_blank');
            } else {
                window.open(bookmark.url, '_blank');
            }
        });

        return card;
    }

    function openVideoModal(embedUrl, title) {
        const content = `
            <div class="video-embed" style="width:100%;">
                <iframe src="${embedUrl}" frameborder="0" allowfullscreen style="width:100%; aspect-ratio:16/9;"></iframe>
            </div>
        `;
        UIUtils.createModal(title || 'Видео', content, { size: 'full' });
    }

    async function openStorageModalContent(forceLocal = false) {
        const contentHtml = `
            <div id="bookmarks-container" style="display:flex; flex-direction:column; gap:16px;">
                <div style="display:flex; gap:8px; align-items:center;">
                    <input type="url" id="new-bookmark-url" placeholder="Ссылка..." style="flex:2; min-width:180px; padding:10px 12px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary); height:44px; box-sizing:border-box;">
                    <input type="text" id="new-bookmark-title" placeholder="Название" style="flex:2; min-width:150px; padding:10px 12px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary); height:44px; box-sizing:border-box;">
                    <button class="button" id="add-bookmark-btn" style="padding:10px 20px; height:44px; box-sizing:border-box; white-space:nowrap;"><i class="fas fa-plus"></i> Добавить</button>
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

        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
        grid.style.gap = '16px';

        let currentBookmarks = [];

        async function refreshGrid() {
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>';
            try {
                currentBookmarks = await loadBookmarks();
                if (currentBookmarks.length === 0) {
                    grid.innerHTML = '<div class="empty-state"><i class="fas fa-bookmark"></i><p>Нет сохранённых закладок</p></div>';
                    return;
                }
                renderBookmarks(currentBookmarks);
            } catch (e) {
                console.error(e);
                grid.innerHTML = `<p class="error-message">Ошибка загрузки: ${e.message}</p>`;
            }
        }

        function renderBookmarks(bookmarks) {
            grid.innerHTML = '';
            bookmarks.sort((a,b) => new Date(b.added) - new Date(a.added));
            bookmarks.forEach(b => {
                const card = renderBookmarkCard(b,
                    (id) => {
                        const original = [...currentBookmarks];
                        const index = currentBookmarks.findIndex(bk => bk.id === id);
                        if (index === -1) return;
                        const removed = currentBookmarks.splice(index, 1)[0];
                        renderBookmarks(currentBookmarks);
                        localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(original));
                        (async () => {
                            try {
                                await removeBookmark(id);
                                localStorage.removeItem(LOCAL_BACKUP_KEY);
                            } catch (e) {
                                UIUtils.showToast('Ошибка удаления: ' + e.message, 'error');
                                currentBookmarks = original;
                                renderBookmarks(currentBookmarks);
                                localStorage.removeItem(LOCAL_BACKUP_KEY);
                            }
                        })();
                    },
                    (bookmark) => {
                        openEditBookmarkModal(bookmark, (updated) => {
                            const index = currentBookmarks.findIndex(b => b.id === updated.id);
                            if (index !== -1) {
                                currentBookmarks[index] = updated;
                                renderBookmarks(currentBookmarks);
                            }
                        });
                    }
                );
                grid.appendChild(card);
            });
        }

        function openEditBookmarkModal(bookmark, onSave) {
            const editHtml = `
                <div style="display:flex; flex-direction:column; gap:16px;">
                    <input type="url" id="edit-bookmark-url" value="${GithubCore.escapeHtml(bookmark.url)}" placeholder="Ссылка" style="padding:10px 12px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                    <input type="text" id="edit-bookmark-title" value="${GithubCore.escapeHtml(bookmark.title)}" placeholder="Название" style="padding:10px 12px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button class="button" id="save-edit-btn">Сохранить</button>
                        <button class="button" id="cancel-edit-btn">Отмена</button>
                    </div>
                </div>
            `;
            const { modal: editModal, closeModal: closeEditModal } = UIUtils.createModal('Редактировать закладку', editHtml, { size: 'full' });
            const urlField = editModal.querySelector('#edit-bookmark-url');
            const titleField = editModal.querySelector('#edit-bookmark-title');
            editModal.querySelector('#save-edit-btn').addEventListener('click', async () => {
                const newUrl = urlField.value.trim();
                const newTitle = titleField.value.trim();
                if (!newUrl) { UIUtils.showToast('Введите ссылку', 'error'); return; }
                const updated = { ...bookmark, url: newUrl, title: newTitle || newUrl };
                onSave(updated);
                try {
                    const index = currentBookmarks.findIndex(b => b.id === bookmark.id);
                    if (index !== -1) currentBookmarks[index] = updated;
                    await saveBookmarks(currentBookmarks);
                } catch (e) {
                    UIUtils.showToast('Ошибка сохранения: ' + e.message, 'error');
                }
                closeEditModal();
            });
            editModal.querySelector('#cancel-edit-btn').addEventListener('click', closeEditModal);
        }

        await refreshGrid();

        addBtn.addEventListener('click', async () => {
            const url = urlInput.value.trim();
            if (!url) { UIUtils.showToast('Введите ссылку', 'error'); return; }
            let title = titleInput.value.trim();
            addBtn.disabled = true;
            const tempId = 'temp-' + Date.now();
            const optimisticBookmark = {
                id: tempId,
                url,
                title: title || url,
                type: 'link',
                added: new Date().toISOString()
            };
            currentBookmarks.unshift(optimisticBookmark);
            renderBookmarks(currentBookmarks);

            try {
                const metadata = await extractMetadata(url);
                const finalBookmark = {
                    id: Date.now() + '-' + Math.random().toString(36),
                    url,
                    title: title || metadata.title || url,
                    type: metadata.type,
                    thumbnail: metadata.thumbnail,
                    embedUrl: metadata.embedUrl,
                    added: new Date().toISOString()
                };
                const index = currentBookmarks.findIndex(b => b.id === tempId);
                if (index !== -1) currentBookmarks[index] = finalBookmark;
                // Используем локальную addBookmark
                await addBookmark(finalBookmark);
                renderBookmarks(currentBookmarks);
                UIUtils.showToast('Добавлено', 'success');
                urlInput.value = '';
                titleInput.value = '';
            } catch (e) {
                UIUtils.showToast('Ошибка: ' + e.message, 'error');
                currentBookmarks = currentBookmarks.filter(b => b.id !== tempId);
                renderBookmarks(currentBookmarks);
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

    // Экспорт
    window.BookmarkStorage = {
        openStorageModal,
        addBookmark,
        loadBookmarks,
        removeBookmark
    };

    // Инициализация
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateAuthState);
    } else {
        updateAuthState();
    }

    // Запасные CDN для marked (дублируем в HTML, но здесь на всякий случай)
    if (typeof marked === 'undefined') {
        const scripts = [
            'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
            'https://unpkg.com/marked@4.0.0/marked.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/marked/4.0.0/marked.min.js'
        ];
        for (const src of scripts) {
            const script = document.createElement('script');
            script.src = src;
            script.defer = true;
            document.head.appendChild(script);
        }
    }
})();