// js/features/storage.js — хранилище закладок с мастер-паролем, умным кешем DOM и исправлениями
(function() {
    const { CONFIG, cacheGet, cacheSet, createElement, formatDate, debounce, loadModule } = GithubCore;

    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium bookmarks storage';
    const STORAGE_KEY_PREFIX = 'bookmarks_';
    const LOCAL_STORAGE_KEY = 'neon_imperium_bookmarks_local';
    const SESSION_CACHE_KEY = 'bookmarks_session_cache';
    const RECOVERY_SALT = new TextEncoder().encode('neon-imperium-recovery-salt-v1');

    let currentUser, currentToken, gistId, masterPassword;
    let cachedBookmarks = null;
    let currentBookmarks = [];
    let sortOrder = 'new', category = 'all';
    let modalAddFormVisible = false;

    const Base64 = {
        encode: arrayBuffer => {
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
        },
        decode: b64 => {
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return bytes;
        }
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
            combined.set(iv);
            combined.set(new Uint8Array(enc), iv.length);
            return Base64.encode(combined.buffer);
        },
        async decrypt(b64, pwd) {
            try {
                const combined = Base64.decode(b64);
                const iv = combined.slice(0, 12);
                const data = combined.slice(12);
                const key = await this.deriveKey(pwd, RECOVERY_SALT);
                const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data.buffer);
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
        async delete(id, token) { try { await fetch(`https://api.github.com/gists/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }); } catch {} }
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
            } catch (e) { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks)); }
        } else {
            const payload = { version: 2, bookmarks, timestamp: Date.now() };
            const content = JSON.stringify(payload);
            try {
                if (gistId) await GistAPI.update(gistId, content, currentToken);
                else {
                    gistId = await GistAPI.create(content, currentToken);
                    localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
                }
            } catch (e) { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bookmarks)); }
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

    async function fetchDirectVideoUrl(url) {
        const promises = [
            fetchFromCobalt(url).catch(() => null),
            fetchFromCobaltTools(url).catch(() => null),
            fetchFrom9xbuddy(url).catch(() => null),
            fetchFromUniversalDownloader(url).catch(() => null)
        ];
        try { return await Promise.any(promises); } catch { return null; }
    }

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

    async function fetchFrom9xbuddy(url) {
        try {
            const formData = new FormData();
            formData.append('url', url);
            const r = await fetch('https://9xbuddy.com/process', { method: 'POST', body: formData });
            if (!r.ok) return null;
            const html = await r.text();
            const match = html.match(/href="(https?:\/\/[^"]+\.(?:mp4|webm|mkv)[^"]*)"/i);
            return match ? match[1] : null;
        } catch { return null; }
    }

    async function fetchFromUniversalDownloader(url) {
        try {
            let endpoint = 'https://universaldownloaderapi.vercel.app/api/youtube/download';
            if (url.includes('instagram.com')) endpoint = 'https://universaldownloaderapi.vercel.app/api/meta/download';
            if (url.includes('tiktok.com')) endpoint = 'https://universaldownloaderapi.vercel.app/api/tiktok/download';
            if (url.includes('twitter.com') || url.includes('x.com')) endpoint = 'https://universaldownloaderapi.vercel.app/api/twitter/download';
            if (url.includes('facebook.com')) endpoint = 'https://universaldownloaderapi.vercel.app/api/meta/download';

            const r = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`);
            if (!r.ok) return null;
            const d = await r.json();
            if (d.data?.medias?.[0]?.url) return d.data.medias[0].url;
            if (d.data?.videoUrl) return d.data.videoUrl;
            if (d.url) return d.url;
            if (d.data?.url) return d.data.url;
            return null;
        } catch { return null; }
    }

    let cardMap = new Map();
    let gridContainer = null;

    function createPlaceholder() {
        const div = createElement('div', 'bookmark-placeholder', {
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            background: 'var(--bg-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)', fontSize: '14px'
        });
        div.textContent = '🎬';
        return div;
    }

    function updateCardMedia(card, bookmark, visible) {
        const mediaContainer = card.querySelector('.bookmark-media');
        if (!mediaContainer) return;
        const isPost = bookmark.postType && bookmark.postData;
        const embedSrc = !isPost ? (bookmark.embedUrl || (UrlUtils.isEmbed(bookmark.url) ? bookmark.url : null)) : null;
        if (visible && embedSrc) {
            if (!mediaContainer.dataset.iframeLoaded) {
                mediaContainer.innerHTML = '';
                const iframe = createElement('iframe', '', {
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none'
                });
                iframe.src = embedSrc;
                iframe.setAttribute('allowfullscreen', 'true');
                iframe.loading = 'lazy';
                iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms allow-presentation';
                mediaContainer.appendChild(iframe);
                mediaContainer.dataset.iframeLoaded = '1';
            }
        } else {
            if (mediaContainer.dataset.iframeLoaded) {
                mediaContainer.innerHTML = '';
                mediaContainer.appendChild(createPlaceholder());
                mediaContainer.dataset.iframeLoaded = '';
            } else if (!mediaContainer.querySelector('.bookmark-placeholder')) {
                if (!isPost) {
                    mediaContainer.innerHTML = '';
                    mediaContainer.appendChild(createPlaceholder());
                }
            }
            if (isPost && bookmark.thumbnail) {
                if (!mediaContainer.querySelector('img')) {
                    mediaContainer.innerHTML = '';
                    const img = createElement('img', '', {
                        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                        objectFit: 'cover'
                    });
                    img.src = bookmark.thumbnail;
                    mediaContainer.appendChild(img);
                }
            }
        }
    }

    function createBookmarkCard(bookmark, onDelete, onEditSave) {
        const isPost = bookmark.postType && bookmark.postData;
        const isLink = !isPost && !bookmark.embedUrl;
        let cardWrapper;

        if (isLink) {
            cardWrapper = createElement('a', 'bookmark-card-link', {
                display: 'block', textDecoration: 'none', color: 'inherit', height: '100%'
            });
            cardWrapper.href = bookmark.url;
            cardWrapper.target = '_blank';
        } else {
            cardWrapper = createElement('div', `bookmark-card-link ${isPost ? 'clickable-post' : ''}`, {
                display: 'block', height: '100%', cursor: isPost ? 'pointer' : 'default'
            });
        }

        const card = createElement('div', 'bookmark-card tilt-card', {
            background: 'var(--bg-inner-gradient)', borderRadius: '20px', border: '1px solid var(--border)',
            overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%'
        });
        card.dataset.bookmarkId = bookmark.id;

        const mediaContainer = createElement('div', 'bookmark-media', {
            position: 'relative', paddingBottom: '56.25%', background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border)', userSelect: 'none', flexShrink: '0'
        });
        if (!isLink) mediaContainer.appendChild(createPlaceholder());
        else {
            const placeholder = createPlaceholder();
            placeholder.textContent = '🔗';
            mediaContainer.appendChild(placeholder);
        }

        const content = createElement('div', 'bookmark-content', { flex: '1', display: 'flex', flexDirection: 'column', padding: '12px' });
        const titleEl = createElement('h4', '', { margin: '0 0 6px', fontSize: '16px', color: 'var(--text-primary)' });
        titleEl.textContent = bookmark.title.length > 60 ? bookmark.title.slice(0,60)+'…' : bookmark.title;

        const meta = createElement('div', '', { display: 'flex', gap: '8px', marginBottom: '8px', fontSize: '11px', color: 'var(--text-secondary)' });
        meta.innerHTML = `<span><i class="fas fa-calendar-alt"></i> ${formatDate(bookmark.added)}</span>`;

        const actions = createElement('div', 'bookmark-actions', { display: 'flex', gap: '4px', marginTop: 'auto', justifyContent: 'flex-end' });
        if (bookmark.downloadUrl) {
            const btn = createElement('button', 'bookmark-action-btn');
            btn.innerHTML = '<i class="fas fa-download"></i>'; btn.title = 'Скачать';
            btn.onclick = e => { e.stopPropagation(); e.preventDefault(); window.open(bookmark.downloadUrl, '_blank'); };
            actions.appendChild(btn);
        }
        const editBtn = createElement('button', 'bookmark-action-btn');
        editBtn.innerHTML = '<i class="fas fa-pen"></i>';
        editBtn.onclick = e => {
            e.stopPropagation(); e.preventDefault();
            const newTitle = prompt('Новое название:', bookmark.title);
            if (newTitle && newTitle !== bookmark.title) {
                bookmark.title = newTitle;
                titleEl.textContent = newTitle.length > 60 ? newTitle.slice(0,60)+'…' : newTitle;
                onEditSave(bookmark);
            }
        };
        const delBtn = createElement('button', 'bookmark-action-btn');
        delBtn.innerHTML = '<i class="fas fa-trash-alt"></i>'; delBtn.style.color = '#f44336';
        delBtn.onclick = e => { e.stopPropagation(); e.preventDefault(); if (confirm('Удалить закладку?')) onDelete(bookmark.id); };
        actions.append(editBtn, delBtn);

        content.append(titleEl, meta, actions);
        card.append(mediaContainer, content);
        cardWrapper.appendChild(card);

        if (isPost && window.UIFeedback) {
            cardWrapper.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                const post = bookmark.postData;
                if (post) {
                    const item = {
                        id: post.id,
                        title: post.title,
                        body: post.body,
                        author: post.author,
                        date: new Date(post.date),
                        game: post.game,
                        labels: post.labels
                    };
                    UIFeedback.openFullModal(item);
                }
            });
        } else if (!isLink && !isPost) {
            cardWrapper.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                const mediaContainer = card.querySelector('.bookmark-media');
                if (!mediaContainer || mediaContainer.querySelector('iframe')) return;
                const embedSrc = bookmark.embedUrl;
                if (embedSrc) {
                    mediaContainer.innerHTML = '';
                    const iframe = createElement('iframe', '', {
                        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none'
                    });
                    iframe.src = embedSrc;
                    iframe.setAttribute('allowfullscreen', 'true');
                    iframe.loading = 'lazy';
                    iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms allow-presentation';
                    mediaContainer.appendChild(iframe);
                }
            });
        }

        return cardWrapper;
    }

    function applyFilterAndSort() {
        if (!gridContainer) return;
        const allIds = Array.from(cardMap.keys());
        const filtered = allIds.filter(id => {
            const bm = currentBookmarks.find(b => b.id === id);
            if (!bm) return false;
            if (category === 'video') return !!bm.embedUrl;
            if (category === 'post') return bm.postType && ['feedback','news','update','site-post'].includes(bm.postType);
            if (category === 'link') return !bm.embedUrl && !(bm.postType && ['feedback','news','update','site-post'].includes(bm.postType));
            return true;
        });
        const sorted = filtered.sort((a, b) => {
            const bmA = currentBookmarks.find(bm => bm.id === a);
            const bmB = currentBookmarks.find(bm => bm.id === b);
            if (!bmA || !bmB) return 0;
            if (sortOrder === 'new') return new Date(bmB.added) - new Date(bmA.added);
            return new Date(bmA.added) - new Date(bmB.added);
        });
        for (let i = 0; i < sorted.length; i++) {
            const card = cardMap.get(sorted[i]);
            if (card) gridContainer.appendChild(card);
        }
        cardMap.forEach((card, id) => {
            const visible = filtered.includes(id);
            card.style.display = visible ? '' : 'none';
            const bm = currentBookmarks.find(b => b.id === id);
            if (bm) updateCardMedia(card.querySelector('.bookmark-card'), bm, visible);
        });
        const empty = gridContainer.querySelector('.empty-placeholder');
        if (filtered.length === 0) {
            if (!empty) {
                const e = createElement('div', 'empty-state', {}, { class: 'empty-placeholder' });
                e.innerHTML = '<i class="fas fa-bookmark" style="font-size:48px;color:var(--accent);opacity:0.6;"></i><p>Нет закладок</p>';
                gridContainer.appendChild(e);
            } else empty.style.display = '';
        } else if (empty) empty.style.display = 'none';
    }

    function syncCardsFromBookmarks() {
        if (!gridContainer) return;
        const currentIds = new Set(currentBookmarks.map(b => b.id));
        for (const [id, card] of cardMap) {
            if (!currentIds.has(id)) {
                card.remove();
                cardMap.delete(id);
            }
        }
        currentBookmarks.forEach(bm => {
            if (!cardMap.has(bm.id)) {
                const card = createBookmarkCard(bm,
                    id => {
                        currentBookmarks = currentBookmarks.filter(b => b.id !== id);
                        cardMap.get(id)?.remove();
                        cardMap.delete(id);
                        applyFilterAndSort();
                        saveBookmarks(currentBookmarks, masterPassword).catch(()=>{});
                    },
                    updated => {
                        const idx = currentBookmarks.findIndex(b => b.id === updated.id);
                        if (idx >= 0) currentBookmarks[idx] = updated;
                        saveBookmarks(currentBookmarks, masterPassword).catch(()=>{});
                    }
                );
                cardMap.set(bm.id, card);
                gridContainer.appendChild(card);
            }
        });
        applyFilterAndSort();
    }

    async function addBookmark(bookmark) {
        if (!currentUser) {
            UIUtils.showToast('Войдите в аккаунт', 'error');
            throw new Error('not_logged_in');
        }
        let res = await loadBookmarks();
        if (res.needSetup) {
            const pwd = prompt('Создайте мастер-пароль для хранилища (мин. 4 символа) или оставьте пустым:');
            if (pwd && pwd.length >= 4) {
                masterPassword = pwd;
                currentBookmarks = [];
                await saveBookmarks([], pwd);
                res = { bookmarks: [] };
            } else if (pwd && pwd.length < 4) {
                UIUtils.showToast('Пароль слишком короткий', 'error');
                throw new Error('invalid_password');
            } else {
                currentBookmarks = [];
                await saveBookmarks([]);
                res = { bookmarks: [] };
            }
        } else if (res.passwordRequired) {
            if (masterPassword) {
                try { res = await loadBookmarks(masterPassword); }
                catch { masterPassword = null; }
            }
            if (!masterPassword || res.passwordRequired) {
                UIUtils.showToast('Требуется мастер-пароль. Откройте хранилище.', 'error');
                throw new Error('password_required');
            }
        }
        const bookmarks = res.bookmarks || [];
        let finalUrl = bookmark.url, embedUrl = null, downloadUrl = null, thumbnail = bookmark.thumbnail || null;
        let finalTitle = bookmark.title, postType = bookmark.postType || null, postData = bookmark.postData || null;

        if (bookmark.url && !bookmark.type && !postType) {
            if (UrlUtils.isSitePost(bookmark.url)) postType = 'site-post';
            else if (UrlUtils.isEmbed(bookmark.url)) embedUrl = finalUrl = bookmark.url;
            else {
                const guessed = UrlUtils.guessEmbed(bookmark.url);
                if (guessed) { embedUrl = finalUrl = guessed; }
                const [oembed, direct] = await Promise.all([
                    fetchOEmbedData(bookmark.url),
                    fetchDirectVideoUrl(bookmark.url)
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
            downloadUrl = await fetchDirectVideoUrl(finalUrl);
        }

        const newBookmark = {
            id: Date.now() + '-' + Math.random().toString(36),
            added: new Date().toISOString(),
            url: finalUrl, title: finalTitle || finalUrl,
            embedUrl, downloadUrl, thumbnail, postType, postData
        };

        if (bookmarks.some(b => b.url === finalUrl)) {
            UIUtils.showToast('Уже в избранном', 'info');
            throw new Error('duplicate');
        }
        const updated = [...bookmarks, newBookmark];
        currentBookmarks = updated;
        syncCardsFromBookmarks();
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
            syncCardsFromBookmarks();
            return;
        }
        const res = await loadBookmarks(masterPassword);
        const bookmarks = (res.bookmarks || []).filter(b => b.id !== bookmarkId);
        currentBookmarks = bookmarks;
        syncCardsFromBookmarks();
        if (masterPassword) await saveBookmarks(bookmarks, masterPassword);
        else await saveBookmarks(bookmarks);
    }

    async function openStorageModal() {
        if (!window.GithubAuth) return setTimeout(openStorageModal, 100);
        updateAuthState();
        if (!currentUser) return UIUtils.showToast('Войдите в аккаунт GitHub', 'error');
        if (!currentToken) return UIUtils.showToast('Токен не найден', 'error');
        if (!GithubAuth.hasScope('gist')) return UIUtils.showToast('Нужен scope "gist"', 'error');

        let needSetup = false, passwordRequired = false;
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
                return UIUtils.showToast('Ошибка: ' + e.message, 'error');
            }
        }

        if (passwordRequired && !masterPassword) {
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
                        <button class="storage-btn primary" id="toggle-add-btn"><i class="fas fa-plus"></i> Добавить</button>
                        <button class="storage-btn" id="change-password-btn"><i class="fas fa-key"></i></button>
                        <button class="storage-btn danger" id="reset-storage-btn"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </div>
                <div id="add-form" class="storage-add-form ${modalAddFormVisible?'visible':''}">
                    <input type="url" id="new-url" placeholder="Ссылка..." autocomplete="off">
                    <input type="text" id="new-title" placeholder="Название">
                    <button class="storage-btn primary" id="confirm-add"><i class="fas fa-plus"></i> Добавить</button>
                </div>
                <div class="bookmarks-grid" id="bookmarks-grid"></div>
            </div>
        `;
        const { modal, closeModal } = UIUtils.createModal('Хранилище', html, { size: 'full' });
        const style = createElement('style');
        style.textContent = `
            .storage-modal-container{display:flex;flex-direction:column;gap:20px}
            .storage-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px}
            .storage-controls{display:flex;gap:15px;flex-wrap:wrap}
            .storage-sort,.storage-categories{display:flex;background:var(--bg-primary);border-radius:40px;padding:4px;border:1px solid var(--border)}
            .sort-btn,.cat-btn{background:0;border:0;color:var(--text-secondary);padding:8px 16px;border-radius:40px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:0.2s;font-family:'Russo One',sans-serif}
            .sort-btn.active,.cat-btn.active{background:var(--accent);color:#fff}
            .storage-actions{display:flex;gap:8px;align-items:center}
            .storage-btn{background:var(--bg-primary);border:1px solid var(--border);color:var(--text-secondary);padding:8px 16px;border-radius:40px;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:0.2s;font-family:'Russo One',sans-serif}
            .storage-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
            .storage-btn:hover{transform:translateY(-2px);box-shadow:0 5px 15px rgba(0,0,0,0.2)}
            .bookmarks-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
            .bookmark-action-btn{background:var(--bg-primary);border:1px solid var(--border);color:var(--text-secondary);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:0.2s;font-size:12px}
            .bookmark-action-btn:hover{background:var(--accent);color:#fff;transform:scale(1.1)}
            .storage-add-form{display:none;grid-template-columns:1fr 1fr auto;gap:10px;background:var(--bg-inner-gradient);padding:16px;border-radius:20px;border:1px solid var(--border);opacity:0;transform:translateY(-10px);transition:0.3s;align-items:center}
            .storage-add-form.visible{display:grid;opacity:1;transform:translateY(0)}
            .storage-add-form input{padding:12px 16px;background:var(--bg-primary);border:1px solid var(--border);border-radius:40px;color:var(--text-primary);font-family:'Russo One',sans-serif}
            @media (max-width:700px){.storage-add-form{grid-template-columns:1fr}}
        `;
        modal.appendChild(style);
        gridContainer = modal.querySelector('#bookmarks-grid');
        cardMap = new Map();
        syncCardsFromBookmarks();

        modal.querySelectorAll('.sort-btn').forEach(b => b.addEventListener('click', () => {
            sortOrder = b.dataset.order;
            modal.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
            b.classList.add('active');
            applyFilterAndSort();
        }));
        modal.querySelectorAll('.cat-btn').forEach(b => b.addEventListener('click', () => {
            category = b.dataset.cat;
            modal.querySelectorAll('.cat-btn').forEach(btn => btn.classList.remove('active'));
            b.classList.add('active');
            applyFilterAndSort();
        }));

        const toggleAdd = modal.querySelector('#toggle-add-btn');
        const addForm = modal.querySelector('#add-form');
        toggleAdd.addEventListener('click', () => {
            modalAddFormVisible = !modalAddFormVisible;
            addForm.classList.toggle('visible', modalAddFormVisible);
            toggleAdd.innerHTML = modalAddFormVisible ? '<i class="fas fa-times"></i> Отмена' : '<i class="fas fa-plus"></i> Добавить';
            if (modalAddFormVisible) modal.querySelector('#new-url').focus();
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
                modalAddFormVisible = false; addForm.classList.remove('visible');
                toggleAdd.innerHTML = '<i class="fas fa-plus"></i> Добавить';
                modal.querySelector('#new-url').value = '';
                modal.querySelector('#new-title').value = '';
            } catch (e) {
                if (e.message !== 'duplicate') UIUtils.showToast('Ошибка: '+e.message, 'error');
            } finally { btn.disabled = false; }
        });

        modal.querySelector('#change-password-btn').addEventListener('click', async () => {
            const old = masterPassword || prompt('Текущий пароль:');
            if (!old) return;
            const newPwd = prompt('Новый пароль (мин. 4):');
            if (!newPwd || newPwd.length < 4) return UIUtils.showToast('Слишком короткий', 'warning');
            try { await changeMasterPassword(old, newPwd); UIUtils.showToast('Пароль изменён', 'success'); }
            catch(e) { UIUtils.showToast('Ошибка: '+e.message, 'error'); }
        });
        modal.querySelector('#reset-storage-btn').addEventListener('click', async () => {
            if (!confirm('Удалить все закладки?')) return;
            await resetStorage();
            currentBookmarks = []; masterPassword = null;
            syncCardsFromBookmarks();
            UIUtils.showToast('Хранилище сброшено', 'success');
            closeModal();
        });
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