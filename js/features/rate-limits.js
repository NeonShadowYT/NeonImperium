// js/features/rate-limits.js – с локализацией, исправлены loadQueueItems и loadHistoryItems
(function() {
    const { escapeHtml } = window.GithubCore;

    const LIMITS = {
        posts: 4,
        comments: 16,
        storageAdds: 16,
        cacheClears: 5,
        reactions: 16
    };

    const STORAGE_KEY = 'rate_limits';
    const DB_NAME = 'NeonImperiumQueue';
    const DB_VERSION = 2;
    const STORE_NAME = 'queue';
    const HISTORY_SIZE = 100;
    const QUEUE_CACHE_TTL = 60000;

    let db = null;
    let currentCounts = null;
    let today = null;
    let queueCache = null;
    let queueCacheTime = 0;
    let processQueueDebounced = null;

    let bc = null;
    try {
        bc = new BroadcastChannel('rate-limits');
        bc.onmessage = (event) => {
            if (event.data.type === 'counts-updated') {
                currentCounts = event.data.counts;
                today = event.data.date;
                updateIndicators();
                if (window._ratePanelOpen) refreshPanel();
            }
            if (event.data.type === 'queue-updated') {
                queueCache = null;
                if (window._ratePanelOpen) refreshPanel();
            }
        };
    } catch (e) {}

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
        try {
            if (bc) bc.postMessage({ type: 'counts-updated', counts: currentCounts, date: today });
        } catch (e) {}
    }

    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) {
            loadCounts();
            updateIndicators();
            if (window._ratePanelOpen) refreshPanel();
        }
    });

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
        if (!processQueueDebounced) {
            processQueueDebounced = debounce(() => {
                processQueue().catch(console.warn);
            }, 5000);
        }
        processQueueDebounced();
        if (window._ratePanelOpen) refreshPanel();
    }

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

    async function getPendingActions(forceRefresh = false) {
        if (!forceRefresh && queueCache && (Date.now() - queueCacheTime < QUEUE_CACHE_TTL)) {
            return queueCache;
        }
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
            queueCache = items || [];
            queueCacheTime = Date.now();
            return queueCache;
        } catch (e) {
            return [];
        }
    }

    async function enqueueAction(action, data) {
        checkDayReset();
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        const existing = await new Promise((resolve) => {
            const index = store.index('action');
            const range = IDBKeyRange.only(action);
            const request = index.getAll(range);
            request.onsuccess = () => {
                const items = request.result.filter(item => item.status === 'pending' || item.status === 'failed');
                let duplicate = false;
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
                    if (data.bookmark && data.bookmark.url) {
                        duplicate = items.some(item => item.data.bookmark && item.data.bookmark.url === data.bookmark.url);
                    } else if (data.bookmarks) {
                        // массовое сохранение – пропускаем дублирование
                    }
                } else if (action === 'cacheClears') {
                    // всегда разрешено
                }
                resolve(duplicate);
            };
            request.onerror = () => resolve(false);
        });

        if (existing) {
            console.log('[RateLimits] Duplicate action skipped:', action);
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
        queueCache = null;
        try { if (bc) bc.postMessage({ type: 'queue-updated' }); } catch (e) {}
        window.UIUtils?.showToast(`Действие "${actionLabels[action] || action}" сохранено в очередь`, 'info');
        if (window._ratePanelOpen) refreshPanel();
        updateIndicators();
        registerSync().catch(console.warn);
        return id;
    }

    async function cancelAction(actionId) {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const item = await new Promise((resolve, reject) => {
            const req = store.get(actionId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        if (item && item.status === 'pending') {
            await new Promise((resolve, reject) => {
                const req = store.delete(actionId);
                req.onsuccess = resolve;
                req.onerror = reject;
            });
            await tx.done;
            queueCache = null;
            try { if (bc) bc.postMessage({ type: 'queue-updated' }); } catch (e) {}
            window.UIUtils?.showToast('Действие удалено из очереди', 'success');
            if (window._ratePanelOpen) refreshPanel();
            return true;
        }
        return false;
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

        pending.sort((a, b) => a.timestamp - b.timestamp);

        for (const item of pending) {
            let valid = true;
            if (window.GithubCore && typeof window.GithubCore.isActionStillValid === 'function') {
                valid = await window.GithubCore.isActionStillValid(item.action, item.data);
            }
            if (!valid) {
                await new Promise((resolve, reject) => {
                    const req = store.delete(item.id);
                    req.onsuccess = resolve;
                    req.onerror = reject;
                });
                continue;
            }

            if (!checkLimit(item.action)) {
                break;
            }

            try {
                await executeAction(item.action, item.data);
                await new Promise((resolve, reject) => {
                    const req = store.delete(item.id);
                    req.onsuccess = resolve;
                    req.onerror = reject;
                });
                increment(item.action);
                addHistory(item.action, item.data, 'completed');
                await new Promise(r => setTimeout(r, 500));
            } catch (err) {
                console.warn('[RateLimits] Error executing queued action:', err);
                if (err.status === 404 || err.message.includes('not found')) {
                    await new Promise((resolve, reject) => {
                        const req = store.delete(item.id);
                        req.onsuccess = resolve;
                        req.onerror = reject;
                    });
                    addHistory(item.action, item.data, 'failed');
                } else {
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

        queueCache = null;
        try { if (bc) bc.postMessage({ type: 'queue-updated' }); } catch (e) {}
        updateIndicators();
        if (window._ratePanelOpen) refreshPanel();
    }

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
                if (data.bookmarks) {
                    if (window.BookmarkStorage && window.BookmarkStorage._doSave) {
                        await window.BookmarkStorage._doSave(data.bookmarks);
                    } else {
                        for (const bm of data.bookmarks) {
                            await window.BookmarkStorage.addBookmark(bm);
                        }
                    }
                } else if (data.bookmark) {
                    await window.BookmarkStorage.addBookmark(data.bookmark);
                }
                break;
            case 'cacheClears':
                await clearAllCacheInternal();
                break;
            case 'reactions':
                await window.GithubAPI.addReaction(data.issueNumber, data.content);
                break;
            default:
                throw new Error('Unknown action');
        }
    }

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

    async function clearAllCacheInternal() {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
            await caches.delete(name);
        }
        const exclude = ['rate_limits', 'rate_history', 'license_agreed_v1', 'license_version', 'license_agreed_timestamp', 'preferredLanguage', 'github_token', 'last_cache_clear'];
        for (const key of Object.keys(localStorage)) {
            if (!exclude.some(ex => key.startsWith(ex))) {
                localStorage.removeItem(key);
            }
        }
        const sessionExclude = ['preferredLanguage'];
        for (const key of Object.keys(sessionStorage)) {
            if (!sessionExclude.some(ex => key.startsWith(ex))) {
                sessionStorage.removeItem(key);
            }
        }
        if (window._cacheMap) window._cacheMap.clear();
        queueCache = null;
    }

    function openRatePanel() {
        const t = window.I18n?.translate || (k => k);
        window._ratePanelOpen = true;
        const { modal, closeModal } = window.UIUtils.createModal(t('limitsAndCache'), buildPanelHTML(t), { size: 'full' });
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
            if (body) body.innerHTML = buildPanelHTML(t);
            bindPanelEvents(modal, t);
        };
        refreshPanel = () => {
            if (window._ratePanelRefresh) {
                requestAnimationFrame(() => window._ratePanelRefresh());
            }
        };

        bindPanelEvents(modal, t);
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

        // Передаём t в функции загрузки
        loadQueueItems(modal, t);
        loadHistoryItems(modal, t);
    }

    function buildPanelHTML(t) {
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

        const style = `
        <style>
          .rate-panel{display:flex;flex-direction:column;gap:20px}
          .rate-summary{display:flex;justify-content:space-between;align-items:center;background:var(--bg-inner-gradient);padding:12px 20px;border-radius:16px;border:1px solid var(--border);flex-wrap:wrap;gap:8px}
          .rate-timer{font-size:14px;color:var(--text-secondary)}
          .rate-timer strong{color:var(--accent)}
          .rate-total{font-size:14px;color:var(--text-secondary)}
          .rate-limits-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
          .rate-limit-item{background:var(--bg-card);border-radius:12px;padding:12px 16px;border:1px solid var(--border)}
          .rate-label{font-size:13px;color:var(--text-secondary);display:block;margin-bottom:6px}
          .rate-bar{height:8px;background:var(--bg-primary);border-radius:10px;overflow:hidden;margin:6px 0}
          .rate-fill{height:100%;border-radius:10px;transition:width 0.4s ease}
          .rate-count{font-size:12px;color:var(--text-secondary);display:flex;justify-content:space-between}
          .rate-count .used{color:var(--text-secondary)}
          .rate-count .rem{font-weight:bold}
          .rate-info{font-size:13px;color:var(--text-secondary);background:var(--bg-inner-gradient);padding:10px 16px;border-radius:12px;border-left:3px solid var(--accent)}
          .rate-tabs{display:flex;gap:8px;border-bottom:1px solid var(--border);padding-bottom:8px;flex-wrap:wrap}
          .rate-tab{background:transparent;border:none;color:var(--text-secondary);padding:6px 14px;border-radius:20px;cursor:pointer;font-family:var(--font-family);transition:0.2s;display:flex;align-items:center;gap:6px}
          .rate-tab.active{background:var(--accent);color:#fff}
          .rate-tab-content{margin-top:8px}
          .rate-history-list,.rate-queue-list,.rate-cache-actions{max-height:300px;overflow-y:auto}
          .rate-history-item,.rate-queue-item{display:flex;justify-content:space-between;padding:6px 12px;border-bottom:1px solid var(--border);font-size:13px;align-items:center}
          .rate-history-item.completed .rate-status{color:#4caf50}
          .rate-history-item.failed .rate-status{color:#f44336}
          .rate-action{color:var(--text-primary)}
          .rate-time{color:var(--text-secondary);font-size:12px}
          .cache-buttons{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
          .cache-buttons button{background:var(--bg-inner-gradient);border:1px solid var(--border);color:var(--text-secondary);padding:6px 14px;border-radius:30px;cursor:pointer;font-family:var(--font-family);transition:0.2s;display:flex;align-items:center;gap:6px}
          .cache-buttons button:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
          .cache-key-item{display:flex;justify-content:space-between;padding:4px 8px;border-bottom:1px solid var(--border);font-size:12px;align-items:center}
          .cache-key-item button{background:transparent;border:none;color:var(--text-secondary);cursor:pointer;font-size:14px}
          .cache-key-item button:hover{color:#f44336}
          .queue-cancel-btn{background:transparent;border:none;color:#f44336;cursor:pointer;font-size:14px}
          .queue-cancel-btn:hover{color:#d32f2f}
          .empty-queue{color:var(--text-secondary);text-align:center;padding:20px}
        </style>`;

        const cacheKeys = getCacheKeys();

        return style + `
        <div class="rate-panel">
          <div class="rate-summary">
            <div class="rate-timer"><i class="fas fa-clock"></i> ${t('refreshIn')} <strong>${hours}ч ${minutes}м</strong></div>
            <div class="rate-total"><i class="fas fa-chart-bar"></i> ${t('totalRemaining')} <strong>${totalRemaining}</strong></div>
          </div>
          <div class="rate-limits-grid">
            ${Object.entries(remaining).map(([action, rem]) => {
              const limit = LIMITS[action];
              const used = limit - rem;
              const pct = limit ? (rem / limit) * 100 : 100;
              let color = '#4caf50';
              if (pct < 30) color = '#f44336';
              else if (pct < 60) color = '#ff9800';
              const label = t('action' + action.charAt(0).toUpperCase() + action.slice(1)) || actionLabels[action] || action;
              return `
                <div class="rate-limit-item">
                  <span class="rate-label"><i class="fas ${actionIcons[action] || 'fa-circle'}"></i> ${label}</span>
                  <div class="rate-bar"><div class="rate-fill" style="width:${pct}%;background:${color};"></div></div>
                  <div class="rate-count">
                    <span class="used">${used} / ${limit}</span>
                    <span class="rem" style="color:${color};"><i class="fas fa-arrow-left"></i> ${rem}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          <div class="rate-info"><i class="fas fa-info-circle"></i> ${t('limitsInfo')}</div>
          <div class="rate-tabs">
            <button class="rate-tab active" data-tab="queue"><i class="fas fa-clock"></i> ${t('queue')} (<span id="queue-count">0</span>)</button>
            <button class="rate-tab" data-tab="history"><i class="fas fa-history"></i> История</button>
            <button class="rate-tab" data-tab="cache"><i class="fas fa-database"></i> ${t('cacheState')}</button>
          </div>
          <div class="rate-tab-content">
            <div id="rate-queue" class="rate-queue-list"><div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> ${t('loading')}</div></div>
            <div id="rate-history" style="display:none;" class="rate-history-list"></div>
            <div id="rate-cache" style="display:none;" class="rate-cache-actions">
              <p><i class="fas fa-broom"></i> ${t('clearStaleCache')}:</p>
              <div class="cache-keys-list">
                ${cacheKeys.length === 0 ? `<p class="empty-queue">${t('noBookmarks')}</p>` :
                  cacheKeys.map(key => `
                    <div class="cache-key-item">
                      <span>${escapeHtml(key)}</span>
                      <button class="cache-delete-btn" data-key="${escapeHtml(key)}"><i class="fas fa-times"></i></button>
                    </div>
                  `).join('')}
              </div>
              <div class="cache-buttons">
                <button id="clear-stale-cache"><i class="fas fa-broom"></i> ${t('clearStaleCache')}</button>
                <button id="clear-all-cache"><i class="fas fa-trash-alt"></i> ${t('clearAllCache')}</button>
              </div>
              <p style="font-size:12px; color:var(--text-secondary);">* ${t('save')} не удаляются.</p>
            </div>
          </div>
        </div>
      `;
    }

    function bindPanelEvents(modal, t) {
        modal.querySelectorAll('.rate-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                modal.querySelectorAll('.rate-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const target = tab.dataset.tab;
                modal.querySelectorAll('.rate-tab-content > div').forEach(div => div.style.display = 'none');
                const map = {
                    'queue': 'rate-queue',
                    'history': 'rate-history',
                    'cache': 'rate-cache'
                };
                const el = modal.querySelector('#' + map[target]);
                if (el) el.style.display = '';
                if (target === 'queue') loadQueueItems(modal, t);
                if (target === 'history') loadHistoryItems(modal, t);
                if (target === 'cache') loadCacheItems(modal);
            });
        });

        modal.querySelector('#clear-stale-cache')?.addEventListener('click', () => {
            clearStaleCache();
            window.UIUtils?.showToast(t('staleCacheCleared'), 'success');
            refreshPanel();
        });
        modal.querySelector('#clear-all-cache')?.addEventListener('click', () => {
            if (confirm(t('clearCacheConfirm'))) {
                clearAllCache();
                window.UIUtils?.showToast(t('cacheCleared'), 'success');
                refreshPanel();
            }
        });

        modal.querySelectorAll('.cache-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = btn.dataset.key;
                if (key && confirm(`Удалить ключ "${key}"?`)) {
                    deleteCacheKey(key);
                    window.UIUtils?.showToast(`Ключ "${key}" удален`, 'success');
                    refreshPanel();
                }
            });
        });

        modal.addEventListener('click', async (e) => {
            const cancelBtn = e.target.closest('.queue-cancel-btn');
            if (cancelBtn) {
                const id = parseInt(cancelBtn.dataset.id, 10);
                if (id && confirm(t('deleteConfirm'))) {
                    await cancelAction(id);
                    refreshPanel();
                }
            }
        });
    }

    // Исправлены функции: теперь принимают t
    async function loadQueueItems(modal, t) {
        const container = modal?.querySelector('#rate-queue');
        if (!container) return;
        const items = await getPendingActions();
        const countEl = modal.querySelector('#queue-count');
        if (countEl) countEl.textContent = items.length;
        if (items.length === 0) {
            container.innerHTML = `<div class="empty-queue"><i class="fas fa-check-circle"></i> ${t('noPendingActions')}</div>`;
            return;
        }
        container.innerHTML = items.map(item => `
          <div class="rate-queue-item">
            <span class="rate-action"><i class="fas ${actionIcons[item.action] || 'fa-circle'}"></i> ${t('action' + item.action.charAt(0).toUpperCase() + item.action.slice(1)) || actionLabels[item.action] || item.action}</span>
            <span class="rate-time">${new Date(item.timestamp).toLocaleString()}</span>
            <button class="queue-cancel-btn" data-id="${item.id}"><i class="fas fa-times"></i></button>
          </div>
        `).join('');
    }

    async function loadHistoryItems(modal, t) {
        const container = modal?.querySelector('#rate-history');
        if (!container) return;
        const history = getHistory().slice(-50).reverse();
        if (history.length === 0) {
            container.innerHTML = `<div class="empty-queue">${t('noBookmarks')}</div>`;
            return;
        }
        container.innerHTML = history.map(h => `
          <div class="rate-history-item ${h.status}">
            <span class="rate-action">${t('action' + h.action.charAt(0).toUpperCase() + h.action.slice(1)) || actionLabels[h.action] || h.action}</span>
            <span class="rate-status">${h.status === 'completed' ? '✅' : '❌'}</span>
            <span class="rate-time">${new Date(h.timestamp).toLocaleString()}</span>
          </div>
        `).join('');
    }

    function loadCacheItems(modal) {
        const container = modal?.querySelector('.cache-keys-list');
        if (!container) return;
        const keys = getCacheKeys();
        if (keys.length === 0) {
            container.innerHTML = `<p class="empty-queue">${t('noBookmarks')}</p>`;
            return;
        }
        container.innerHTML = keys.map(key => `
          <div class="cache-key-item">
            <span>${escapeHtml(key)}</span>
            <button class="cache-delete-btn" data-key="${escapeHtml(key)}"><i class="fas fa-times"></i></button>
          </div>
        `).join('');
        container.querySelectorAll('.cache-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const key = btn.dataset.key;
                if (key && confirm(`Удалить ключ "${key}"?`)) {
                    deleteCacheKey(key);
                    window.UIUtils?.showToast(`Ключ "${key}" удален`, 'success');
                    refreshPanel();
                }
            });
        });
    }

    function getCacheKeys() {
        const keys = new Set();
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && !key.startsWith('preferredLanguage')) {
                keys.add('session:' + key);
            }
        }
        const exclude = ['rate_limits', 'rate_history', 'license_agreed_v1', 'license_version', 'license_agreed_timestamp', 'preferredLanguage', 'github_token', 'last_cache_clear'];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && !exclude.some(ex => key.startsWith(ex))) {
                keys.add('local:' + key);
            }
        }
        return Array.from(keys).sort();
    }

    function deleteCacheKey(fullKey) {
        const [storage, key] = fullKey.split(':', 2);
        if (storage === 'session') {
            sessionStorage.removeItem(key);
        } else if (storage === 'local') {
            localStorage.removeItem(key);
        }
    }

    function clearStaleCache() {
        const now = Date.now();
        const ttl = window.GithubCore?.CONFIG?.CACHE_TTL || 600000;
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key && key.endsWith('_time')) {
                const time = parseInt(sessionStorage.getItem(key), 10);
                if (!isNaN(time) && now - time > ttl) {
                    const dataKey = key.replace('_time', '');
                    sessionStorage.removeItem(dataKey);
                    sessionStorage.removeItem(key);
                }
            }
        }
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && key.endsWith('_time') && !key.startsWith('rate_limits') && !key.startsWith('license_')) {
                const time = parseInt(localStorage.getItem(key), 10);
                if (!isNaN(time) && now - time > ttl) {
                    const dataKey = key.replace('_time', '');
                    localStorage.removeItem(dataKey);
                    localStorage.removeItem(key);
                }
            }
        }
    }

    function clearAllCache() {
        const exclude = ['rate_limits', 'rate_history', 'license_agreed_v1', 'license_version', 'license_agreed_timestamp', 'preferredLanguage', 'github_token', 'last_cache_clear'];
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && !exclude.some(ex => key.startsWith(ex))) {
                localStorage.removeItem(key);
            }
        }
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key && !key.startsWith('preferredLanguage')) {
                sessionStorage.removeItem(key);
            }
        }
        caches.keys().then(names => {
            for (const name of names) {
                caches.delete(name);
            }
        }).catch(console.warn);
        queueCache = null;
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

    let refreshPanel = () => {};

    function updateIndicators() {
        document.querySelectorAll('.rate-indicator').forEach(el => {
            const action = el.dataset.action;
            if (action && LIMITS[action] !== undefined) {
                el.textContent = getRemaining(action);
            }
        });
    }

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

    if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data?.type === 'SYNC_TRIGGERED') {
                processQueue().catch(console.error);
            }
        });
    }

    function init() {
        loadCounts();
        setInterval(() => {
            checkDayReset();
        }, 60000);

        processQueue().catch(console.warn);

        window.addEventListener('github-auth-ready', () => {
            const profile = document.querySelector('.nav-profile');
            if (profile) {
                const dropdown = profile.querySelector('.profile-dropdown');
                if (dropdown && !dropdown.querySelector('[data-action="rate-panel"]')) {
                    const t = window.I18n?.translate || (k => k);
                    const item = document.createElement('div');
                    item.className = 'profile-dropdown-item';
                    item.dataset.action = 'rate-panel';
                    item.innerHTML = `<i class="fas fa-chart-bar"></i> ${t('ratePanel')}`;
                    const divider = dropdown.querySelector('.profile-dropdown-divider');
                    if (divider) {
                        dropdown.insertBefore(item, divider);
                    } else {
                        dropdown.appendChild(item);
                    }
                }
            }
        });

        window.addEventListener('open-rate-panel', () => {
            openRatePanel();
        });

        document.addEventListener('click', (e) => {
            const indicator = e.target.closest('.rate-indicator-wrapper, .rate-indicator');
            if (indicator) {
                openRatePanel();
            }
        });

        updateIndicators();
        console.log('[RateLimits] Инициализирован');
    }

    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    const actionLabels = {
        posts: window.I18n?.translate('actionPosts') || 'Посты',
        comments: window.I18n?.translate('actionComments') || 'Комментарии',
        storageAdds: window.I18n?.translate('actionStorageAdds') || 'Добавления в хранилище',
        cacheClears: window.I18n?.translate('actionCacheClears') || 'Очистка кеша',
        reactions: window.I18n?.translate('actionReactions') || 'Реакции'
    };

    const actionIcons = {
        posts: 'fa-newspaper',
        comments: 'fa-comment',
        storageAdds: 'fa-box-archive',
        cacheClears: 'fa-broom',
        reactions: 'fa-heart'
    };

    window.RateLimits = {
        init,
        checkLimit,
        increment,
        getRemaining,
        enqueueAction,
        cancelAction,
        processQueue,
        openRatePanel,
        addIndicator,
        updateIndicators,
        getPendingActions,
        getHistory,
        LIMITS,
        actionLabels,
        clearAllCache: clearAllCacheInternal,
        clearStaleCache,
        getCacheKeys,
        deleteCacheKey
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();