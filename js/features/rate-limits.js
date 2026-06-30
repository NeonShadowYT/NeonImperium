// js/features/rate-limits.js – единая система лимитов, очереди, кеша и визуализации
(function() {
    // ---------- Конфигурация лимитов ----------
    const LIMITS = {
        posts: 10,
        comments: 50,
        storageAdds: 30,
        cacheClears: 5,
        eyesReactions: 20
    };

    const STORAGE_KEY = 'rate_limits';
    const DB_NAME = 'NeonImperiumQueue';
    const DB_VERSION = 1;
    const STORE_NAME = 'queue';
    const HISTORY_SIZE = 100; // храним последние 100 действий в истории

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
        currentCounts = { posts: 0, comments: 0, storageAdds: 0, cacheClears: 0, eyesReactions: 0 };
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
        // После инкремента пробуем обработать очередь
        processQueue().catch(console.warn);
        updateIndicators();
        // Обновляем панель, если открыта
        if (window._ratePanelOpen) refreshPanel();
    }

    // Сброс в полночь (проверяется при каждом действии)
    function checkDayReset() {
        const newToday = getToday();
        if (newToday !== today) {
            today = newToday;
            currentCounts = { posts: 0, comments: 0, storageAdds: 0, cacheClears: 0, eyesReactions: 0 };
            saveCounts();
            // При смене дня пробуем выполнить очередь
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

        // Проверка дубликата: для одинаковых действий с одинаковыми данными (кроме timestamp)
        const existing = await new Promise((resolve) => {
            const index = store.index('action');
            const range = IDBKeyRange.only(action);
            const request = index.getAll(range);
            request.onsuccess = () => {
                const items = request.result.filter(item => item.status === 'pending' || item.status === 'failed');
                // Для комментариев и постов проверяем содержание
                let duplicate = false;
                if (action === 'comments') {
                    duplicate = items.some(item => item.data.issueNumber === data.issueNumber && item.data.body === data.body);
                } else if (action === 'posts') {
                    duplicate = items.some(item => item.data.title === data.title && item.data.body === data.body);
                } else if (action === 'storageAdds') {
                    duplicate = items.some(item => item.data.bookmark.url === data.bookmark.url);
                } else if (action === 'cacheClears') {
                    duplicate = items.some(item => true); // очистка кеша не дублируется
                } else if (action === 'eyesReactions') {
                    duplicate = items.some(item => item.data.issueNumber === data.issueNumber);
                }
                resolve(duplicate);
            };
            request.onerror = () => resolve(false);
        });

        if (existing) {
            console.log('[RateLimits] Действие уже в очереди:', action);
            return;
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
        window.UIUtils?.showToast(`Действие "${action}" сохранено в очереди`, 'info');

        // Обновляем панель, если открыта
        if (window._ratePanelOpen) refreshPanel();
        updateIndicators();
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

        for (const item of pending) {
            // Проверяем лимит для этого действия
            if (!checkLimit(item.action)) {
                // Не можем выполнить сейчас – оставляем в очереди
                continue;
            }

            try {
                await executeAction(item.action, item.data);
                // Успешно – удаляем из очереди и инкрементим счётчик
                await new Promise((resolve, reject) => {
                    const req = store.delete(item.id);
                    req.onsuccess = resolve;
                    req.onerror = reject;
                });
                increment(item.action);
                // Логируем в историю (можно сохранять в localStorage)
                addHistory(item.action, item.data, 'completed');
            } catch (err) {
                console.warn('[RateLimits] Ошибка выполнения действия из очереди:', err);
                // Увеличиваем счётчик ретраев
                if (item.retries >= 5) {
                    // Удаляем, если слишком много ошибок
                    await new Promise((resolve, reject) => {
                        const req = store.delete(item.id);
                        req.onsuccess = resolve;
                        req.onerror = reject;
                    });
                    addHistory(item.action, item.data, 'failed');
                } else {
                    // Обновляем retries и статус (оставляем pending)
                    item.retries++;
                    await new Promise((resolve, reject) => {
                        const req = store.put(item);
                        req.onsuccess = resolve;
                        req.onerror = reject;
                    });
                }
            }
        }
        await tx.done;

        // Обновляем UI
        updateIndicators();
        if (window._ratePanelOpen) refreshPanel();
    }

    // Исполнение действия (вызов реальных API)
    async function executeAction(action, data) {
        switch (action) {
            case 'posts':
                if (data.mode === 'edit') {
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
                // Очистка кеша – просто отмечаем, что выполнено
                break;
            case 'eyesReactions':
                await window.GithubAPI.addReaction(data.issueNumber, 'eyes');
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

    // ---------- Панель лимитов (модалка) ----------
    function openRatePanel() {
        window._ratePanelOpen = true;
        const { modal, closeModal } = window.UIUtils.createModal('Лимиты и кеш', buildPanelHTML(), { size: 'full' });
        modal.dataset.ratePanel = 'true';
        // При закрытии снимаем флаг
        const originalClose = closeModal;
        const newClose = () => {
            window._ratePanelOpen = false;
            originalClose();
        };
        // Переопределяем close
        modal.querySelector('.modal-close').addEventListener('click', newClose);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) newClose();
        });
        // Обновляем панель при изменении
        window._ratePanelRefresh = () => {
            const body = modal.querySelector('.modal-body');
            if (body) body.innerHTML = buildPanelHTML();
        };
        refreshPanel = () => {
            if (window._ratePanelRefresh) window._ratePanelRefresh();
        };
        // Добавляем обработчики для кнопок очистки кеша
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
                await clearAllCache();
                if (window._ratePanelRefresh) window._ratePanelRefresh();
                window.UIUtils.showToast('Весь кеш (кроме лимитов) очищен', 'success');
            }
        });
        // Обновляем таймер до полуночи
        updateTimerDisplay(modal);
        // Периодическое обновление таймера
        const timerInterval = setInterval(() => {
            if (!modal.parentNode) { clearInterval(timerInterval); return; }
            updateTimerDisplay(modal);
        }, 10000);
        // При закрытии очищаем интервал
        const origClose = newClose;
        const newCloseWithClean = () => {
            clearInterval(timerInterval);
            origClose();
        };
        // Переопределяем ещё раз
        modal.querySelector('.modal-close').removeEventListener('click', newClose);
        modal.querySelector('.modal-close').addEventListener('click', newCloseWithClean);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) newCloseWithClean();
        });
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

        const history = getHistory();
        const pending = []; // будем получать из очереди асинхронно, но здесь пока заглушка
        // Для отображения очереди получаем из IndexedDB асинхронно, но в этом HTML мы не можем ждать,
        // поэтому оставим место и заполним позже через JS.
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
                                <div class="rate-fill" style="width: ${(rem / LIMITS[action]) * 100}%; background: ${rem > 0 ? 'var(--accent)' : '#f44336'};"></div>
                            </div>
                            <span class="rate-count">${rem} / ${LIMITS[action]}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="rate-info">
                    <p><i class="fas fa-info-circle"></i> Лимиты защищают ваш аккаунт от блокировок GitHub и предотвращают спам. При исчерпании лимита действия сохраняются в очередь и выполняются позже.</p>
                </div>
                <div class="rate-tabs">
                    <button class="rate-tab active" data-tab="history">История</button>
                    <button class="rate-tab" data-tab="queue">Очередь</button>
                    <button class="rate-tab" data-tab="cache">Кеш</button>
                </div>
                <div class="rate-tab-content">
                    <div id="rate-history" class="rate-history-list">
                        ${history.slice(-20).reverse().map(h => `
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
                        <p>Очистите выборочно:</p>
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

    // Обновление таймера в панели
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

    // Переменная для обновления панели
    let refreshPanel = () => {};

    // ---------- Очистка кеша ----------
    async function clearCacheType(type) {
        const cacheNames = await caches.keys();
        const toDelete = [];
        switch (type) {
            case 'static':
                toDelete.push('static-v7');
                break;
            case 'images':
                toDelete.push('images-v7');
                break;
            case 'api':
                toDelete.push('github-api-v7');
                break;
            case 'dynamic':
                toDelete.push('dynamic-v7');
                break;
            default:
                return;
        }
        for (const name of cacheNames) {
            if (toDelete.includes(name)) {
                await caches.delete(name);
            }
        }
        // Дополнительно очищаем localStorage для API-кеша
        if (type === 'api') {
            for (const key of Object.keys(localStorage)) {
                if (key.startsWith('gh_api_') || key.startsWith('game_issues_') || key.startsWith('posts_')) {
                    localStorage.removeItem(key);
                }
            }
        }
        // Очищаем sessionStorage для некоторых ключей
        if (type === 'static') {
            // ничего
        }
    }

    async function clearAllCache() {
        const cacheNames = await caches.keys();
        const exclude = ['rate_limits', 'pending_actions', 'rate_history'];
        for (const name of cacheNames) {
            await caches.delete(name);
        }
        // Чистим localStorage, исключая лимиты и историю
        for (const key of Object.keys(localStorage)) {
            if (!key.startsWith('rate_') && key !== 'pending_actions' && key !== 'last_cache_clear') {
                localStorage.removeItem(key);
            }
        }
        // Чистим sessionStorage
        sessionStorage.clear();
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

    // ---------- Инициализация ----------
    function init() {
        loadCounts();
        // Периодическая проверка смены дня
        setInterval(() => {
            checkDayReset();
        }, 60000); // каждую минуту

        // Обработка очереди при загрузке
        processQueue().catch(console.warn);

        // Добавляем пункт в меню профиля для открытия панели
        // Это делается в github-auth.js, но мы можем добавить обработчик событий
        window.addEventListener('github-auth-ready', () => {
            // Добавляем пункт в dropdown
            const profile = document.querySelector('.nav-profile');
            if (profile) {
                const dropdown = profile.querySelector('.profile-dropdown');
                if (dropdown) {
                    // Проверяем, есть ли уже пункт
                    if (!dropdown.querySelector('[data-action="rate-panel"]')) {
                        const item = document.createElement('div');
                        item.className = 'profile-dropdown-item';
                        item.dataset.action = 'rate-panel';
                        item.innerHTML = '<i class="fas fa-chart-bar"></i> Лимиты и кеш';
                        // Вставляем перед разделителем или в конец
                        const divider = dropdown.querySelector('.profile-dropdown-divider');
                        if (divider) {
                            dropdown.insertBefore(item, divider);
                        } else {
                            dropdown.appendChild(item);
                        }
                        // Обработчик добавляется в github-auth.js через handleAction
                        // Мы добавим обработчик в глобальный список
                    }
                }
            }
        });

        // Обработка события для открытия панели
        window.addEventListener('open-rate-panel', () => {
            openRatePanel();
        });

        // Также добавляем клик по индикатору для открытия панели
        document.addEventListener('click', (e) => {
            const indicator = e.target.closest('.rate-indicator-wrapper, .rate-indicator');
            if (indicator) {
                openRatePanel();
            }
        });

        // Обновляем индикаторы при загрузке
        updateIndicators();
        console.log('[RateLimits] Инициализирован');
    }

    // Словарь названий действий
    const actionLabels = {
        posts: 'Посты',
        comments: 'Комментарии',
        storageAdds: 'Добавления в хранилище',
        cacheClears: 'Очистка кеша',
        eyesReactions: 'Реакции 👀'
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
        clearAllCache,
        getHistory,
        LIMITS,
        actionLabels
    };

    // Автоинициализация после загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();