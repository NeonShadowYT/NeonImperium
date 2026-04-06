// notifications.js – система уведомлений о новых комментариях, постах, обновлениях и изменениях лицензии
(function() {
    const NOTIFICATION_KEY = 'neon_notifications_last_visit';
    const NOTIFICATION_DATA_KEY = 'neon_notifications_data';
    const CHECK_INTERVAL = 60 * 60 * 1000; // проверка раз в час (только если вкладка активна)
    
    let currentUser = null;
    let lastVisit = null;
    let notificationCount = 0;
    let notificationList = [];
    let bellButton = null;
    let dropdown = null;
    
    // Инициализация
    document.addEventListener('DOMContentLoaded', init);
    window.addEventListener('github-login-success', (e) => { currentUser = e.detail.login; checkAll(); });
    window.addEventListener('github-logout', () => { currentUser = null; clearNotifications(); });
    
    function init() {
        currentUser = GithubAuth.getCurrentUser();
        loadLastVisit();
        createNotificationBell();
        
        // Периодическая проверка
        setInterval(() => {
            if (document.visibilityState === 'visible') {
                checkAll();
            }
        }, CHECK_INTERVAL);
        
        // Проверка при возвращении на вкладку
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                checkAll();
            }
        });
        
        // Первая проверка
        setTimeout(checkAll, 2000);
    }
    
    function loadLastVisit() {
        const stored = localStorage.getItem(NOTIFICATION_KEY);
        if (stored) {
            lastVisit = new Date(parseInt(stored));
        } else {
            lastVisit = new Date(0); // если никогда не заходил
            updateLastVisit();
        }
    }
    
    function updateLastVisit() {
        lastVisit = new Date();
        localStorage.setItem(NOTIFICATION_KEY, lastVisit.getTime().toString());
        // Очищаем список уведомлений после просмотра
        notificationList = [];
        notificationCount = 0;
        updateBellBadge();
        saveNotificationData();
    }
    
    function saveNotificationData() {
        const data = {
            count: notificationCount,
            list: notificationList,
            lastUpdate: Date.now()
        };
        localStorage.setItem(NOTIFICATION_DATA_KEY, JSON.stringify(data));
    }
    
    function loadNotificationData() {
        const stored = localStorage.getItem(NOTIFICATION_DATA_KEY);
        if (stored) {
            try {
                const data = JSON.parse(stored);
                notificationCount = data.count || 0;
                notificationList = data.list || [];
                updateBellBadge();
            } catch(e) {}
        }
    }
    
    function clearNotifications() {
        notificationCount = 0;
        notificationList = [];
        updateBellBadge();
        saveNotificationData();
    }
    
    function createNotificationBell() {
        // Ищем место для кнопки – справа от профиля
        const navBar = document.querySelector('.nav-bar');
        if (!navBar) return;
        
        const langSwitcher = document.querySelector('.lang-switcher');
        const profile = document.querySelector('.nav-profile');
        
        bellButton = document.createElement('div');
        bellButton.className = 'notification-bell';
        bellButton.setAttribute('role', 'button');
        bellButton.setAttribute('tabindex', '0');
        bellButton.setAttribute('aria-label', 'Уведомления');
        bellButton.innerHTML = '<i class="fas fa-bell"></i><span class="notification-badge" style="display: none;">0</span>';
        
        // Вставляем перед профилем или после языкового переключателя
        if (profile) {
            navBar.insertBefore(bellButton, profile);
        } else if (langSwitcher) {
            navBar.insertBefore(bellButton, langSwitcher);
        } else {
            navBar.appendChild(bellButton);
        }
        
        // Выпадающий список уведомлений
        dropdown = document.createElement('div');
        dropdown.className = 'notification-dropdown';
        dropdown.style.cssText = `
            position: absolute;
            top: 100%;
            right: 0;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            width: 320px;
            max-height: 400px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
            box-shadow: var(--shadow);
        `;
        bellButton.appendChild(dropdown);
        
        bellButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
            if (!isVisible) {
                renderDropdown();
                // Отмечаем уведомления как просмотренные только при открытии?
                // По желанию: можно сбросить счётчик при открытии
                // Но по заданию – при следующем заходе. Оставляем счётчик до обновления страницы.
            }
        });
        
        document.addEventListener('click', (e) => {
            if (!bellButton.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
        
        loadNotificationData();
    }
    
    function updateBellBadge() {
        if (!bellButton) return;
        const badge = bellButton.querySelector('.notification-badge');
        if (notificationCount > 0) {
            badge.textContent = notificationCount > 99 ? '99+' : notificationCount;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }
    
    function renderDropdown() {
        if (!dropdown) return;
        if (notificationList.length === 0) {
            dropdown.innerHTML = '<div class="notification-item">Нет новых уведомлений</div>';
            return;
        }
        dropdown.innerHTML = '';
        notificationList.slice(0, 20).forEach(notif => {
            const item = document.createElement('div');
            item.className = 'notification-item';
            item.innerHTML = `
                <div class="notification-icon">${notif.icon}</div>
                <div class="notification-content">
                    <div class="notification-title">${GithubCore.escapeHtml(notif.title)}</div>
                    <div class="notification-text">${GithubCore.escapeHtml(notif.text)}</div>
                    <div class="notification-time">${notif.timeAgo}</div>
                </div>
            `;
            if (notif.link) {
                item.style.cursor = 'pointer';
                item.addEventListener('click', () => {
                    window.location.href = notif.link;
                });
            }
            dropdown.appendChild(item);
        });
        if (notificationList.length > 20) {
            const more = document.createElement('div');
            more.className = 'notification-item more';
            more.textContent = `+ ещё ${notificationList.length - 20} уведомлений`;
            dropdown.appendChild(more);
        }
    }
    
    function addNotification(type, title, text, link = null) {
        const iconMap = {
            'comment': '💬',
            'post': '📰',
            'update': '🔄',
            'license': '📜',
            'support': '🛟'
        };
        const icon = iconMap[type] || '🔔';
        const timeAgo = 'только что';
        notificationList.unshift({
            type,
            icon,
            title,
            text,
            link,
            timeAgo,
            timestamp: Date.now()
        });
        notificationCount++;
        updateBellBadge();
        saveNotificationData();
        // Показываем тост
        UIUtils.showToast(`${title}: ${text.substring(0, 60)}`, 'info', 5000);
    }
    
    // ========== ПРОВЕРКИ ==========
    
    async function checkAll() {
        if (!currentUser) return;
        await checkFeedbackIssues();
        await checkGameUpdates();
        await checkNewsPosts();
        await checkLicenseChange();
        updateLastVisit(); // после проверки обновляем время последнего визита
    }
    
    async function checkFeedbackIssues() {
        // Загружаем все issues для игр (можно ограничить)
        const games = ['starve-neon', 'alpha-01', 'gc-adven'];
        for (const game of games) {
            try {
                const issues = await GithubAPI.loadIssues({ labels: `game:${game}`, state: 'open', per_page: 50 });
                for (const issue of issues) {
                    const issueDate = new Date(issue.created_at);
                    if (issueDate > lastVisit) {
                        const typeLabel = issue.labels.find(l => l.name.startsWith('type:'))?.name.split(':')[1] || 'feedback';
                        const title = `[${game}] ${issue.title}`;
                        const text = `Новое сообщение от ${issue.user.login}`;
                        const link = `${window.location.origin}${window.location.pathname}?post=${issue.number}`;
                        addNotification('post', title, text, link);
                    }
                    // Проверяем комментарии
                    const comments = await GithubAPI.loadComments(issue.number);
                    for (const comment of comments) {
                        const commentDate = new Date(comment.created_at);
                        if (commentDate > lastVisit && comment.user.login !== currentUser) {
                            const title = `Ответ в "${issue.title}"`;
                            const text = `${comment.user.login}: ${comment.body.substring(0, 60)}`;
                            const link = `${window.location.origin}${window.location.pathname}?post=${issue.number}`;
                            addNotification('comment', title, text, link);
                        }
                    }
                }
            } catch(e) { console.warn('Ошибка загрузки feedback', game, e); }
        }
    }
    
    async function checkGameUpdates() {
        const games = ['starve-neon', 'alpha-01', 'gc-adven'];
        for (const game of games) {
            try {
                const issues = await GithubAPI.loadIssues({ labels: `type:update,game:${game}`, state: 'open', per_page: 30 });
                for (const issue of issues) {
                    const issueDate = new Date(issue.created_at);
                    if (issueDate > lastVisit) {
                        const title = `Обновление игры ${game}`;
                        const text = issue.title;
                        const link = `${window.location.origin}/${game}.html?post=${issue.number}`;
                        addNotification('update', title, text, link);
                    }
                }
            } catch(e) { console.warn('Ошибка загрузки обновлений', game, e); }
        }
    }
    
    async function checkNewsPosts() {
        try {
            const issues = await GithubAPI.loadIssues({ labels: 'type:news', state: 'open', per_page: 30 });
            for (const issue of issues) {
                const issueDate = new Date(issue.created_at);
                if (issueDate > lastVisit) {
                    const title = `Новость`;
                    const text = issue.title;
                    const link = `${window.location.origin}/index.html?post=${issue.number}`;
                    addNotification('post', title, text, link);
                }
            }
        } catch(e) { console.warn('Ошибка загрузки новостей', e); }
    }
    
    async function checkLicenseChange() {
        // Проверяем дату последнего обновления лицензии
        // Можно получить из HTML мета-тега или из GitHub
        try {
            const licenseUrl = `${window.location.origin}/license.html`;
            const response = await fetch(licenseUrl);
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const lastUpdateElem = doc.querySelector('.last-update');
            if (lastUpdateElem) {
                const text = lastUpdateElem.textContent;
                const match = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
                if (match) {
                    let date = new Date(match[3], getMonthNumber(match[2]), match[1]);
                    if (date > lastVisit) {
                        addNotification('license', 'Лицензионное соглашение', 'Обновлена лицензия. Пожалуйста, ознакомьтесь.', '/license.html');
                    }
                }
            }
        } catch(e) { console.warn('Ошибка проверки лицензии', e); }
    }
    
    function getMonthNumber(monthName) {
        const months = {
            'января': 0, 'февраля': 1, 'марта': 2, 'апреля': 3, 'мая': 4, 'июня': 5,
            'июля': 6, 'августа': 7, 'сентября': 8, 'октября': 9, 'ноября': 10, 'декабря': 11
        };
        return months[monthName.toLowerCase()] || 0;
    }
})();