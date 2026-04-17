// js/features/storage.js — Хранилище закладок через GitHub Gist с улучшенным UI и мульти-сервисным получением видео
(function() {
    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium bookmarks storage';
    const STORAGE_KEY_PREFIX = 'bookmarks_';
    const LOCAL_STORAGE_KEY = 'neon_imperium_bookmarks_local';
    const LOCAL_BACKUP_KEY = 'neon_imperium_bookmarks_backup';

    let currentUser = null;
    let currentToken = null;
    let gistId = null;

    // --- Base64 ---
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

    // --- Шифрование ---
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

    // --- Состояние авторизации ---
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

    // --- Работа с Gist ---
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

    // --- Мульти-сервисное получение информации о ссылке ---
    async function fetchEmbedData(url) {
        // Список сервисов для получения oEmbed (noembed.com, если не сработает — попробуем другие)
        const services = [
            `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
            `https://api.embed.ly/1/oembed?url=${encodeURIComponent(url)}`, // требует ключ? но попробуем
            `https://iframe.ly/api/oembed?url=${encodeURIComponent(url)}`
        ];
        for (const serviceUrl of services) {
            try {
                const response = await fetch(serviceUrl, { signal: AbortSignal.timeout(5000) });
                if (!response.ok) continue;
                const data = await response.json();
                if (data && (data.html || data.url || data.thumbnail_url)) {
                    return data;
                }
            } catch (err) {
                console.warn(`Service ${serviceUrl} failed:`, err);
            }
        }
        // Если oEmbed не дал результата, пробуем получить Open Graph мета-теги через прокси
        try {
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
            const proxyResp = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
            if (proxyResp.ok) {
                const proxyData = await proxyResp.json();
                const html = proxyData.contents;
                const titleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"[^>]*>/i);
                const imageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"[^>]*>/i);
                const videoMatch = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"[^>]*>/i);
                return {
                    title: titleMatch ? titleMatch[1] : null,
                    thumbnail_url: imageMatch ? imageMatch[1] : null,
                    url: videoMatch ? videoMatch[1] : null
                };
            }
        } catch (err) {
            console.warn('OpenGraph proxy failed:', err);
        }
        return null;
    }

    function guessEmbedUrl(url) {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            const origin = urlObj.origin;
            const path = urlObj.pathname;
            const search = urlObj.search;
            let videoId = null;

            // YouTube Shorts
            if (path.includes('/shorts/')) {
                videoId = path.split('/shorts/')[1]?.split('?')[0];
                if (videoId) return `https://www.youtube.com/embed/${videoId}`;
            }
            if (path.includes('view_video.php') && search.includes('viewkey=')) {
                const params = new URLSearchParams(search);
                videoId = params.get('viewkey');
                if (videoId) return `${origin}/embed/${videoId}`;
            }
            const viewMatch = path.match(/\/(view|watch)\/([a-zA-Z0-9_-]+)/);
            if (viewMatch) {
                videoId = viewMatch[2];
                return `${origin}/embed/${videoId}`;
            }
            const vMatch = path.match(/^\/v\/([a-zA-Z0-9_-]+)/);
            if (vMatch) {
                videoId = vMatch[1];
                return `${origin}/embed/${videoId}`;
            }
            const videoMatch = path.match(/\/video\/([a-zA-Z0-9_-]+)/);
            if (videoMatch) {
                videoId = videoMatch[1];
                return `${origin}/embed/${videoId}`;
            }
            if (search.includes('v=')) {
                const params = new URLSearchParams(search);
                videoId = params.get('v');
                if (videoId) return `https://www.youtube.com/embed/${videoId}`;
            }
            if (path.match(/^\/embed\//)) return url;
            return null;
        } catch (e) {
            return null;
        }
    }

    function isEmbedUrl(url) {
        if (!url) return false;
        const lowerUrl = url.toLowerCase();
        return lowerUrl.includes('/embed/') || lowerUrl.includes('/player/') || lowerUrl.includes('?embed');
    }

    // --- Добавление закладки с мульти-сервисным получением ---
    async function addBookmark(bookmark) {
        if (!currentUser) { UIUtils.showToast('Войдите в аккаунт', 'error'); return; }
        let embedUrl = null;
        let downloadUrl = null;
        let thumbnail = null;
        let finalTitle = bookmark.title;
        if (bookmark.url) {
            if (isEmbedUrl(bookmark.url)) {
                embedUrl = bookmark.url;
            } else {
                const oembed = await fetchEmbedData(bookmark.url);
                if (oembed) {
                    if (oembed.html) {
                        const iframeMatch = oembed.html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                        if (iframeMatch && iframeMatch[1]) embedUrl = iframeMatch[1];
                    }
                    if (oembed.url && (oembed.url.endsWith('.mp4') || oembed.url.endsWith('.webm') || oembed.url.includes('video/mp4'))) {
                        downloadUrl = oembed.url;
                    }
                    if (oembed.thumbnail_url) thumbnail = oembed.thumbnail_url;
                    if (oembed.title && !finalTitle) finalTitle = oembed.title;
                }
                if (!embedUrl) embedUrl = guessEmbedUrl(bookmark.url);
                if (!thumbnail && embedUrl && embedUrl.includes('youtube.com/embed/')) {
                    const videoId = embedUrl.split('/embed/')[1]?.split('?')[0];
                    if (videoId) thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
                }
            }
        }
        const bookmarks = await loadBookmarks();
        if (bookmarks.some(b => b.url === bookmark.url)) {
            UIUtils.showToast('Уже в избранном', 'info');
            throw new Error('duplicate');
        }
        bookmark.id = Date.now() + '-' + Math.random().toString(36);
        bookmark.added = new Date().toISOString();
        if (embedUrl) bookmark.embedUrl = embedUrl;
        if (downloadUrl) bookmark.downloadUrl = downloadUrl;
        if (thumbnail) bookmark.thumbnail = thumbnail;
        if (finalTitle) bookmark.title = finalTitle;
        bookmarks.push(bookmark);
        await saveBookmarks(bookmarks);
        return bookmark;
    }

    async function removeBookmark(bookmarkId) {
        const bookmarks = await loadBookmarks();
        const filtered = bookmarks.filter(b => b.id !== bookmarkId);
        await saveBookmarks(filtered);
    }

    // --- Полноэкранный просмотр видео ---
    function openVideoFullscreen(iframeElement, title) {
        if (!iframeElement) return;
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;';
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';
        closeBtn.style.cssText = 'position:absolute;top:20px;right:20px;background:rgba(0,0,0,0.7);color:white;border:none;border-radius:50%;width:40px;height:40px;font-size:20px;cursor:pointer;z-index:100001;';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            document.body.removeChild(overlay);
            iframeElement.style.position = '';
            iframeElement.style.width = '100%';
            iframeElement.style.height = '100%';
        };
        const titleDiv = document.createElement('div');
        titleDiv.textContent = title;
        titleDiv.style.cssText = 'position:absolute;top:20px;left:20px;color:white;font-size:18px;font-family:"Russo One",sans-serif;background:rgba(0,0,0,0.5);padding:8px 16px;border-radius:30px;z-index:100001;';
        const parent = iframeElement.parentNode;
        iframeElement.style.position = 'static';
        iframeElement.style.width = '90%';
        iframeElement.style.height = '85%';
        iframeElement.style.borderRadius = '12px';
        overlay.appendChild(iframeElement);
        overlay.appendChild(closeBtn);
        overlay.appendChild(titleDiv);
        document.body.appendChild(overlay);
        overlay.onclick = (e) => { if (e.target === overlay) closeBtn.click(); };
    }

    // --- Рендер карточки ---
    function renderBookmarkCard(bookmark, onDelete, onEdit) {
        const card = document.createElement('div');
        card.className = 'project-card-link tilt-card';
        card.style.cursor = 'pointer';
        const inner = document.createElement('div');
        inner.className = 'project-card';
        inner.style.position = 'relative';
        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'image-wrapper';
        imgWrapper.style.position = 'relative';
        const embedSrc = bookmark.embedUrl || (isEmbedUrl(bookmark.url) ? bookmark.url : null);
        let iframe = null;
        if (embedSrc) {
            iframe = document.createElement('iframe');
            iframe.src = embedSrc;
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = 'none';
            iframe.style.borderRadius = 'var(--border-radius-small)';
            iframe.setAttribute('frameborder', '0');
            iframe.setAttribute('allowfullscreen', 'true');
            iframe.setAttribute('loading', 'lazy');
            iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-forms allow-presentation');
            const videoOverlay = document.createElement('div');
            videoOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;cursor:pointer;z-index:1;';
            videoOverlay.onclick = (e) => { e.stopPropagation(); openVideoFullscreen(iframe, bookmark.title); };
            imgWrapper.appendChild(iframe);
            imgWrapper.appendChild(videoOverlay);
        } else {
            const img = document.createElement('img');
            img.src = bookmark.thumbnail || 'images/default-news.webp';
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
        actionsDiv.style.cssText = 'position:absolute;top:8px;right:8px;display:flex;gap:6px;z-index:3;';
        if (bookmark.downloadUrl) {
            const downloadBtn = document.createElement('button');
            downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
            Object.assign(downloadBtn.style, { background:'rgba(0,0,0,0.6)', color:'white', border:'none', borderRadius:'50%', width:'30px', height:'30px', cursor:'pointer' });
            downloadBtn.title = 'Скачать видео';
            downloadBtn.onclick = (e) => { e.stopPropagation(); window.open(bookmark.downloadUrl, '_blank'); };
            actionsDiv.appendChild(downloadBtn);
        }
        const editBtn = document.createElement('button');
        editBtn.innerHTML = '<i class="fas fa-pen"></i>';
        Object.assign(editBtn.style, { background:'rgba(0,0,0,0.6)', color:'white', border:'none', borderRadius:'50%', width:'30px', height:'30px', cursor:'pointer' });
        editBtn.onclick = (e) => { e.stopPropagation(); onEdit(bookmark); };
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        Object.assign(deleteBtn.style, { background:'rgba(0,0,0,0.6)', color:'white', border:'none', borderRadius:'50%', width:'30px', height:'30px', cursor:'pointer' });
        deleteBtn.onclick = (e) => { e.stopPropagation(); if (confirm('Удалить из избранного?')) onDelete(bookmark.id); };
        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);
        inner.appendChild(actionsDiv);
        card.appendChild(inner);
        card.onclick = (e) => {
            if (e.target.closest('button') || e.target.closest('.image-wrapper > div')) return;
            window.open(bookmark.url, '_blank');
        };
        return card;
    }

    // --- Модальное окно с сортировкой и анимированной формой добавления ---
    async function openStorageModalContent() {
        let currentBookmarks = [];
        let currentSort = 'new'; // new, old, type_all, type_video, type_post, type_link
        let addFormVisible = false;

        const contentHtml = `
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div class="storage-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <div class="sort-buttons" style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button class="button small sort-btn" data-sort="new" style="background:var(--accent);">📅 Новые</button>
                        <button class="button small sort-btn" data-sort="old">📅 Старые</button>
                        <button class="button small sort-btn" data-sort="type_all">📂 Все</button>
                        <button class="button small sort-btn" data-sort="type_video">🎬 Видео</button>
                        <button class="button small sort-btn" data-sort="type_post">📝 Посты</button>
                        <button class="button small sort-btn" data-sort="type_link">🔗 Ссылки</button>
                    </div>
                    <button class="button" id="toggle-add-btn" style="transition: all 0.2s;">➕ Добавить</button>
                </div>
                <div id="add-form" style="display:none; background:var(--bg-inner-gradient); border-radius:20px; padding:16px; margin-bottom:10px; transition: all 0.3s ease;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="url" id="new-url" placeholder="Ссылка..." style="flex:2; padding:10px 12px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                        <input type="text" id="new-title" placeholder="Название (опционально)" style="flex:2; padding:10px 12px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                        <button class="button" id="confirm-add" style="min-width:100px;">➕ Добавить</button>
                        <button class="button" id="cancel-add" style="background:#555;">✖ Отмена</button>
                    </div>
                </div>
                <div class="projects-grid" id="bookmarks-grid" style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px;">
                    <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>
                </div>
                <div style="margin-top:20px; padding:16px; background:var(--bg-inner-gradient); border-radius:16px;">
                    <p><i class="fas fa-info-circle"></i> <strong>Закладки</strong> хранятся в приватном GitHub Gist и синхронизируются.<br>
                    <i class="fas fa-video"></i> Для видео автоматически подбирается плеер, кнопка скачивания (если доступно), клик по видео — полноэкранный режим.</p>
                </div>
            </div>
        `;

        const { modal, closeModal } = UIUtils.createModal('Хранилище', contentHtml, { size: 'full' });
        const grid = modal.querySelector('#bookmarks-grid');
        const sortBtns = modal.querySelectorAll('.sort-btn');
        const toggleAddBtn = modal.querySelector('#toggle-add-btn');
        const addForm = modal.querySelector('#add-form');
        const newUrlInput = modal.querySelector('#new-url');
        const newTitleInput = modal.querySelector('#new-title');
        const confirmAddBtn = modal.querySelector('#confirm-add');
        const cancelAddBtn = modal.querySelector('#cancel-add');

        async function refreshAndRender() {
            try {
                currentBookmarks = await loadBookmarks();
                renderBookmarks();
            } catch (e) {
                grid.innerHTML = `<p class="error-message">Ошибка загрузки: ${e.message}</p>`;
            }
        }

        function getFilteredBookmarks() {
            let filtered = [...currentBookmarks];
            if (currentSort === 'type_video') {
                filtered = filtered.filter(b => b.embedUrl);
            } else if (currentSort === 'type_post') {
                filtered = filtered.filter(b => !b.embedUrl && (b.title && b.title.length > 0));
            } else if (currentSort === 'type_link') {
                filtered = filtered.filter(b => !b.embedUrl && !(b.title && b.title.length > 0));
            }
            if (currentSort === 'new') {
                filtered.sort((a,b) => new Date(b.added) - new Date(a.added));
            } else if (currentSort === 'old') {
                filtered.sort((a,b) => new Date(a.added) - new Date(b.added));
            } else {
                filtered.sort((a,b) => new Date(b.added) - new Date(a.added));
            }
            return filtered;
        }

        function renderBookmarks() {
            const filtered = getFilteredBookmarks();
            if (filtered.length === 0) {
                grid.innerHTML = '<div class="empty-state"><i class="fas fa-bookmark"></i><p>Нет закладок</p></div>';
                return;
            }
            grid.innerHTML = '';
            filtered.forEach(b => {
                const card = renderBookmarkCard(b,
                    async (id) => {
                        const original = [...currentBookmarks];
                        const index = currentBookmarks.findIndex(bk => bk.id === id);
                        if (index === -1) return;
                        currentBookmarks.splice(index, 1);
                        renderBookmarks();
                        localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(original));
                        try {
                            await removeBookmark(id);
                            localStorage.removeItem(LOCAL_BACKUP_KEY);
                        } catch (e) {
                            UIUtils.showToast('Ошибка удаления', 'error');
                            currentBookmarks = original;
                            renderBookmarks();
                        }
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
                            let newDownloadUrl = bookmark.downloadUrl;
                            let newThumbnail = bookmark.thumbnail;
                            let newTitle = titleField.value.trim() || newUrl;
                            if (newUrl !== bookmark.url) {
                                const oembed = await fetchEmbedData(newUrl);
                                newEmbedUrl = null;
                                newDownloadUrl = null;
                                newThumbnail = null;
                                if (oembed) {
                                    if (oembed.html) {
                                        const iframeMatch = oembed.html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
                                        if (iframeMatch && iframeMatch[1]) newEmbedUrl = iframeMatch[1];
                                    }
                                    if (oembed.url && (oembed.url.endsWith('.mp4') || oembed.url.endsWith('.webm') || oembed.url.includes('video/mp4'))) {
                                        newDownloadUrl = oembed.url;
                                    }
                                    if (oembed.thumbnail_url) newThumbnail = oembed.thumbnail_url;
                                    if (oembed.title && !newTitle) newTitle = oembed.title;
                                }
                                if (!newEmbedUrl) newEmbedUrl = guessEmbedUrl(newUrl);
                                if (!newThumbnail && newEmbedUrl && newEmbedUrl.includes('youtube.com/embed/')) {
                                    const videoId = newEmbedUrl.split('/embed/')[1]?.split('?')[0];
                                    if (videoId) newThumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
                                }
                            }
                            const updated = { 
                                ...bookmark, 
                                url: newUrl, 
                                title: newTitle,
                                embedUrl: newEmbedUrl || undefined,
                                downloadUrl: newDownloadUrl || undefined,
                                thumbnail: newThumbnail || undefined
                            };
                            const index = currentBookmarks.findIndex(b => b.id === bookmark.id);
                            if (index !== -1) currentBookmarks[index] = updated;
                            renderBookmarks();
                            await saveBookmarks(currentBookmarks);
                            closeEditModal();
                        });
                        editModal.querySelector('#cancel-edit').addEventListener('click', closeEditModal);
                    }
                );
                grid.appendChild(card);
            });
        }

        // Сортировка
        sortBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                currentSort = btn.dataset.sort;
                sortBtns.forEach(b => b.style.background = '');
                btn.style.background = 'var(--accent)';
                renderBookmarks();
            });
        });
        // Устанавливаем активную по умолчанию
        modal.querySelector('[data-sort="new"]').style.background = 'var(--accent)';

        // Анимированное появление формы добавления
        let isAnimating = false;
        function showAddForm() {
            if (addFormVisible) return;
            addFormVisible = true;
            addForm.style.display = 'block';
            addForm.style.opacity = '0';
            addForm.style.transform = 'translateY(-10px)';
            addForm.style.transition = 'opacity 0.2s, transform 0.2s';
            setTimeout(() => {
                addForm.style.opacity = '1';
                addForm.style.transform = 'translateY(0)';
            }, 10);
            toggleAddBtn.textContent = '✖ Отмена';
        }
        function hideAddForm() {
            if (!addFormVisible) return;
            addFormVisible = false;
            addForm.style.opacity = '0';
            addForm.style.transform = 'translateY(-10px)';
            setTimeout(() => {
                addForm.style.display = 'none';
                addForm.style.opacity = '';
                addForm.style.transform = '';
            }, 200);
            toggleAddBtn.textContent = '➕ Добавить';
            newUrlInput.value = '';
            newTitleInput.value = '';
        }
        toggleAddBtn.addEventListener('click', () => {
            if (addFormVisible) hideAddForm();
            else showAddForm();
        });
        cancelAddBtn.addEventListener('click', hideAddForm);

        confirmAddBtn.addEventListener('click', async () => {
            const url = newUrlInput.value.trim();
            if (!url) { UIUtils.showToast('Введите ссылку', 'error'); return; }
            const title = newTitleInput.value.trim() || url;
            confirmAddBtn.disabled = true;
            const optimisticBookmark = {
                id: 'temp-' + Date.now(),
                url,
                title,
                added: new Date().toISOString(),
                temp: true
            };
            currentBookmarks.unshift(optimisticBookmark);
            renderBookmarks();
            try {
                const final = await addBookmark({ url, title });
                const index = currentBookmarks.findIndex(b => b.id === optimisticBookmark.id);
                if (index !== -1) currentBookmarks[index] = final;
                renderBookmarks();
                UIUtils.showToast('Добавлено', 'success');
                hideAddForm();
            } catch (err) {
                if (err.message !== 'duplicate') UIUtils.showToast('Ошибка: ' + err.message, 'error');
                const index = currentBookmarks.findIndex(b => b.id === optimisticBookmark.id);
                if (index !== -1) currentBookmarks.splice(index, 1);
                renderBookmarks();
            } finally {
                confirmAddBtn.disabled = false;
            }
        });

        await refreshAndRender();
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