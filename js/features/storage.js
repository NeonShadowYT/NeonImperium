// js/features/storage.js — надёжное хранилище закладок с оптимистичным UI, дебаунсом, виртуализацией
(function() {
    const { CONFIG, escapeHtml, createElement, formatDate, debounce, cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix, loadModule } = GithubCore;
    const GIST_FILENAME = 'neon-imperium-bookmarks.json';
    const GIST_DESCRIPTION = 'Neon Imperium bookmarks storage';
    const STORAGE_KEY_PREFIX = 'bookmarks_';
    const LOCAL_STORAGE_KEY = 'neon_imperium_bookmarks_local';
    const SESSION_CACHE_KEY = 'bookmarks_session_cache';
    const RECOVERY_SALT = new TextEncoder().encode('neon-imperium-recovery-salt-v1');
    const MAX_PASSWORD_ATTEMPTS = 3;
    const LOCKOUT_DURATION = 60000; // 1 минута

    // Состояние модуля
    let currentUser = null;
    let currentToken = null;
    let gistId = null;
    let masterPassword = null;           // хранится в замыкании только в течение сессии
    let currentBookmarks = [];
    let sortOrder = 'new';
    let category = 'all';
    let modalAddFormVisible = false;

    // Интерфейс синхронизации
    let debouncedSaveBookmarks = null;
    let lastServerTimestamp = null;      // время последней успешной синхронизации с Gist
    let lastSyncETag = null;

    // Блокировка мастер‑пароля
    let passwordAttempts = 0;
    let lockoutUntil = 0;

    // Виртуализация карточек
    let observer = null;
    let gridContainer = null;

    // ---------- Вспомогательные утилиты ----------
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

    // ---------- Gist API с использование GithubAPI.fetch ----------
    async function gistFetch(gistId, token) {
        const url = `https://api.github.com/gists/${gistId}`;
        const resp = await GithubAPI.fetch(url);
        if (resp.status === 404) return null;
        if (!resp.ok) throw new Error(`Gist fetch error: ${resp.status}`);
        return resp.json();
    }

    async function gistUpdate(gistId, content, token) {
        const url = `https://api.github.com/gists/${gistId}`;
        const resp = await GithubAPI.fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } })
        });
        if (!resp.ok) throw new Error(`Gist update error: ${resp.status}`);
        return resp.json();
    }

    async function gistCreate(content, token) {
        const url = 'https://api.github.com/gists';
        const resp = await GithubAPI.fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files: { [GIST_FILENAME]: { content } } })
        });
        if (!resp.ok) throw new Error(`Gist create error: ${resp.status}`);
        const gist = await resp.json();
        return gist.id;
    }

    async function gistDelete(gistId, token) {
        const url = `https://api.github.com/gists/${gistId}`;
        await GithubAPI.fetch(url, { method: 'DELETE' }).catch(() => {});
    }

    // ---------- Локальное / удалённое сохранение (с дебаунсом) ----------
    function triggerDebouncedSave() {
        if (!debouncedSaveBookmarks) {
            debouncedSaveBookmarks = debounce(doSaveBookmarks, 2000);
        }
        debouncedSaveBookmarks();
    }

    async function doSaveBookmarks() {
        try {
            if (currentToken) {
                if (masterPassword) {
                    const encrypted = await Crypto.encrypt(currentBookmarks, masterPassword);
                    const payload = { version: 2, user: currentUser, encryptedBookmarks: encrypted, timestamp: Date.now() };
                    const content = JSON.stringify(payload);
                    if (gistId) {
                        await gistUpdate(gistId, content, currentToken);
                    } else {
                        gistId = await gistCreate(content, currentToken);
                        localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
                    }
                    lastServerTimestamp = Date.now();
                } else {
                    const payload = { version: 2, bookmarks: currentBookmarks, timestamp: Date.now() };
                    const content = JSON.stringify(payload);
                    if (gistId) {
                        await gistUpdate(gistId, content, currentToken);
                    } else {
                        gistId = await gistCreate(content, currentToken);
                        localStorage.setItem(STORAGE_KEY_PREFIX + currentUser, JSON.stringify({ gistId }));
                    }
                    lastServerTimestamp = Date.now();
                }
            }
            // Всегда сохраняем локальную копию
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(currentBookmarks));
        } catch (err) {
            console.error('Ошибка синхронизации закладок:', err);
        }
    }

    // ---------- Загрузка закладок ----------
    async function loadBookmarks(password = null) {
        // Если нет токена – только локально
        if (!currentToken) {
            try {
                return { bookmarks: JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]') };
            } catch {
                return { bookmarks: [] };
            }
        }

        // Если пароль не передан, но данные зашифрованы – потребуется пароль
        try {
            if (!gistId) {
                const stored = localStorage.getItem(STORAGE_KEY_PREFIX + currentUser);
                if (stored) gistId = JSON.parse(stored).gistId;
            }
            if (!gistId) return { bookmarks: [], needSetup: true };

            const gist = await gistFetch(gistId, currentToken);
            if (!gist) return { bookmarks: [], needSetup: true };
            const file = gist.files?.[GIST_FILENAME];
            if (!file) return { bookmarks: [], needSetup: true };

            let payload;
            try {
                payload = JSON.parse(file.content);
            } catch {
                payload = { encryptedBookmarks: file.content };
            }

            if (payload.encryptedBookmarks) {
                if (!password) {
                    // Проверка попыток и блокировки
                    if (isLockedOut()) {
                        return { passwordLocked: true, remaining: getLockoutRemaining() };
                    }
                    return { passwordRequired: true, user: payload.user };
                }
                validatePasswordAttempt();
                const bookmarks = await Crypto.decrypt(payload.encryptedBookmarks, password);
                if (!bookmarks) {
                    recordFailedAttempt();
                    throw new Error('Invalid password');
                }
                resetPasswordAttempts();
                // Сохраняем timestamp сервера
                lastServerTimestamp = payload.timestamp || 0;
                return { bookmarks };
            }

            if (payload.bookmarks) {
                lastServerTimestamp = payload.timestamp || 0;
                return { bookmarks: payload.bookmarks };
            }
            return { bookmarks: [] };
        } catch (e) {
            if (e.message === 'Invalid password') throw e;
            try {
                return { bookmarks: JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]') };
            } catch {
                return { bookmarks: [] };
            }
        }
    }

    // ---------- Логика блокировки пароля ----------
    function isLockedOut() {
        if (lockoutUntil > Date.now()) return true;
        return false;
    }

    function getLockoutRemaining() {
        return Math.max(0, lockoutUntil - Date.now());
    }

    function validatePasswordAttempt() {
        if (isLockedOut()) {
            const sec = Math.ceil(getLockoutRemaining() / 1000);
            UIUtils.showToast(`Слишком много попыток. Попробуйте через ${sec} сек.`, 'error');
            throw new Error('locked');
        }
    }

    function recordFailedAttempt() {
        passwordAttempts++;
        sessionStorage.setItem('bookmark_pwd_attempts', passwordAttempts);
        if (passwordAttempts >= MAX_PASSWORD_ATTEMPTS) {
            lockoutUntil = Date.now() + LOCKOUT_DURATION;
            sessionStorage.setItem('bookmark_pwd_lockout', lockoutUntil);
            UIUtils.showToast('Превышено число попыток. Повторите через 1 минуту.', 'error');
        }
    }

    function resetPasswordAttempts() {
        passwordAttempts = 0;
        sessionStorage.removeItem('bookmark_pwd_attempts');
        lockoutUntil = 0;
        sessionStorage.removeItem('bookmark_pwd_lockout');
    }

    function restorePasswordState() {
        const attempts = sessionStorage.getItem('bookmark_pwd_attempts');
        if (attempts) passwordAttempts = parseInt(attempts, 10);
        const lock = sessionStorage.getItem('bookmark_pwd_lockout');
        if (lock) lockoutUntil = parseInt(lock, 10);
    }

    // ---------- Обновление UI после изменения (оптимистичное) ----------
    function syncUIFromBookmarks() {
        if (!gridContainer) return;
        // Удаляем карточки, которых больше нет
        const currentIds = new Set(currentBookmarks.map(b => b.id));
        const cards = gridContainer.querySelectorAll('.bookmark-card-wrapper');
        cards.forEach(card => {
            const id = card.dataset.id;
            if (!currentIds.has(id)) card.remove();
        });

        // Добавляем новые карточки
        currentBookmarks.forEach((bm, index) => {
            let card = gridContainer.querySelector(`.bookmark-card-wrapper[data-id="${bm.id}"]`);
            if (!card) {
                card = createBookmarkCard(bm);
                gridContainer.appendChild(card);
            } else {
                // Обновляем содержимое (на случай изменений)
                updateBookmarkCard(card, bm);
            }
        });

        // Виртуализация – наблюдение за видимыми карточками
        if (observer) observer.disconnect();
        if (currentBookmarks.length > 50) {
            observer = new IntersectionObserver(handleIntersection, { rootMargin: '200px' });
            gridContainer.querySelectorAll('.bookmark-card-wrapper').forEach(card => observer.observe(card));
        } else {
            // Если меньше 50, сразу загружаем все медиа
            gridContainer.querySelectorAll('.bookmark-card-wrapper').forEach(card => {
                const bm = currentBookmarks.find(b => b.id === card.dataset.id);
                if (bm) showCardMedia(card, bm);
            });
        }
    }

    function handleIntersection(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const card = entry.target;
                const bm = currentBookmarks.find(b => b.id === card.dataset.id);
                if (bm) showCardMedia(card, bm);
                observer.unobserve(card);
            }
        });
    }

    function showCardMedia(card, bookmark) {
        if (card.dataset.mediaLoaded === 'true') return;
        const mediaContainer = card.querySelector('.bookmark-media');
        if (!mediaContainer) return;
        if (bookmark.embedUrl) {
            // Показать превью/кнопку, а не сразу iframe
            if (!mediaContainer.querySelector('.bookmark-preview')) {
                mediaContainer.innerHTML = `
                    <div class="bookmark-preview" style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-primary);cursor:pointer;">
                        ${bookmark.thumbnail ? `<img src="${escapeHtml(bookmark.thumbnail)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">` : ''}
                        <div class="play-button" style="position:absolute;background:rgba(0,0,0,0.7);border-radius:50%;width:50px;height:50px;display:flex;align-items:center;justify-content:center;color:white;font-size:24px;">▶</div>
                    </div>
                `;
                mediaContainer.querySelector('.bookmark-preview').addEventListener('click', () => {
                    mediaContainer.innerHTML = '';
                    const iframe = createElement('iframe', '', {
                        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none'
                    });
                    iframe.src = bookmark.embedUrl;
                    iframe.setAttribute('allowfullscreen', 'true');
                    iframe.loading = 'lazy';
                    iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms allow-presentation';
                    mediaContainer.appendChild(iframe);
                    card.dataset.mediaLoaded = 'true';
                });
            }
        } else if (bookmark.thumbnail) {
            mediaContainer.innerHTML = `<img src="${escapeHtml(bookmark.thumbnail)}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;">`;
            card.dataset.mediaLoaded = 'true';
        } else {
            mediaContainer.innerHTML = '';
            card.dataset.mediaLoaded = 'true';
        }
    }

    function createBookmarkCard(bookmark) {
        const cardWrapper = createElement('div', 'bookmark-card-wrapper', { position: 'relative', height: '100%' });
        cardWrapper.dataset.id = bookmark.id;

        const card = createElement('div', 'bookmark-card tilt-card', {
            background: 'var(--bg-inner-gradient)', borderRadius: '20px', border: '1px solid var(--border)',
            overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%'
        });

        const mediaContainer = createElement('div', 'bookmark-media', {
            position: 'relative', paddingBottom: '56.25%', background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border)', flexShrink: '0'
        });
        // Пустой, заполнится позже виртуализацией
        card.appendChild(mediaContainer);

        const content = createElement('div', 'bookmark-content', {
            flex: '1', display: 'flex', flexDirection: 'column', padding: '12px'
        });

        const titleEl = createElement('h4', '', { margin: '0 0 6px', fontSize: '16px', color: 'var(--text-primary)' });
        titleEl.textContent = bookmark.title.length > 60 ? bookmark.title.slice(0,60)+'…' : bookmark.title;
        content.appendChild(titleEl);

        const meta = createElement('div', '', { display: 'flex', gap: '8px', marginBottom: '8px', fontSize: '11px', color: 'var(--text-secondary)' });
        meta.innerHTML = `<span><i class="fas fa-calendar-alt"></i> ${formatDate(bookmark.added)}</span>`;
        content.appendChild(meta);

        const actions = createElement('div', 'bookmark-actions', {
            display: 'flex', gap: '4px', marginTop: 'auto', justifyContent: 'flex-end'
        });

        if (bookmark.downloadUrl) {
            const btn = createActionBtn('download', () => window.open(bookmark.downloadUrl, '_blank'));
            actions.appendChild(btn);
        }
        const editBtn = createActionBtn('edit', () => {
            const newTitle = prompt('Новое название:', bookmark.title);
            if (newTitle && newTitle !== bookmark.title) {
                bookmark.title = newTitle;
                titleEl.textContent = newTitle.length > 60 ? newTitle.slice(0,60)+'…' : newTitle;
                optimisticallyUpdate(bookmark);
            }
        });
        const delBtn = createActionBtn('delete', () => {
            if (confirm('Удалить закладку?')) optimisticallyRemove(bookmark.id);
        });
        actions.append(editBtn, delBtn);
        content.appendChild(actions);
        card.appendChild(content);
        cardWrapper.appendChild(card);
        return cardWrapper;
    }

    function createActionBtn(type, onClick) {
        const btn = createElement('button', 'bookmark-action-btn', {
            background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
            width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', transition: '0.2s', fontSize: '12px'
        });
        if (type === 'delete') btn.style.color = '#f44336';
        btn.innerHTML = type === 'edit' ? '<i class="fas fa-pen"></i>' : (type === 'delete' ? '<i class="fas fa-trash-alt"></i>' : '<i class="fas fa-download"></i>');
        btn.addEventListener('click', e => { e.stopPropagation(); onClick(); });
        return btn;
    }

    function updateBookmarkCard(card, bookmark) {
        const titleEl = card.querySelector('h4');
        if (titleEl) titleEl.textContent = bookmark.title.length > 60 ? bookmark.title.slice(0,60)+'…' : bookmark.title;
        // обновим дату и т.д., если нужно
    }

    // ---------- Оптимистичное обновление ----------
    function optimisticallyUpdate(bookmark) {
        const index = currentBookmarks.findIndex(b => b.id === bookmark.id);
        if (index >= 0) currentBookmarks[index] = bookmark;
        syncUIFromBookmarks();
        triggerDebouncedSave();
    }

    async function optimisticallyRemove(id) {
        const index = currentBookmarks.findIndex(b => b.id === id);
        if (index === -1) return;
        const removed = currentBookmarks.splice(index, 1)[0];
        syncUIFromBookmarks();
        triggerDebouncedSave();
        // нет отката при ошибке (можно добавить)
    }

    // ---------- Публичные методы ----------
    async function addBookmark(bookmarkData) {
        if (!currentUser) {
            UIUtils.showToast('Войдите в аккаунт', 'error');
            throw new Error('not_logged_in');
        }
        // Проверка, нужен ли пароль
        let res = await loadBookmarks();
        if (res.needSetup) {
            const pwd = prompt('Создайте мастер-пароль (мин. 4 символа):');
            if (pwd && pwd.length >= 4) {
                masterPassword = pwd;
                currentBookmarks = [];
                await doSaveBookmarks(); // принудительно сохранить
                res = { bookmarks: [] };
            } else {
                UIUtils.showToast('Пароль слишком короткий', 'error');
                throw new Error('invalid_password');
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
        } else if (res.passwordLocked) {
            UIUtils.showToast('Хранилище временно заблокировано', 'error');
            throw new Error('locked');
        }

        const existing = res.bookmarks || [];
        // Проверка дубликатов
        if (existing.some(b => b.url === bookmarkData.url)) {
            UIUtils.showToast('Уже в избранном', 'info');
            throw new Error('duplicate');
        }

        const newBookmark = {
            id: Date.now() + '-' + Math.random().toString(36),
            added: new Date().toISOString(),
            url: bookmarkData.url,
            title: bookmarkData.title || bookmarkData.url,
            embedUrl: bookmarkData.embedUrl || null,
            downloadUrl: bookmarkData.downloadUrl || null,
            thumbnail: bookmarkData.thumbnail || null,
            postType: bookmarkData.postType || null,
            postData: bookmarkData.postData || null
        };

        currentBookmarks = [newBookmark, ...existing];
        syncUIFromBookmarks();
        triggerDebouncedSave();
        return newBookmark;
    }

    async function removeBookmark(id) {
        if (!masterPassword && !currentToken) {
            const local = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
            currentBookmarks = local.filter(b => b.id !== id);
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(currentBookmarks));
            syncUIFromBookmarks();
            return;
        }
        const res = await loadBookmarks(masterPassword);
        if (res.passwordRequired || res.passwordLocked) return;
        currentBookmarks = (res.bookmarks || []).filter(b => b.id !== id);
        syncUIFromBookmarks();
        triggerDebouncedSave();
    }

    async function openStorageModal() {
        updateAuthState();
        if (!currentUser) return UIUtils.showToast('Войдите в аккаунт GitHub', 'error');
        if (!currentToken) return UIUtils.showToast('Токен не найден', 'error');
        if (!GithubAuth.hasScope('gist')) return UIUtils.showToast('Нужен scope "gist"', 'error');

        restorePasswordState();

        let needSetup = false, passwordRequired = false;
        try {
            const res = await loadBookmarks(masterPassword);
            if (res.passwordLocked) {
                UIUtils.showToast('Хранилище временно заблокировано', 'error');
                return;
            }
            if (res.passwordRequired) {
                passwordRequired = true;
            } else if (res.needSetup) {
                needSetup = true;
            } else {
                currentBookmarks = res.bookmarks || [];
            }
        } catch (e) {
            if (e.message === 'locked') return;
        }

        // Если нужен пароль, запрашиваем (до 3 попыток)
        while (passwordRequired && !masterPassword) {
            const pwd = prompt('Введите мастер-пароль:');
            if (!pwd) return UIUtils.showToast('Отменено', 'info');
            try {
                const res = await loadBookmarks(pwd);
                if (res.passwordLocked) {
                    UIUtils.showToast('Хранилище временно заблокировано', 'error');
                    return;
                }
                if (res.passwordRequired) {
                    UIUtils.showToast('Неверный пароль', 'error');
                    // увеличит счётчик внутри loadBookmarks
                    continue;
                }
                currentBookmarks = res.bookmarks || [];
                masterPassword = pwd;
                passwordRequired = false;
            } catch (err) {
                UIUtils.showToast('Ошибка', 'error');
                return;
            }
        }

        if (needSetup) {
            const pwd = prompt('Создайте мастер-пароль (мин. 4 символа):');
            if (!pwd || pwd.length < 4) return UIUtils.showToast('Пароль короткий', 'error');
            masterPassword = pwd;
            currentBookmarks = [];
            await doSaveBookmarks();
            UIUtils.showToast('Хранилище создано!', 'success');
        }

        // Строим модальное окно
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

        // Стили для модального окна (можно вынести, но для целостности оставим)
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
            .bookmark-action-btn:hover{background:var(--accent);color:#fff;transform:scale(1.1)}
            .storage-add-form{display:none;grid-template-columns:1fr 1fr auto;gap:10px;background:var(--bg-inner-gradient);padding:16px;border-radius:20px;border:1px solid var(--border);opacity:0;transform:translateY(-10px);transition:0.3s;align-items:center}
            .storage-add-form.visible{display:grid;opacity:1;transform:translateY(0)}
            .storage-add-form input{padding:12px 16px;background:var(--bg-primary);border:1px solid var(--border);border-radius:40px;color:var(--text-primary);font-family:'Russo One',sans-serif}
            @media (max-width:700px){.storage-add-form{grid-template-columns:1fr}}
        `;
        modal.appendChild(style);
        gridContainer = modal.querySelector('#bookmarks-grid');
        syncUIFromBookmarks();

        // Назначаем обработчики
        modal.querySelectorAll('.sort-btn').forEach(b => {
            b.addEventListener('click', () => {
                sortOrder = b.dataset.order;
                modal.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
                b.classList.add('active');
                applyFilterAndSort();
            });
        });
        modal.querySelectorAll('.cat-btn').forEach(b => {
            b.addEventListener('click', () => {
                category = b.dataset.cat;
                modal.querySelectorAll('.cat-btn').forEach(btn => btn.classList.remove('active'));
                b.classList.add('active');
                applyFilterAndSort();
            });
        });

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
            try {
                await addBookmark({ url, title });
                UIUtils.showToast('Добавлено', 'success');
                modalAddFormVisible = false;
                addForm.classList.remove('visible');
                toggleAdd.innerHTML = '<i class="fas fa-plus"></i> Добавить';
                modal.querySelector('#new-url').value = '';
                modal.querySelector('#new-title').value = '';
            } catch (e) {
                if (e.message !== 'duplicate') UIUtils.showToast('Ошибка', 'error');
            }
        });

        modal.querySelector('#change-password-btn').addEventListener('click', async () => {
            const old = masterPassword || prompt('Текущий пароль:');
            if (!old) return;
            const newPwd = prompt('Новый пароль (мин. 4):');
            if (!newPwd || newPwd.length < 4) return UIUtils.showToast('Слишком короткий', 'warning');
            try {
                await changeMasterPassword(old, newPwd);
                UIUtils.showToast('Пароль изменён', 'success');
            } catch (e) {
                UIUtils.showToast('Ошибка: '+e.message, 'error');
            }
        });
        modal.querySelector('#reset-storage-btn').addEventListener('click', async () => {
            if (!confirm('Удалить все закладки безвозвратно?')) return;
            await resetStorage();
            currentBookmarks = [];
            masterPassword = null;
            syncUIFromBookmarks();
            UIUtils.showToast('Хранилище сброшено', 'success');
            closeModal();
        });

        return { modal, closeModal };
    }

    function applyFilterAndSort() {
        // Перерисовываем с учетом фильтра и сортировки
        // Просто обновим display у карточек
        const cards = gridContainer.querySelectorAll('.bookmark-card-wrapper');
        cards.forEach(card => {
            const id = card.dataset.id;
            const bm = currentBookmarks.find(b => b.id === id);
            let visible = true;
            if (category === 'video' && !bm.embedUrl) visible = false;
            if (category === 'post' && !bm.postType) visible = false;
            if (category === 'link' && (bm.embedUrl || bm.postType)) visible = false;
            card.style.display = visible ? '' : 'none';
        });

        // Сортировка повлияет на порядок в DOM (перемещение)
        const sortedIds = [...currentBookmarks]
            .filter(b => {
                if (category === 'video') return !!b.embedUrl;
                if (category === 'post') return !!b.postType;
                if (category === 'link') return !b.embedUrl && !b.postType;
                return true;
            })
            .sort((a, b) => {
                if (sortOrder === 'new') return new Date(b.added) - new Date(a.added);
                return new Date(a.added) - new Date(b.added);
            })
            .map(b => b.id);

        sortedIds.forEach(id => {
            const card = gridContainer.querySelector(`.bookmark-card-wrapper[data-id="${id}"]`);
            if (card) gridContainer.appendChild(card);
        });
    }

    async function changeMasterPassword(oldPwd, newPwd) {
        const res = await loadBookmarks(oldPwd);
        if (res.passwordRequired) throw new Error('Старый пароль неверный');
        masterPassword = newPwd;
        currentBookmarks = res.bookmarks || [];
        await doSaveBookmarks();
    }

    async function resetStorage() {
        if (gistId && currentToken) {
            await gistDelete(gistId, currentToken).catch(() => {});
        }
        gistId = null;
        localStorage.removeItem(STORAGE_KEY_PREFIX + currentUser);
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        sessionStorage.removeItem(USER_CACHE_KEY);
        sessionStorage.removeItem(SESSION_CACHE_KEY);
        resetPasswordAttempts();
        masterPassword = null;
    }

    function updateAuthState() {
        if (!window.GithubAuth) return;
        currentUser = GithubAuth.getCurrentUser();
        currentToken = GithubAuth.getToken();
        if (currentUser && currentToken) {
            const stored = localStorage.getItem(STORAGE_KEY_PREFIX + currentUser);
            if (stored) try { gistId = JSON.parse(stored).gistId; } catch {}
        } else {
            gistId = null;
            masterPassword = null;
        }
    }

    window.addEventListener('github-login-success', () => {
        updateAuthState();
        restorePasswordState();
    });
    window.addEventListener('github-logout', () => {
        currentUser = null;
        currentToken = null;
        gistId = null;
        masterPassword = null;
    });

    // Экспорт
    window.BookmarkStorage = {
        openStorageModal,
        addBookmark,
        removeBookmark,
        changeMasterPassword,
        resetStorage,
        loadBookmarks   // может пригодиться
    };
})();