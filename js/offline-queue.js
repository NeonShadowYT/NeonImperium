// js/offline-queue.js – единая офлайн-очередь для мутаций GitHub API
(function() {
    // Зависит от Utils (loadModule, debounce)
    const { loadModule, debounce } = window.Utils;

    const DB_NAME = 'NeonImperiumSync';
    const DB_VERSION = 2;
    const STORE_MUTATIONS = 'mutations';
    const STORE_CREDENTIALS = 'credentials';
    const SYNC_TAG = 'github-mutations';

    let dbPromise = null;
    let isProcessing = false;
    let syncRegistered = false;

    // ---- Инициализация IndexedDB ----
    function openDB() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const oldVersion = event.oldVersion;

                if (!db.objectStoreNames.contains(STORE_MUTATIONS)) {
                    db.createObjectStore(STORE_MUTATIONS, { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains(STORE_CREDENTIALS)) {
                    db.createObjectStore(STORE_CREDENTIALS, { keyPath: 'key' });
                }

                if (oldVersion < 2 && db.objectStoreNames.contains(STORE_MUTATIONS)) {
                    const store = request.transaction.objectStore(STORE_MUTATIONS);
                    if (!store.indexNames.contains('timestamp')) {
                        store.createIndex('timestamp', 'timestamp');
                    }
                }
            };
        });
        return dbPromise;
    }

    // ---- Сохранение мутации в очередь ----
    async function queueMutation(mutation) {
        const db = await openDB();
        const tx = db.transaction(STORE_MUTATIONS, 'readwrite');
        const store = tx.objectStore(STORE_MUTATIONS);
        const item = {
            ...mutation,
            timestamp: Date.now(),
            retries: 0
        };
        const result = await store.add(item);
        await tx.done;
        console.log('[OfflineQueue] Mutation queued:', mutation.type, result);
        registerSync().catch(console.warn);
        return result;
    }

    // ---- Получение всех мутаций из очереди (всегда возвращает массив) ----
    async function getAllMutations() {
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_MUTATIONS, 'readonly');
            const store = tx.objectStore(STORE_MUTATIONS);
            const index = store.index('timestamp');
            const mutations = await index.getAll();
            await tx.done;
            return mutations || []; // гарантируем массив
        } catch (err) {
            console.error('[OfflineQueue] Failed to get mutations:', err);
            return [];
        }
    }

    // ---- Удаление мутации по id ----
    async function deleteMutation(id) {
        const db = await openDB();
        const tx = db.transaction(STORE_MUTATIONS, 'readwrite');
        await tx.objectStore(STORE_MUTATIONS).delete(id);
        await tx.done;
    }

    // ---- Очистка всей очереди (при сбросе данных) ----
    async function clearQueue() {
        const db = await openDB();
        const tx = db.transaction(STORE_MUTATIONS, 'readwrite');
        await tx.objectStore(STORE_MUTATIONS).clear();
        await tx.done;
        console.log('[OfflineQueue] Queue cleared');
    }

    // ---- Получение/сохранение токена в IndexedDB (резерв) ----
    async function getStoredToken() {
        const db = await openDB();
        const tx = db.transaction(STORE_CREDENTIALS, 'readonly');
        const store = tx.objectStore(STORE_CREDENTIALS);
        const record = await store.get('github_token');
        await tx.done;
        return record?.value || null;
    }

    async function saveToken(token) {
        const db = await openDB();
        const tx = db.transaction(STORE_CREDENTIALS, 'readwrite');
        await tx.objectStore(STORE_CREDENTIALS).put({ key: 'github_token', value: token });
        await tx.done;
    }

    // ---- Обработка одной мутации (отправка на сервер) ----
    async function processMutation(mutation) {
        const { type, issueNumber, content, reactionId, commentId, body, title, labels, issueData } = mutation;

        if (!window.GithubAPI) {
            await loadModule('js/core/github-api.js');
        }
        if (!window.GithubAPI) throw new Error('GitHubAPI not available');

        switch (type) {
            case 'addReaction':
                await window.GithubAPI.addReaction(issueNumber, content);
                break;
            case 'removeReaction':
                await window.GithubAPI.removeReaction(issueNumber, reactionId);
                break;
            case 'addComment':
                await window.GithubAPI.addComment(issueNumber, body);
                break;
            case 'updateComment':
                await window.GithubAPI.updateComment(commentId, body);
                break;
            case 'deleteComment':
                await window.GithubAPI.deleteComment(commentId);
                break;
            case 'createIssue':
                await window.GithubAPI.createIssue(title, body, labels);
                break;
            case 'updateIssue':
                await window.GithubAPI.updateIssue(issueNumber, issueData);
                break;
            default:
                console.warn('[OfflineQueue] Unknown mutation type:', type);
        }
    }

    // ---- Обработка всей очереди (с повторными попытками) ----
    async function processQueue() {
        if (isProcessing) return;
        isProcessing = true;

        try {
            const mutations = await getAllMutations();
            if (!mutations.length) return;

            console.log(`[OfflineQueue] Processing ${mutations.length} mutations`);

            for (const mut of mutations) {
                try {
                    await processMutation(mut);
                    await deleteMutation(mut.id);
                    console.log(`[OfflineQueue] Mutation ${mut.id} (${mut.type}) succeeded`);
                } catch (err) {
                    console.error(`[OfflineQueue] Mutation ${mut.id} failed:`, err);
                    const newRetries = (mut.retries || 0) + 1;
                    if (newRetries >= 5) {
                        console.warn(`[OfflineQueue] Mutation ${mut.id} exceeded retries, removing`);
                        await deleteMutation(mut.id);
                    } else {
                        const db = await openDB();
                        const tx = db.transaction(STORE_MUTATIONS, 'readwrite');
                        const store = tx.objectStore(STORE_MUTATIONS);
                        const updated = { ...mut, retries: newRetries, timestamp: Date.now() };
                        await store.put(updated);
                        await tx.done;
                    }
                }
            }
        } catch (err) {
            console.error('[OfflineQueue] Process queue error:', err);
        } finally {
            isProcessing = false;
        }
    }

    const debouncedProcessQueue = debounce(processQueue, 2000);

    // ---- Регистрация background sync (через Service Worker) ----
    async function registerSync() {
        if (syncRegistered) return;
        if (!('serviceWorker' in navigator) || !('SyncManager' in window)) {
            console.log('[OfflineQueue] Background sync not supported');
            return;
        }
        try {
            const registration = await navigator.serviceWorker.ready;
            await registration.sync.register(SYNC_TAG);
            syncRegistered = true;
            console.log('[OfflineQueue] Background sync registered');
        } catch (err) {
            console.warn('[OfflineQueue] Background sync registration failed:', err);
        }
    }

    // ---- Вызывать при получении сигнала от SW (например, после восстановления сети) ----
    function onSyncEvent() {
        console.log('[OfflineQueue] Sync event triggered');
        processQueue().catch(console.error);
    }

    // ---- Сброс всей очереди (при смене пользователя) ----
    async function resetQueue() {
        await clearQueue();
        syncRegistered = false;
    }

    // ---- Инициализация: слушаем сообщения от Service Worker ----
    if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data?.type === 'SYNC_TRIGGERED') {
                onSyncEvent();
            }
        });
        window.addEventListener('load', () => {
            debouncedProcessQueue();
        });
    }

    window.OfflineQueue = {
        queueMutation,
        processQueue,
        registerSync,
        resetQueue,
        getAllMutations,
        clearQueue,
        getStoredToken,
        saveToken
    };
})();