// js/features/rate-limits.js – управление дневными лимитами, очередью, историей и визуализацией
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
    const HISTORY_KEY = 'action_history';

    // ---------- Счётчики ----------
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
        addHistory(action, 'completed');
        processPendingActions();
        updateIndicators();
        updateModalStats();
    }

    // ---------- История действий ----------
    function addHistory(action, status, detail = '') {
        let history = [];
        try {
            history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
        } catch {}
        history.push({
            action,
            status, // 'completed', 'pending', 'failed'
            detail,
            timestamp: Date.now(),
            date: new Date().toISOString()
        });
        // Ограничим историю 100 записями
        if (history.length > 100) history = history.slice(-100);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }

    function getHistory() {
        try {
            return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
        } catch { return []; }
    }

    function clearHistory() {
        localStorage.removeItem(HISTORY_KEY);
    }

    // ---------- Очередь ----------
    function enqueueAction(action, data) {
        let queue = [];
        try {
            queue = JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
        } catch {}
        queue.push({ action, data, timestamp: Date.now() });
        localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        addHistory(action, 'pending', JSON.stringify(data));
        window.UIUtils?.showToast(`Действие "${action}" сохранено и будет выполнено позже`, 'info');
        updateModalStats();
    }

    function getPendingActions() {
        try {
            return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
        } catch { return []; }
    }

    function clearPendingActions() {
        localStorage.removeItem(QUEUE_KEY);
    }

    async function processPendingActions() {
        const queue = getPendingActions();
        if (queue.length === 0) return;

        const remaining = {};
        for (const action of Object.keys(LIMITS)) {
            remaining[action] = getRemaining(action);
        }

        const canExecute = queue.filter(item => remaining[item.action] > 0);
        if (canExecute.length === 0) return;

        const toExecute = canExecute.slice(0, 1);
        const executed = [];
        for (const item of toExecute) {
            try {
                await executeAction(item.action, item.data);
                increment(item.action);
                // Удаляем из очереди после успеха
                const newQueue = queue.filter(q => q !== item);
                localStorage.setItem(QUEUE_KEY, JSON.stringify(newQueue));
                executed.push(item);
                addHistory(item.action, 'completed', 'Из очереди');
            } catch (err) {
                console.warn('Failed to execute pending action:', err);
                if (!err.message?.includes('limit')) {
                    // Удаляем, если ошибка не связана с лимитом
                    const newQueue = queue.filter(q => q !== item);
                    localStorage.setItem(QUEUE_KEY, JSON.stringify(newQueue));
                    addHistory(item.action, 'failed', err.message);
                }
            }
        }

        if (executed.length > 0) {
            window.UIUtils?.showToast(`Выполнено ${executed.length} отложенных действий`, 'success');
            updateModalStats();
        }
    }

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
                // Очистка кеша уже выполнена
                break;
            case 'eyesReactions':
                await window.GithubAPI.addReaction(data.issueNumber, 'eyes');
                break;
            default:
                throw new Error('Unknown action');
        }
    }

    // ---------- Таймер до полуночи ----------
    function getTimeUntilMidnight() {
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        return Math.max(0, midnight - now);
    }

    function formatTimeLeft(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    // ---------- Визуальные индикаторы ----------
    function updateIndicators() {
        document.querySelectorAll('.rate-indicator').forEach(el => {
            const action = el.dataset.action;
            const remaining = getRemaining(action);
            el.textContent = remaining;
        });
        // Таймер
        document.querySelectorAll('.rate-timer').forEach(el => {
            el.textContent = formatTimeLeft(getTimeUntilMidnight());
        });
    }

    // ---------- Модалка лимитов ----------
    let modalInstance = null;

    function openLimitsModal() {
        if (modalInstance) {
            modalInstance.closeModal();
            modalInstance = null;
        }

        const history = getHistory();
        const pending = getPendingActions();
        const counts = getCounts();

        let historyHtml = history.length === 0 ? '<p class="text-secondary">Нет записей</p>' :
            history.slice().reverse().slice(0, 30).map(h => {
                const statusColor = h.status === 'completed' ? '#4caf50' : h.status === 'pending' ? '#ff9800' : '#f44336';
                return `<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--border); font-size:13px;">
                    <span>${h.action}</span>
                    <span style="color:${statusColor};">${h.status}</span>
                    <span style="color:var(--text-secondary);">${new Date(h.timestamp).toLocaleTimeString()}</span>
                </div>`;
            }).join('');

        let pendingHtml = pending.length === 0 ? '<p class="text-secondary">Нет отложенных действий</p>' :
            pending.map(p => `<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--border); font-size:13px;">
                <span>${p.action}</span>
                <span style="color:#ff9800;">ожидает</span>
                <span style="color:var(--text-secondary);">${new Date(p.timestamp).toLocaleTimeString()}</span>
            </div>`).join('');

        const html = `
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:20px;">
                <div style="background:var(--bg-inner-gradient); border-radius:16px; padding:16px; border:1px solid var(--border);">
                    <h4 style="margin:0 0 12px; color:var(--accent);">📊 Лимиты</h4>
                    ${Object.keys(LIMITS).map(action => `
                        <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--border);">
                            <span>${action}</span>
                            <span><span class="rate-indicator" data-action="${action}">${getRemaining(action)}</span> / ${LIMITS[action]}</span>
                        </div>
                    `).join('')}
                    <div style="margin-top:12px; font-size:13px; color:var(--text-secondary);">
                        Обновление через: <span class="rate-timer">${formatTimeLeft(getTimeUntilMidnight())}</span>
                    </div>
                </div>
                <div style="background:var(--bg-inner-gradient); border-radius:16px; padding:16px; border:1px solid var(--border);">
                    <h4 style="margin:0 0 12px; color:var(--accent);">⏳ Очередь (${pending.length})</h4>
                    ${pendingHtml}
                </div>
            </div>
            <div style="background:var(--bg-inner-gradient); border-radius:16px; padding:16px; border:1px solid var(--border); margin-bottom:20px;">
                <h4 style="margin:0 0 12px; color:var(--accent);">📜 История (последние 30)</h4>
                ${historyHtml}
            </div>
            <div style="display:flex; gap:12px; justify-content:flex-end;">
                <button id="clear-cache-modal-btn" class="button" style="background:var(--bg-inner-gradient); border:1px solid var(--border);">Очистить кеш (без лимитов)</button>
                <button id="clear-history-btn" class="button" style="background:var(--bg-inner-gradient); border:1px solid var(--border);">Очистить историю</button>
                <button id="close-limits-modal" class="button" style="background:var(--accent);">Закрыть</button>
            </div>
        `;

        const { modal, closeModal } = window.UIUtils.createModal('Лимиты и кеш', html, { size: 'full' });
        modalInstance = { modal, closeModal };

        modal.querySelector('#clear-cache-modal-btn').addEventListener('click', () => {
            // Очищаем кеш, но сохраняем лимиты и очередь
            const keysToKeep = [STORAGE_KEY, QUEUE_KEY, HISTORY_KEY, 'github_token', 'preferredLanguage', 'license_agreed_v1', 'license_version', 'license_agreed_timestamp'];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && !keysToKeep.includes(key)) {
                    localStorage.removeItem(key);
                }
            }
            // Также очищаем sessionStorage (кроме важных ключей)
            const sessionKeysToKeep = ['github_user', 'github_scopes', 'i18n_ru', 'i18n_en'];
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key && !sessionKeysToKeep.includes(key)) {
                    sessionStorage.removeItem(key);
                }
            }
            window.UIUtils.showToast('Кеш очищен (лимиты и очередь сохранены)', 'success');
            closeModal();
            setTimeout(() => location.reload(), 1000);
        });

        modal.querySelector('#clear-history-btn').addEventListener('click', () => {
            clearHistory();
            window.UIUtils.showToast('История очищена', 'info');
            closeModal();
            openLimitsModal(); // переоткрыть с обновлённой историей
        });

        modal.querySelector('#close-limits-modal').addEventListener('click', closeModal);

        // Обновляем таймер каждые 10 секунд
        const timerInterval = setInterval(() => {
            const timerEl = modal.querySelector('.rate-timer');
            if (timerEl) timerEl.textContent = formatTimeLeft(getTimeUntilMidnight());
        }, 10000);

        // Очищаем интервал при закрытии
        const originalClose = closeModal;
        modalInstance.closeModal = () => {
            clearInterval(timerInterval);
            originalClose();
            modalInstance = null;
        };
    }

    function updateModalStats() {
        if (modalInstance) {
            // Обновляем содержимое модалки (можно переоткрыть)
            const modalEl = modalInstance.modal;
            if (modalEl && modalEl.querySelector('.modal-body')) {
                // Просто переоткрываем для простоты
                modalInstance.closeModal();
                openLimitsModal();
            }
        }
    }

    // ---------- Инициализация ----------
    document.addEventListener('DOMContentLoaded', () => {
        updateIndicators();
        // Периодическое обновление таймера (каждые 10 сек)
        setInterval(updateIndicators, 10000);
        // При загрузке пытаемся выполнить отложенные действия
        setTimeout(processPendingActions, 3000);
    });

    // Экспорт
    window.RateLimits = {
        checkLimit,
        increment,
        getRemaining,
        enqueueAction,
        processPendingActions,
        openLimitsModal,
        updateIndicators,
        getTimeUntilMidnight,
        formatTimeLeft,
        LIMITS,
        getHistory,
        clearHistory,
        getPendingActions
    };
})();