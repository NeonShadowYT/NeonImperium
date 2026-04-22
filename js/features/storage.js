// js/features/storage.js — Хранилище закладок через GitHub Gist
// Полностью переработанный интерфейс с анимациями, адаптивностью и оптимистичными обновлениями.
const BookmarkStorage = (function() {
    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium bookmarks storage';
    const STORAGE_KEY_PREFIX = 'bookmarks_';
    const LOCAL_STORAGE_KEY = 'neon_imperium_bookmarks_local';
    const SESSION_CACHE_KEY = 'bookmarks_session_cache';
    const RECOVERY_SALT = new TextEncoder().encode('neon-imperium-recovery-salt-v1');

    let currentUser = null;
    let currentToken = null;
    let gistId = null;
    let masterPassword = null;
    let cachedBookmarks = null;
    let currentModal = null;
    let currentGrid = null;
    let currentBookmarks = [];
    let sortOrder = 'new';
    let category = 'all';
    let addFormVisible = false;

    // ==================== УТИЛИТЫ ====================
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
            return null;
        }
    }

    // ==================== GIST API ====================
    async function fetchGist(gistId, token) {
        const url = `https://api.github.com/gists/${gistId}`;
        const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!resp.ok) {
            if (resp.status === 404) return null;
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
        } catch (e) {}
    }

    // ==================== КЭШ СЕССИИ ====================
    function saveSessionCache(bookmarks, password) {
        if (password) {
            try {
                sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
                    user: currentUser,
                    bookmarks: bookmarks,
                    timestamp: Date.now()
                }));
            } catch (e) {}
        }
        cachedBookmarks = bookmarks;
    }

    function loadSessionCache() {
        if (cachedBookmarks) return cachedBookmarks;
        try {
            const cached = sessionStorage.getItem(SESSION_CACHE_KEY);
            if (cached) {
                const data = JSON.parse(cached);
                if (data.user === currentUser) {
                    cachedBookmarks = data.bookmarks;
                    return data.bookmarks;
                }
            }
        } catch (e) {}
        return null;
    }

    function clearSessionCache() {
        sessionStorage.removeItem(SESSION_CACHE_KEY);
        cachedBookmarks = null;
    }

    // ==================== ЗАГРУЗКА/СОХРАНЕНИЕ ====================
    async function loadBookmarks(password = null) {
        if (!currentToken) {
            try { return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch { return []; }
        }

        if (!password) {
            const sessionCache = loadSessionCache();
            if (sessionCache) return { bookmarks: sessionCache };
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

            let payload;
            try {
                payload = JSON.parse(file.content);
            } catch {
                payload = { encryptedBookmarks: file.content };
            }

            if (payload.encryptedBookmarks) {
                if (!password) {
                    return { passwordRequired: true, user: payload.user, version: payload.version };
                }
                const bookmarks = await decryptWithPassword(payload.encryptedBookmarks, password);
                if (!bookmarks) throw new Error('Invalid password');
                saveSessionCache(bookmarks, password);
                return { bookmarks };
            } else if (payload.bookmarks) {
                return { bookmarks: payload.bookmarks, legacy: true };
            } else {
                return { bookmarks: [], needSetup: true };
            }
        } catch (e) {
            if (e.message.includes('403')) throw new Error('TOKEN_NO_GIST_SCOPE');
            if (e.message === 'Invalid password') throw e;
            try { return { bookmarks: JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]') }; } catch { return { bookmarks: [] }; }
        }
    }

    async function saveBookmarks(bookmarks, password = masterPassword) {
        if (!currentToken) {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
            return;
        }
        if (!password) throw new Error('Master password is required');

        saveSessionCache(bookmarks, password);

        const encrypted = await encryptWithPassword(bookmarks, password);
        const payload = {
            version: 2,
            user: currentUser,
            encryptedBookmarks: encrypted,
            timestamp: Date.now()
        };
        const content = JSON.stringify(payload);

        try {
            if (gistId) {
                await updateGist(gistId, content, currentToken);
            } else {
                gistId = await createGist(content, currentToken);
                localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
            }
        } catch (e) {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
        }
    }

    async function changeMasterPassword(oldPassword, newPassword) {
        if (!currentToken || !gistId) throw new Error('No active storage');
        const result = await loadBookmarks(oldPassword);
        if (result.passwordRequired) throw new Error('Old password required');
        if (result.needSetup) throw new Error('Storage not initialized');
        const bookmarks = result.bookmarks || [];
        await saveBookmarks(bookmarks, newPassword);
        masterPassword = newPassword;
        return true;
    }

    async function resetStorage() {
        if (!currentToken) return;
        if (gistId) await deleteGist(gistId, currentToken);
        gistId = null;
        masterPassword = null;
        clearSessionCache();
        localStorage.removeItem(STORAGE_KEY_PREFIX + currentUser);
        localStorage.removeItem(LOCAL_STORAGE_KEY);
    }

    // ==================== ПРОДВИНУТОЕ ПОЛУЧЕНИЕ ДАННЫХ ====================

    function guessEmbedUrl(url) {
        if (!url) return null;
        try {
            const urlObj = new URL(url);
            const origin = urlObj.origin;
            const path = urlObj.pathname;
            const search = urlObj.search;
            
            // Обработка view_video.php
            if (path.includes('view_video.php') && search.includes('viewkey=')) {
                const params = new URLSearchParams(search);
                const videoId = params.get('viewkey');
                if (videoId) return `${origin}/embed/${videoId}`;
            }
            
            if (url.includes('youtube.com/shorts/') || url.includes('youtu.be/shorts/')) {
                const match = url.match(/(?:youtube\.com\/shorts\/|youtu\.be\/shorts\/)([a-zA-Z0-9_-]+)/);
                if (match) return `https://www.youtube.com/embed/${match[1]}`;
            }
            if (search.includes('v=')) {
                const params = new URLSearchParams(search);
                const videoId = params.get('v');
                if (videoId) return `https://www.youtube.com/embed/${videoId}`;
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
        } catch {
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

    // Расширенный список oEmbed провайдеров
    const OEMBED_PROVIDERS = [
        (url) => `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
        (url) => `https://iframe.ly/api/oembed?url=${encodeURIComponent(url)}`,
        (url) => `https://api.embed.ly/1/oembed?url=${encodeURIComponent(url)}`,
        (url) => `https://app.embed.rocks/api/oembed?url=${encodeURIComponent(url)}`,
        (url) => `https://api.microlink.io/?url=${encodeURIComponent(url)}`,
        (url) => `https://jsonlink.io/api/extract?url=${encodeURIComponent(url)}`,
        (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
    ];

    async function fetchOEmbedData(url) {
        const controllers = OEMBED_PROVIDERS.map(() => new AbortController());
        const timeoutId = setTimeout(() => controllers.forEach(c => c.abort()), 5000);

        const promises = OEMBED_PROVIDERS.map(async (provider, index) => {
            try {
                const apiUrl = provider(url);
                const resp = await fetch(apiUrl, { signal: controllers[index].signal });
                if (!resp.ok) return null;
                const data = await resp.json();
                if (data) {
                    // Адаптация под разные форматы ответов
                    if (data.contents) {
                        const html = data.contents;
                        const titleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"[^>]*>/i);
                        const imageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"[^>]*>/i);
                        const videoMatch = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"[^>]*>/i);
                        return {
                            title: titleMatch ? titleMatch[1] : null,
                            thumbnail_url: imageMatch ? imageMatch[1] : null,
                            url: videoMatch ? videoMatch[1] : null
                        };
                    }
                    if (data.html || data.url || data.thumbnail_url || data.image || data.title) {
                        return {
                            title: data.title || null,
                            thumbnail_url: data.thumbnail_url || data.image || data.thumbnail || null,
                            url: data.url || null,
                            html: data.html || null
                        };
                    }
                }
                return null;
            } catch {
                return null;
            }
        });

        try {
            const result = await Promise.any(promises);
            clearTimeout(timeoutId);
            return result;
        } catch {
            clearTimeout(timeoutId);
            return null;
        }
    }

    // Сервисы для получения прямых ссылок на видео
    const VIDEO_DOWNLOAD_SERVICES = [
        {
            name: 'Cobalt',
            endpoint: 'https://co.wuk.sh/api/json',
            method: 'POST',
            getBody: (url) => JSON.stringify({ url, aFormat: 'best', vCodec: 'h264' })
        },
        {
            name: 'AllMedia',
            endpoint: 'https://allmedia-downloader.p.rapidapi.com/download',
            method: 'GET',
            getUrl: (url) => `https://allmedia-downloader.p.rapidapi.com/download?url=${encodeURIComponent(url)}`
        }
    ];

    async function fetchDirectVideoUrl(url) {
        const promises = VIDEO_DOWNLOAD_SERVICES.map(async (service) => {
            try {
                let resp;
                if (service.method === 'POST') {
                    resp = await fetch(service.endpoint, {
                        method: 'POST',
                        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                        body: service.getBody(url)
                    });
                } else {
                    resp = await fetch(service.getUrl(url));
                }
                if (!resp.ok) return null;
                const data = await resp.json();
                // Cobalt API
                if (data.status === 'success' || data.url) {
                    return data.url;
                }
                // AllMedia API
                if (data.success && data.data && data.data.url) {
                    return data.data.url;
                }
                return null;
            } catch {
                return null;
            }
        });

        try {
            return await Promise.any(promises);
        } catch {
            return null;
        }
    }

    // ==================== ДОБАВЛЕНИЕ/УДАЛЕНИЕ ====================
    async function addBookmark(bookmark) {
        if (!currentUser) { UIUtils.showToast('Войдите в аккаунт', 'error'); return; }
        if (!masterPassword) {
            await openStorageModal();
            if (!masterPassword) return;
        }
    
        if (!bookmark || !bookmark.url) {
            UIUtils.showToast('Некорректная ссылка', 'error');
            return;
        }
    
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
                // Сначала пробуем угадать embed
                const guessedEmbed = guessEmbedUrl(bookmark.url);
                if (guessedEmbed) {
                    embedUrl = guessedEmbed;
                    finalUrl = guessedEmbed;
                }
    
                // Параллельно получаем oEmbed данные
                const oembed = await fetchOEmbedData(bookmark.url);
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
    
                // Пытаемся получить прямую ссылку на видео
                if (!downloadUrl) {
                    const directUrl = await fetchDirectVideoUrl(bookmark.url);
                    if (directUrl) downloadUrl = directUrl;
                }
    
                if (embedUrl) finalUrl = embedUrl;
                if (!thumbnail && embedUrl && embedUrl.includes('youtube.com/embed/')) {
                    const videoId = embedUrl.split('/embed/')[1]?.split('?')[0];
                    if (videoId) thumbnail = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
                }
            }
        }
    
        const result = await loadBookmarks(masterPassword);
        if (result.passwordRequired) throw new Error('Password required');
        let bookmarksArray = result.bookmarks || [];
        
        if (bookmarksArray.some(b => b.url === finalUrl)) {
            UIUtils.showToast('Уже в избранном', 'info');
            throw new Error('duplicate');
        }
    
        const newBookmark = {
            id: Date.now() + '-' + Math.random().toString(36),
            added: new Date().toISOString(),
            url: finalUrl,
            title: finalTitle || finalUrl,
            embedUrl,
            downloadUrl,
            thumbnail,
            postType
        };
    
        const optimisticBookmarks = [...bookmarksArray, newBookmark];
        saveSessionCache(optimisticBookmarks, masterPassword);
        if (currentGrid) renderBookmarksGrid(optimisticBookmarks);
    
        saveBookmarks(optimisticBookmarks, masterPassword).catch(e => {
            UIUtils.showToast('Ошибка синхронизации', 'error');
        });
    
        return newBookmark;
    }

    async function removeBookmark(bookmarkId) {
        if (!masterPassword) throw new Error('Master password not set');
        const result = await loadBookmarks(masterPassword);
        if (result.passwordRequired) throw new Error('Password required');
        const bookmarksArray = result.bookmarks || [];
        const filtered = bookmarksArray.filter(b => b.id !== bookmarkId);
        
        saveSessionCache(filtered, masterPassword);
        if (currentGrid) renderBookmarksGrid(filtered);

        saveBookmarks(filtered, masterPassword).catch(e => {
            UIUtils.showToast('Ошибка синхронизации', 'error');
        });
    }

    // ==================== ПОЛНОЭКРАННОЕ ВИДЕО ====================
    function openVideoFullscreen(iframeElement, title) {
        if (!iframeElement) return;
        const overlay = document.createElement('div');
        overlay.className = 'storage-fullscreen-overlay';
        overlay.style.cssText = `
            position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);
            z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;
            cursor:pointer;animation:fadeIn 0.2s ease;
        `;
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';
        closeBtn.style.cssText = `
            position:absolute;top:20px;right:20px;background:rgba(0,0,0,0.7);color:white;
            border:none;border-radius:50%;width:40px;height:40px;font-size:20px;cursor:pointer;z-index:100001;
            transition:transform 0.2s;
        `;
        closeBtn.onmouseover = () => closeBtn.style.transform = 'scale(1.1)';
        closeBtn.onmouseleave = () => closeBtn.style.transform = 'scale(1)';
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            overlay.style.animation = 'fadeOut 0.2s ease forwards';
            setTimeout(() => overlay.remove(), 200);
        };
        const titleDiv = document.createElement('div');
        titleDiv.textContent = title;
        titleDiv.style.cssText = `
            position:absolute;top:20px;left:20px;color:white;font-size:18px;
            font-family:"Russo One",sans-serif;background:rgba(0,0,0,0.5);padding:8px 16px;
            border-radius:30px;z-index:100001;
        `;
        iframeElement.style.cssText = `
            width:90%;height:85%;border-radius:12px;border:none;
        `;
        overlay.appendChild(iframeElement);
        overlay.appendChild(closeBtn);
        overlay.appendChild(titleDiv);
        document.body.appendChild(overlay);
        overlay.onclick = (e) => { if (e.target === overlay) closeBtn.click(); };
    }

    // ==================== КАРТОЧКА ЗАКЛАДКИ ====================
    function renderBookmarkCard(bookmark, onDelete, onEditSave) {
        const card = document.createElement('div');
        card.className = 'bookmark-card tilt-card';
        card.style.cssText = `
            background:var(--bg-inner-gradient);border-radius:20px;padding:0;
            border:1px solid var(--border);cursor:pointer;transition:all 0.3s cubic-bezier(0.25,0.46,0.45,0.94);
            overflow:hidden;display:flex;flex-direction:column;height:100%;
        `;
        
        // 3D эффект при наведении
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const rotateX = (y - centerY) / 15;
            const rotateY = (centerX - x) / 15;
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)';
        });

        const mediaContainer = document.createElement('div');
        mediaContainer.style.cssText = `
            position:relative;width:100%;padding-bottom:56.25%;background:var(--bg-primary);
            border-bottom:1px solid var(--border);
        `;
        
        const embedSrc = bookmark.embedUrl || (isEmbedUrl(bookmark.url) ? bookmark.url : null);
        let mediaElement;
        if (embedSrc) {
            mediaElement = document.createElement('iframe');
            mediaElement.src = embedSrc;
            mediaElement.style.cssText = `
                position:absolute;top:0;left:0;width:100%;height:100%;border:none;
            `;
            mediaElement.setAttribute('allowfullscreen', 'true');
            mediaElement.setAttribute('loading', 'lazy');
            mediaElement.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-forms allow-presentation');
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position:absolute;top:0;left:0;width:100%;height:100%;cursor:pointer;z-index:2;
            `;
            overlay.onclick = (e) => { e.stopPropagation(); openVideoFullscreen(mediaElement, bookmark.title); };
            mediaContainer.appendChild(mediaElement);
            mediaContainer.appendChild(overlay);
        } else {
            mediaElement = document.createElement('img');
            mediaElement.src = bookmark.thumbnail || 'images/default-news.webp';
            mediaElement.alt = bookmark.title;
            mediaElement.style.cssText = `
                position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;
            `;
            mediaElement.onerror = () => mediaElement.src = 'images/default-news.webp';
            mediaContainer.appendChild(mediaElement);
        }

        const content = document.createElement('div');
        content.style.cssText = 'padding:12px;flex:1;display:flex;flex-direction:column;';

        const titleEl = document.createElement('h4');
        titleEl.textContent = bookmark.title.length > 60 ? bookmark.title.substring(0,60)+'…' : bookmark.title;
        titleEl.style.cssText = 'margin:0 0 6px;font-size:16px;color:var(--text-primary);font-weight:500;';

        const meta = document.createElement('div');
        meta.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:11px;color:var(--text-secondary);';
        meta.innerHTML = `<span><i class="fas fa-calendar-alt"></i> ${new Date(bookmark.added).toLocaleDateString()}</span>`;

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:4px;margin-top:auto;justify-content:flex-end;';
        
        if (bookmark.downloadUrl) {
            const downloadBtn = document.createElement('button');
            downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
            downloadBtn.className = 'bookmark-action-btn';
            downloadBtn.title = 'Скачать';
            downloadBtn.onclick = (e) => { e.stopPropagation(); window.open(bookmark.downloadUrl, '_blank'); };
            actions.appendChild(downloadBtn);
        }

        const editBtn = document.createElement('button');
        editBtn.innerHTML = '<i class="fas fa-pen"></i>';
        editBtn.className = 'bookmark-action-btn';
        editBtn.title = 'Редактировать';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            const newTitle = prompt('Новое название:', bookmark.title);
            if (newTitle && newTitle !== bookmark.title) {
                bookmark.title = newTitle;
                titleEl.textContent = newTitle.length > 60 ? newTitle.substring(0,60)+'…' : newTitle;
                onEditSave(bookmark);
            }
        };
        actions.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        deleteBtn.className = 'bookmark-action-btn';
        deleteBtn.style.color = '#f44336';
        deleteBtn.title = 'Удалить';
        deleteBtn.onclick = (e) => { e.stopPropagation(); if (confirm('Удалить закладку?')) onDelete(bookmark.id); };
        actions.appendChild(deleteBtn);

        content.appendChild(titleEl);
        content.appendChild(meta);
        content.appendChild(actions);
        card.appendChild(mediaContainer);
        card.appendChild(content);
        card.onclick = (e) => {
            if (e.target.closest('button')) return;
            window.open(bookmark.url, '_blank');
        };
        return card;
    }

    // ==================== СЕТКА ЗАКЛАДОК ====================
    function renderBookmarksGrid(bookmarks) {
        if (!currentGrid) return;
        let filtered = [...bookmarks];
        if (category === 'video') filtered = filtered.filter(b => b.embedUrl);
        else if (category === 'post') filtered = filtered.filter(b => b.postType && ['feedback','news','update','site-post'].includes(b.postType));
        else if (category === 'link') filtered = filtered.filter(b => !b.embedUrl && !(b.postType && ['feedback','news','update','site-post'].includes(b.postType)));
        
        filtered.sort((a,b) => {
            const dateA = new Date(a.added);
            const dateB = new Date(b.added);
            return sortOrder === 'new' ? dateB - dateA : dateA - dateB;
        });

        if (filtered.length === 0) {
            currentGrid.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1;text-align:center;padding:40px;">
                    <i class="fas fa-bookmark" style="font-size:48px;color:var(--accent);opacity:0.6;margin-bottom:16px;"></i>
                    <p>Нет закладок</p>
                </div>
            `;
            return;
        }

        currentGrid.innerHTML = '';
        filtered.forEach(b => {
            const card = renderBookmarkCard(b,
                async (id) => {
                    const index = currentBookmarks.findIndex(bk => bk.id === id);
                    if (index === -1) return;
                    currentBookmarks.splice(index, 1);
                    renderBookmarksGrid(currentBookmarks);
                    try {
                        await removeBookmark(id);
                    } catch (e) {
                        UIUtils.showToast('Ошибка удаления', 'error');
                    }
                },
                async (updated) => {
                    const index = currentBookmarks.findIndex(b => b.id === updated.id);
                    if (index !== -1) currentBookmarks[index] = updated;
                    await saveBookmarks(currentBookmarks);
                    renderBookmarksGrid(currentBookmarks);
                }
            );
            currentGrid.appendChild(card);
        });
    }

    // ==================== МОДАЛЬНОЕ ОКНО ====================
    async function openStorageModal() {
        updateAuthState();

        if (!window.GithubAuth) {
            setTimeout(openStorageModal, 100);
            return;
        }

        if (!currentUser) {
            UIUtils.showToast('Войдите в аккаунт GitHub', 'error');
            return;
        }
        if (!currentToken) {
            UIUtils.showToast('Токен не найден. Перезайдите.', 'error');
            return;
        }

        if (!window.GithubAuth.hasScope('gist')) {
            UIUtils.showToast('Для хранилища нужен scope "gist"', 'error');
            return;
        }

        let needSetup = false;
        let passwordRequired = false;
        let legacy = false;

        try {
            const result = await loadBookmarks();
            if (result.passwordRequired) {
                passwordRequired = true;
            } else if (result.needSetup) {
                needSetup = true;
            } else {
                currentBookmarks = result.bookmarks || [];
                if (result.legacy) legacy = true;
            }
        } catch (e) {
            if (e.message === 'TOKEN_NO_GIST_SCOPE') {
                UIUtils.showToast('Токен не имеет доступа к Gist', 'error');
                return;
            }
            UIUtils.showToast('Ошибка загрузки: ' + e.message, 'error');
            return;
        }

        if (passwordRequired) {
            const pwd = await new Promise(resolve => {
                const input = prompt('Введите мастер-пароль:');
                resolve(input);
            });
            if (!pwd) {
                UIUtils.showToast('Доступ отменён', 'info');
                return;
            }
            try {
                const result = await loadBookmarks(pwd);
                if (result.passwordRequired) throw new Error('Invalid password');
                currentBookmarks = result.bookmarks || [];
                masterPassword = pwd;
                passwordRequired = false;
                needSetup = false;
            } catch (err) {
                UIUtils.showToast('Неверный пароль', 'error');
                if (confirm('Сбросить хранилище?')) {
                    await resetStorage();
                    needSetup = true;
                    passwordRequired = false;
                    masterPassword = null;
                } else {
                    return;
                }
            }
        } else if (masterPassword && !needSetup) {
            try {
                const result = await loadBookmarks(masterPassword);
                if (result.passwordRequired) {
                    masterPassword = null;
                    passwordRequired = true;
                    return openStorageModal();
                }
                currentBookmarks = result.bookmarks || [];
            } catch (e) {
                UIUtils.showToast('Ошибка загрузки: ' + e.message, 'error');
                return;
            }
        }

        if (needSetup) {
            const pwd = await new Promise(resolve => {
                const input = prompt('Создайте мастер-пароль (мин. 4 символа):');
                resolve(input);
            });
            if (!pwd || pwd.length < 4) {
                UIUtils.showToast('Пароль слишком короткий', 'error');
                return;
            }
            masterPassword = pwd;
            currentBookmarks = [];
            try {
                await saveBookmarks(currentBookmarks, masterPassword);
                UIUtils.showToast('Хранилище создано!', 'success');
            } catch (err) {
                UIUtils.showToast('Ошибка создания: ' + err.message, 'error');
                return;
            }
        } else if (legacy) {
            UIUtils.showToast('Обнаружено старое хранилище. Рекомендуется установить пароль.', 'warning', 6000);
            if (confirm('Установить мастер-пароль?')) {
                const newPwd = prompt('Новый пароль (мин. 4 символа):');
                if (newPwd && newPwd.length >= 4) {
                    try {
                        await saveBookmarks(currentBookmarks, newPwd);
                        masterPassword = newPwd;
                        UIUtils.showToast('Пароль установлен!', 'success');
                    } catch (e) {
                        UIUtils.showToast('Ошибка: ' + e.message, 'error');
                    }
                }
            }
        }

        const modalHtml = `
            <div class="storage-modal-container">
                <div class="storage-header">
                    <div class="storage-controls">
                        <div class="storage-sort">
                            <button class="sort-btn ${sortOrder === 'new' ? 'active' : ''}" data-order="new">
                                <i class="fas fa-arrow-down"></i> Новые
                            </button>
                            <button class="sort-btn ${sortOrder === 'old' ? 'active' : ''}" data-order="old">
                                <i class="fas fa-arrow-up"></i> Старые
                            </button>
                        </div>
                        <div class="storage-categories">
                            <button class="cat-btn ${category === 'all' ? 'active' : ''}" data-cat="all"><i class="fas fa-globe"></i> Все</button>
                            <button class="cat-btn ${category === 'video' ? 'active' : ''}" data-cat="video"><i class="fas fa-video"></i> Видео</button>
                            <button class="cat-btn ${category === 'post' ? 'active' : ''}" data-cat="post"><i class="fas fa-newspaper"></i> Посты</button>
                            <button class="cat-btn ${category === 'link' ? 'active' : ''}" data-cat="link"><i class="fas fa-link"></i> Ссылки</button>
                        </div>
                    </div>
                    <div class="storage-actions">
                        <button class="storage-btn" id="change-password-btn" title="Сменить пароль">
                            <i class="fas fa-key"></i>
                        </button>
                        <button class="storage-btn danger" id="reset-storage-btn" title="Сбросить хранилище">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                        <button class="storage-btn primary" id="toggle-add-btn">
                            <i class="fas fa-plus"></i> Добавить
                        </button>
                    </div>
                </div>
                <div id="add-form" class="storage-add-form ${addFormVisible ? 'visible' : ''}">
                    <input type="url" id="new-url" placeholder="Ссылка на видео, пост или страницу..." autocomplete="off">
                    <input type="text" id="new-title" placeholder="Название (опционально)">
                    <button class="storage-btn primary" id="confirm-add"><i class="fas fa-plus"></i> Добавить</button>
                </div>
                <div class="bookmarks-grid" id="bookmarks-grid"></div>
            </div>
        `;

        const { modal, closeModal } = UIUtils.createModal('Хранилище', modalHtml, { size: 'full' });
        currentModal = modal;
        
        const style = document.createElement('style');
        style.textContent = `
            .storage-modal-container {
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            .storage-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-wrap: wrap;
                gap: 15px;
            }
            .storage-controls {
                display: flex;
                align-items: center;
                gap: 15px;
                flex-wrap: wrap;
            }
            .storage-sort {
                display: flex;
                background: var(--bg-primary);
                border-radius: 40px;
                padding: 4px;
                border: 1px solid var(--border);
            }
            .sort-btn {
                background: transparent;
                border: none;
                color: var(--text-secondary);
                padding: 8px 16px;
                border-radius: 40px;
                font-size: 14px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s;
                font-family: 'Russo One', sans-serif;
            }
            .sort-btn.active {
                background: var(--accent);
                color: white;
            }
            .storage-categories {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
            }
            .cat-btn {
                background: var(--bg-primary);
                border: 1px solid var(--border);
                color: var(--text-secondary);
                padding: 8px 14px;
                border-radius: 40px;
                font-size: 13px;
                cursor: pointer;
                transition: all 0.2s;
                font-family: 'Russo One', sans-serif;
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .cat-btn.active {
                background: var(--accent);
                color: white;
                border-color: var(--accent);
            }
            .storage-actions {
                display: flex;
                gap: 8px;
            }
            .storage-btn {
                background: var(--bg-primary);
                border: 1px solid var(--border);
                color: var(--text-secondary);
                padding: 8px 16px;
                border-radius: 40px;
                font-size: 14px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s;
                font-family: 'Russo One', sans-serif;
            }
            .storage-btn.primary {
                background: var(--accent);
                color: white;
                border-color: var(--accent);
            }
            .storage-btn.danger {
                color: #f44336;
            }
            .storage-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            }
            .storage-add-form {
                display: grid;
                grid-template-columns: 1fr 1fr auto;
                gap: 10px;
                background: var(--bg-inner-gradient);
                padding: 16px;
                border-radius: 20px;
                border: 1px solid var(--border);
                opacity: 0;
                transform: translateY(-10px);
                transition: opacity 0.3s, transform 0.3s;
                display: none;
                align-items: center;
            }
            .storage-add-form.visible {
                display: grid;
                opacity: 1;
                transform: translateY(0);
            }
            .storage-add-form input {
                padding: 12px 16px;
                background: var(--bg-primary);
                border: 1px solid var(--border);
                border-radius: 40px;
                color: var(--text-primary);
                font-family: 'Russo One', sans-serif;
            }
            .bookmarks-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                gap: 20px;
            }
            .bookmark-action-btn {
                background: var(--bg-primary);
                border: 1px solid var(--border);
                color: var(--text-secondary);
                width: 28px;
                height: 28px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.2s;
                font-size: 12px;
            }
            .bookmark-action-btn:hover {
                background: var(--accent);
                color: white;
                transform: scale(1.1);
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes fadeOut {
                from { opacity: 1; }
                to { opacity: 0; }
            }
            @media (max-width: 700px) {
                .storage-header {
                    flex-direction: column;
                    align-items: stretch;
                }
                .storage-controls {
                    justify-content: space-between;
                }
                .storage-add-form {
                    grid-template-columns: 1fr;
                }
                .bookmarks-grid {
                    grid-template-columns: 1fr;
                }
            }
        `;
        modal.appendChild(style);

        currentGrid = modal.querySelector('#bookmarks-grid');
        const sortBtns = modal.querySelectorAll('.sort-btn');
        const catBtns = modal.querySelectorAll('.cat-btn');
        const toggleAddBtn = modal.querySelector('#toggle-add-btn');
        const addForm = modal.querySelector('#add-form');
        const newUrlInput = modal.querySelector('#new-url');
        const newTitleInput = modal.querySelector('#new-title');
        const confirmAddBtn = modal.querySelector('#confirm-add');
        const changePasswordBtn = modal.querySelector('#change-password-btn');
        const resetStorageBtn = modal.querySelector('#reset-storage-btn');

        renderBookmarksGrid(currentBookmarks);

        sortBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                sortOrder = btn.dataset.order;
                sortBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderBookmarksGrid(currentBookmarks);
            });
        });

        catBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                category = btn.dataset.cat;
                catBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderBookmarksGrid(currentBookmarks);
            });
        });

        toggleAddBtn.addEventListener('click', () => {
            addFormVisible = !addFormVisible;
            addForm.classList.toggle('visible', addFormVisible);
            if (addFormVisible) {
                newUrlInput.focus();
                toggleAddBtn.innerHTML = '<i class="fas fa-times"></i> Отмена';
            } else {
                toggleAddBtn.innerHTML = '<i class="fas fa-plus"></i> Добавить';
            }
        });

        confirmAddBtn.addEventListener('click', async () => {
            const url = newUrlInput.value.trim();
            if (!url) { UIUtils.showToast('Введите ссылку', 'error'); return; }
            const title = newTitleInput.value.trim() || url;
            confirmAddBtn.disabled = true;
            
            const tempId = 'temp-' + Date.now();
            const optimistic = {
                id: tempId, url, title, added: new Date().toISOString(), temp: true
            };
            currentBookmarks.unshift(optimistic);
            renderBookmarksGrid(currentBookmarks);
            
            try {
                const final = await addBookmark({ url, title });
                const index = currentBookmarks.findIndex(b => b.id === tempId);
                if (index !== -1) currentBookmarks[index] = final;
                renderBookmarksGrid(currentBookmarks);
                UIUtils.showToast('Добавлено', 'success');
                addFormVisible = false;
                addForm.classList.remove('visible');
                toggleAddBtn.innerHTML = '<i class="fas fa-plus"></i> Добавить';
                newUrlInput.value = '';
                newTitleInput.value = '';
            } catch (err) {
                if (err.message !== 'duplicate') UIUtils.showToast('Ошибка: ' + err.message, 'error');
                const index = currentBookmarks.findIndex(b => b.id === tempId);
                if (index !== -1) currentBookmarks.splice(index, 1);
                renderBookmarksGrid(currentBookmarks);
            } finally {
                confirmAddBtn.disabled = false;
            }
        });

        changePasswordBtn.addEventListener('click', async () => {
            const oldPwd = masterPassword || prompt('Текущий пароль:');
            if (!oldPwd) return;
            const newPwd = prompt('Новый пароль (мин. 4 символа):');
            if (!newPwd || newPwd.length < 4) {
                UIUtils.showToast('Пароль слишком короткий', 'warning');
                return;
            }
            try {
                await changeMasterPassword(oldPwd, newPwd);
                UIUtils.showToast('Пароль изменён!', 'success');
            } catch (err) {
                UIUtils.showToast('Ошибка: ' + err.message, 'error');
            }
        });

        resetStorageBtn.addEventListener('click', async () => {
            if (confirm('Удалить все закладки безвозвратно?')) {
                try {
                    await resetStorage();
                    currentBookmarks = [];
                    masterPassword = null;
                    renderBookmarksGrid([]);
                    UIUtils.showToast('Хранилище сброшено', 'success');
                    closeModal();
                } catch (err) {
                    UIUtils.showToast('Ошибка: ' + err.message, 'error');
                }
            }
        });
    }

    function updateAuthState() {
        if (window.GithubAuth) {
            currentUser = window.GithubAuth.getCurrentUser();
            currentToken = window.GithubAuth.getToken();
            if (currentUser && currentToken) {
                const stored = localStorage.getItem(STORAGE_KEY_PREFIX + currentUser);
                if (stored) {
                    try { gistId = JSON.parse(stored).gistId; } catch {}
                }
            } else {
                gistId = null;
                masterPassword = null;
                clearSessionCache();
            }
        }
    }

    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    function init() {
        updateAuthState();
        window.addEventListener('github-login-success', updateAuthState);
        window.addEventListener('github-logout', () => {
            currentUser = null;
            currentToken = null;
            gistId = null;
            masterPassword = null;
            clearSessionCache();
        });
    }

    const API = {
        openStorageModal,
        addBookmark,
        loadBookmarks,
        removeBookmark,
        changeMasterPassword,
        resetStorage
    };

    if (!window.BookmarkStorage) {
        window.BookmarkStorage = API;
        init();
    }
})();