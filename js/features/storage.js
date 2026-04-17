// js/features/storage.js — Хранилище закладок через GitHub Gist + oEmbed + эвристическое преобразование
(function() {
    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium bookmarks storage';
    const STORAGE_KEY_PREFIX = 'bookmarks_';
    const LOCAL_STORAGE_KEY = 'neon_imperium_bookmarks_local';
    const LOCAL_BACKUP_KEY = 'neon_imperium_bookmarks_backup';

    let currentUser = null;
    let currentToken = null;
    let gistId = null;

    function toBase64(str) {
        const bytes = new TextEncoder().encode(str);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }
    function fromBase64(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }

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
        return toBase64(result);
    }

    function decryptData(encrypted) {
        try {
            const key = getEncryptionKey();
            const decoded = fromBase64(encrypted);
            let result = '';
            for (let i = 0; i < decoded.length; i++) {
                const charCode = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
                result += String.fromCharCode(charCode);
            }
            return JSON.parse(result);
        } catch (e) {
            console.warn('Decryption failed', e);
            return { bookmarks: [] };
        }
    }

    function updateAuthState() {
        currentUser = GithubAuth.getCurrentUser();
        currentToken = GithubAuth.getToken();
        if (currentUser && currentToken) {
            const stored = localStorage.getItem(STORAGE_KEY_PREFIX + currentUser);
            if (stored) {
                try { gistId = JSON.parse(stored).gistId; } catch {}
            }
        } else {
            gistId = null;
        }
    }
    window.addEventListener('github-login-success', updateAuthState);
    window.addEventListener('github-logout', updateAuthState);

    async function getOrCreateGist() {
        if (!currentToken) throw new Error('No token');
        if (gistId) {
            try {
                const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
                    headers: { 'Authorization': `Bearer ${currentToken}` }
                });
                if (resp.ok) return gistId;
            } catch {}
        }
        const listResp = await fetch('https://api.github.com/gists', {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        if (listResp.ok) {
            const gists = await listResp.json();
            const existing = gists.find(g => g.description === GIST_DESCRIPTION && g.files?.[GIST_FILENAME]);
            if (existing) {
                gistId = existing.id;
                localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
                return existing.id;
            }
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
                files: { [GIST_FILENAME]: { content: encryptData({ bookmarks: [] }) } }
            })
        });
        if (!createResp.ok) throw new Error('Cannot create gist');
        const gist = await createResp.json();
        gistId = gist.id;
        localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
        return gist.id;
    }

    async function loadBookmarks() {
        if (!currentToken) {
            try { return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch { return []; }
        }
        try {
            const gistId = await getOrCreateGist();
            const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
                headers: { 'Authorization': `Bearer ${currentToken}` }
            });
            const gist = await resp.json();
            const file = gist.files[GIST_FILENAME];
            if (!file) return [];
            return decryptData(file.content).bookmarks || [];
        } catch (e) {
            console.warn('Gist load failed, using local', e);
            try { return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch { return []; }
        }
    }

    async function saveBookmarks(bookmarks) {
        if (!currentToken) {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
            return;
        }
        try {
            const gistId = await getOrCreateGist();
            const encrypted = encryptData({ bookmarks });
            await fetch(`https://api.github.com/gists/${gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${currentToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ files: { [GIST_FILENAME]: { content: encrypted } } })
            });
        } catch (e) {
            console.warn('Gist save failed, using local', e);
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
        }
    }

    // --- oEmbed запрос (без указания доменов) ---
    async function fetchEmbedUrl(pageUrl) {
        try {
            const apiUrl = `https://noembed.com/embed?url=${encodeURIComponent(pageUrl)}`;
            const response = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
            if (!response.ok) return null;
            const data = await response.json();
            if (data.html) {
                const iframeMatch = data.html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                if (iframeMatch && iframeMatch[1]) return iframeMatch[1];
                if (data.url) return data.url;
            }
            if (data.embed_url) return data.embed_url;
            return null;
        } catch (err) {
            console.warn('oEmbed fetch failed:', err);
            return null;
        }
    }

    // --- Эвристическое преобразование обычной ссылки в embed ---
    function guessEmbedUrl(url) {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            const origin = urlObj.origin;
            const path = urlObj.pathname;
            const search = urlObj.search;
            let videoId = null;

            // Паттерны
            // view_video.php?viewkey=...
            if (path.includes('view_video.php') && search.includes('viewkey=')) {
                const params = new URLSearchParams(search);
                videoId = params.get('viewkey');
                if (videoId) return `${origin}/embed/${videoId}`;
            }
            // /view/... или /watch/...
            const viewMatch = path.match(/\/(view|watch)\/([a-zA-Z0-9_-]+)/);
            if (viewMatch) {
                videoId = viewMatch[2];
                return `${origin}/embed/${videoId}`;
            }
            // /v/... (короткая ссылка)
            const vMatch = path.match(/^\/v\/([a-zA-Z0-9_-]+)/);
            if (vMatch) {
                videoId = vMatch[1];
                return `${origin}/embed/${videoId}`;
            }
            // /video/...
            const videoMatch = path.match(/\/video\/([a-zA-Z0-9_-]+)/);
            if (videoMatch) {
                videoId = videoMatch[1];
                return `${origin}/embed/${videoId}`;
            }
            // YouTube: /watch?v=... или /v/... или youtu.be/...
            if (search.includes('v=')) {
                const params = new URLSearchParams(search);
                videoId = params.get('v');
                if (videoId) return `https://www.youtube.com/embed/${videoId}`;
            }
            if (path.match(/^\/embed\//)) return url; // уже embed
            return null;
        } catch (e) {
            return null;
        }
    }

    // --- Проверка, является ли URL embed-ссылкой ---
    function isEmbedUrl(url) {
        if (!url) return false;
        const lowerUrl = url.toLowerCase();
        return lowerUrl.includes('/embed/') || lowerUrl.includes('/player/') || lowerUrl.includes('?embed');
    }

    async function addBookmark(bookmark) {
        if (!currentUser) { UIUtils.showToast('Войдите в аккаунт', 'error'); return; }
        let embedUrl = null;
        if (bookmark.url) {
            if (isEmbedUrl(bookmark.url)) {
                embedUrl = bookmark.url;
            } else {
                // Сначала пробуем oEmbed
                embedUrl = await fetchEmbedUrl(bookmark.url);
                if (!embedUrl) {
                    // Если oEmbed не дал результат, пробуем эвристику
                    embedUrl = guessEmbedUrl(bookmark.url);
                }
            }
        }
        const bookmarks = await loadBookmarks();
        if (bookmarks.some(b => b.url === bookmark.url)) {
            UIUtils.showToast('Уже в избранном', 'info');
            return;
        }
        bookmark.id = Date.now() + '-' + Math.random().toString(36);
        bookmark.added = new Date().toISOString();
        if (embedUrl) bookmark.embedUrl = embedUrl;
        bookmarks.push(bookmark);
        await saveBookmarks(bookmarks);
        return embedUrl;
    }

    async function removeBookmark(bookmarkId) {
        const bookmarks = await loadBookmarks();
        const filtered = bookmarks.filter(b => b.id !== bookmarkId);
        await saveBookmarks(filtered);
    }

    function renderBookmarkCard(bookmark, onDelete, onEdit) {
        const card = document.createElement('div');
        card.className = 'project-card-link tilt-card';
        card.style.cursor = 'pointer';

        const inner = document.createElement('div');
        inner.className = 'project-card';
        inner.style.position = 'relative';

        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'image-wrapper';
        
        const embedSrc = bookmark.embedUrl || (isEmbedUrl(bookmark.url) ? bookmark.url : null);
        
        if (embedSrc) {
            const iframe = document.createElement('iframe');
            iframe.src = embedSrc;
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.style.borderRadius = 'var(--border-radius-small)';
            iframe.setAttribute('frameborder', '0');
            iframe.setAttribute('allowfullscreen', 'true');
            iframe.setAttribute('loading', 'lazy');
            iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-forms allow-presentation');
            imgWrapper.appendChild(iframe);
        } else {
            let thumbnailUrl = bookmark.thumbnail || 'images/default-news.webp';
            const img = document.createElement('img');
            img.src = thumbnailUrl;
            img.alt = bookmark.title;
            img.className = 'project-image';
            img.onerror = () => img.src = 'images/default-news.webp';
            imgWrapper.appendChild(img);
        }
        
        inner.appendChild(imgWrapper);

        const title = document.createElement('h3');
        title.textContent = bookmark.title.length > 60 ? bookmark.title.substring(0,60)+'…' : bookmark.title;
        inner.appendChild(title);

        const meta = document.createElement('p');
        meta.className = 'text-secondary';
        meta.style.fontSize = '12px';
        meta.innerHTML = `<i class="fas fa-calendar-alt"></i> ${new Date(bookmark.added).toLocaleDateString()}`;
        inner.appendChild(meta);

        const actionsDiv = document.createElement('div');
        actionsDiv.style.position = 'absolute';
        actionsDiv.style.top = '8px';
        actionsDiv.style.right = '8px';
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '6px';
        actionsDiv.style.zIndex = '2';

        const editBtn = document.createElement('button');
        editBtn.innerHTML = '<i class="fas fa-pen"></i>';
        Object.assign(editBtn.style, { background:'rgba(0,0,0,0.6)', color:'white', border:'none', borderRadius:'50%', width:'30px', height:'30px', cursor:'pointer' });
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); onEdit(bookmark); });

        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        Object.assign(deleteBtn.style, { background:'rgba(0,0,0,0.6)', color:'white', border:'none', borderRadius:'50%', width:'30px', height:'30px', cursor:'pointer' });
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Удалить из избранного?')) onDelete(bookmark.id);
        });

        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);
        inner.appendChild(actionsDiv);
        card.appendChild(inner);

        card.addEventListener('click', () => window.open(bookmark.url, '_blank'));
        return card;
    }

    async function openStorageModalContent() {
        const contentHtml = `
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <input type="url" id="new-bookmark-url" placeholder="Ссылка на страницу или видео..." style="flex:2; padding:10px 12px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary); height:44px;">
                    <input type="text" id="new-bookmark-title" placeholder="Название" style="flex:2; padding:10px 12px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary); height:44px;">
                    <button class="button" id="add-bookmark-btn" style="padding:10px 20px; height:44px; white-space:nowrap; width:auto; min-width:120px;"><i class="fas fa-plus"></i> Добавить</button>
                </div>
                <div class="projects-grid" id="bookmarks-grid" style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px;">
                    <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>
                </div>
                <div style="margin-top:20px; padding:16px; background:var(--bg-inner-gradient); border-radius:16px;">
                    <p><i class="fas fa-info-circle"></i> <strong>Закладки</strong> хранятся в приватном GitHub Gist и синхронизируются.<br>
                    <i class="fas fa-video"></i> Для видео автоматически подбирается встраиваемый плеер (через oEmbed + эвристика).</p>
                </div>
            </div>
        `;

        const { modal, closeModal } = UIUtils.createModal('Хранилище', contentHtml, { size: 'full' });
        const grid = modal.querySelector('#bookmarks-grid');
        const urlInput = modal.querySelector('#new-bookmark-url');
        const titleInput = modal.querySelector('#new-bookmark-title');
        const addBtn = modal.querySelector('#add-bookmark-btn');

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
                        currentBookmarks.splice(index, 1);
                        renderBookmarks(currentBookmarks);
                        localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(original));
                        (async () => {
                            try {
                                await removeBookmark(id);
                                localStorage.removeItem(LOCAL_BACKUP_KEY);
                            } catch (e) {
                                UIUtils.showToast('Ошибка удаления', 'error');
                                currentBookmarks = original;
                                renderBookmarks(currentBookmarks);
                            }
                        })();
                    },
                    (bookmark) => {
                        const editHtml = `
                            <div style="display:flex; flex-direction:column; gap:16px;">
                                <input type="url" id="edit-url" value="${GithubCore.escapeHtml(bookmark.url)}" style="padding:10px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                                <input type="text" id="edit-title" value="${GithubCore.escapeHtml(bookmark.title)}" style="padding:10px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                                <div style="display:flex; gap:8px; justify-content:flex-end;">
                                    <button class="button" id="save-edit">Сохранить</button>
                                    <button class="button" id="cancel-edit">Отмена</button>
                                </div>
                            </div>
                        `;
                        const { modal: editModal, closeModal: closeEditModal } = UIUtils.createModal('Редактировать', editHtml, { size: 'full' });
                        const urlField = editModal.querySelector('#edit-url');
                        const titleField = editModal.querySelector('#edit-title');
                        editModal.querySelector('#save-edit').addEventListener('click', async () => {
                            const newUrl = urlField.value.trim();
                            if (!newUrl) { UIUtils.showToast('Введите ссылку', 'error'); return; }
                            let newEmbedUrl = bookmark.embedUrl;
                            if (newUrl !== bookmark.url) {
                                if (isEmbedUrl(newUrl)) {
                                    newEmbedUrl = newUrl;
                                } else {
                                    newEmbedUrl = await fetchEmbedUrl(newUrl);
                                    if (!newEmbedUrl) newEmbedUrl = guessEmbedUrl(newUrl);
                                }
                            }
                            const updated = { 
                                ...bookmark, 
                                url: newUrl, 
                                title: titleField.value.trim() || newUrl,
                                embedUrl: newEmbedUrl || undefined
                            };
                            const index = currentBookmarks.findIndex(b => b.id === bookmark.id);
                            if (index !== -1) currentBookmarks[index] = updated;
                            renderBookmarks(currentBookmarks);
                            await saveBookmarks(currentBookmarks);
                            closeEditModal();
                        });
                        editModal.querySelector('#cancel-edit').addEventListener('click', closeEditModal);
                    }
                );
                grid.appendChild(card);
            });
        }

        await refreshGrid();

        addBtn.addEventListener('click', async () => {
            const url = urlInput.value.trim();
            if (!url) { UIUtils.showToast('Введите ссылку', 'error'); return; }
            let title = titleInput.value.trim() || url;
            addBtn.disabled = true;
            
            const tempId = 'temp-' + Date.now();
            const optimistic = { id: tempId, url, title, added: new Date().toISOString() };
            currentBookmarks.unshift(optimistic);
            renderBookmarks(currentBookmarks);

            try {
                let embedUrl = null;
                if (isEmbedUrl(url)) {
                    embedUrl = url;
                } else {
                    embedUrl = await fetchEmbedUrl(url);
                    if (!embedUrl) embedUrl = guessEmbedUrl(url);
                }
                const final = { 
                    id: Date.now() + '-' + Math.random().toString(36),
                    url,
                    title,
                    added: new Date().toISOString(),
                    embedUrl: embedUrl || undefined
                };
                const index = currentBookmarks.findIndex(b => b.id === tempId);
                if (index !== -1) currentBookmarks[index] = final;
                await saveBookmarks(currentBookmarks);
                renderBookmarks(currentBookmarks);
                UIUtils.showToast(embedUrl ? 'Добавлено (с поддержкой видео)' : 'Добавлено', 'success');
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
        if (!currentUser) { UIUtils.showToast('Войдите в аккаунт GitHub', 'error'); return; }
        if (!currentToken) { UIUtils.showToast('Токен не найден. Перезайдите.', 'error'); return; }
        try {
            await openStorageModalContent();
        } catch (e) {
            UIUtils.showToast('Ошибка: ' + e.message, 'error');
        }
    }

    window.BookmarkStorage = { openStorageModal, addBookmark, loadBookmarks, removeBookmark };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateAuthState);
    else updateAuthState();
})();