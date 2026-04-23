// js/features/storage.js — хранилище с ленивой загрузкой и исправленной обработкой пароля
(function() {
    const {
        CONFIG, cacheGet, cacheSet, createElement, formatDate, debounce
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

    // ========== Утилиты Base64 и Crypto ==========
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

    // ========== Gist API ==========
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

    // ========== Кэш сессии ==========
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

    // ========== Загрузка/сохранение ==========
    async function loadBookmarks(password = null) {
        if (!currentToken) {
            try { return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]'); } catch { return []; }
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
            if (payload.bookmarks) return { bookmarks: payload.bookmarks, legacy: true };
            return { bookmarks: [], needSetup: true };
        } catch (e) {
            if (e.message.includes('403')) throw new Error('TOKEN_NO_GIST_SCOPE');
            if (e.message === 'Invalid password') throw e;
            try { return { bookmarks: JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]') }; } catch { return { bookmarks: [] }; }
        }
    }

    async function saveBookmarks(bookmarks, password = masterPassword) {
        if (!currentToken) { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks)); return; }
        if (!password) throw new Error('Master password required');
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

    // ========== URL утилиты ==========
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

    // ========== OEmbed и прямые ссылки ==========
    const OEMBED_PROVIDERS = [
        url => `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
        url => `https://iframe.ly/api/oembed?url=${encodeURIComponent(url)}`,
        url => `https://api.embed.ly/1/oembed?url=${encodeURIComponent(url)}`,
        url => `https://api.microlink.io/?url=${encodeURIComponent(url)}`,
        url => `https://jsonlink.io/api/extract?url=${encodeURIComponent(url)}`,
        url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
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

    const VIDEO_SERVICES = [
        {
            name: 'Cobalt',
            fetch: async url => {
                const r = await fetch('https://co.wuk.sh/api/json', {
                    method: 'POST',
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, aFormat: 'best', vCodec: 'h264' })
                });
                if (!r.ok) return null;
                const d = await r.json();
                return d.status === 'success' ? d.url : null;
            }
        },
        {
            name: 'YtDlpAPI',
            fetch: async url => {
                const r = await fetch(`https://yt-dlp-api.vercel.app/api/extract?url=${encodeURIComponent(url)}`);
                if (!r.ok) return null;
                const d = await r.json();
                return d.formats?.find(f => f.vcodec !== 'none' && f.acodec !== 'none')?.url || d.url;
            }
        }
    ];

    async function fetchDirectVideoUrl(url) {
        const promises = VIDEO_SERVICES.map(s => s.fetch(url).catch(() => null));
        try { return await Promise.any(promises); } catch { return null; }
    }

    // ========== Добавление/удаление ==========
    async function addBookmark(bookmark) {
        if (!currentUser) { UIUtils.showToast('Войдите в аккаунт', 'error'); return; }
        if (!masterPassword) {
            await openStorageModal();
            if (!masterPassword) return;
        }
        if (!bookmark?.url) { UIUtils.showToast('Некорректная ссылка', 'error'); return; }

        let finalUrl = bookmark.url, embedUrl = null, downloadUrl = null, thumbnail = null;
        let finalTitle = bookmark.title, postType = bookmark.postType || null;

        if (bookmark.url) {
            if (UrlUtils.isSitePost(bookmark.url)) postType = 'site-post';
            else if (UrlUtils.isEmbed(bookmark.url)) embedUrl = finalUrl = bookmark.url;
            else {
                const guessed = UrlUtils.guessEmbed(bookmark.url);
                if (guessed) { embedUrl = finalUrl = guessed; }
                const [oembed, direct] = await Promise.all([fetchOEmbedData(bookmark.url), fetchDirectVideoUrl(bookmark.url)]);
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
        }

        const res = await loadBookmarks(masterPassword);
        if (res.passwordRequired) throw new Error('Password required');
        const bookmarks = res.bookmarks || [];
        if (bookmarks.some(b => b.url === finalUrl)) {
            UIUtils.showToast('Уже в избранном', 'info');
            throw new Error('duplicate');
        }

        const newBookmark = {
            id: Date.now() + '-' + Math.random().toString(36),
            added: new Date().toISOString(),
            url: finalUrl, title: finalTitle || finalUrl,
            embedUrl, downloadUrl, thumbnail, postType
        };

        const optimistic = [...bookmarks, newBookmark];
        SessionCache.save(optimistic, masterPassword);
        if (currentGrid) renderBookmarksGrid(optimistic);
        saveBookmarks(optimistic, masterPassword).catch(e => UIUtils.showToast('Ошибка синхронизации', 'error'));
        return newBookmark;
    }

    async function removeBookmark(bookmarkId) {
        if (!currentUser) { UIUtils.showToast('Войдите в аккаунт', 'error'); return; }
        if (!masterPassword) {
            // Открываем хранилище для ввода пароля
            await openStorageModal();
            if (!masterPassword) return; // пользователь не ввёл пароль
        }
        const res = await loadBookmarks(masterPassword);
        const filtered = (res.bookmarks || []).filter(b => b.id !== bookmarkId);
        SessionCache.save(filtered, masterPassword);
        if (currentGrid) renderBookmarksGrid(filtered);
        saveBookmarks(filtered, masterPassword).catch(e => UIUtils.showToast('Ошибка синхронизации', 'error'));
    }

    // ========== UI компоненты ==========
    function openVideoFullscreen(iframe, title) {
        const overlay = createElement('div', '', {
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.95)', zIndex: 100000, display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            animation: 'fadeIn 0.2s'
        });
        const close = createElement('button', '', {
            position: 'absolute', top: '20px', right: '20px', background: 'rgba(0,0,0,0.7)',
            color: '#fff', border: 'none', borderRadius: '50%', width: '40px', height: '40px',
            fontSize: '20px', cursor: 'pointer', transition: 'transform 0.2s'
        });
        close.innerHTML = '<i class="fas fa-times"></i>';
        close.onmouseover = () => close.style.transform = 'scale(1.1)';
        close.onmouseleave = () => close.style.transform = 'scale(1)';
        close.onclick = () => { overlay.style.animation = 'fadeOut 0.2s forwards'; setTimeout(() => overlay.remove(), 200); };
        const titleDiv = createElement('div', '', {
            position: 'absolute', top: '20px', left: '20px', color: '#fff', fontSize: '18px',
            background: 'rgba(0,0,0,0.5)', padding: '8px 16px', borderRadius: '30px'
        });
        titleDiv.textContent = title;
        iframe.style.cssText = 'width:90%;height:85%;border-radius:12px;border:none;';
        overlay.append(iframe, close, titleDiv);
        document.body.appendChild(overlay);
        overlay.onclick = e => e.target === overlay && close.click();
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
            const overlay = createElement('div', '', {
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', cursor: 'pointer', zIndex: 2
            });
            overlay.onclick = e => { e.stopPropagation(); openVideoFullscreen(iframe, bookmark.title); };
            mediaContainer.append(iframe, overlay);
        } else {
            const img = createElement('img', '', {
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover'
            });
            img.src = bookmark.thumbnail || 'images/default-news.webp';
            img.alt = bookmark.title;
            img.onerror = () => img.src = 'images/default-news.webp';
            mediaContainer.appendChild(img);
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
                id => removeBookmark(id),
                updated => { const idx = currentBookmarks.findIndex(bk => bk.id === updated.id); if (idx>=0) currentBookmarks[idx] = updated; saveBookmarks(currentBookmarks); renderBookmarksGrid(currentBookmarks); }
            );
            currentGrid.appendChild(card);
        });
    }

    // ========== Модальное окно ==========
    async function openStorageModal() {
        if (!window.GithubAuth) return setTimeout(openStorageModal, 100);
        updateAuthState();
        if (!currentUser) return UIUtils.showToast('Войдите в аккаунт GitHub', 'error');
        if (!currentToken) return UIUtils.showToast('Токен не найден', 'error');
        if (!GithubAuth.hasScope('gist')) return UIUtils.showToast('Нужен scope "gist"', 'error');

        let needSetup = false, passwordRequired = false;
        try {
            const res = await loadBookmarks();
            if (res.passwordRequired) passwordRequired = true;
            else if (res.needSetup) needSetup = true;
            else currentBookmarks = res.bookmarks || [];
        } catch (e) {
            if (e.message === 'TOKEN_NO_GIST_SCOPE') return UIUtils.showToast('Нет доступа к Gist', 'error');
            return UIUtils.showToast('Ошибка: ' + e.message, 'error');
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
            .storage-sort{display:flex;background:var(--bg-primary);border-radius:40px;padding:4px;border:1px solid var(--border)}
            .sort-btn{background:0;border:0;color:var(--text-secondary);padding:8px 16px;border-radius:40px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:0.2s}
            .sort-btn.active{background:var(--accent);color:#fff}
            .storage-categories{display:flex;gap:6px;flex-wrap:wrap}
            .cat-btn{background:var(--bg-primary);border:1px solid var(--border);color:var(--text-secondary);padding:8px 14px;border-radius:40px;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:4px;transition:0.2s}
            .cat-btn.active{background:var(--accent);color:#fff;border-color:var(--accent)}
            .storage-actions{display:flex;gap:8px}
            .storage-btn{background:var(--bg-primary);border:1px solid var(--border);color:var(--text-secondary);padding:8px 16px;border-radius:40px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:0.2s}
            .storage-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
            .storage-btn.danger{color:#f44336}
            .storage-btn:hover{transform:translateY(-2px);box-shadow:0 5px 15px rgba(0,0,0,0.2)}
            .storage-add-form{display:none;grid-template-columns:1fr 1fr auto;gap:10px;background:var(--bg-inner-gradient);padding:16px;border-radius:20px;border:1px solid var(--border);opacity:0;transform:translateY(-10px);transition:0.3s;align-items:center}
            .storage-add-form.visible{display:grid;opacity:1;transform:translateY(0)}
            .storage-add-form input{padding:12px 16px;background:var(--bg-primary);border:1px solid var(--border);border-radius:40px;color:var(--text-primary)}
            .bookmarks-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
            .bookmark-action-btn{background:var(--bg-primary);border:1px solid var(--border);color:var(--text-secondary);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:0.2s;font-size:12px}
            .bookmark-action-btn:hover{background:var(--accent);color:#fff;transform:scale(1.1)}
            @media (max-width:700px){.storage-header{flex-direction:column;align-items:stretch}.storage-add-form{grid-template-columns:1fr}.bookmarks-grid{grid-template-columns:1fr}}
        `;
        modal.appendChild(style);
        currentGrid = modal.querySelector('#bookmarks-grid');
        modal.querySelectorAll('.sort-btn').forEach(b => b.addEventListener('click', () => { sortOrder = b.dataset.order; renderBookmarksGrid(currentBookmarks); }));
        modal.querySelectorAll('.cat-btn').forEach(b => b.addEventListener('click', () => { category = b.dataset.cat; renderBookmarksGrid(currentBookmarks); }));
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
            const tempId = 'temp-'+Date.now();
            const optimistic = { id: tempId, url, title, added: new Date().toISOString() };
            currentBookmarks.unshift(optimistic);
            renderBookmarksGrid(currentBookmarks);
            try {
                const final = await addBookmark({ url, title });
                const idx = currentBookmarks.findIndex(b => b.id === tempId);
                if (idx >= 0) currentBookmarks[idx] = final;
                renderBookmarksGrid(currentBookmarks);
                UIUtils.showToast('Добавлено', 'success');
                addFormVisible = false; addForm.classList.remove('visible');
                toggleAdd.innerHTML = '<i class="fas fa-plus"></i> Добавить';
            } catch (e) {
                if (e.message !== 'duplicate') UIUtils.showToast('Ошибка: '+e.message, 'error');
                currentBookmarks = currentBookmarks.filter(b => b.id !== tempId);
                renderBookmarksGrid(currentBookmarks);
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