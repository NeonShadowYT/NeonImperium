// notifications.js – уведомления (колокольчик)
(function() {
    const NOTIFICATION_KEY = 'neon_notifications_last_visit';
    const NOTIFICATION_DATA_KEY = 'neon_notifications_data';
    const CHECK_INTERVAL = 60 * 60 * 1000;
    let currentUser = null;
    let lastVisit = null;
    let notificationCount = 0;
    let notificationList = [];
    let bellButton = null;
    let dropdown = null;

    document.addEventListener('DOMContentLoaded', init);
    window.addEventListener('github-login-success', (e) => { currentUser = e.detail.login; checkAll(); });
    window.addEventListener('github-logout', () => { currentUser = null; clearNotifications(); });

    function init() {
        currentUser = GithubAuth.getCurrentUser();
        loadLastVisit();
        createNotificationBell();
        setInterval(() => { if (document.visibilityState === 'visible') checkAll(); }, CHECK_INTERVAL);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkAll(); });
        setTimeout(checkAll, 2000);
    }

    function loadLastVisit() {
        const stored = localStorage.getItem(NOTIFICATION_KEY);
        lastVisit = stored ? new Date(parseInt(stored)) : new Date(0);
        if (!stored) updateLastVisit();
    }
    function updateLastVisit() { lastVisit = new Date(); localStorage.setItem(NOTIFICATION_KEY, lastVisit.getTime().toString()); notificationList = []; notificationCount = 0; updateBellBadge(); saveNotificationData(); }
    function saveNotificationData() { localStorage.setItem(NOTIFICATION_DATA_KEY, JSON.stringify({ count: notificationCount, list: notificationList, lastUpdate: Date.now() })); }
    function loadNotificationData() {
        const stored = localStorage.getItem(NOTIFICATION_DATA_KEY);
        if (stored) { try { const data = JSON.parse(stored); notificationCount = data.count || 0; notificationList = data.list || []; updateBellBadge(); } catch(e) {} }
    }
    function clearNotifications() { notificationCount = 0; notificationList = []; updateBellBadge(); saveNotificationData(); }

    function createNotificationBell() {
        const navBar = document.querySelector('.nav-bar');
        if (!navBar) return;
        const profile = document.querySelector('.nav-profile');
        bellButton = document.createElement('div');
        bellButton.className = 'notification-bell';
        bellButton.setAttribute('role', 'button');
        bellButton.setAttribute('tabindex', '0');
        bellButton.setAttribute('aria-label', 'Уведомления');
        bellButton.innerHTML = '<i class="fas fa-bell"></i><span class="notification-badge" style="display: none;">0</span>';
        // Исправлено: вставляем перед профилем, если профиль есть, иначе добавляем в конец
        if (profile && profile.parentNode === navBar) {
            navBar.insertBefore(bellButton, profile);
        } else {
            navBar.appendChild(bellButton);
        }
        dropdown = document.createElement('div');
        dropdown.className = 'notification-dropdown';
        bellButton.appendChild(dropdown);
        bellButton.addEventListener('click', (e) => { e.stopPropagation(); const isVisible = dropdown.style.display === 'block'; dropdown.style.display = isVisible ? 'none' : 'block'; if (!isVisible) renderDropdown(); });
        document.addEventListener('click', (e) => { if (!bellButton.contains(e.target)) dropdown.style.display = 'none'; });
        loadNotificationData();
    }

    function updateBellBadge() {
        if (!bellButton) return;
        const badge = bellButton.querySelector('.notification-badge');
        if (notificationCount > 0) {
            badge.textContent = notificationCount > 99 ? '99+' : notificationCount;
            badge.style.display = 'inline-flex';
        } else badge.style.display = 'none';
    }

    function renderDropdown() {
        if (!dropdown) return;
        if (notificationList.length === 0) { dropdown.innerHTML = '<div class="notification-item">Нет новых уведомлений</div>'; return; }
        dropdown.innerHTML = '';
        notificationList.slice(0, 20).forEach(notif => {
            const item = document.createElement('div');
            item.className = 'notification-item';
            item.innerHTML = `<div class="notification-icon">${notif.icon}</div><div class="notification-content"><div class="notification-title">${GithubCore.escapeHtml(notif.title)}</div><div class="notification-text">${GithubCore.escapeHtml(notif.text)}</div><div class="notification-time">${notif.timeAgo}</div></div>`;
            if (notif.link) { item.style.cursor = 'pointer'; item.addEventListener('click', () => { window.location.href = notif.link; }); }
            dropdown.appendChild(item);
        });
        if (notificationList.length > 20) { const more = document.createElement('div'); more.className = 'notification-item more'; more.textContent = `+ ещё ${notificationList.length - 20} уведомлений`; dropdown.appendChild(more); }
    }

    function addNotification(type, title, text, link = null) {
        const iconMap = { 'comment': '💬', 'post': '📰', 'update': '🔄', 'license': '📜', 'support': '🛟' };
        const icon = iconMap[type] || '🔔';
        notificationList.unshift({ type, icon, title, text, link, timeAgo: 'только что', timestamp: Date.now() });
        notificationCount++;
        updateBellBadge();
        saveNotificationData();
        UIUtils.showToast(`${title}: ${text.substring(0, 60)}`, 'info', 5000);
    }

    async function checkAll() {
        if (!currentUser) return;
        await checkFeedbackIssues();
        await checkGameUpdates();
        await checkNewsPosts();
        await checkLicenseChange();
        updateLastVisit();
    }

    async function checkFeedbackIssues() {
        const games = ['starve-neon', 'alpha-01', 'gc-adven'];
        for (const game of games) {
            try {
                const issues = await GithubAPI.loadIssues({ labels: `game:${game}`, state: 'open', per_page: 50 });
                for (const issue of issues) {
                    if (new Date(issue.created_at) > lastVisit) {
                        addNotification('post', `[${game}] ${issue.title}`, `Новое сообщение от ${issue.user.login}`, `${window.location.origin}${window.location.pathname}?post=${issue.number}`);
                    }
                    const comments = await GithubAPI.loadComments(issue.number);
                    for (const comment of comments) {
                        if (new Date(comment.created_at) > lastVisit && comment.user.login !== currentUser) {
                            addNotification('comment', `Ответ в "${issue.title}"`, `${comment.user.login}: ${comment.body.substring(0, 60)}`, `${window.location.origin}${window.location.pathname}?post=${issue.number}`);
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
                    if (new Date(issue.created_at) > lastVisit) {
                        addNotification('update', `Обновление игры ${game}`, issue.title, `${window.location.origin}/${game}.html?post=${issue.number}`);
                    }
                }
            } catch(e) { console.warn('Ошибка загрузки обновлений', game, e); }
        }
    }

    async function checkNewsPosts() {
        try {
            const issues = await GithubAPI.loadIssues({ labels: 'type:news', state: 'open', per_page: 30 });
            for (const issue of issues) {
                if (new Date(issue.created_at) > lastVisit) {
                    addNotification('post', `Новость`, issue.title, `${window.location.origin}/index.html?post=${issue.number}`);
                }
            }
        } catch(e) { console.warn('Ошибка загрузки новостей', e); }
    }

    async function checkLicenseChange() {
        const licenseUrl = `${window.location.origin}/NeonImperium/license.html`;
        try {
            const response = await fetch(licenseUrl);
            if (!response.ok) return;
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const lastUpdateElem = doc.querySelector('.last-update');
            if (lastUpdateElem) {
                const text = lastUpdateElem.textContent;
                const match = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
                if (match) {
                    const months = { 'января':0, 'февраля':1, 'марта':2, 'апреля':3, 'мая':4, 'июня':5, 'июля':6, 'августа':7, 'сентября':8, 'октября':9, 'ноября':10, 'декабря':11 };
                    const date = new Date(match[3], months[match[2].toLowerCase()], match[1]);
                    if (date > lastVisit) addNotification('license', 'Лицензионное соглашение', 'Обновлена лицензия. Пожалуйста, ознакомьтесь.', '/NeonImperium/license.html');
                }
            }
        } catch(e) { console.warn('Ошибка проверки лицензии', e); }
    }
})();