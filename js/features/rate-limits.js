// js/features/rate-limits.js – управление дневными лимитами и очередью отложенных действий
(function() {
    const LIMITS = {
        posts: 10,
        comments: 50,
        storageAdds: 30,
        cacheClears: 5,
        eyesReactions: 20
    };

    const STORAGE_KEY = 'rate_limits';
    const QUEUE_KEY = 'pending_actions';

    function getToday() {
        return new Date().toDateString();
    }

    function getCounts() {
        try {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (data && data.date === getToday()) {
                return data.counts;
            }
        } catch {}
        return { posts: 0, comments: 0, storageAdds: 0, cacheClears: 0, eyesReactions: 0 };
    }

    function saveCounts(counts) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            date: getToday(),
            counts: counts
        }));
    }

    function getRemaining(action) {
        const counts = getCounts();
        const limit = LIMITS[action];
        if (limit === undefined) return Infinity;
        return Math.max(0, limit - (counts[action] || 0));
    }

    function checkLimit(action) {
        return getRemaining(action) > 0;
    }

    function increment(action) {
        const counts = getCounts();
        if (counts[action] === undefined) counts[action] = 0;
        counts[action]++;
        saveCounts(counts);
        // После успешного инкремента пытаемся выполнить отложенные действия
        processPendingActions();
        updateIndicators();
    }

    // ---------- Очередь отложенных действий ----------
    function enqueueAction(action, data) {
        let queue = [];
        try {
            queue = JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
        } catch {}
        queue.push({ action, data, timestamp: Date.now() });
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        window.UIUtils?.showToast(`Действие "${action}" сохранено и будет выполнено позже`, 'info');
    }

    function getPendingActions() {
        try {
            return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
        } catch { return []; }
    }

    function clearPendingActions() {
        localStorage.removeItem(QUEUE_KEY);
    }

    // Попытка выполнить отложенные действия (вызывается после каждого успешного инкремента)
    async function processPendingActions() {
        const queue = getPendingActions();
        if (queue.length === 0) return;

        // Фильтруем действия, которые можно выполнить сейчас (по лимитам)
        const remaining = {};
        for (const action of Object.keys(LIMITS)) {
            remaining[action] = getRemaining(action);
        }

        const canExecute = queue.filter(item => remaining[item.action] > 0);
        if (canExecute.length === 0) return;

        // Выполняем первые доступные (по порядку)
        const toExecute = canExecute.slice(0, 1); // по одному за раз, чтобы не перегружать
        const executed = [];
        for (const item of toExecute) {
            try {
                await executeAction(item.action, item.data);
                increment(item.action);
                executed.push(item);
            } catch (err) {
                console.warn('Failed to execute pending action:', err);
                // Если ошибка не из-за лимита, оставляем в очереди
                if (err.message?.includes('limit')) {
                    // останется в очереди
                } else {
                    // удаляем, если ошибка критическая
                    executed.push(item);
                }
            }
        }

        // Удаляем выполненные из очереди
        const newQueue = queue.filter(item => !executed.includes(item));
        localStorage.setItem(QUEUE_KEY, JSON.stringify(newQueue));

        if (executed.length > 0) {
            window.UIUtils?.showToast(`Выполнено ${executed.length} отложенных действий`, 'success');
        }
    }

    // Исполнение конкретного действия (вызов соответствующих API)
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
                // Очистка кеша уже выполнена? (это действие не требует API)
                // Мы просто отмечаем, что очистка произошла
                break;
            case 'eyesReactions':
                await window.GithubAPI.addReaction(data.issueNumber, 'eyes');
                break;
            default:
                throw new Error('Unknown action');
        }
    }

    // ---------- Визуальные индикаторы ----------
    function updateIndicators() {
        document.querySelectorAll('.rate-indicator').forEach(el => {
            const action = el.dataset.action;
            const remaining = getRemaining(action);
            el.textContent = remaining;
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

    // Обновление индикаторов при загрузке
    document.addEventListener('DOMContentLoaded', updateIndicators);

    // Экспорт
    window.RateLimits = {
        checkLimit,
        increment,
        getRemaining,
        enqueueAction,
        processPendingActions,
        addIndicator,
        updateIndicators,
        LIMITS
    };
})();