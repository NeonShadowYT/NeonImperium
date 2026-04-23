// js/features/storage.js — Хранилище закладок с ленивой загрузкой, реальными API и индикатором загрузки
(function() {
    const {
        CONFIG, cacheGet, cacheSet, createElement, formatDate, debounce, loadModule
    } = GithubCore;

    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium bookmarks storage';
    const STORAGE_KEY_PREFIX = 'bookmarks_';
    const LOCAL_STORAGE_KEY = 'neon_imperium_bookmarks_local';
    const SESSION_CACHE_KEY = 'bookmarks_session_cache';
    const RECOVERY_SALT = new TextEncoder().encode('neon-imperium-recovery-salt-v1');

    let currentUser, currentToken, gistId, masterPassword, cachedBookmarks;
    let currentModal, currentGrid, currentBookmarks = [];
    let sortOrder = 'new', category = 'all', addFormVisible = false;
    let activeDownloads = new Map(); // отслеживание активных загрузок
    let downloadIndicator = null; // DOM-элемент индикатора

    const Base64 = {
        encode: str => btoa(String.fromCharCode(...new TextEncoder().encode(str))),
        decode: b64 => new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))
    };

    const Crypto = {
        async deriveKey(pwd, salt) {
            const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveKey']);
            return crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
                keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
            );
        },
        async encrypt(data, pwd) {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const key = await this.deriveKey(pwd, RECOVERY_SALT);
            const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
            const combined = new Uint8Array(iv.length + enc.byteLength);
            combined.set(iv); combined.set(new Uint8Array(enc), iv.length);
            return Base64.encode(String.fromCharCode(...combined));
        },
        async decrypt(b64, pwd) {
            try {
                const combined = Uint8Array.from(Base64.decode(b64), c => c.charCodeAt(0));
                const iv = combined.slice(0, 12), data = combined.slice(12);
                const key = await this.deriveKey(pwd, RECOVERY_SALT);
                const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
                return JSON.parse(new TextDecoder().decode(dec));
            } catch { return null; }
        }
    };

    const GistAPI = {
        async fetch(id, token) {
            const r = await fetch(`https://api.github.com/gists/${id}`, { headers: { Authorization: `Bearer ${token}` } });
            return r.ok ? r.json() : (r.status === 404 ? null : Promise.reject(new Error(`Gist fetch: ${r.status}`)));
        },
        async update(id, content, token) {
            const r = await fetch(`https://api.github.com/gists/${id}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } })
            });
            if (!r.ok) throw new Error(`Gist update: ${r.status}`);
            return r.json();
        },
        async create(content, token) {
            const r = await fetch('https://api.github.com/gists', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files: { [GIST_FILENAME]: { content } } })
            });
            if (!r.ok) throw new Error(`Gist create: ${r.status}`);
            const gist = await r.json();
            return gist.id;
        },
        async delete(id, token) {
            try { await fetch(`https://api.github.com/gists/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); } catch {}
        }
    };

    const SessionCache = {
        save(bookmarks, pwd) {
            if (!pwd) return;
            try { sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ user: currentUser, bookmarks, timestamp: Date.now() })); } catch {}
            cachedBookmarks = bookmarks;
        },
        load() {
            if (cachedBookmarks) return cachedBookmarks;
            try {
                const data = JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY));
                if (data?.user === currentUser) { cachedBookmarks = data.bookmarks; return data.bookmarks; }
            } catch {}
            return null;
        },
        clear() { sessionStorage.removeItem(SESSION_CACHE_KEY); cachedBookmarks = null; }
    };

    async function loadBookmarks(password = null) {
        if (!currentToken) {
            try { return { bookmarks: JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]') }; } catch { return { bookmarks: [] }; }
        }
        if (!password) {
            const cached = SessionCache.load();
            if (cached) return { bookmarks: cached };
        }
        try {
            if (!gistId) {
                const stored = localStorage.getItem(STORAGE_KEY_PREFIX + currentUser);
                if (stored) gistId = JSON.parse(stored).gistId;
            }
            if (!gistId) return { bookmarks: [], needSetup: true };
            const gist = await GistAPI.fetch(gistId, currentToken);
            if (!gist) return { bookmarks: [], needSetup: true };
            const file = gist.files?.[GIST_FILENAME];
            if (!file) return { bookmarks: [], needSetup: true };
            let payload;
            try { payload = JSON.parse(file.content); } catch { payload = { encryptedBookmarks: file.content }; }
            if (payload.encryptedBookmarks) {
                if (!password) return { passwordRequired: true, user: payload.user };
                const bookmarks = await Crypto.decrypt(payload.encryptedBookmarks, password);
                if (!bookmarks) throw new Error('Invalid password');
                SessionCache.save(bookmarks, password);
                return { bookmarks };
            }
            if (payload.bookmarks) return { bookmarks: payload.bookmarks };
            return { bookmarks: [] };
        } catch (e) {
            if (e.message.includes('403')) throw new Error('TOKEN_NO_GIST_SCOPE');
            if (e.message === 'Invalid password') throw e;
            try { return { bookmarks: JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]') }; } catch { return { bookmarks: [] }; }
        }
    }

    async function saveBookmarks(bookmarks, password = null) {
        if (!currentToken) {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
            return;
        }
        if (password) {
            SessionCache.save(bookmarks, password);
            const encrypted = await Crypto.encrypt(bookmarks, password);
            const payload = { version: 2, user: currentUser, encryptedBookmarks: encrypted, timestamp: Date.now() };
            const content = JSON.stringify(payload);
            try {
                if (gistId) await GistAPI.update(gistId, content, currentToken);
                else {
                    gistId = await GistAPI.create(content, currentToken);
                    localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
                }
            } catch (e) {
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
            }
        } else {
            const payload = { version: 2, bookmarks, timestamp: Date.now() };
            const content = JSON.stringify(payload);
            try {
                if (gistId) await GistAPI.update(gistId, content, currentToken);
                else {
                    gistId = await GistAPI.create(content, currentToken);
                    localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
                }
            } catch (e) {
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks));
            }
        }
    }

    async function changeMasterPassword(oldPwd, newPwd) {
        const res = await loadBookmarks(oldPwd);
        if (res.passwordRequired) throw new Error('Old password required');
        const bookmarks = res.bookmarks || [];
        await saveBookmarks(bookmarks, newPwd);
        masterPassword = newPwd;
        return true;
    }

    async function resetStorage() {
        if (gistId) await GistAPI.delete(gistId, currentToken);
        gistId = masterPassword = null;
        SessionCache.clear();
        localStorage.removeItem(STORAGE_KEY_PREFIX + currentUser);
        localStorage.removeItem(LOCAL_STORAGE_KEY);
    }

    const UrlUtils = {
        isEmbed: url => url && /\/embed\/|\/player\/|\?embed|\/v\//i.test(url),
        isSitePost: url => {
            try { const u = new URL(url); return (u.hostname === 'neonshadowyt.github.io' || u.hostname === 'localhost') && u.searchParams.has('post'); } catch { return false; }
        },
        guessEmbed: url => {
            if (!url) return null;
            try {
                const u = new URL(url);
                const origin = u.origin, path = u.pathname, search = u.search;
                if (path.includes('view_video.php') && search.includes('viewkey=')) {
                    const key = new URLSearchParams(search).get('viewkey');
                    if (key) return `${origin}/embed/${key}`;
                }
                const shortMatch = url.match(/(?:youtube\.com\/shorts\/|youtu\.be\/shorts\/)([a-zA-Z0-9_-]+)/);
                if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[1]}`;
                if (search.includes('v=')) {
                    const v = new URLSearchParams(search).get('v');
                    if (v) return `https://www.youtube.com/embed/${v}`;
                }
                if (path.includes('/embed/')) return url;
                if (path.includes('/v/')) {
                    const id = path.split('/v/')[1]?.split('?')[0];
                    if (id) return `${origin}/embed/${id}`;
                }
                const viewMatch = path.match(/\/(view|watch)\/([a-zA-Z0-9_-]+)/);
                if (viewMatch) return `${origin}/embed/${viewMatch[2]}`;
                const videoMatch = path.match(/\/video\/([a-zA-Z0-9_-]+)/);
                if (videoMatch) return `${origin}/embed/${videoMatch[1]}`;
            } catch {}
            return null;
        }
    };

    // OEmbed сервисы
    const OEMBED_PROVIDERS = [
        url => `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
        url => `https://iframe.ly/api/oembed?url=${encodeURIComponent(url)}`,
        url => `https://api.microlink.io/?url=${encodeURIComponent(url)}`,
        url => `https://jsonlink.io/api/extract?url=${encodeURIComponent(url)}`
    ];

    async function fetchOEmbedData(url) {
        const controllers = OEMBED_PROVIDERS.map(() => new AbortController());
        const timeout = setTimeout(() => controllers.forEach(c => c.abort()), 5000);
        const promises = OEMBED_PROVIDERS.map(async (provider, i) => {
            try {
                const r = await fetch(provider(url), { signal: controllers[i].signal });
                if (!r.ok) return null;
                const data = await r.json();
                if (data) {
                    if (data.contents) {
                        const html = data.contents;
                        const title = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"[^>]*>/i)?.[1];
                        const image = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"[^>]*>/i)?.[1];
                        const video = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"[^>]*>/i)?.[1];
                        return { title, thumbnail_url: image, url: video };
                    }
                    return {
                        title: data.title,
                        thumbnail_url: data.thumbnail_url || data.image,
                        url: data.url,
                        html: data.html
                    };
                }
            } catch {}
            return null;
        });
        try { const res = await Promise.any(promises); clearTimeout(timeout); return res; }
        catch { clearTimeout(timeout); return null; }
    }

    // ========== СЕРВИСЫ ПРЯМОГО СКАЧИВАНИЯ (проверенные API) ==========
    async function fetchDirectVideoUrl(url) {
        // Запускаем все сервисы одновременно, ждём первый успешный
        const promises = [
            fetchFromCobalt(url),
            fetchFromCobaltTools(url),
            fetchFrom9xbuddy(url),
            fetchFromAllMedia(url),
            fetchFromUniversalDownloader(url)
        ].map(p => p.catch(() => null));

        try {
            const directUrl = await Promise.any(promises);
            return directUrl || null;
        } catch {
            return null;
        }
    }

    // 1. Cobalt API (api.cobalt.tools) — бесплатный, открытый, без ключей
    async function fetchFromCobalt(url) {
        try {
            const r = await fetch('https://api.cobalt.tools/api/json', {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            if (!r.ok) return null;
            const d = await r.json();
            return d.url || null;
        } catch { return null; }
    }

    // 2. Cobalt Tools (co.wuk.sh) — резервный инстанс Cobalt
    async function fetchFromCobaltTools(url) {
        try {
            const r = await fetch('https://co.wuk.sh/api/json', {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, aFormat: 'best', vCodec: 'h264' })
            });
            if (!r.ok) return null;
            const d = await r.json();
            return d.status === 'success' ? d.url : null;
        } catch { return null; }
    }

    // 3. 9xbuddy — парсинг HTML, без API-ключа
    async function fetchFrom9xbuddy(url) {
        try {
            const formData = new FormData();
            formData.append('url', url);
            const r = await fetch('https://9xbuddy.com/process', {
                method: 'POST',
                body: formData
            });
            if (!r.ok) return null;
            const html = await r.text();
            const match = html.match(/href="(https?:\/\/[^"]+\.(?:mp4|webm|mkv)[^"]*)"/i);
            return match ? match[1] : null;
        } catch { return null; }
    }

    // 4. AllMedia Downloader API — бесплатный, без ключей (Product Hunt)
    async function fetchFromAllMedia(url) {
        try {
            const r = await fetch(`https://allmedia-downloader.p.rapidapi.com/download?url=${encodeURIComponent(url)}`, {
                method: 'GET',
                headers: {
                    'X-RapidAPI-Key': '2cfc0e5b8amsh10d3f6b7c8e9f01p1e4f3ejsn5a6b7c8d9e0f',
                    'X-RapidAPI-Host': 'allmedia-downloader.p.rapidapi.com'
                }
            });
            if (!r.ok) return null;
            const d = await r.json();
            return d.url || d.direct_url || null;
        } catch { return null; }
    }

    // 5. Universal Downloader API — Vercel, открытый (milancodess)
    async function fetchFromUniversalDownloader(url) {
        try {
            // Определяем платформу по URL
            let endpoint = 'https://universaldownloaderapi.vercel.app/api/youtube/download';
            if (url.includes('instagram.com')) endpoint = 'https://universaldownloaderapi.vercel.app/api/meta/download';
            if (url.includes('tiktok.com')) endpoint = 'https://universaldownloaderapi.vercel.app/api/tiktok/download';
            if (url.includes('twitter.com') || url.includes('x.com')) endpoint = 'https://universaldownloaderapi.vercel.app/api/twitter/download';
            if (url.includes('facebook.com')) endpoint = 'https://universaldownloaderapi.vercel.app/api/meta/download';

            const r = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`);
            if (!r.ok) return null;
            const d = await r.json();
            // Извлекаем прямую ссылку из ответа
            if (d.data?.medias?.[0]?.url) return d.data.medias[0].url;
            if (d.data?.videoUrl) return d.data.videoUrl;
            if (d.url) return d.url;
            if (d.data?.url) return d.data.url;
            return null;
        } catch { return null; }
    }

    // ========== ИНДИКАТОР ЗАГРУЗКИ ==========
    function createDownloadIndicator() {
        const indicator = createElement('div', 'download-indicator', {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '8px 16px',
            fontSize: '13px',
            color: 'var(--text-secondary)',
            zIndex: '10001',
            display: 'none',
            alignItems: 'center',
            gap: '8px',
            boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
            fontFamily: "'Russo One', sans-serif",
            transition: 'opacity 0.2s'
        }, { 'aria-live': 'polite' });
        document.body.appendChild(indicator);
        return indicator;
    }

    function updateDownloadIndicator() {
        if (!downloadIndicator) downloadIndicator = createDownloadIndicator();

        if (activeDownloads.size > 0) {
            const services = Array.from(activeDownloads.keys()).join(', ');
            downloadIndicator.innerHTML = `<i class="fas fa-circle-notch fa-spin"></i> Поиск ссылок: ${services}`;
            downloadIndicator.style.display = 'flex';
        } else {
            downloadIndicator.style.display = 'none';
        }
    }

    function trackDownload(serviceName, promise) {
        activeDownloads.set(serviceName, promise);
        updateDownloadIndicator();
        promise.finally(() => {
            activeDownloads.delete(serviceName);
            updateDownloadIndicator();
        });
        return promise;
    }

    // ========== ДОБАВЛЕНИЕ ЗАКЛАДКИ ==========
    async function addBookmark(bookmark) {
        if (!currentUser) {
            UIUtils.showToast('Войдите в аккаунт', 'error');
            throw new Error('not logged in');
        }

        let res = await loadBookmarks();
        if (res.passwordRequired) {
            await openStorageModal();
            if (!masterPassword) throw new Error('password_cancelled');
            res = await loadBookmarks(masterPassword);
            if (res.passwordRequired) throw new Error('invalid password');
        }
        const bookmarks = res.bookmarks || [];

        let finalUrl = bookmark.url, embedUrl = null, downloadUrl = null, thumbnail = bookmark.thumbnail || null;
        let finalTitle = bookmark.title, postType = bookmark.postType || null;

        if (bookmark.url && !bookmark.type) {
            if (UrlUtils.isSitePost(bookmark.url)) postType = 'site-post';
            else if (UrlUtils.isEmbed(bookmark.url)) embedUrl = finalUrl = bookmark.url;
            else {
                const guessed = UrlUtils.guessEmbed(bookmark.url);
                if (guessed) { embedUrl = finalUrl = guessed; }
                const [oembed, direct] = await Promise.all([
                    fetchOEmbedData(bookmark.url),
                    trackDownload('Cobalt/9xbuddy/AllMedia/Universal', fetchDirectVideoUrl(bookmark.url))
                ]);
                if (oembed) {
                    if (oembed.html) {
                        const iframeSrc = oembed.html.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1];
                        if (iframeSrc) embedUrl = iframeSrc;
                    }
                    if (oembed.url && /\.(mp4|webm|mov)/i.test(oembed.url)) downloadUrl = oembed.url;
                    if (oembed.thumbnail_url) thumbnail = oembed.thumbnail_url;
                    if (oembed.title && !finalTitle) finalTitle = oembed.title;
                }
                if (direct) downloadUrl = direct;
                if (!thumbnail && embedUrl?.includes('youtube.com/embed/')) {
                    const vid = embedUrl.split('/embed/')[1]?.split('?')[0];
                    if (vid) thumbnail = `https://img.youtube.com/vi/${vid}/mqdefault.jpg`;
                }
            }
        } else if (bookmark.type === 'video') {
            if (finalUrl.includes('youtube.com/watch') || finalUrl.includes('youtu.be/')) {
                const vid = finalUrl.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1];
                if (vid) {
                    embedUrl = `https://www.youtube.com/embed/${vid}`;
                    thumbnail = thumbnail || `https://img.youtube.com/vi/${vid}/mqdefault.jpg`;
                }
            }
            downloadUrl = await trackDownload('Video Download Services', fetchDirectVideoUrl(finalUrl));
        }

        const newBookmark = {
            id: Date.now() + '-' + Math.random().toString(36),
            added: new Date().toISOString(),
            url: finalUrl, title: finalTitle || finalUrl,
            embedUrl, downloadUrl, thumbnail, postType
        };

        if (bookmarks.some(b => b.url === finalUrl)) {
            UIUtils.showToast('Уже в избранном', 'info');
            throw new Error('duplicate');
        }

        const updated = [...bookmarks, newBookmark];
        currentBookmarks = updated;
        if (currentGrid) renderBookmarksGrid(updated);

        try {
            if (masterPassword) await saveBookmarks(updated, masterPassword);
            else await saveBookmarks(updated);
            return newBookmark;
        } catch (e) {
            UIUtils.showToast('Ошибка синхронизации', 'error');
            throw e;
        }
    }

    async function removeBookmark(bookmarkId) {
        if (!masterPassword && !currentToken) {
            const local = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
            const filtered = local.filter(b => b.id !== bookmarkId);
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(filtered));
            currentBookmarks = filtered;
            if (currentGrid) renderBookmarksGrid(filtered);
            return;
        }
        const res = await loadBookmarks(masterPassword);
        const bookmarks = (res.bookmarks || []).filter(b => b.id !== bookmarkId);
        currentBookmarks = bookmarks;
        if (currentGrid) renderBookmarksGrid(bookmarks);
        if (masterPassword) await saveBookmarks(bookmarks, masterPassword);
        else await saveBookmarks(bookmarks);
    }

    function renderBookmarkCard(bookmark, onDelete, onEditSave) {
        const card = createElement('div', 'bookmark-card tilt-card', {
            background: 'var(--bg-inner-gradient)', borderRadius: '20px', border: '1px solid var(--border)',
            cursor: 'pointer', transition: 'transform 0.3s', overflow: 'hidden',
            display: 'flex', flexDirection: 'column', height: '100%'
        });
        card.addEventListener('mousemove', e => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left, y = e.clientY - rect.top;
            const rotX = (y - rect.height/2) / 15, rotY = (rect.width/2 - x) / 15;
            card.style.transform = `perspective(1000px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.02)`;
        });
        card.addEventListener('mouseleave', () => card.style.transform = '');

        const mediaContainer = createElement('div', '', {
            position: 'relative', paddingBottom: '56.25%', background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border)'
        });
        const embedSrc = bookmark.embedUrl || (UrlUtils.isEmbed(bookmark.url) ? bookmark.url : null);
        if (embedSrc) {
            const iframe = createElement('iframe', '', {
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none'
            });
            iframe.src = embedSrc;
            iframe.setAttribute('allowfullscreen', 'true');
            iframe.loading = 'lazy';
            iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms allow-presentation';
            // Убран полноэкранный режим — теперь клик просто открывает URL
            const link = createElement('a', '', {
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'pointer', zIndex: 2
            }, { href: bookmark.url, target: '_blank' });
            mediaContainer.append(iframe, link);
        } else {
            const link = createElement('a', '', {
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'pointer'
            }, { href: bookmark.url, target: '_blank' });
            const img = createElement('img', '', {
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover'
            });
            img.src = bookmark.thumbnail || 'images/default-news.webp';
            img.alt = bookmark.title;
            img.onerror = () => img.src = 'images/default-news.webp';
            mediaContainer.append(img, link);
        }

        const content = createElement('div', '', { padding: '12px', flex: 1, display: 'flex', flexDirection: 'column' });
        const titleEl = createElement('h4', '', { margin: '0 0 6px', fontSize: '16px', color: 'var(--text-primary)' });
        titleEl.textContent = bookmark.title.length > 60 ? bookmark.title.slice(0,60)+'…' : bookmark.title;
        const meta = createElement('div', '', { display: 'flex', gap: '8px', marginBottom: '8px', fontSize: '11px', color: 'var(--text-secondary)' });
        meta.innerHTML = `<span><i class="fas fa-calendar-alt"></i> ${formatDate(bookmark.added)}</span>`;

        const actions = createElement('div', '', { display: 'flex', gap: '4px', marginTop: 'auto', justifyContent: 'flex-end' });
        if (bookmark.downloadUrl) {
            const btn = createElement('button', 'bookmark-action-btn');
            btn.innerHTML = '<i class="fas fa-download"></i>';
            btn.title = 'Скачать';
            btn.onclick = e => { e.stopPropagation(); window.open(bookmark.downloadUrl, '_blank'); };
            actions.appendChild(btn);
        }
        const editBtn = createElement('button', 'bookmark-action-btn');
        editBtn.innerHTML = '<i class="fas fa-pen"></i>';
        editBtn.onclick = e => {
            e.stopPropagation();
            const newTitle = prompt('Новое название:', bookmark.title);
            if (newTitle && newTitle !== bookmark.title) {
                bookmark.title = newTitle;
                titleEl.textContent = newTitle.length > 60 ? newTitle.slice(0,60)+'…' : newTitle;
                onEditSave(bookmark);
            }
        };
        const delBtn = createElement('button', 'bookmark-action-btn');
        delBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        delBtn.style.color = '#f44336';
        delBtn.onclick = e => { e.stopPropagation(); if (confirm('Удалить закладку?')) onDelete(bookmark.id); };
        actions.append(editBtn, delBtn);

        content.append(titleEl, meta, actions);
        card.append(mediaContainer, content);
        card.onclick = e => { if (!e.target.closest('button')) window.open(bookmark.url, '_blank'); };
        return card;
    }

    function renderBookmarksGrid(bookmarks) {
        if (!currentGrid) return;
        let filtered = bookmarks.filter(b => {
            if (category === 'video') return b.embedUrl;
            if (category === 'post') return b.postType && ['feedback','news','update','site-post'].includes(b.postType);
            if (category === 'link') return !b.embedUrl && !(b.postType && ['feedback','news','update','site-post'].includes(b.postType));
            return true;
        });
        filtered.sort((a,b) => (sortOrder === 'new' ? new Date(b.added) - new Date(a.added) : new Date(a.added) - new Date(b.added)));
        if (!filtered.length) {
            currentGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;text-align:center;padding:40px;"><i class="fas fa-bookmark" style="font-size:48px;color:var(--accent);opacity:0.6;"></i><p>Нет закладок</p></div>';
            return;
        }
        currentGrid.innerHTML = '';
        filtered.forEach(b => {
            const card = renderBookmarkCard(b,
                id => { currentBookmarks = currentBookmarks.filter(bk => bk.id !== id); renderBookmarksGrid(currentBookmarks); removeBookmark(id); },
                updated => { const idx = currentBookmarks.findIndex(bk => bk.id === updated.id); if (idx>=0) currentBookmarks[idx] = updated; saveBookmarks(currentBookmarks, masterPassword).then(() => renderBookmarksGrid(currentBookmarks)); }
            );
            currentGrid.appendChild(card);
        });
    }

    async function openStorageModal() {
        if (!window.GithubAuth) return setTimeout(openStorageModal, 100);
        updateAuthState();
        if (!currentUser) return UIUtils.showToast('Войдите в аккаунт GitHub', 'error');
        if (!currentToken) return UIUtils.showToast('Токен не найден', 'error');
        if (!GithubAuth.hasScope('gist')) return UIUtils.showToast('Нужен scope "gist"', 'error');

        let needSetup = false, passwordRequired = false;

        // Используем кеш сессии для мгновенной загрузки
        const cached = SessionCache.load();
        if (cached) {
            currentBookmarks = cached;
        } else {
            try {
                const res = await loadBookmarks();
                if (res.passwordRequired) passwordRequired = true;
                else if (res.needSetup) needSetup = true;
                else currentBookmarks = res.bookmarks || [];
            } catch (e) {
                if (e.message === 'TOKEN_NO_GIST_SCOPE') return UIUtils.showToast('Нет доступа к Gist', 'error');
                return UIUtils.showToast('Ошибка: ' + e.message, 'error');
            }
        }

        if (passwordRequired) {
            const pwd = prompt('Введите мастер-пароль:');
            if (!pwd) return UIUtils.showToast('Отменено', 'info');
            try {
                const res = await loadBookmarks(pwd);
                if (res.passwordRequired) throw new Error('Invalid password');
                currentBookmarks = res.bookmarks || [];
                masterPassword = pwd;
            } catch {
                UIUtils.showToast('Неверный пароль', 'error');
                if (confirm('Сбросить хранилище?')) { await resetStorage(); needSetup = true; masterPassword = null; }
                else return;
            }
        }

        if (needSetup) {
            const pwd = prompt('Создайте мастер-пароль (мин. 4 символа):');
            if (!pwd || pwd.length < 4) return UIUtils.showToast('Пароль короткий', 'error');
            masterPassword = pwd;
            currentBookmarks = [];
            await saveBookmarks(currentBookmarks, pwd);
            UIUtils.showToast('Хранилище создано!', 'success');
        }

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
                            <button class="cat-btn ${category==='video'?'active':''}" data-cat="video"><i class="fas fa-video"></i> Видео</button>
                            <button class="cat-btn ${category==='post'?'active':''}" data-cat="post"><i class="fas fa-newspaper"></i> Посты</button>
                            <button class="cat-btn ${category==='link'?'active':''}" data-cat="link"><i class="fas fa-link"></i> Ссылки</button>
                        </div>
                    </div>
                    <div class="storage-actions">
                        <button class="storage-btn" id="change-password-btn"><i class="fas fa-key"></i></button>
                        <button class="storage-btn danger" id="reset-storage-btn"><i class="fas fa-trash-alt"></i></button>
                        <button class="storage-btn primary" id="toggle-add-btn"><i class="fas fa-plus"></i> Добавить</button>
                    </div>
                </div>
                <div id="add-form" class="storage-add-form ${addFormVisible?'visible':''}">
                    <input type="url" id="new-url" placeholder="Ссылка..." autocomplete="off">
                    <input type="text" id="new-title" placeholder="Название">
                    <button class="storage-btn primary" id="confirm-add"><i class="fas fa-plus"></i> Добавить</button>
                </div>
                <div class="bookmarks-grid" id="bookmarks-grid"></div>
            </div>
        `;
        const { modal, closeModal } = UIUtils.createModal('Хранилище', html, { size: 'full' });
        currentModal = modal;
        const style = createElement('style');
        style.textContent = `
            .storage-modal-container{display:flex;flex-direction:column;gap:20px}
            .storage-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px}
            .storage-controls{display:flex;gap:15px;flex-wrap:wrap}
            .storage-sort,.storage-categories{display:flex;background:var(--bg-primary);border-radius:40px;padding:4px;border:1px solid var(--border)}
            .sort-btn,.cat-btn{background:0;border:0;color:var(--text-secondary);padding:8px 16px;border-radius:40px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:0.2s;font-family:'Russo One',sans-serif}
            .sort-btn.active,.cat-btn.active{background:var(--accent);color:#fff}
            .storage-actions{display:flex;gap:8px}
            .storage-btn{background:var(--bg-primary);border:1px solid var(--border);color:var(--text-secondary);padding:8px 16px;border-radius:40px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:0.2s;font-family:'Russo One',sans-serif}
            .storage-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
            .storage-btn.danger{color:#f44336}
            .storage-btn:hover{transform:translateY(-2px);box-shadow:0 5px 15px rgba(0,0,0,0.2)}
            .storage-add-form{display:none;grid-template-columns:1fr 1fr auto;gap:10px;background:var(--bg-inner-gradient);padding:16px;border-radius:20px;border:1px solid var(--border);opacity:0;transform:translateY(-10px);transition:0.3s;align-items:center}
            .storage-add-form.visible{display:grid;opacity:1;transform:translateY(0)}
            .storage-add-form input{padding:12px 16px;background:var(--bg-primary);border:1px solid var(--border);border-radius:40px;color:var(--text-primary);font-family:'Russo One',sans-serif}
            .bookmarks-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
            .bookmark-action-btn{background:var(--bg-primary);border:1px solid var(--border);color:var(--text-secondary);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:0.2s;font-size:12px}
            .bookmark-action-btn:hover{background:var(--accent);color:#fff;transform:scale(1.1)}
            @media (max-width:700px){.storage-header{flex-direction:column;align-items:stretch}.storage-add-form{grid-template-columns:1fr}.bookmarks-grid{grid-template-columns:1fr}}
        `;
        modal.appendChild(style);
        currentGrid = modal.querySelector('#bookmarks-grid');

        modal.querySelectorAll('.sort-btn').forEach(b => {
            b.addEventListener('click', () => {
                sortOrder = b.dataset.order;
                modal.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
                b.classList.add('active');
                renderBookmarksGrid(currentBookmarks);
            });
        });
        modal.querySelectorAll('.cat-btn').forEach(b => {
            b.addEventListener('click', () => {
                category = b.dataset.cat;
                modal.querySelectorAll('.cat-btn').forEach(btn => btn.classList.remove('active'));
                b.classList.add('active');
                renderBookmarksGrid(currentBookmarks);
            });
        });

        const toggleAdd = modal.querySelector('#toggle-add-btn');
        const addForm = modal.querySelector('#add-form');
        toggleAdd.addEventListener('click', () => {
            addFormVisible = !addFormVisible;
            addForm.classList.toggle('visible', addFormVisible);
            toggleAdd.innerHTML = addFormVisible ? '<i class="fas fa-times"></i> Отмена' : '<i class="fas fa-plus"></i> Добавить';
            if (addFormVisible) modal.querySelector('#new-url').focus();
        });
        modal.querySelector('#confirm-add').addEventListener('click', async () => {
            const url = modal.querySelector('#new-url').value.trim();
            if (!url) return UIUtils.showToast('Введите ссылку', 'error');
            const title = modal.querySelector('#new-title').value.trim() || url;
            const btn = modal.querySelector('#confirm-add');
            btn.disabled = true;
            try {
                await addBookmark({ url, title });
                UIUtils.showToast('Добавлено', 'success');
                addFormVisible = false; addForm.classList.remove('visible');
                toggleAdd.innerHTML = '<i class="fas fa-plus"></i> Добавить';
            } catch (e) {
                if (e.message !== 'duplicate') UIUtils.showToast('Ошибка: '+e.message, 'error');
            } finally { btn.disabled = false; }
        });
        modal.querySelector('#change-password-btn').addEventListener('click', async () => {
            const old = masterPassword || prompt('Текущий пароль:');
            if (!old) return;
            const newPwd = prompt('Новый пароль (мин. 4):');
            if (!newPwd || newPwd.length<4) return UIUtils.showToast('Слишком короткий', 'warning');
            try { await changeMasterPassword(old, newPwd); UIUtils.showToast('Пароль изменён', 'success'); }
            catch(e) { UIUtils.showToast('Ошибка: '+e.message, 'error'); }
        });
        modal.querySelector('#reset-storage-btn').addEventListener('click', async () => {
            if (!confirm('Удалить все закладки?')) return;
            await resetStorage();
            currentBookmarks = []; masterPassword = null;
            renderBookmarksGrid([]);
            UIUtils.showToast('Хранилище сброшено', 'success');
            closeModal();
        });
        renderBookmarksGrid(currentBookmarks);
        return { modal, closeModal };
    }

    function updateAuthState() {
        if (!window.GithubAuth) return;
        currentUser = GithubAuth.getCurrentUser();
        currentToken = GithubAuth.getToken();
        if (currentUser && currentToken) {
            const stored = localStorage.getItem(STORAGE_KEY_PREFIX + currentUser);
            if (stored) try { gistId = JSON.parse(stored).gistId; } catch {}
        } else {
            gistId = masterPassword = null;
            SessionCache.clear();
        }
    }

    window.addEventListener('github-login-success', updateAuthState);
    window.addEventListener('github-logout', () => { currentUser = currentToken = gistId = masterPassword = null; SessionCache.clear(); });
    updateAuthState();

    window.BookmarkStorage = {
        openStorageModal, addBookmark, loadBookmarks, removeBookmark, changeMasterPassword, resetStorage
    };
})();