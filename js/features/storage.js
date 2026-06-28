// js/features/storage.js – хранилище закладок на GitHub Gist (финальная версия)
(function() {
    const { CONFIG, escapeHtml, createElement, formatDate, debounce, cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix, loadModule } = window.GithubCore;
    const { getCurrentUser, isAdmin, hasScope, getToken } = window.GithubAuth;
    const { showToast, createModal } = window.UIUtils;

    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium bookmarks storage';
    const STORAGE_KEY_PREFIX = 'bookmarks_';
    const SEARCH_DEBOUNCE_MS = 300;

    let currentUser = null;
    let currentToken = null;
    let gistId = null;
    let currentBookmarks = [];
    let sortOrder = 'new';
    let category = 'all';
    let searchQuery = '';

    let debouncedSaveBookmarks = null;
    let isSaving = false;
    let modalRef = null; // ссылка на модалку хранилища
    let searchInputRef = null;

    // ---------- Вспомогательные функции ----------
    async function authFetch(url, options = {}) {
        const token = currentToken || localStorage.getItem('github_token');
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            ...options.headers
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(url, { ...options, headers, signal: controller.signal });
            clearTimeout(timeoutId);
            return response;
        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    }

    function simpleHash(str) {
        if (typeof str !== 'string' || str.length === 0) return '';
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash.toString(16);
    }

    // ---------- Gist API ----------
    async function gistFetch(gistId) {
        const url = `https://api.github.com/gists/${gistId}`;
        try {
            const resp = await authFetch(url);
            if (resp.status === 404) return null;
            if (!resp.ok) {
                const errorText = await resp.text();
                throw new Error(`Gist fetch error: ${resp.status} ${errorText}`);
            }
            return await resp.json();
        } catch (e) {
            console.error('gistFetch failed:', e);
            return null;
        }
    }

    async function gistUpdate(gistId, content) {
        const url = `https://api.github.com/gists/${gistId}`;
        const resp = await authFetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } })
        });
        if (!resp.ok) {
            const errorText = await resp.text();
            throw new Error(`Gist update error: ${resp.status} ${errorText}`);
        }
        return await resp.json();
    }

    async function gistCreate(content) {
        const url = 'https://api.github.com/gists';
        const resp = await authFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files: { [GIST_FILENAME]: { content } } })
        });
        if (!resp.ok) {
            const errorText = await resp.text();
            throw new Error(`Gist create error: ${resp.status} ${errorText}`);
        }
        const gist = await resp.json();
        return gist.id;
    }

    // ---------- Загрузка/сохранение закладок ----------
    async function loadBookmarks() {
        if (!currentToken) {
            return { bookmarks: [] };
        }

        try {
            const stored = localStorage.getItem(STORAGE_KEY_PREFIX + currentUser);
            if (!stored) {
                const content = JSON.stringify({ version: 2, bookmarks: [] });
                const newGistId = await gistCreate(content);
                gistId = newGistId;
                localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
                return { bookmarks: [] };
            }

            gistId = JSON.parse(stored).gistId;
            const gist = await gistFetch(gistId);
            if (!gist) {
                const content = JSON.stringify({ version: 2, bookmarks: [] });
                const newGistId = await gistCreate(content);
                gistId = newGistId;
                localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
                return { bookmarks: [] };
            }

            const file = gist.files?.[GIST_FILENAME];
            if (!file) {
                const content = JSON.stringify({ version: 2, bookmarks: [] });
                await gistUpdate(gistId, content);
                return { bookmarks: [] };
            }

            let payload;
            try {
                payload = JSON.parse(file.content);
            } catch {
                const content = JSON.stringify({ version: 2, bookmarks: [] });
                await gistUpdate(gistId, content);
                return { bookmarks: [] };
            }

            if (payload.bookmarks) {
                return { bookmarks: payload.bookmarks };
            }
            return { bookmarks: [] };
        } catch (err) {
            console.error('Ошибка загрузки закладок:', err);
            return { bookmarks: [] };
        }
    }

    async function saveBookmarksImmediately() {
        if (isSaving) return;
        isSaving = true;
        try {
            await doSaveBookmarks();
        } finally {
            isSaving = false;
        }
    }

    async function doSaveBookmarks() {
        try {
            if (!currentToken) return;

            const payload = {
                version: 2,
                bookmarks: currentBookmarks,
                timestamp: Date.now()
            };
            const content = JSON.stringify(payload);

            if (gistId) {
                await gistUpdate(gistId, content);
                console.log('[storage] Gist updated successfully');
            } else {
                const newGistId = await gistCreate(content);
                gistId = newGistId;
                localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
                console.log('[storage] Gist created successfully', newGistId);
            }
        } catch (err) {
            console.error('Ошибка синхронизации закладок:', err);
            showToast('Не удалось сохранить изменения', 'error');
        }
    }

    function triggerDebouncedSave() {
        if (!debouncedSaveBookmarks) {
            debouncedSaveBookmarks = debounce(saveBookmarksImmediately, 2000);
        }
        debouncedSaveBookmarks();
    }

    // ---------- Получение метаданных через парсинг HTML (с поддержкой прокси) ----------
    async function fetchPageMetadata(url) {
        // Сначала пробуем напрямую (с CORS)
        try {
            const resp = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(5000) });
            if (!resp.ok) return null;
            const html = await resp.text();
            return parseHtmlMetadata(html, url);
        } catch (e) {
            // Пробуем через прокси allorigins
            try {
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
                const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
                if (!resp.ok) return null;
                const html = await resp.text();
                return parseHtmlMetadata(html, url);
            } catch (e2) {
                return null;
            }
        }
    }

    function parseHtmlMetadata(html, baseUrl) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // Ищем заголовок
        let title = doc.querySelector('title')?.textContent?.trim() || null;
        // Ищем og:title
        const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
        if (ogTitle) title = ogTitle;

        // Ищем изображение
        let thumbnail = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim() || null;
        if (!thumbnail) {
            // Ищем первую картинку на странице (может быть большая)
            const img = doc.querySelector('img');
            if (img) {
                let src = img.getAttribute('src');
                if (src) {
                    if (src.startsWith('//')) src = 'https:' + src;
                    else if (src.startsWith('/')) src = new URL(src, baseUrl).href;
                    thumbnail = src;
                }
            }
        }

        return { title, thumbnail };
    }

    // ---------- Получение метаданных через oEmbed и Open Graph ----------
    async function tryOembed(url) {
        const providers = [
            async (u) => {
                const resp = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(u)}`);
                if (!resp.ok) return null;
                const data = await resp.json();
                if (data && data.title) return data;
                return null;
            },
            async (u) => {
                const resp = await fetch(`https://iframe.ly/api/oembed?url=${encodeURIComponent(u)}`);
                if (!resp.ok) return null;
                const data = await resp.json();
                if (data && data.title) return data;
                return null;
            },
            async (u) => {
                const resp = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(u)}&data.title&data.image&data.embed`);
                if (!resp.ok) return null;
                const data = await resp.json();
                if (data && data.data && data.data.title) {
                    return {
                        title: data.data.title,
                        thumbnail_url: data.data.image?.url || null,
                        html: data.data.embed?.html || null,
                    };
                }
                return null;
            }
        ];

        for (const fn of providers) {
            try {
                const result = await fn(url);
                if (result) return result;
            } catch (e) {}
        }
        return null;
    }

    // ---------- Определение типа и получение метаданных ----------
    async function fetchMetadata(url) {
        if (typeof url !== 'string' || !url) {
            return { type: 'link', title: url || 'Ссылка', thumbnail: null, embedUrl: null, downloadUrl: null };
        }

        // Пост NeonImperium
        if (url.includes('neonshadowyt.github.io/NeonImperium')) {
            const postMatch = url.match(/[?&]post=(\d+)/);
            if (postMatch) {
                const postId = parseInt(postMatch[1], 10);
                try {
                    const issue = await window.GithubAPI.loadIssue(postId);
                    if (issue) {
                        return {
                            type: 'post',
                            title: issue.title,
                            thumbnail: null,
                            embedUrl: null,
                            downloadUrl: null,
                            postData: {
                                id: issue.number,
                                title: issue.title,
                                body: issue.body,
                                author: issue.user.login,
                                date: issue.created_at,
                                labels: issue.labels.map(l => l.name),
                                game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null
                            }
                        };
                    }
                } catch (e) {
                    return {
                        type: 'post',
                        title: 'Пост #' + postId,
                        thumbnail: null,
                        embedUrl: null,
                        downloadUrl: null,
                        postData: { id: postId }
                    };
                }
            }
        }

        // Видео-сервисы (определяем до oEmbed, чтобы получить embedUrl)
        const videoInfo = await detectVideoService(url);
        if (videoInfo) {
            // Пытаемся получить название и превью через oEmbed и Open Graph
            let title = videoInfo.title;
            let thumbnail = videoInfo.thumbnail;
            let embedUrl = videoInfo.embedUrl;

            // Сначала пробуем oEmbed с оригинального URL
            const oembed = await tryOembed(url);
            if (oembed) {
                if (oembed.title) title = oembed.title;
                if (oembed.thumbnail_url) thumbnail = oembed.thumbnail_url;
                if (oembed.html && !embedUrl) {
                    const div = document.createElement('div');
                    div.innerHTML = oembed.html;
                    const iframe = div.querySelector('iframe');
                    if (iframe && iframe.src) embedUrl = iframe.src;
                }
            }

            // Если не хватает данных, пробуем Open Graph / парсинг страницы
            if (!title || title === 'Видео' || !thumbnail) {
                const pageData = await fetchPageMetadata(url);
                if (pageData) {
                    if (pageData.title && (title === 'Видео' || !title)) title = pageData.title;
                    if (pageData.thumbnail && !thumbnail) thumbnail = pageData.thumbnail;
                }
            }

            // Если всё ещё нет заголовка, пробуем парсить embed-страницу (если она отличается)
            if ((!title || title === 'Видео') && videoInfo.embedUrl && videoInfo.embedUrl !== url) {
                const embedPage = await fetchPageMetadata(videoInfo.embedUrl);
                if (embedPage && embedPage.title && embedPage.title !== 'Видео') {
                    title = embedPage.title;
                    if (!thumbnail && embedPage.thumbnail) thumbnail = embedPage.thumbnail;
                }
            }

            return {
                type: 'video',
                title: title || 'Видео',
                thumbnail: thumbnail || null,
                embedUrl: embedUrl || videoInfo.embedUrl || null,
                downloadUrl: videoInfo.downloadUrl || null,
                videoData: videoInfo
            };
        }

        // Обычная ссылка – пробуем oEmbed и Open Graph
        let title = url, thumbnail = null, embedUrl = null;
        const oembed = await tryOembed(url);
        if (oembed && oembed.title) {
            title = oembed.title;
            thumbnail = oembed.thumbnail_url || null;
            if (oembed.html) {
                const div = document.createElement('div');
                div.innerHTML = oembed.html;
                const iframe = div.querySelector('iframe');
                if (iframe && iframe.src) embedUrl = iframe.src;
            }
        } else {
            const pageData = await fetchPageMetadata(url);
            if (pageData) {
                if (pageData.title) title = pageData.title;
                if (pageData.thumbnail) thumbnail = pageData.thumbnail;
            }
        }

        return {
            type: 'link',
            title: title || url,
            thumbnail: thumbnail || null,
            embedUrl: embedUrl || null,
            downloadUrl: null,
            linkData: null
        };
    }

    async function detectVideoService(url) {
        if (typeof url !== 'string' || !url) return null;

        // YouTube
        const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
        if (ytMatch) {
            const id = ytMatch[1];
            const thumbnail = `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
            const embedUrl = `https://www.youtube.com/embed/${id}`;
            let title = 'YouTube видео';
            try {
                const resp = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
                if (resp.ok) {
                    const data = await resp.json();
                    title = data.title || title;
                }
            } catch (e) {}
            return { title, thumbnail, embedUrl, downloadUrl: null, service: 'youtube', id };
        }

        // Vimeo
        const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
        if (vimeoMatch) {
            const id = vimeoMatch[1];
            let thumbnail = null, title = 'Vimeo видео', embedUrl = null;
            try {
                const resp = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
                if (resp.ok) {
                    const data = await resp.json();
                    title = data.title || title;
                    thumbnail = data.thumbnail_url || null;
                    embedUrl = data.html ? (() => {
                        const div = document.createElement('div');
                        div.innerHTML = data.html;
                        const iframe = div.querySelector('iframe');
                        return iframe ? iframe.src : null;
                    })() : null;
                }
            } catch (e) {}
            return { title, thumbnail, embedUrl, downloadUrl: null, service: 'vimeo', id };
        }

        // Прямой видеофайл
        const videoExt = /\.(mp4|webm|ogg|mov|avi|mkv)$/i;
        if (videoExt.test(url)) {
            return {
                title: 'Видео файл',
                thumbnail: null,
                embedUrl: url,
                downloadUrl: url,
                service: 'direct'
            };
        }

        // Специальная обработка для view_video.php?viewkey=...
        if (url.includes('view_video.php?viewkey=')) {
            const match = url.match(/viewkey=([^&]+)/);
            if (match) {
                const key = match[1];
                const embedUrl = url.replace(/view_video\.php\?viewkey=[^&]+/, `embed/${key}`);
                return {
                    title: 'Видео',
                    thumbnail: null,
                    embedUrl: embedUrl,
                    downloadUrl: null,
                    service: 'custom',
                    // сохраняем оригинальный URL для парсинга
                    originalUrl: url
                };
            }
        }

        // Другие популярные видео-хостинги
        if (url.includes('dailymotion.com')) {
            const idMatch = url.match(/dailymotion\.com\/video\/([^_]+)/);
            if (idMatch) {
                const id = idMatch[1];
                const embedUrl = `https://www.dailymotion.com/embed/video/${id}`;
                const thumbnail = `https://www.dailymotion.com/thumbnail/video/${id}`;
                return { title: 'Dailymotion видео', thumbnail, embedUrl, downloadUrl: null, service: 'dailymotion', id };
            }
        }
        if (url.includes('twitch.tv')) {
            const clipMatch = url.match(/clips\.twitch\.tv\/([^?]+)/);
            if (clipMatch) {
                const slug = clipMatch[1];
                const embedUrl = `https://clips.twitch.tv/embed?clip=${slug}`;
                return { title: 'Twitch клип', thumbnail: null, embedUrl, downloadUrl: null, service: 'twitch', slug };
            }
            const vodMatch = url.match(/twitch\.tv\/videos\/(\d+)/);
            if (vodMatch) {
                const id = vodMatch[1];
                const embedUrl = `https://player.twitch.tv/?video=${id}`;
                return { title: 'Twitch VOD', thumbnail: null, embedUrl, downloadUrl: null, service: 'twitch', id };
            }
        }

        return null;
    }

    // ---------- Добавление закладки (универсальное) ----------
    async function addBookmark(bookmarkOrUrl, title, fileContent, fileName) {
        if (!currentUser) {
            showToast('Войдите в аккаунт GitHub с правами gist', 'error');
            throw new Error('not_logged_in');
        }

        let url = null;
        let customTitle = null;
        let customFileContent = null;
        let customFileName = null;
        let extraData = {};

        if (typeof bookmarkOrUrl === 'object' && bookmarkOrUrl !== null) {
            const obj = bookmarkOrUrl;
            url = obj.url || null;
            customTitle = obj.title || null;
            customFileContent = obj.fileContent || null;
            customFileName = obj.fileName || null;
            extraData = {
                type: obj.type || null,
                thumbnail: obj.thumbnail || null,
                embedUrl: obj.embedUrl || null,
                downloadUrl: obj.downloadUrl || null,
                postData: obj.postData || null,
                videoData: obj.videoData || null,
                linkData: obj.linkData || null,
                saveData: obj.saveData || null,
                author: obj.author || null,
                date: obj.date || null,
            };
        } else {
            url = bookmarkOrUrl;
            customTitle = title;
            customFileContent = fileContent;
            customFileName = fileName;
        }

        // === Обработка файла (сохранения) ===
        const isFile = (typeof customFileContent === 'string' && customFileContent.length > 0 &&
                        typeof customFileName === 'string' && customFileName.length > 0);

        if (isFile) {
            const hash = simpleHash(customFileContent);
            const existing = currentBookmarks.some(b =>
                b.saveData && b.saveData.fileName === customFileName && b.saveData.hash === hash
            );
            if (existing) {
                showToast('Такое сохранение уже есть', 'info');
                throw new Error('duplicate');
            }

            const newBookmark = {
                id: Date.now() + '-' + Math.random().toString(36),
                added: new Date().toISOString(),
                type: 'save',
                title: customTitle || customFileName,
                url: null,
                thumbnail: null,
                embedUrl: null,
                downloadUrl: null,
                saveData: {
                    fileName: customFileName,
                    content: customFileContent,
                    hash: hash,
                    mimeType: 'text/plain'
                }
            };
            currentBookmarks = [newBookmark, ...currentBookmarks];
            triggerDebouncedSave();
            return newBookmark;
        }

        // === Обработка ссылки ===
        if (!url) {
            showToast('Нет ссылки для добавления', 'error');
            throw new Error('no_url');
        }

        if (currentBookmarks.some(b => b.url === url)) {
            showToast('Уже в избранном', 'info');
            throw new Error('duplicate');
        }

        let meta;
        if (extraData.type) {
            meta = {
                type: extraData.type,
                title: customTitle || extraData.title || url,
                thumbnail: extraData.thumbnail || null,
                embedUrl: extraData.embedUrl || null,
                downloadUrl: extraData.downloadUrl || null,
                postData: extraData.postData || null,
                videoData: extraData.videoData || null,
                linkData: extraData.linkData || null,
                saveData: extraData.saveData || null,
            };
        } else {
            meta = await fetchMetadata(url);
            if (!meta.title || meta.title === url) {
                meta.title = customTitle || url;
            }
        }

        const newBookmark = {
            id: Date.now() + '-' + Math.random().toString(36),
            added: new Date().toISOString(),
            url: url,
            title: meta.title || url,
            type: meta.type || 'link',
            thumbnail: meta.thumbnail || null,
            embedUrl: meta.embedUrl || null,
            downloadUrl: meta.downloadUrl || null,
            postData: meta.postData || null,
            videoData: meta.videoData || null,
            linkData: meta.linkData || null,
            saveData: meta.saveData || null,
            author: extraData.author || null,
            date: extraData.date || null,
        };

        currentBookmarks = [newBookmark, ...currentBookmarks];
        triggerDebouncedSave();
        return newBookmark;
    }

    // ---------- Удаление ----------
    async function removeBookmark(id) {
        if (!currentToken) return;
        currentBookmarks = currentBookmarks.filter(b => b.id !== id);
        triggerDebouncedSave();
        if (modalRef) {
            renderBookmarks(modalRef);
        }
    }

    // ---------- UI: рендеринг карточек ----------
    function renderBookmarks(modalElement) {
        const grid = modalElement.querySelector('#bookmarks-grid');
        if (!grid) return;

        let filtered = currentBookmarks;
        if (category !== 'all') {
            filtered = filtered.filter(b => b.type === category);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            filtered = filtered.filter(b => b.title && b.title.toLowerCase().includes(q));
        }
        if (sortOrder === 'new') {
            filtered.sort((a, b) => new Date(b.added) - new Date(a.added));
        } else {
            filtered.sort((a, b) => new Date(a.added) - new Date(b.added));
        }

        grid.innerHTML = '';
        if (filtered.length === 0) {
            grid.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>Ничего не найдено</p></div>';
            return;
        }

        filtered.forEach(bookmark => {
            const card = createBookmarkCard(bookmark);
            grid.appendChild(card);
        });
    }

    function createBookmarkCard(bookmark) {
        const wrapper = createElement('div', 'bookmark-card-wrapper', {
            position: 'relative',
            height: '100%',
            cursor: 'pointer',
            transition: 'transform 0.2s, box-shadow 0.2s'
        });
        wrapper.dataset.id = bookmark.id;

        const card = createElement('div', 'bookmark-card tilt-card', {
            background: 'var(--bg-inner-gradient)',
            borderRadius: '20px',
            border: '1px solid var(--border)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            transition: 'transform 0.2s, border-color 0.2s'
        });
        card.addEventListener('mouseenter', () => {
            card.style.borderColor = 'var(--accent)';
        });
        card.addEventListener('mouseleave', () => {
            card.style.borderColor = 'var(--border)';
        });

        if (bookmark.type === 'post') {
            buildPostCard(card, bookmark);
        } else if (bookmark.type === 'video') {
            buildVideoCard(card, bookmark);
        } else if (bookmark.type === 'save') {
            buildSaveCard(card, bookmark);
        } else {
            buildLinkCard(card, bookmark);
        }

        const deleteBtn = createElement('button', 'bookmark-delete-btn', {
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: 'rgba(0,0,0,0.6)',
            border: 'none',
            borderRadius: '50%',
            width: '28px',
            height: '28px',
            color: '#f44336',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            zIndex: '5',
            transition: 'opacity 0.2s'
        });
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Удалить закладку?')) {
                removeBookmark(bookmark.id);
            }
        });
        wrapper.appendChild(card);
        wrapper.appendChild(deleteBtn);

        return wrapper;
    }

    function buildPostCard(card, bookmark) {
        card.addEventListener('click', () => {
            if (bookmark.postData && bookmark.postData.id) {
                const postId = bookmark.postData.id;
                if (window.UIFeedback) {
                    window.GithubAPI.loadIssue(postId).then(issue => {
                        window.UIFeedback.openFullModal({
                            id: issue.number,
                            title: issue.title,
                            body: issue.body,
                            author: issue.user.login,
                            date: issue.created_at,
                            labels: issue.labels.map(l => l.name),
                            game: issue.labels.find(l => l.name.startsWith('game:'))?.name.split(':')[1] || null
                        });
                    }).catch(() => {
                        window.UIFeedback.openFullModal(bookmark.postData);
                    });
                } else {
                    showToast('Модуль обратной связи не загружен', 'error');
                }
            } else {
                showToast('Данные поста недоступны', 'error');
            }
        });

        const content = createElement('div', 'bookmark-content', { padding: '12px', flex: '1', display: 'flex', flexDirection: 'column' });
        const titleEl = createElement('h4', '', { margin: '0 0 4px', fontSize: '16px', color: 'var(--text-primary)' });
        titleEl.textContent = bookmark.title || 'Пост';
        content.appendChild(titleEl);

        const meta = createElement('div', '', { fontSize: '12px', color: 'var(--text-secondary)' });
        meta.textContent = `Пост · ${formatDate(bookmark.added)}`;
        content.appendChild(meta);

        card.appendChild(content);

        if (bookmark.thumbnail) {
            const imgWrapper = createElement('div', 'bookmark-media', {
                position: 'relative',
                paddingBottom: '56.25%',
                background: 'var(--bg-primary)',
                borderBottom: '1px solid var(--border)',
                flexShrink: '0'
            });
            const img = createElement('img', '', {
                position: 'absolute',
                top: 0, left: 0, width: '100%', height: '100%',
                objectFit: 'cover'
            });
            img.src = bookmark.thumbnail;
            img.alt = bookmark.title;
            img.onerror = () => { img.style.display = 'none'; };
            imgWrapper.appendChild(img);
            card.insertBefore(imgWrapper, content);
        } else {
            const iconWrapper = createElement('div', 'bookmark-icon', {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '48px',
                padding: '20px 0',
                background: 'var(--bg-primary)',
                borderBottom: '1px solid var(--border)'
            });
            iconWrapper.innerHTML = '<i class="fas fa-newspaper"></i>';
            card.insertBefore(iconWrapper, content);
        }
    }

    function buildVideoCard(card, bookmark) {
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            if (bookmark.embedUrl) {
                const isDirectVideo = /\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(bookmark.embedUrl);
                let html;
                const downloadSection = bookmark.downloadUrl
                    ? `<a href="${escapeHtml(bookmark.downloadUrl)}" download class="button" style="background:var(--accent);">Скачать видео</a>`
                    : '';

                // Сервисы для скачивания YouTube
                let extraDownload = '';
                if (bookmark.videoData && bookmark.videoData.service === 'youtube' && bookmark.videoData.id) {
                    const vid = bookmark.videoData.id;
                    extraDownload = `
                        <a href="https://www.y2mate.com/youtube/${vid}" target="_blank" class="button" style="background:var(--bg-inner-gradient);">Скачать через y2mate</a>
                        <a href="https://en.savefrom.net/1/?url=https://youtu.be/${vid}" target="_blank" class="button" style="background:var(--bg-inner-gradient);">Скачать через savefrom</a>
                    `;
                }

                if (isDirectVideo) {
                    html = `
                        <div style="background:#000;border-radius:12px;overflow:hidden;">
                            <video controls style="width:100%;max-height:70vh;" src="${escapeHtml(bookmark.embedUrl)}"></video>
                        </div>
                        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
                            ${downloadSection}
                            ${extraDownload}
                            <a href="${escapeHtml(bookmark.url)}" target="_blank" class="button" style="background:var(--bg-inner-gradient);">Открыть источник</a>
                        </div>
                    `;
                } else {
                    html = `
                        <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;background:#000;border-radius:12px;">
                            <iframe src="${escapeHtml(bookmark.embedUrl)}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allowfullscreen></iframe>
                        </div>
                        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
                            ${downloadSection}
                            ${extraDownload}
                            <a href="${escapeHtml(bookmark.url)}" target="_blank" class="button" style="background:var(--bg-inner-gradient);">Открыть источник</a>
                        </div>
                    `;
                }

                // Создаём модалку вручную, чтобы не закрывать хранилище
                const modalOverlay = document.createElement('div');
                modalOverlay.className = 'modal-fullscreen';
                modalOverlay.style.zIndex = '10002';
                modalOverlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
                modalOverlay.innerHTML = `
                    <div class="modal-content-full" style="max-width: 900px; max-height: 90vh;">
                        <div class="modal-header">
                            <h2>${escapeHtml(bookmark.title || 'Видео')}</h2>
                            <button class="modal-close" aria-label="Закрыть"><i class="fas fa-times"></i></button>
                        </div>
                        <div class="modal-body" style="padding:20px;">
                            ${html}
                        </div>
                    </div>
                `;
                document.body.appendChild(modalOverlay);
                modalOverlay.classList.add('active');
                document.body.style.overflow = 'hidden';

                const closeModal = () => {
                    modalOverlay.remove();
                    document.body.style.overflow = '';
                };

                modalOverlay.querySelector('.modal-close').addEventListener('click', closeModal);
                modalOverlay.addEventListener('click', (e) => {
                    if (e.target === modalOverlay) closeModal();
                });
                document.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        closeModal();
                        document.removeEventListener('keydown', closeModal);
                    }
                });
            } else {
                window.open(bookmark.url, '_blank');
            }
        });

        const content = createElement('div', 'bookmark-content', { padding: '12px', flex: '1', display: 'flex', flexDirection: 'column' });
        const titleEl = createElement('h4', '', { margin: '0 0 4px', fontSize: '16px', color: 'var(--text-primary)' });
        titleEl.textContent = bookmark.title || 'Видео';
        content.appendChild(titleEl);

        const meta = createElement('div', '', { fontSize: '12px', color: 'var(--text-secondary)' });
        meta.textContent = `Видео · ${formatDate(bookmark.added)}`;
        content.appendChild(meta);

        card.appendChild(content);

        if (bookmark.thumbnail) {
            const imgWrapper = createElement('div', 'bookmark-media', {
                position: 'relative',
                paddingBottom: '56.25%',
                background: 'var(--bg-primary)',
                borderBottom: '1px solid var(--border)',
                flexShrink: '0'
            });
            const img = createElement('img', '', {
                position: 'absolute',
                top: 0, left: 0, width: '100%', height: '100%',
                objectFit: 'cover'
            });
            img.src = bookmark.thumbnail;
            img.alt = bookmark.title;
            img.onerror = () => { img.style.display = 'none'; };
            imgWrapper.appendChild(img);
            const playBtn = createElement('div', 'play-overlay', {
                position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                background: 'rgba(0,0,0,0.7)',
                borderRadius: '50%',
                width: '60px', height: '60px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '30px',
                pointerEvents: 'none'
            });
            playBtn.innerHTML = '<i class="fas fa-play"></i>';
            imgWrapper.appendChild(playBtn);
            card.insertBefore(imgWrapper, content);
        } else {
            const iconWrapper = createElement('div', 'bookmark-icon', {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '48px',
                padding: '20px 0',
                background: 'var(--bg-primary)',
                borderBottom: '1px solid var(--border)'
            });
            iconWrapper.innerHTML = '<i class="fas fa-video"></i>';
            card.insertBefore(iconWrapper, content);
        }
    }

    function buildLinkCard(card, bookmark) {
        card.addEventListener('click', () => {
            window.open(bookmark.url, '_blank');
        });

        const content = createElement('div', 'bookmark-content', { padding: '12px', flex: '1', display: 'flex', flexDirection: 'column' });
        const titleEl = createElement('h4', '', { margin: '0 0 4px', fontSize: '16px', color: 'var(--text-primary)' });
        titleEl.textContent = bookmark.title || 'Ссылка';
        content.appendChild(titleEl);

        const meta = createElement('div', '', { fontSize: '12px', color: 'var(--text-secondary)' });
        meta.textContent = `Ссылка · ${formatDate(bookmark.added)}`;
        content.appendChild(meta);

        card.appendChild(content);

        if (bookmark.thumbnail) {
            const imgWrapper = createElement('div', 'bookmark-media', {
                position: 'relative',
                paddingBottom: '56.25%',
                background: 'var(--bg-primary)',
                borderBottom: '1px solid var(--border)',
                flexShrink: '0'
            });
            const img = createElement('img', '', {
                position: 'absolute',
                top: 0, left: 0, width: '100%', height: '100%',
                objectFit: 'cover'
            });
            img.src = bookmark.thumbnail;
            img.alt = bookmark.title;
            img.onerror = () => { img.style.display = 'none'; };
            imgWrapper.appendChild(img);
            card.insertBefore(imgWrapper, content);
        } else {
            const iconWrapper = createElement('div', 'bookmark-icon', {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '48px',
                padding: '20px 0',
                background: 'var(--bg-primary)',
                borderBottom: '1px solid var(--border)'
            });
            iconWrapper.innerHTML = '<i class="fas fa-link"></i>';
            card.insertBefore(iconWrapper, content);
        }
    }

    function buildSaveCard(card, bookmark) {
        card.addEventListener('click', () => {
            if (!bookmark.saveData) return;
            const contentHtml = `
                <div style="margin-bottom:16px;">
                    <strong>Файл:</strong> ${escapeHtml(bookmark.saveData.fileName)}
                </div>
                <pre style="background:var(--bg-primary);padding:16px;border-radius:12px;border:1px solid var(--border);max-height:400px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:13px;">${escapeHtml(bookmark.saveData.content)}</pre>
                <div style="margin-top:16px;display:flex;gap:12px;justify-content:center;">
                    <button class="button" style="background:var(--accent);padding:12px 40px;font-size:18px;" id="download-save-btn">
                        <i class="fas fa-download"></i> Скачать
                    </button>
                </div>
            `;
            // Создаём модалку вручную, чтобы не закрывать хранилище
            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'modal-fullscreen';
            modalOverlay.style.zIndex = '10002';
            modalOverlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
            modalOverlay.innerHTML = `
                <div class="modal-content-full" style="max-width: 700px; max-height: 90vh;">
                    <div class="modal-header">
                        <h2>${escapeHtml(bookmark.title || 'Сохранение')}</h2>
                        <button class="modal-close" aria-label="Закрыть"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-body" style="padding:20px;">
                        ${contentHtml}
                    </div>
                </div>
            `;
            document.body.appendChild(modalOverlay);
            modalOverlay.classList.add('active');
            document.body.style.overflow = 'hidden';

            const closeModal = () => {
                modalOverlay.remove();
                document.body.style.overflow = '';
            };

            modalOverlay.querySelector('.modal-close').addEventListener('click', closeModal);
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) closeModal();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeModal();
                    document.removeEventListener('keydown', closeModal);
                }
            });

            modalOverlay.querySelector('#download-save-btn').addEventListener('click', () => {
                const blob = new Blob([bookmark.saveData.content], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = bookmark.saveData.fileName;
                a.click();
                URL.revokeObjectURL(a.href);
            });
        });

        const content = createElement('div', 'bookmark-content', { padding: '12px', flex: '1', display: 'flex', flexDirection: 'column' });
        const titleEl = createElement('h4', '', { margin: '0 0 4px', fontSize: '16px', color: 'var(--text-primary)' });
        titleEl.textContent = bookmark.title || 'Сохранение';
        content.appendChild(titleEl);

        const meta = createElement('div', '', { fontSize: '12px', color: 'var(--text-secondary)' });
        meta.textContent = `Сохранение · ${formatDate(bookmark.added)}`;
        content.appendChild(meta);

        card.appendChild(content);

        const iconWrapper = createElement('div', 'bookmark-icon', {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '48px',
            padding: '20px 0',
            background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border)'
        });
        iconWrapper.innerHTML = '<i class="fas fa-save"></i>';
        card.insertBefore(iconWrapper, content);
    }

    // ---------- Модалка хранилища ----------
    async function openStorageModal() {
        updateAuthState();
        if (!currentUser) return showToast('Войдите в аккаунт GitHub', 'error');
        if (!currentToken) return showToast('Токен не найден', 'error');
        if (!hasScope('gist')) return showToast('Нужен scope "gist"', 'error');

        const res = await loadBookmarks();
        currentBookmarks = res.bookmarks || [];

        const html = `
            <div class="storage-modal-container">
                <div class="storage-header">
                    <div class="storage-controls">
                        <div class="storage-sort">
                            <button class="sort-btn ${sortOrder==='new'?'active':''}" data-order="new"><i class="fas fa-arrow-down"></i> Новые</button>
                            <button class="sort-btn ${sortOrder==='old'?'active':''}" data-order="old"><i class="fas fa-arrow-up"></i> Старые</button>
                        </div>
                        <div class="storage-categories">
                            <button class="cat-btn ${category==='all'?'active':''}" data-cat="all"><i class="fas fa-globe"></i> Все</button>
                            <button class="cat-btn ${category==='post'?'active':''}" data-cat="post"><i class="fas fa-newspaper"></i> Посты</button>
                            <button class="cat-btn ${category==='video'?'active':''}" data-cat="video"><i class="fas fa-video"></i> Видео</button>
                            <button class="cat-btn ${category==='link'?'active':''}" data-cat="link"><i class="fas fa-link"></i> Ссылки</button>
                            <button class="cat-btn ${category==='save'?'active':''}" data-cat="save"><i class="fas fa-save"></i> Сохранения</button>
                        </div>
                    </div>
                    <div class="storage-actions">
                        <div class="search-wrapper" style="display:flex;gap:8px;align-items:center;">
                            <input type="text" id="search-input" placeholder="Поиск..." style="padding:6px 14px;border-radius:40px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text-primary);font-family:var(--font-family);font-size:14px;width:160px;">
                        </div>
                        <button class="storage-btn primary" id="toggle-add-btn"><i class="fas fa-plus"></i> Добавить</button>
                    </div>
                </div>
                <div id="add-form" class="storage-add-form" style="display:none;">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                        <input type="url" id="new-url" placeholder="Ссылка..." autocomplete="off" style="flex:1;min-width:200px;">
                        <button class="storage-btn primary" id="confirm-add"><i class="fas fa-plus"></i> Добавить</button>
                    </div>
                    <div style="margin-top:12px;border:2px dashed var(--border);border-radius:16px;padding:20px;text-align:center;color:var(--text-secondary);transition:background 0.2s;" id="drop-zone">
                        <i class="fas fa-file-upload" style="font-size:32px;display:block;margin-bottom:8px;"></i>
                        <p>Перетащите файлы .ini или .starver сюда</p>
                        <p style="font-size:12px;">или выберите файлы</p>
                        <input type="file" id="file-input" accept=".ini,.starver" multiple style="display:none;">
                        <button class="storage-btn" id="file-select-btn"><i class="fas fa-folder-open"></i> Выбрать</button>
                    </div>
                </div>
                <div class="bookmarks-grid" id="bookmarks-grid"></div>
            </div>
        `;

        const { modal, closeModal } = createModal('Хранилище', html, { size: 'full' });
        modalRef = modal;

        const style = createElement('style');
        style.textContent = `
            .storage-modal-container{display:flex;flex-direction:column;gap:20px}
            .storage-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px}
            .storage-controls{display:flex;gap:15px;flex-wrap:wrap}
            .storage-sort,.storage-categories{display:flex;background:var(--bg-primary);border-radius:40px;padding:4px;border:1px solid var(--border)}
            .sort-btn,.cat-btn{background:0;border:0;color:var(--text-secondary);padding:8px 16px;border-radius:40px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:0.2s;font-family:'Russo One',sans-serif}
            .sort-btn.active,.cat-btn.active{background:var(--accent);color:#fff}
            .storage-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
            .storage-btn{background:var(--bg-primary);border:1px solid var(--border);color:var(--text-secondary);padding:8px 16px;border-radius:40px;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:0.2s;font-family:'Russo One',sans-serif}
            .storage-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
            .storage-btn:hover{transform:translateY(-2px);box-shadow:0 5px 15px rgba(0,0,0,0.2)}
            .bookmarks-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}
            .bookmark-card-wrapper{position:relative;transition:transform 0.2s}
            .bookmark-card-wrapper:hover{transform:translateY(-4px)}
            .bookmark-delete-btn{opacity:0;transition:opacity 0.2s}
            .bookmark-card-wrapper:hover .bookmark-delete-btn{opacity:1}
            .storage-add-form{background:var(--bg-inner-gradient);padding:16px;border-radius:20px;border:1px solid var(--border)}
            #drop-zone.dragover{background:var(--bg-card);border-color:var(--accent)}
            .bookmark-media{position:relative;padding-bottom:56.25%;background:var(--bg-primary);border-bottom:1px solid var(--border);flex-shrink:0;overflow:hidden}
            .bookmark-media img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
            .play-overlay{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.7);border-radius:50%;width:60px;height:60px;display:flex;align-items:center;justify-content:center;color:white;font-size:30px;pointer-events:none}
            .bookmark-icon{display:flex;align-items:center;justify-content:center;font-size:48px;padding:20px 0;background:var(--bg-primary);border-bottom:1px solid var(--border)}
            .bookmark-content{padding:12px;flex:1;display:flex;flex-direction:column}
            .bookmark-content h4{margin:0 0 4px;font-size:16px;color:var(--text-primary)}
            .bookmark-content .text-secondary{font-size:12px}
            .search-wrapper input{transition:border-color 0.2s,box-shadow 0.2s}
            .search-wrapper input:focus{border-color:var(--accent);outline:none;box-shadow:0 0 0 2px rgba(61,158,179,0.3)}
        `;
        modal.appendChild(style);

        const grid = modal.querySelector('#bookmarks-grid');
        renderBookmarks(modal);

        // Сортировка
        modal.querySelectorAll('.sort-btn').forEach(b => {
            b.addEventListener('click', () => {
                sortOrder = b.dataset.order;
                modal.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
                b.classList.add('active');
                renderBookmarks(modal);
            });
        });

        // Фильтры
        modal.querySelectorAll('.cat-btn').forEach(b => {
            b.addEventListener('click', () => {
                category = b.dataset.cat;
                modal.querySelectorAll('.cat-btn').forEach(btn => btn.classList.remove('active'));
                b.classList.add('active');
                renderBookmarks(modal);
            });
        });

        // Поиск
        const searchInput = modal.querySelector('#search-input');
        searchInputRef = searchInput;
        const debouncedSearch = debounce(() => {
            searchQuery = searchInput.value;
            renderBookmarks(modal);
        }, SEARCH_DEBOUNCE_MS);
        searchInput.addEventListener('input', debouncedSearch);

        // Добавление
        const toggleAddBtn = modal.querySelector('#toggle-add-btn');
        const addForm = modal.querySelector('#add-form');
        let formVisible = false;
        toggleAddBtn.addEventListener('click', () => {
            formVisible = !formVisible;
            addForm.style.display = formVisible ? 'block' : 'none';
            toggleAddBtn.innerHTML = formVisible ? '<i class="fas fa-times"></i> Отмена' : '<i class="fas fa-plus"></i> Добавить';
        });

        const addBtn = modal.querySelector('#confirm-add');
        const urlInput = modal.querySelector('#new-url');
        addBtn.addEventListener('click', async () => {
            const url = urlInput.value.trim();
            if (!url) {
                showToast('Введите ссылку', 'error');
                return;
            }
            try {
                await addBookmark(url);
                showToast('Добавлено', 'success');
                urlInput.value = '';
                renderBookmarks(modal);
            } catch (e) {
                if (e.message !== 'duplicate') showToast('Ошибка: ' + e.message, 'error');
            }
        });

        // Файлы
        const dropZone = modal.querySelector('#drop-zone');
        const fileInput = modal.querySelector('#file-input');
        const fileSelectBtn = modal.querySelector('#file-select-btn');

        fileSelectBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (files.length === 0) return;
            await processFiles(files, modal);
            fileInput.value = '';
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length === 0) return;
            await processFiles(files, modal);
        });

        return { modal, closeModal: () => { closeModal(); modalRef = null; } };
    }

    async function processFiles(files, modal) {
        for (const file of files) {
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext !== 'ini' && ext !== 'starver') {
                showToast(`Файл ${file.name} не поддерживается`, 'error');
                continue;
            }
            try {
                const content = await file.text();
                await addBookmark(null, file.name, content, file.name);
                showToast(`Сохранение "${file.name}" добавлено`, 'success');
            } catch (e) {
                if (e.message !== 'duplicate') showToast(`Ошибка при добавлении ${file.name}: ${e.message}`, 'error');
            }
        }
        if (modal) renderBookmarks(modal);
    }

    function updateAuthState() {
        if (!window.GithubAuth) return;
        currentUser = getCurrentUser();
        currentToken = getToken();
        if (currentUser && currentToken) {
            const stored = localStorage.getItem(STORAGE_KEY_PREFIX + currentUser);
            if (stored) try { gistId = JSON.parse(stored).gistId; } catch {}
        } else {
            gistId = null;
        }
    }

    window.addEventListener('github-login-success', updateAuthState);
    window.addEventListener('github-logout', () => {
        currentUser = null;
        currentToken = null;
        gistId = null;
        currentBookmarks = [];
        if (modalRef) {
            modalRef = null;
        }
    });

    window.BookmarkStorage = {
        openStorageModal,
        addBookmark,
        removeBookmark,
        loadBookmarks,
        resetStorage: async () => {
            if (gistId && currentToken) {
                await fetch(`https://api.github.com/gists/${gistId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${currentToken}` }
                }).catch(() => {});
            }
            gistId = null;
            localStorage.removeItem(STORAGE_KEY_PREFIX + currentUser);
            currentBookmarks = [];
        }
    };
})();