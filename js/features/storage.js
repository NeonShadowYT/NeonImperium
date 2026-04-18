// js/features/storage.js — Хранилище закладок через GitHub Gist с восстановлением и полным UI
(function() {
    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium bookmarks storage';
    const STORAGE_KEY_PREFIX = 'bookmarks_';
    const LOCAL_STORAGE_KEY = 'neon_imperium_bookmarks_local';
    const LOCAL_BACKUP_KEY = 'neon_imperium_bookmarks_backup';
    const RECOVERY_SALT = new TextEncoder().encode('neon-imperium-recovery-salt-v1');

    let currentUser = null;
    let currentToken = null;
    let gistId = null;

    // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
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

    // Шифрование данных токеном GitHub (основной слой для текущих закладок)
    function getEncryptionKey() {
        if (!currentToken) return 'default-key';
        let hash = 0;
        for (let i = 0; i < currentToken.length; i++) {
            hash = ((hash << 5) - hash) + currentToken.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(16);
    }
    function encryptWithToken(data) {
        const key = getEncryptionKey();
        const json = JSON.stringify(data);
        let result = '';
        for (let i = 0; i < json.length; i++) {
            const charCode = json.charCodeAt(i) ^ key.charCodeAt(i % key.length);
            result += String.fromCharCode(charCode);
        }
        return toBase64(result);
    }
    function decryptWithToken(encrypted) {
        if (!encrypted) return null;
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
            console.warn('Token decryption failed', e);
            return null;
        }
    }

    // Функции для работы с мастер-паролем (Web Crypto API)
    async function deriveKeyFromPassword(password, salt) {
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptWithPassword(data, password) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKeyFromPassword(password, RECOVERY_SALT);
        const enc = new TextEncoder();
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            enc.encode(JSON.stringify(data))
        );
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);
        return toBase64(String.fromCharCode(...combined));
    }

    async function decryptWithPassword(encryptedBase64, password) {
        try {
            const combined = new Uint8Array(fromBase64(encryptedBase64).split('').map(c => c.charCodeAt(0)));
            const iv = combined.slice(0, 12);
            const encryptedData = combined.slice(12);
            const key = await deriveKeyFromPassword(password, RECOVERY_SALT);
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                encryptedData
            );
            return JSON.parse(new TextDecoder().decode(decrypted));
        } catch (e) {
            console.warn('Password decryption failed', e);
            return null;
        }
    }

    // Работа с Gist через GitHub API
    async function fetchGist(gistId, token) {
        const url = `https://api.github.com/gists/${gistId}`;
        const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!resp.ok) {
            if (resp.status === 404) return null; // Gist не найден
            throw new Error(`Gist fetch failed: ${resp.status}`);
        }
        return resp.json();
    }

    async function updateGist(gistId, content, token) {
        const url = `https://api.github.com/gists/${gistId}`;
        const resp = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } })
        });
        if (!resp.ok) throw new Error(`Gist update failed: ${resp.status}`);
        return resp.json();
    }

    async function createGist(content, token) {
        const url = 'https://api.github.com/gists';
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                description: GIST_DESCRIPTION,
                public: false,
                files: { [GIST_FILENAME]: { content } }
            })
        });
        if (!resp.ok) throw new Error(`Gist create failed: ${resp.status}`);
        const gist = await resp.json();
        return gist.id;
    }

    async function deleteGist(gistId, token) {
        try {
            await fetch(`https://api.github.com/gists/${gistId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (e) {
            console.warn('Failed to delete gist', e);
        }
    }

    // ==================== ОСНОВНЫЕ ФУНКЦИИ РАБОТЫ С ХРАНИЛИЩЕМ ====================
    async function loadBookmarks() {
        if (!currentToken) {
            try { return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch { return []; }
        }
        try {
            if (!gistId) {
                const stored = localStorage.getItem(STORAGE_KEY_PREFIX + currentUser);
                if (stored) gistId = JSON.parse(stored).gistId;
            }
            if (!gistId) return { bookmarks: [], needSetup: true };
            
            const gist = await fetchGist(gistId, currentToken);
            if (!gist) return { bookmarks: [], needSetup: true };
            
            const file = gist.files[GIST_FILENAME];
            if (!file) return { bookmarks: [], needSetup: true };
            
            // Пытаемся расшифровать токеном
            const decrypted = decryptWithToken(file.content);
            if (decrypted && decrypted.bookmarks) {
                return { bookmarks: decrypted.bookmarks };
            }
            
            // Если не получилось, проверяем, есть ли recovery (может быть в поле recovery внутри зашифрованного токеном объекта)
            if (decrypted && decrypted.recovery) {
                return { recoveryNeeded: true, recoveryData: decrypted.recovery };
            }
            
            // Возможно, файл вообще не зашифрован токеном (устаревший формат) или повреждён
            // Пробуем распарсить как обычный JSON (для обратной совместимости)
            try {
                const raw = JSON.parse(file.content);
                if (raw.recovery) return { recoveryNeeded: true, recoveryData: raw.recovery };
                if (raw.bookmarks) return { bookmarks: raw.bookmarks };
            } catch {}
            
            return { bookmarks: [], needSetup: true };
        } catch (e) {
            console.warn('Gist load failed', e);
            if (e.message.includes('403')) {
                throw new Error('TOKEN_NO_GIST_SCOPE');
            }
            try { return { bookmarks: JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]') }; } catch { return { bookmarks: [] }; }
        }
    }

    async function saveBookmarks(bookmarks) {
        if (!currentToken) {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
            return;
        }
        // Получаем текущий gist, чтобы сохранить recovery если есть
        let recoveryData = null;
        if (gistId) {
            try {
                const gist = await fetchGist(gistId, currentToken);
                if (gist && gist.files[GIST_FILENAME]) {
                    const content = gist.files[GIST_FILENAME].content;
                    const decrypted = decryptWithToken(content);
                    if (decrypted && decrypted.recovery) {
                        recoveryData = decrypted.recovery;
                    }
                }
            } catch {}
        }
        
        const payload = { bookmarks };
        if (recoveryData) payload.recovery = recoveryData;
        
        const encrypted = encryptWithToken(payload);
        try {
            if (gistId) {
                await updateGist(gistId, encrypted, currentToken);
            } else {
                gistId = await createGist(encrypted, currentToken);
                localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
            }
        } catch (e) {
            console.warn('Gist save failed, using local', e);
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
        }
    }

    async function setupRecovery(masterPassword) {
        if (!currentToken || !gistId) throw new Error('No active storage');
        const gist = await fetchGist(gistId, currentToken);
        if (!gist) throw new Error('Gist not found');
        const file = gist.files[GIST_FILENAME];
        if (!file) throw new Error('No data to protect');
        const currentData = decryptWithToken(file.content);
        const bookmarks = currentData?.bookmarks || [];
        const encryptedBookmarks = await encryptWithPassword(bookmarks, masterPassword);
        const recoveryPayload = {
            version: 1,
            user: currentUser,
            encryptedBookmarks,
            timestamp: Date.now()
        };
        const newPayload = { bookmarks, recovery: recoveryPayload };
        const encrypted = encryptWithToken(newPayload);
        await updateGist(gistId, encrypted, currentToken);
        return true;
    }

    async function recoverWithPassword(masterPassword) {
        if (!currentToken || !gistId) throw new Error('No storage to recover');
        const gist = await fetchGist(gistId, currentToken);
        if (!gist) throw new Error('Gist not found');
        const file = gist.files[GIST_FILENAME];
        if (!file) throw new Error('No data found');
        
        let recovery;
        // Пробуем расшифровать токеном
        const decrypted = decryptWithToken(file.content);
        if (decrypted && decrypted.recovery) {
            recovery = decrypted.recovery;
        } else {
            // Может быть старый формат без шифрования токеном
            try {
                const raw = JSON.parse(file.content);
                if (raw.recovery) recovery = raw.recovery;
            } catch {}
        }
        if (!recovery) throw new Error('No recovery data available');
        
        const bookmarks = await decryptWithPassword(recovery.encryptedBookmarks, masterPassword);
        if (!bookmarks) throw new Error('Invalid master password');
        
        // Сохраняем расшифрованные данные обратно в Gist
        const newPayload = { bookmarks, recovery };
        const encrypted = encryptWithToken(newPayload);
        await updateGist(gistId, encrypted, currentToken);
        return bookmarks;
    }

    async function resetStorage() {
        if (!currentToken) return;
        if (gistId) {
            await deleteGist(gistId, currentToken);
        }
        gistId = null;
        localStorage.removeItem(STORAGE_KEY_PREFIX + currentUser);
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        localStorage.removeItem(LOCAL_BACKUP_KEY);
    }

    // ==================== МУЛЬТИ-СЕРВИСНОЕ ПОЛУЧЕНИЕ ВИДЕО ====================
    async function fetchEmbedData(url) {
        const services = [
            `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
            `https://iframe.ly/api/oembed?url=${encodeURIComponent(url)}`,
            `https://api.embed.ly/1/oembed?url=${encodeURIComponent(url)}`
        ];
        for (const serviceUrl of services) {
            try {
                const response = await fetch(serviceUrl, { signal: AbortSignal.timeout(5000) });
                if (!response.ok) continue;
                const data = await response.json();
                if (data && (data.html || data.url || data.thumbnail_url)) return data;
            } catch {}
        }
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
        } catch {}
        return null;
    }

    function guessEmbedUrl(url) {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            const origin = urlObj.origin;
            const path = urlObj.pathname;
            const search = urlObj.search;
            if (url.includes('youtube.com/shorts/') || url.includes('youtu.be/shorts/')) {
                const match = url.match(/(?:youtube\.com\/shorts\/|youtu\.be\/shorts\/)([a-zA-Z0-9_-]+)/);
                if (match) return `https://www.youtube.com/embed/${match[1]}`;
            }
            if (search.includes('v=')) {
                const params = new URLSearchParams(search);
                const videoId = params.get('v');
                if (videoId) return `https://www.youtube.com/embed/${videoId}`;
            }
            if (path.includes('view_video.php') && search.includes('viewkey=')) {
                const params = new URLSearchParams(search);
                const videoId = params.get('viewkey');
                if (videoId) return `${origin}/embed/${videoId}`;
            }
            if (path.includes('/embed/')) return url;
            if (path.includes('/v/')) {
                const videoId = path.split('/v/')[1]?.split('?')[0];
                if (videoId) return `${origin}/embed/${videoId}`;
            }
            const viewMatch = path.match(/\/(view|watch)\/([a-zA-Z0-9_-]+)/);
            if (viewMatch) return `${origin}/embed/${viewMatch[2]}`;
            const videoMatch = path.match(/\/video\/([a-zA-Z0-9_-]+)/);
            if (videoMatch) return `${origin}/embed/${videoMatch[1]}`;
            return null;
        } catch (e) {
            return null;
        }
    }

    function isEmbedUrl(url) {
        if (!url) return false;
        const lowerUrl = url.toLowerCase();
        return lowerUrl.includes('/embed/') || lowerUrl.includes('/player/') || lowerUrl.includes('?embed') || lowerUrl.includes('/v/');
    }

    function isSitePostUrl(url) {
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname === 'neonshadowyt.github.io' || urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
                const params = new URLSearchParams(urlObj.search);
                if (params.has('post')) return true;
            }
        } catch {}
        return false;
    }

    async function addBookmark(bookmark) {
        if (!currentUser) { UIUtils.showToast('Войдите в аккаунт', 'error'); return; }
        let finalUrl = bookmark.url;
        let embedUrl = null;
        let downloadUrl = null;
        let thumbnail = null;
        let finalTitle = bookmark.title;
        let postType = bookmark.postType || null;

        if (bookmark.url) {
            if (isSitePostUrl(bookmark.url)) {
                postType = 'site-post';
            } else if (isEmbedUrl(bookmark.url)) {
                embedUrl = bookmark.url;
                finalUrl = bookmark.url;
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
                if (embedUrl) finalUrl = embedUrl;
                if (!thumbnail && embedUrl && embedUrl.includes('youtube.com/embed/')) {
                    const videoId = embedUrl.split('/embed/')[1]?.split('?')[0];
                    if (videoId) thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
                }
            }
        }

        const bookmarks = await loadBookmarks();
        const bookmarksArray = bookmarks.bookmarks || bookmarks;
        if (bookmarksArray && bookmarksArray.some(b => b.url === finalUrl)) {
            UIUtils.showToast('Уже в избранном', 'info');
            throw new Error('duplicate');
        }
        bookmark.id = Date.now() + '-' + Math.random().toString(36);
        bookmark.added = new Date().toISOString();
        bookmark.url = finalUrl;
        if (embedUrl) bookmark.embedUrl = embedUrl;
        if (downloadUrl) bookmark.downloadUrl = downloadUrl;
        if (thumbnail) bookmark.thumbnail = thumbnail;
        if (finalTitle) bookmark.title = finalTitle;
        if (postType) bookmark.postType = postType;
        
        const newBookmarks = bookmarksArray ? [...bookmarksArray, bookmark] : [bookmark];
        await saveBookmarks(newBookmarks);
        return bookmark;
    }

    async function removeBookmark(bookmarkId) {
        let bookmarks = await loadBookmarks();
        const bookmarksArray = bookmarks.bookmarks || bookmarks;
        if (!bookmarksArray) return;
        const filtered = bookmarksArray.filter(b => b.id !== bookmarkId);
        await saveBookmarks(filtered);
    }

    // ==================== ПОЛНОЭКРАННЫЙ РЕЖИМ ДЛЯ ВИДЕО ====================
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

    // ==================== РЕНДЕР КАРТОЧКИ ====================
    function renderBookmarkCard(bookmark, onDelete, onEditSave) {
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

        const titleContainer = document.createElement('div');
        titleContainer.style.display = 'flex';
        titleContainer.style.alignItems = 'center';
        titleContainer.style.gap = '8px';
        titleContainer.style.flexWrap = 'wrap';
        const titleSpan = document.createElement('h3');
        titleSpan.textContent = bookmark.title.length > 60 ? bookmark.title.substring(0,60)+'…' : bookmark.title;
        titleSpan.style.flex = '1';
        titleSpan.style.cursor = 'pointer';
        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = bookmark.title;
        titleInput.style.display = 'none';
        titleInput.style.flex = '1';
        titleInput.style.padding = '4px 8px';
        titleInput.style.borderRadius = '20px';
        titleInput.style.border = '1px solid var(--accent)';
        titleInput.style.background = 'var(--bg-primary)';
        titleInput.style.color = 'var(--text-primary)';
        titleContainer.appendChild(titleSpan);
        titleContainer.appendChild(titleInput);
        inner.appendChild(titleContainer);

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
        let editMode = false;
        editBtn.onclick = (e) => {
            e.stopPropagation();
            if (editMode) {
                const newTitle = titleInput.value.trim();
                if (newTitle && newTitle !== bookmark.title) {
                    bookmark.title = newTitle;
                    titleSpan.textContent = newTitle.length > 60 ? newTitle.substring(0,60)+'…' : newTitle;
                    onEditSave(bookmark);
                }
                titleSpan.style.display = 'block';
                titleInput.style.display = 'none';
                editBtn.innerHTML = '<i class="fas fa-pen"></i>';
            } else {
                titleSpan.style.display = 'none';
                titleInput.style.display = 'block';
                titleInput.focus();
                editBtn.innerHTML = '<i class="fas fa-save"></i>';
            }
            editMode = !editMode;
        };
        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        Object.assign(deleteBtn.style, { background:'rgba(0,0,0,0.6)', color:'white', border:'none', borderRadius:'50%', width:'30px', height:'30px', cursor:'pointer' });
        deleteBtn.onclick = (e) => { e.stopPropagation(); if (confirm('Удалить из избранного?')) onDelete(bookmark.id); };
        actionsDiv.appendChild(editBtn);
        actionsDiv.appendChild(deleteBtn);
        inner.appendChild(actionsDiv);
        card.appendChild(inner);
        card.onclick = (e) => {
            if (e.target.closest('button') || e.target.closest('.image-wrapper > div') || e.target.closest('input')) return;
            window.open(bookmark.url, '_blank');
        };
        return card;
    }

    // ==================== МОДАЛЬНОЕ ОКНО ХРАНИЛИЩА ====================
    async function openStorageModalContent() {
        if (!GithubAuth.hasScope('gist')) {
            UIUtils.showToast('Для использования хранилища необходим токен с разрешением "gist".', 'error', 8000);
            return;
        }

        let currentBookmarks = [];
        let sortOrder = 'new';
        let category = 'all';
        let needSetup = false;
        let recoveryNeeded = false;
        let recoveryData = null;

        try {
            const result = await loadBookmarks();
            if (result.recoveryNeeded) {
                recoveryNeeded = true;
                recoveryData = result.recoveryData;
            } else if (result.needSetup) {
                needSetup = true;
            } else {
                currentBookmarks = result.bookmarks || [];
            }
        } catch (e) {
            if (e.message === 'TOKEN_NO_GIST_SCOPE') {
                UIUtils.showToast('Токен не имеет доступа к Gist. Убедитесь, что при создании токена выбрана область "gist".', 'error', 8000);
                return;
            }
            UIUtils.showToast('Ошибка загрузки хранилища: ' + e.message, 'error');
            return;
        }

        if (recoveryNeeded) {
            const password = await new Promise(resolve => {
                const pwd = prompt('Хранилище защищено мастер-паролем. Введите пароль для восстановления:');
                resolve(pwd);
            });
            if (!password) {
                UIUtils.showToast('Восстановление отменено', 'info');
                return;
            }
            try {
                const bookmarks = await recoverWithPassword(password);
                currentBookmarks = bookmarks;
                needSetup = false;
                recoveryNeeded = false;
                UIUtils.showToast('Хранилище успешно восстановлено!', 'success');
            } catch (err) {
                UIUtils.showToast('Неверный пароль или ошибка восстановления', 'error');
                if (confirm('Не удалось восстановить хранилище. Сбросить и создать новое?')) {
                    await resetStorage();
                    needSetup = true;
                    recoveryNeeded = false;
                } else {
                    return;
                }
            }
        }

        if (needSetup) {
            const password = await new Promise(resolve => {
                const pwd = prompt('Создайте мастер-пароль для восстановления хранилища (запомните его! Минимум 4 символа):');
                resolve(pwd);
            });
            if (!password || password.length < 4) {
                UIUtils.showToast('Пароль слишком короткий. Хранилище не будет создано.', 'error');
                return;
            }
            try {
                const encrypted = encryptWithToken({ bookmarks: [] });
                gistId = await createGist(encrypted, currentToken);
                localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
                await setupRecovery(password);
                currentBookmarks = [];
                UIUtils.showToast('Хранилище создано и защищено паролем!', 'success');
            } catch (err) {
                UIUtils.showToast('Ошибка создания хранилища: ' + err.message, 'error');
                return;
            }
        }

        const contentHtml = `
            <div style="display:flex; flex-direction:column; gap:16px;">
                <div class="storage-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <div class="access-switch" style="display:inline-flex;">
                            <button class="access-switch-btn ${sortOrder === 'new' ? 'active' : ''}" data-order="new">Новые</button>
                            <button class="access-switch-btn ${sortOrder === 'old' ? 'active' : ''}" data-order="old">Старые</button>
                        </div>
                        <div class="category-buttons" style="display:flex; gap:4px;">
                            <button class="button small cat-btn ${category === 'all' ? 'active' : ''}" data-cat="all">Все</button>
                            <button class="button small cat-btn ${category === 'video' ? 'active' : ''}" data-cat="video"><i class="fas fa-video"></i> Видео</button>
                            <button class="button small cat-btn ${category === 'post' ? 'active' : ''}" data-cat="post"><i class="fas fa-newspaper"></i> Посты</button>
                            <button class="button small cat-btn ${category === 'link' ? 'active' : ''}" data-cat="link"><i class="fas fa-link"></i> Ссылки</button>
                        </div>
                    </div>
                    <div style="display:flex; gap:6px; flex-shrink:0;">
                        <button class="button small" id="setup-recovery-btn"><i class="fas fa-shield-alt"></i> Восстановление</button>
                        <button class="button small" id="reset-storage-btn" style="background:#f44336;"><i class="fas fa-trash-alt"></i> Сброс</button>
                        <button class="button small" id="toggle-add-btn"><i class="fas fa-plus"></i> Добавить</button>
                    </div>
                </div>
                <div id="add-form" style="display:none; background:var(--bg-inner-gradient); border-radius:20px; padding:16px; margin-bottom:10px;">
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <input type="url" id="new-url" placeholder="Ссылка на видео, пост или страницу..." style="flex:3; padding:10px 12px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                        <input type="text" id="new-title" placeholder="Название (опционально)" style="flex:2; padding:10px 12px; border-radius:30px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary);">
                        <button class="button small" id="confirm-add"><i class="fas fa-check"></i> Добавить</button>
                    </div>
                </div>
                <div class="projects-grid" id="bookmarks-grid" style="display:grid; grid-template-columns:repeat(3,1fr); gap:16px;"></div>
            </div>
        `;

        const { modal, closeModal } = UIUtils.createModal('Хранилище', contentHtml, { size: 'full' });
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        
        const grid = modal.querySelector('#bookmarks-grid');
        const orderBtns = modal.querySelectorAll('.access-switch-btn');
        const catBtns = modal.querySelectorAll('.cat-btn');
        const toggleAddBtn = modal.querySelector('#toggle-add-btn');
        const addForm = modal.querySelector('#add-form');
        const newUrlInput = modal.querySelector('#new-url');
        const newTitleInput = modal.querySelector('#new-title');
        const confirmAddBtn = modal.querySelector('#confirm-add');
        const setupRecoveryBtn = modal.querySelector('#setup-recovery-btn');
        const resetStorageBtn = modal.querySelector('#reset-storage-btn');

        function renderBookmarks() {
            let filtered = [...currentBookmarks];
            if (category === 'video') filtered = filtered.filter(b => b.embedUrl);
            else if (category === 'post') filtered = filtered.filter(b => b.postType && ['feedback','news','update','site-post'].includes(b.postType));
            else if (category === 'link') filtered = filtered.filter(b => !b.embedUrl && !(b.postType && ['feedback','news','update','site-post'].includes(b.postType)));
            filtered.sort((a,b) => {
                const dateA = new Date(a.added);
                const dateB = new Date(b.added);
                return sortOrder === 'new' ? dateB - dateA : dateA - dateB;
            });
            if (filtered.length === 0) {
                grid.innerHTML = '<div class="empty-state"><i class="fas fa-bookmark"></i><p>Нет закладок</p></div>';
                return;
            }
            grid.innerHTML = '';
            filtered.forEach(b => {
                const card = renderBookmarkCard(b,
                    async (id) => {
                        const index = currentBookmarks.findIndex(bk => bk.id === id);
                        if (index === -1) return;
                        currentBookmarks.splice(index, 1);
                        renderBookmarks();
                        try {
                            await removeBookmark(id);
                        } catch (e) {
                            UIUtils.showToast('Ошибка удаления', 'error');
                        }
                    },
                    async (updatedBookmark) => {
                        const index = currentBookmarks.findIndex(b => b.id === updatedBookmark.id);
                        if (index !== -1) currentBookmarks[index] = updatedBookmark;
                        await saveBookmarks(currentBookmarks);
                        renderBookmarks();
                    }
                );
                grid.appendChild(card);
            });
        }

        renderBookmarks();

        orderBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                sortOrder = btn.dataset.order;
                orderBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderBookmarks();
            });
        });
        catBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                category = btn.dataset.cat;
                catBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderBookmarks();
            });
        });

        setupRecoveryBtn.addEventListener('click', async () => {
            const masterPassword = prompt('Введите новый мастер-пароль для восстановления (запомните его!):');
            if (masterPassword && masterPassword.length >= 4) {
                try {
                    await setupRecovery(masterPassword);
                    UIUtils.showToast('Восстановление обновлено!', 'success');
                } catch (err) {
                    UIUtils.showToast('Ошибка настройки: ' + err.message, 'error');
                }
            } else {
                UIUtils.showToast('Пароль должен быть не менее 4 символов', 'warning');
            }
        });

        resetStorageBtn.addEventListener('click', async () => {
            if (confirm('ВНИМАНИЕ! Это удалит все ваши закладки без возможности восстановления. Продолжить?')) {
                try {
                    await resetStorage();
                    currentBookmarks = [];
                    renderBookmarks();
                    UIUtils.showToast('Хранилище сброшено', 'success');
                    closeModal();
                    setTimeout(() => openStorageModal(), 100);
                } catch (err) {
                    UIUtils.showToast('Ошибка сброса: ' + err.message, 'error');
                }
            }
        });

        let addFormVisible = false;
        function showAddForm() {
            if (addFormVisible) return;
            addFormVisible = true;
            addForm.style.display = 'block';
            addForm.style.opacity = '0';
            addForm.style.transform = 'translateY(-10px)';
            setTimeout(() => {
                addForm.style.opacity = '1';
                addForm.style.transform = 'translateY(0)';
            }, 10);
            toggleAddBtn.innerHTML = '<i class="fas fa-times"></i> Отмена';
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
            toggleAddBtn.innerHTML = '<i class="fas fa-plus"></i> Добавить';
            newUrlInput.value = '';
            newTitleInput.value = '';
        }
        toggleAddBtn.addEventListener('click', () => {
            if (addFormVisible) hideAddForm();
            else showAddForm();
        });

        confirmAddBtn.addEventListener('click', async () => {
            const url = newUrlInput.value.trim();
            if (!url) { UIUtils.showToast('Введите ссылку', 'error'); return; }
            const title = newTitleInput.value.trim() || url;
            confirmAddBtn.disabled = true;
            const optimisticBookmark = { id: 'temp-' + Date.now(), url, title, added: new Date().toISOString(), temp: true };
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

    function updateAuthState() {
        currentUser = window.GithubAuth?.getCurrentUser();
        currentToken = window.GithubAuth?.getToken();
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

    window.BookmarkStorage = {
        openStorageModal,
        addBookmark,
        loadBookmarks,
        removeBookmark,
        setupRecovery,
        recoverWithPassword,
        resetStorage
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateAuthState);
    else updateAuthState();
})();