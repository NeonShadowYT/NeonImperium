// js/features/rate-limits.js – единая система лимитов, очереди и выполнения действий
(function() {
    // ---------- Конфигурация лимитов ----------
    const LIMITS = {
        posts: 10,
        comments: 50,
        storageAdds: 30,
        cacheClears: 5,
        reactions: 20   // 👀 и ❤️ вместе
    };

    const STORAGE_KEY = 'rate_limits';
    const DB_NAME = 'NeonImperiumQueue';
    const DB_VERSION = 2;
    const STORE_NAME = 'queue';
    const HISTORY_SIZE = 100;

    let db = null;
    let currentCounts = null;
    let today = null;

    // ---------- Инициализация IndexedDB для очереди ----------
    function openDB() {
        return new Promise((resolve, reject) => {
            if (db) { resolve(db); return; }
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('status', 'status');
                    store.createIndex('action', 'action');
                    store.createIndex('timestamp', 'timestamp');
                }
            };
            request.onsuccess = (e) => { db = e.target.result; resolve(db); };
            request.onerror = (e) => { reject(e.target.error); };
        });
    }

    // ---------- Счётчики (localStorage) ----------
    function getToday() {
        return new Date().toDateString();
    }

    function loadCounts() {
        try {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (data && data.date === getToday()) {
                today = data.date;
                currentCounts = data.counts;
                return;
            }
        } catch {}
        today = getToday();
        currentCounts = { posts: 0, comments: 0, storageAdds: 0, cacheClears: 0, reactions: 0 };
        saveCounts();
    }

    function saveCounts() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, counts: currentCounts }));
    }

    function getRemaining(action) {
        const limit = LIMITS[action];
        if (limit === undefined) return Infinity;
        const used = currentCounts[action] || 0;
        return Math.max(0, limit - used);
    }

    function checkLimit(action) {
        return getRemaining(action) > 0;
    }

    function increment(action) {
        if (currentCounts[action] === undefined) currentCounts[action] = 0;
        currentCounts[action]++;
        saveCounts();
        updateIndicators();
        // После инкремента пробуем обработать очередь
        processQueue().catch(console.warn);
        if (window._ratePanelOpen) refreshPanel();
    }

    // Сброс в полночь
    function checkDayReset() {
        const newToday = getToday();
        if (newToday !== today) {
            today = newToday;
            currentCounts = { posts: 0, comments: 0, storageAdds: 0, cacheClears: 0, reactions: 0 };
            saveCounts();
            processQueue().catch(console.warn);
            updateIndicators();
            if (window._ratePanelOpen) refreshPanel();
        }
    }

    // ---------- Очередь (IndexedDB) ----------
    async function enqueueAction(action, data) {
        checkDayReset();
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        // Проверка дубликата: для одного типа действия и одинаковых данных (кроме timestamp)
        const existing = await new Promise((resolve) => {
            const index = store.index('action');
            const range = IDBKeyRange.only(action);
            const request = index.getAll(range);
            request.onsuccess = () => {
                const items = request.result.filter(item => item.status === 'pending' || item.status === 'failed');
                let duplicate = false;
                // Для реакций проверяем issueNumber и content
                if (action === 'reactions') {
                    duplicate = items.some(item => item.data.issueNumber === data.issueNumber && item.data.content === data.content);
                } else if (action === 'comments') {
                    duplicate = items.some(item => item.data.issueNumber === data.issueNumber && item.data.body === data.body);
                } else if (action === 'posts') {
                    if (data.mode === 'edit' && data.id) {
                        duplicate = items.some(item => item.data.id === data.id);
                    } else {
                        duplicate = items.some(item => item.data.title === data.title && item.data.body === data.body);
                    }
                } else if (action === 'storageAdds') {
                    if (data.bookmark.url) {
                        duplicate = items.some(item => item.data.bookmark.url === data.bookmark.url);
                    } else if (data.bookmark.saveData && data.bookmark.saveData.hash) {
                        duplicate = items.some(item => item.data.bookmark.saveData && item.data.bookmark.saveData.hash === data.bookmark.saveData.hash);
                    }
                } else if (action === 'cacheClears') {
                    // не дублируем
                }
                resolve(duplicate);
            };
            request.onerror = () => resolve(false);
        });

        if (existing) {
            console.log('[RateLimits] Действие уже в очереди:', action);
            return null;
        }

        const entry = {
            action,
            data,
            timestamp: Date.now(),
            status: 'pending',
            retries: 0
        };
        const id = await new Promise((resolve, reject) => {
            const req = store.add(entry);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        await tx.done;

        // Показываем уведомление
        window.UIUtils?.showToast(`Действие "${actionLabels[action] || action}" сохранено в очередь`, 'info');

        // Обновляем панель
        if (window._ratePanelOpen) refreshPanel();
        updateIndicators();

        // Регистрируем background sync
        registerSync().catch(console.warn);

        return id;
    }

    async function getPendingActions() {
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const index = store.index('status');
            const range = IDBKeyRange.only('pending');
            const items = await new Promise((resolve) => {
                const req = index.getAll(range);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve([]);
            });
            await tx.done;
            return items || [];
        } catch (e) {
            return [];
        }
    }

    async function processQueue() {
        checkDayReset();
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('status');
        const range = IDBKeyRange.only('pending');
        const pending = await new Promise((resolve) => {
            const req = index.getAll(range);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve([]);
        });

        if (pending.length === 0) return;

        // Сортируем по времени (старые сначала)
        pending.sort((a, b) => a.timestamp - b.timestamp);

        // Обрабатываем с задержкой между действиями, чтобы не превысить вторичные лимиты
        for (const item of pending) {
            // Проверяем актуальность действия
            let valid = true;
            if (window.GithubCore && typeof window.GithubCore.isActionStillValid === 'function') {
                valid = await window.GithubCore.isActionStillValid(item.action, item.data);
            }
            if (!valid) {
                // Удаляем неактуальное действие
                await new Promise((resolve, reject) => {
                    const req = store.delete(item.id);
                    req.onsuccess = resolve;
                    req.onerror = reject;
                });
                continue;
            }

            // Проверяем лимит для этого действия
            if (!checkLimit(item.action)) {
                // Не можем выполнить сейчас – оставляем в очереди (прерываем цикл, так как лимиты могут восстановиться позже)
                break;
            }

            try {
                await executeAction(item.action, item.data);
                // Успешно – удаляем и инкрементим
                await new Promise((resolve, reject) => {
                    const req = store.delete(item.id);
                    req.onsuccess = resolve;
                    req.onerror = reject;
                });
                increment(item.action);
                addHistory(item.action, item.data, 'completed');
                // Небольшая задержка между успешными действиями
                await new Promise(r => setTimeout(r, 500));
            } catch (err) {
                console.warn('[RateLimits] Ошибка выполнения действия из очереди:', err);
                // Если ошибка непреодолима (например, 404), удаляем
                if (err.status === 404 || err.message.includes('not found')) {
                    await new Promise((resolve, reject) => {
                        const req = store.delete(item.id);
                        req.onsuccess = resolve;
                        req.onerror = reject;
                    });
                    addHistory(item.action, item.data, 'failed');
                } else {
                    // Увеличиваем счётчик ретраев
                    if (item.retries >= 5) {
                        await new Promise((resolve, reject) => {
                            const req = store.delete(item.id);
                            req.onsuccess = resolve;
                            req.onerror = reject;
                        });
                        addHistory(item.action, item.data, 'failed');
                    } else {
                        item.retries++;
                        item.status = 'pending';
                        await new Promise((resolve, reject) => {
                            const req = store.put(item);
                            req.onsuccess = resolve;
                            req.onerror = reject;
                        });
                    }
                }
            }
        }
        await tx.done;

        updateIndicators();
        if (window._ratePanelOpen) refreshPanel();
    }

    // Исполнение действия (вызов реальных API)
    async function executeAction(action, data) {
        switch (action) {
            case 'posts':
                if (data.mode === 'edit' && data.id) {
                    await window.GithubAPI.updateIssue(data.id, { title: data.title, body: data.body });
                } else {
                    await window.GithubAPI.createIssue(data.title, data.body, data.labels);
                }
                break;
            case 'comments':
                await window.GithubAPI.addComment(data.issueNumber, data.body);
                break;
            case 'storageAdds':
                await window.BookmarkStorage.addBookmark(data.bookmark);
                break;
            case 'cacheClears':
                // Очистка кеша – выполняем через RateLimits.clearAllCache
                await clearAllCacheInternal();
                break;
            case 'reactions':
                await window.GithubAPI.addReaction(data.issueNumber, data.content);
                break;
            default:
                throw new Error('Unknown action');
        }
    }

    // ---------- История (локально в localStorage) ----------
    function addHistory(action, data, status) {
        let history = [];
        try {
            history = JSON.parse(localStorage.getItem('rate_history')) || [];
        } catch {}
        history.push({ action, data: JSON.stringify(data), status, timestamp: Date.now() });
        if (history.length > HISTORY_SIZE) {
            history = history.slice(-HISTORY_SIZE);
        }
        localStorage.setItem('rate_history', JSON.stringify(history));
    }

    function getHistory() {
        try {
            return JSON.parse(localStorage.getItem('rate_history')) || [];
        } catch { return []; }
    }

    // ---------- Очистка кеша (внутренняя) ----------
    async function clearAllCacheInternal() {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
            await caches.delete(name);
        }
        // Чистим localStorage, исключая лимиты, историю и важные настройки
        const exclude = ['rate_limits', 'rate_history', 'license_agreed_v1', 'license_version', 'license_agreed_timestamp', 'preferredLanguage', 'github_token'];
        for (const key of Object.keys(localStorage)) {
            if (!exclude.some(ex => key.startsWith(ex))) {
                localStorage.removeItem(key);
            }
        }
        // sessionStorage чистим всё, кроме текущей сессии (можно оставить для языка и т.п.)
        const sessionExclude = ['preferredLanguage'];
        for (const key of Object.keys(sessionStorage)) {
            if (!sessionExclude.some(ex => key.startsWith(ex))) {
                sessionStorage.removeItem(key);
            }
        }
        // Также очищаем кеш в памяти
        if (window._cacheMap) window._cacheMap.clear();
    }

    // ---------- Панель лимитов (модалка) ----------
    function openRatePanel() {
        window._ratePanelOpen = true;
        const { modal, closeModal } = window.UIUtils.createModal('Лимиты и кеш', buildPanelHTML(), { size: 'full' });
        modal.dataset.ratePanel = 'true';
        const originalClose = closeModal;
        const newClose = () => {
            window._ratePanelOpen = false;
            originalClose();
        };
        modal.querySelector('.modal-close').addEventListener('click', newClose);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) newClose();
        });

        window._ratePanelRefresh = () => {
            const body = modal.querySelector('.modal-body');
            if (body) body.innerHTML = buildPanelHTML();
        };
        refreshPanel = () => {
            if (window._ratePanelRefresh) window._ratePanelRefresh();
        };

        // Обработчики кнопок очистки кеша
        modal.addEventListener('click', async (e) => {
            const target = e.target.closest('[data-clear-cache]');
            if (target) {
                const type = target.dataset.clearCache;
                await clearCacheType(type);
                if (window._ratePanelRefresh) window._ratePanelRefresh();
                window.UIUtils.showToast(`Кеш "${type}" очищен`, 'success');
            }
            const clearAllBtn = e.target.closest('#clear-all-cache');
            if (clearAllBtn) {
                await clearAllCacheInternal();
                if (window._ratePanelRefresh) window._ratePanelRefresh();
                window.UIUtils.showToast('Весь кеш (кроме лимитов) очищен', 'success');
            }
        });

        // Обновляем таймер
        updateTimerDisplay(modal);
        const timerInterval = setInterval(() => {
            if (!modal.parentNode) { clearInterval(timerInterval); return; }
            updateTimerDisplay(modal);
        }, 10000);
        const origClose = newClose;
        const newCloseWithClean = () => {
            clearInterval(timerInterval);
            origClose();
        };
        modal.querySelector('.modal-close').removeEventListener('click', newClose);
        modal.querySelector('.modal-close').addEventListener('click', newCloseWithClean);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) newCloseWithClean();
        });

        // Загружаем очередь
        loadQueueItems(modal);
    }

    function buildPanelHTML() {
        const remaining = {};
        let totalRemaining = 0;
        for (const [action, limit] of Object.entries(LIMITS)) {
            const rem = getRemaining(action);
            remaining[action] = rem;
            totalRemaining += rem;
        }
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        const msToMidnight = midnight - now;
        const hours = Math.floor(msToMidnight / 3600000);
        const minutes = Math.floor((msToMidnight % 3600000) / 60000);

        return `
            <div class="rate-panel">
                <div class="rate-summary">
                    <div class="rate-timer">
                        <i class="fas fa-clock"></i> Обновление через: <strong>${hours}ч ${minutes}м</strong>
                    </div>
                    <div class="rate-total">
                        <span>Всего действий осталось: <strong>${totalRemaining}</strong></span>
                    </div>
                </div>
                <div class="rate-limits-grid">
                    ${Object.entries(remaining).map(([action, rem]) => `
                        <div class="rate-limit-item">
                            <span class="rate-label">${actionLabels[action] || action}</span>
                            <div class="rate-bar">
                                <div class="rate-fill" style="width: ${LIMITS[action] ? (rem / LIMITS[action]) * 100 : 100}%; background: ${rem > 0 ? 'var(--accent)' : '#f44336'};"></div>
                            </div>
                            <span class="rate-count">${rem} / ${LIMITS[action]}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="rate-info">
                    <p><i class="fas fa-info-circle"></i> Лимиты защищают ваш аккаунт от блокировок GitHub. При исчерпании лимита действия сохраняются в очередь и выполняются позже.</p>
                </div>
                <div class="rate-tabs">
                    <button class="rate-tab active" data-tab="history">История</button>
                    <button class="rate-tab" data-tab="queue">Очередь</button>
                    <button class="rate-tab" data-tab="cache">Кеш</button>
                </div>
                <div class="rate-tab-content">
                    <div id="rate-history" class="rate-history-list">
                        ${getHistory().slice(-20).reverse().map(h => `
                            <div class="rate-history-item ${h.status}">
                                <span class="rate-action">${actionLabels[h.action] || h.action}</span>
                                <span class="rate-status">${h.status === 'completed' ? '✅' : '❌'}</span>
                                <span class="rate-time">${new Date(h.timestamp).toLocaleTimeString()}</span>
                            </div>
                        `).join('') || 'Нет истории'}
                    </div>
                    <div id="rate-queue" style="display:none;" class="rate-queue-list">
                        <div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>
                    </div>
                    <div id="rate-cache" style="display:none;" class="rate-cache-actions">
                        <p>Очистите выборочно (удаляются только устаревшие данные):</p>
                        <div class="cache-buttons">
                            <button data-clear-cache="static">Статика (CSS, JS)</button>
                            <button data-clear-cache="images">Изображения</button>
                            <button data-clear-cache="api">API-кеш</button>
                            <button data-clear-cache="dynamic">Динамические страницы</button>
                            <button id="clear-all-cache" style="background:#f44336;">Очистить всё (кроме лимитов)</button>
                        </div>
                        <p style="font-size:12px; color:var(--text-secondary);">* Лимиты и очередь не удаляются.</p>
                    </div>
                </div>
            </div>
        `;
    }

    function updateTimerDisplay(modal) {
        const timerEl = modal?.querySelector('.rate-timer strong');
        if (!timerEl) return;
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        const ms = midnight - now;
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        timerEl.textContent = `${hours}ч ${minutes}м`;
    }

    async function loadQueueItems(modal) {
        const container = modal?.querySelector('#rate-queue');
        if (!container) return;
        const items = await getPendingActions();
        if (items.length === 0) {
            container.innerHTML = '<p class="text-secondary">Очередь пуста</p>';
            return;
        }
        container.innerHTML = items.map(item => `
            <div class="queue-item">
                <span class="queue-action">${actionLabels[item.action] || item.action}</span>
                <span class="queue-time">${new Date(item.timestamp).toLocaleString()}</span>
                <span class="queue-status">${item.status === 'pending' ? '⏳' : '❌'}</span>
            </div>
        `).join('');
    }

    let refreshPanel = () => {};

    // ---------- Очистка кеша по типу (только устаревшее) ----------
    async function clearCacheType(type) {
        const cacheNames = await caches.keys();
        const now = Date.now();
        // Определяем TTL для каждого типа
        const ttlMap = {
            'static': window.GithubCore?.CONFIG?.CACHE_TTL || 10 * 60 * 1000,
            'images': window.GithubCore?.CONFIG?.IMAGE_CACHE_TTL || 30 * 24 * 60 * 60 * 1000,
            'api': window.GithubCore?.CONFIG?.API_CACHE_TTL || 5 * 60 * 1000,
            'dynamic': window.GithubCore?.CONFIG?.CACHE_TTL || 10 * 60 * 1000
        };
        const ttl = ttlMap[type] || 10 * 60 * 1000;

        // Для каждого кеша проверяем записи и удаляем устаревшие
        for (const name of cacheNames) {
            if (type === 'static' && name === 'static-v7') {
                await cleanCacheByName(name, ttl);
            } else if (type === 'images' && name === 'images-v7') {
                await cleanCacheByName(name, ttl);
            } else if (type === 'api' && name === 'github-api-v7') {
                await cleanCacheByName(name, ttl);
            } else if (type === 'dynamic' && name === 'dynamic-v7') {
                await cleanCacheByName(name, ttl);
            }
        }
        // Дополнительно очищаем localStorage для API-кеша
        if (type === 'api') {
            const prefix = 'gh_api_';
            for (const key of Object.keys(localStorage)) {
                if (key.startsWith(prefix)) {
                    const timeKey = key + '_time';
                    const storedTime = localStorage.getItem(timeKey);
                    if (storedTime && (now - parseInt(storedTime) > ttl)) {
                        localStorage.removeItem(key);
                        localStorage.removeItem(timeKey);
                    }
                }
            }
        }
    }

    async function cleanCacheByName(cacheName, ttl) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        const now = Date.now();
        for (const req of requests) {
            const response = await cache.match(req);
            if (response) {
                const cachedTime = response.headers.get('sw-cached-time');
                if (cachedTime && (now - parseInt(cachedTime) > ttl)) {
                    await cache.delete(req);
                }
            }
        }
    }

    // ---------- Индикаторы ----------
    function updateIndicators() {
        document.querySelectorAll('.rate-indicator').forEach(el => {
            const action = el.dataset.action;
            if (action && LIMITS[action] !== undefined) {
                el.textContent = getRemaining(action);
            }
        });
    }

    // Добавление индикатора в DOM
    function addIndicator(parent, action, label) {
        const wrapper = document.createElement('span');
        wrapper.className = 'rate-indicator-wrapper';
        wrapper.style.cssText = 'font-size: 12px; color: var(--text-secondary); margin-left: 8px;';
        const text = document.createElement('span');
        text.textContent = label + ' ';
        wrapper.appendChild(text);
        const indicator = document.createElement('span');
        indicator.className = 'rate-indicator';
        indicator.dataset.action = action;
        indicator.textContent = getRemaining(action);
        wrapper.appendChild(indicator);
        parent.appendChild(wrapper);
        return indicator;
    }

    // ---------- Background Sync ----------
    let syncRegistered = false;
    const SYNC_TAG = 'github-queue-sync';

    async function registerSync() {
        if (syncRegistered) return;
        if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
        try {
            const registration = await navigator.serviceWorker.ready;
            await registration.sync.register(SYNC_TAG);
            syncRegistered = true;
            console.log('[RateLimits] Background sync registered');
        } catch (err) {
            console.warn('[RateLimits] Background sync registration failed:', err);
        }
    }

    // Обработка события sync от SW
    if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data?.type === 'SYNC_TRIGGERED') {
                processQueue().catch(console.error);
            }
        });
    }

    // ---------- Инициализация ----------
    function init() {
        loadCounts();
        // Периодическая проверка смены дня (каждую минуту)
        setInterval(() => {
            checkDayReset();
        }, 60000);

        // Обработка очереди при загрузке
        processQueue().catch(console.warn);

        // Добавляем пункт в меню профиля для открытия панели
        window.addEventListener('github-auth-ready', () => {
            const profile = document.querySelector('.nav-profile');
            if (profile) {
                const dropdown = profile.querySelector('.profile-dropdown');
                if (dropdown && !dropdown.querySelector('[data-action="rate-panel"]')) {
                    const item = document.createElement('div');
                    item.className = 'profile-dropdown-item';
                    item.dataset.action = 'rate-panel';
                    item.innerHTML = '<i class="fas fa-chart-bar"></i> Лимиты и кеш';
                    const divider = dropdown.querySelector('.profile-dropdown-divider');
                    if (divider) {
                        dropdown.insertBefore(item, divider);
                    } else {
                        dropdown.appendChild(item);
                    }
                }
            }
        });

        // Обработка события для открытия панели
        window.addEventListener('open-rate-panel', () => {
            openRatePanel();
        });

        // Клик по индикатору открывает панель
        document.addEventListener('click', (e) => {
            const indicator = e.target.closest('.rate-indicator-wrapper, .rate-indicator');
            if (indicator) {
                openRatePanel();
            }
        });

        updateIndicators();
        console.log('[RateLimits] Инициализирован');
    }

    const actionLabels = {
        posts: 'Посты',
        comments: 'Комментарии',
        storageAdds: 'Добавления в хранилище',
        cacheClears: 'Очистка кеша',
        reactions: 'Реакции'
    };

    // Экспорт
    window.RateLimits = {
        init,
        checkLimit,
        increment,
        getRemaining,
        enqueueAction,
        processQueue,
        openRatePanel,
        addIndicator,
        updateIndicators,
        clearCacheType,
        clearAllCache: clearAllCacheInternal,
        getHistory,
        getPendingActions,
        LIMITS,
        actionLabels
    };

    // Автоинициализация
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();