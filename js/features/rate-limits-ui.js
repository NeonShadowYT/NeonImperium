// js/features/rate-limits-ui.js – стильный интерфейс для управления лимитами и кешем
(function() {
    const { createElement, escapeHtml, formatDate, loadModule } = window.Utils;

    // Создаём модальное окно со всей информацией
    async function openLimitsDashboard() {
        if (!window.RateLimits) await loadModule('js/features/rate-limits.js');

        const limits = window.RateLimits.LIMITS;
        const counts = window.RateLimits.getCounts();
        const remaining = {};
        for (const [action, limit] of Object.entries(limits)) {
            remaining[action] = Math.max(0, limit - (counts[action] || 0));
        }

        // Информация о кеше
        const cacheInfo = getCacheInfo();

        // Очередь действий
        const queue = window.RateLimits.getPendingActions();

        // Общее состояние
        const now = new Date();
        const resetTime = new Date(now);
        resetTime.setHours(24, 0, 0, 0); // полночь

        const html = `
            <div class="limits-dashboard">
                <div class="limits-header">
                    <h2><i class="fas fa-chart-pie"></i> Лимиты и кеш</h2>
                    <p class="text-secondary">Управление действиями и локальным хранилищем</p>
                </div>

                <div class="limits-grid">
                    ${Object.entries(limits).map(([action, limit]) => `
                        <div class="limit-card">
                            <div class="limit-label">${getActionLabel(action)}</div>
                            <div class="limit-bar">
                                <div class="limit-fill" style="width: ${(counts[action] || 0) / limit * 100}%;"></div>
                            </div>
                            <div class="limit-values">
                                <span>${counts[action] || 0} / ${limit}</span>
                                <span class="limit-remaining">Осталось: ${remaining[action]}</span>
                            </div>
                            <div class="limit-reset">Сброс: ${resetTime.toLocaleTimeString()}</div>
                        </div>
                    `).join('')}
                </div>

                <div class="cache-section">
                    <h3><i class="fas fa-database"></i> Состояние кеша</h3>
                    <div class="cache-grid">
                        <div class="cache-item">
                            <span>Кеш-память (sessionStorage):</span>
                            <span>${cacheInfo.sessionSize} KB</span>
                        </div>
                        <div class="cache-item">
                            <span>Локальное хранилище (localStorage):</span>
                            <span>${cacheInfo.localSize} KB</span>
                        </div>
                        <div class="cache-item">
                            <span>Количество кешированных ключей:</span>
                            <span>${cacheInfo.totalKeys}</span>
                        </div>
                        <div class="cache-item">
                            <span>Устаревших записей:</span>
                            <span>${cacheInfo.staleCount}</span>
                        </div>
                    </div>
                    <div class="cache-actions">
                        <button class="button small" id="clear-stale-cache"><i class="fas fa-broom"></i> Очистить устаревший кеш</button>
                        <button class="button small" id="clear-all-cache"><i class="fas fa-trash-alt"></i> Очистить весь кеш (без лимитов)</button>
                    </div>
                </div>

                <div class="queue-section">
                    <h3><i class="fas fa-clock"></i> Очередь действий (${queue.length})</h3>
                    ${queue.length === 0 ? '<p class="text-secondary">Нет ожидающих действий</p>' : `
                        <div class="queue-list">
                            ${queue.map((item, idx) => `
                                <div class="queue-item">
                                    <span class="queue-action">${getActionLabel(item.action)}</span>
                                    <span class="queue-time">${new Date(item.timestamp).toLocaleString()}</span>
                                </div>
                            `).join('')}
                        </div>
                    `}
                </div>

                <div class="limits-info">
                    <p><i class="fas fa-info-circle"></i> Лимиты введены для защиты вашего аккаунта от автоматической блокировки GitHub. Все действия локально кешируются и синхронизируются при восстановлении лимитов.</p>
                </div>
            </div>
        `;

        const { modal, closeModal } = window.UIUtils.createModal('Управление лимитами', html, { size: 'full' });

        // Добавляем стили
        const style = document.createElement('style');
        style.textContent = `
            .limits-dashboard { display: flex; flex-direction: column; gap: 24px; }
            .limits-header { text-align: center; }
            .limits-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
            .limit-card { background: var(--bg-inner-gradient); border-radius: 16px; padding: 16px; border: 1px solid var(--border); }
            .limit-label { font-weight: bold; margin-bottom: 8px; }
            .limit-bar { height: 8px; background: var(--bg-primary); border-radius: 10px; overflow: hidden; margin: 8px 0; }
            .limit-fill { height: 100%; background: var(--accent); border-radius: 10px; transition: width 0.3s; }
            .limit-values { display: flex; justify-content: space-between; font-size: 13px; color: var(--text-secondary); }
            .limit-remaining { color: var(--accent); }
            .limit-reset { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }
            .cache-section, .queue-section { background: var(--bg-inner-gradient); border-radius: 16px; padding: 16px; border: 1px solid var(--border); }
            .cache-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0; }
            .cache-item { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--border); }
            .cache-actions { display: flex; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
            .queue-list { max-height: 200px; overflow-y: auto; }
            .queue-item { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 14px; }
            .queue-action { font-weight: bold; color: var(--accent); }
            .queue-time { color: var(--text-secondary); font-size: 12px; }
            .limits-info { background: rgba(61,158,179,0.1); border-radius: 12px; padding: 12px; border-left: 4px solid var(--accent); font-size: 14px; }
        `;
        modal.appendChild(style);

        // Обработчики кнопок
        modal.querySelector('#clear-stale-cache').addEventListener('click', () => {
            clearStaleCache();
            showToast('Устаревший кеш очищен', 'success');
            closeModal();
        });

        modal.querySelector('#clear-all-cache').addEventListener('click', () => {
            if (confirm('Очистить весь кеш (кроме лимитов)?')) {
                clearAllCache();
                showToast('Весь кеш очищен', 'success');
                closeModal();
            }
        });

        return { modal, closeModal };
    }

    // Вспомогательные функции
    function getActionLabel(action) {
        const map = {
            'posts': '📝 Посты',
            'comments': '💬 Комментарии',
            'storageAdds': '📁 Добавления в хранилище',
            'cacheClears': '🧹 Очистка кеша',
            'eyesReactions': '👀 Реакции "глаза"'
        };
        return map[action] || action;
    }

    function getCacheInfo() {
        let sessionSize = 0, localSize = 0, totalKeys = 0, staleCount = 0;
        const now = Date.now();

        // sessionStorage
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (!key) continue;
            const val = sessionStorage.getItem(key);
            sessionSize += (key.length + (val ? val.length : 0)) * 2; // приблизительно в байтах
            totalKeys++;
            // Проверяем на устаревание (ключи с _time)
            if (key.endsWith('_time')) {
                const time = parseInt(val, 10);
                if (!isNaN(time) && now - time > window.GithubCore?.CONFIG?.CACHE_TTL || 600000) {
                    staleCount++;
                }
            }
        }

        // localStorage
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            const val = localStorage.getItem(key);
            localSize += (key.length + (val ? val.length : 0)) * 2;
            if (!key.startsWith('rate_limits') && !key.startsWith('pending_actions') && !key.startsWith('license_')) {
                totalKeys++;
                if (key.endsWith('_time')) {
                    const time = parseInt(val, 10);
                    if (!isNaN(time) && now - time > window.GithubCore?.CONFIG?.CACHE_TTL || 600000) {
                        staleCount++;
                    }
                }
            }
        }

        return {
            sessionSize: Math.round(sessionSize / 1024),
            localSize: Math.round(localSize / 1024),
            totalKeys,
            staleCount
        };
    }

    function clearStaleCache() {
        const now = Date.now();
        const ttl = window.GithubCore?.CONFIG?.CACHE_TTL || 600000;

        // sessionStorage
        const toRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.endsWith('_time')) {
                const time = parseInt(sessionStorage.getItem(key), 10);
                if (!isNaN(time) && now - time > ttl) {
                    toRemove.push(key.replace('_time', ''));
                }
            }
        }
        toRemove.forEach(key => {
            sessionStorage.removeItem(key);
            sessionStorage.removeItem(key + '_time');
        });

        // localStorage (исключаем лимиты и лицензию)
        const toRemoveLocal = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.endsWith('_time') && !key.startsWith('rate_limits') && !key.startsWith('pending_actions') && !key.startsWith('license_')) {
                const time = parseInt(localStorage.getItem(key), 10);
                if (!isNaN(time) && now - time > ttl) {
                    toRemoveLocal.push(key.replace('_time', ''));
                }
            }
        }
        toRemoveLocal.forEach(key => {
            localStorage.removeItem(key);
            localStorage.removeItem(key + '_time');
        });
    }

    function clearAllCache() {
        // Сохраняем только лимиты и лицензию
        const exceptions = ['rate_limits', 'pending_actions', 'license_agreed_v1', 'license_version', 'license_agreed_timestamp', 'preferredLanguage', 'github_token', 'last_cache_clear'];
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && !exceptions.some(ex => key.startsWith(ex))) {
                localStorage.removeItem(key);
            }
        }
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key && !exceptions.some(ex => key.startsWith(ex))) {
                sessionStorage.removeItem(key);
            }
        }
    }

    // Добавляем пункт в меню профиля
    function addLimitsMenuItem() {
        const dropdown = document.querySelector('.profile-dropdown');
        if (!dropdown) return;
        // Ищем разделитель
        const divider = dropdown.querySelector('.profile-dropdown-divider');
        if (!divider) return;
        const item = document.createElement('div');
        item.className = 'profile-dropdown-item';
        item.dataset.action = 'limits';
        item.innerHTML = '<i class="fas fa-chart-pie"></i> Лимиты и кеш';
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            openLimitsDashboard();
            const profile = document.querySelector('.nav-profile');
            if (profile) profile.classList.remove('active');
        });
        dropdown.insertBefore(item, divider);
    }

    // Инициализация
    document.addEventListener('DOMContentLoaded', () => {
        // Добавляем пункт в профиль после загрузки
        const observer = new MutationObserver(() => {
            if (document.querySelector('.profile-dropdown')) {
                addLimitsMenuItem();
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        // Также пробуем сразу
        setTimeout(addLimitsMenuItem, 500);
    });

    // Экспортируем
    window.LimitsUI = {
        openLimitsDashboard,
        getCacheInfo,
        clearStaleCache,
        clearAllCache
    };
})();