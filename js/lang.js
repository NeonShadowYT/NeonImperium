// lang.js – переводы и переключатель языка
const translations = {
    ru: {
        // Navigation
        navHome: "Neon Imperium",
        navStarve: "Starve Neon",
        navAlpha: "Alpha 01",
        navGc: "ГК Адвенчур",
        // Home
        siteTitle: "Neon Imperium",
        mainProjectsTitle: "Главные проекты",
        mainProjectsDesc: "Игры с приоритетом разработки",
        starveDesc: "Выживание в брутальном мире с прокачкой и генетикой.",
        alphaDesc: "Top-down шутер, где вы робот, помогающий солдатам.",
        gcDesc: "Просто приключение ГКТМО.",
        detailsBtn: "Подробнее",
        smallProjectsTitle: "Небольшие проекты",
        smallProjectsDesc: "Игры созданные по рофлу",
        comingSoon: "Скоро",
        developersTitle: "Разработчики",
        developersDesc: "Работаем в свободное время",
        youtubersTitle: "Ютуберы",
        youtubersDesc: "Собираем комьюнити",
        newsTitle: "📰 Последние новости",
        newsDesc: "Свежие видео и обновления",
        newsLoading: "Загрузка новостей...",
        // Game pages common
        trailerTitle: "Трейлер",
        developerTitle: "Разработчик",
        downloadTitle: "Скачать",
        descriptionTitle: "Описание",
        videoTitle: "Видео",
        videoDesc: "Подборка контента от сообщества",
        updatesTitle: "Обновления",
        downloadBtn: "Скачать",
        feedbackTitle: "Идеи, баги и отзывы",
        feedbackDesc: "Делитесь мыслями, сообщайте об ошибках или предлагайте улучшения.",
        feedbackNewBtn: "Оставить сообщение",
        feedbackLoading: "Загрузка обратной связи...",
        feedbackLoginPrompt: "Войдите через GitHub, чтобы участвовать",
        feedbackLoginBtn: "Войти",
        feedbackTokenNote: "Ваш токен останется только у вас в браузере.",
        feedbackCancel: "Отмена",
        feedbackTabAll: "Все",
        feedbackTabIdea: "💡 Идеи",
        feedbackTabBug: "🐛 Баги",
        feedbackTabReview: "⭐ Отзывы",
        feedbackLoadError: "Ошибка загрузки.",
        feedbackRetry: "Повторить",
        // GitHub auth
        githubLoginTitle: "Вход через GitHub",
        githubSecure: "Безопасно и прозрачно:",
        githubTokenNote: "токен хранится в вашем браузере и передаётся только в GitHub API.",
        githubHowTo: "Как получить токен (простой способ):",
        githubStep1: "Перейдите в ",
        githubStep2: "Нажмите \"Generate new token (classic)\".",
        githubStep3: "Дайте имя, выберите срок (например, 30 дней).",
        githubStep4: "В разделе \"Select scopes\" отметьте только ",
        githubStep5: "Скопируйте токен и вставьте сюда.",
        githubWarning: "Classic токен даёт доступ ко всем вашим репозиториям. Это нормально для участия в обсуждениях.",
        githubLoginBtn: "Войти",
        githubAuthError: "Ошибка авторизации. Проверьте токен или попробуйте снова.",
        githubProfile: "Профиль",
        githubTokenActive: "Токен активен",
        githubLogout: "Выйти",
        githubLoginVia: "Войти через GitHub",
        githubWhy: "Зачем это нужно?",
        githubClearCache: "Очистить кеш",
        githubRevoke: "Управление токенами",
        githubTokenMissing: "Введите токен доступа",
        githubTimeout: "Превышено время ожидания. Проверьте соединение.",
        githubForbidden: "Доступ запрещён (403). Проверьте права токена.",
        githubNotFound: "Репозиторий не найден (404).",
        githubServerError: "Ошибка сервера GitHub",
        githubNetworkError: "Ошибка сети. Проверьте подключение.",
        supportMenuItem: "Поддержка",
        supportTitle: "Поддержка",
        supportNewBtn: "Новое обращение",
        donateButton: "Поддержать",
        licenseAccept: "Скачивая игру, вы принимаете ",
        licenseLink: "лицензионное соглашение",
        // Starve Neon specific
        starveVersion: "Объединение 0.14.0",
        starveDownloadNote: "Версия 0.14.0 · Обновление от 08.03.2026",
        worldTitle: "Игровой мир",
        worldDesc: "БРУТАЛЬНЫЙ ХАРДКОРНЫЙ МИР...",
        statusTitle: "Статус",
        statusDesc: "Starve Neon находится на ранней стадии разработки...",
        developmentTitle: "Развитие",
        developmentDesc: "Полная система развития от копий и мечей до ГРЕБАНОГО МИНИГАНА...",
        alliesTitle: "Союзники",
        alliesDesc: "Создавай союзы с фракциями и другими игроками...",
        featuresTitle: "Особенности",
        feature1: "Интернет необязателен.",
        feature2: "Частые крупные обновления.",
        feature3: "Встроенная поддержка модов.",
        feature4: "Прямое общение с разработчиком.",
        feature5: "Многоязычная поддержка...",
        requirementsTitle: "Системные требования",
        requirementsNote: "Примерные значения...",
        fps60: "60+ Фпс",
        cpu60: "Процессор: Xeon-E2650 v2 3.00 GHz",
        gpu60: "Видеокарта: GT 730 4GB",
        fps180: "180+ Фпс",
        cpu180: "Процессор: AMD Athlon X4 840 3.10 GHz",
        gpu180: "Видеокарта: GT 1030 2GB",
        fps1000: "1000+ Фпс",
        cpu1000: "Процессор: AMD Ryzen 7 7435HS 4.00 GHz",
        gpu1000: "Видеокарта: RTX 3050 4GB Laptop",
        consumptionTitle: "Потребление",
        consumptionNote: "Примерные значения",
        vram: "Видеопамять",
        vramVal: "512-1024 Мб",
        ram: "Оперативка",
        ramVal: "512-1024 Мб",
        storage: "Память",
        storageVal: "256 Мб",
        os: "Система",
        osVal: "Win 10+ 32 Бит / Андроид 7+",
        // Alpha 01 specific
        alphaVersion: "Патч 0.0.5.2",
        alphaDownloadNote: "Версия 0.0.5.2 · Обновление от 21.01.2024",
        alphaStoryTitle: "Сюжет",
        alphaStoryDesc: "Alpha 01 - это topdown шутер...",
        alphaStatusTitle: "Статус",
        alphaStatusDesc: "Игра находится в активной разработке. Текущая версия: 0.0.5.2",
        // GC Adven specific
        gcVersion: "Обновление 0.1.0",
        gcDownloadNote: "Версия 0.1.0 · Обновление от 01.11.2023",
        gcAboutTitle: "Об игре",
        gcDescription: "Welcome to the ebanat zone: Gc adventure!!",
        // License page
        licenseTitle: "Лицензионное соглашение",
        licenseLastUpdate: "Последнее обновление: 9 апреля 2026 г.",
        licenseAllowedTitle: "Разрешено",
        licenseAllowed1: "Распространение игры где угодно...",
        licenseForbiddenTitle: "Запрещено",
        licenseForbidden1: "Выдавать имена, товарные знаки, логотипы за свои",
        licenseObligationTitle: "Обязанности",
        licenseObligation1: "Сохранять первоначальные авторские права",
        allRightsReserved: "Все права защищены.",
        licenseBack: "← Вернуться к игре",
        // 404
        notFoundTitle: "404 — Страница не найдена",
        notFoundDesc: "Запрашиваемая страница не существует или была перемещена.",
        backHome: "Вернуться на главную"
    },
    en: {
        navHome: "Neon Imperium",
        navStarve: "Starve Neon",
        navAlpha: "Alpha 01",
        navGc: "GC Adven",
        siteTitle: "Neon Imperium",
        mainProjectsTitle: "Main Projects",
        mainProjectsDesc: "Priority development games",
        starveDesc: "Survival in a brutal world with progression and genetics.",
        alphaDesc: "Top-down shooter where you are a robot helping soldiers.",
        gcDesc: "Just a GC adventure.",
        detailsBtn: "Details",
        smallProjectsTitle: "Small Projects",
        smallProjectsDesc: "Games made for fun",
        comingSoon: "Coming soon",
        developersTitle: "Developers",
        developersDesc: "Working in free time",
        youtubersTitle: "YouTubers",
        youtubersDesc: "Building community",
        newsTitle: "📰 Latest News",
        newsDesc: "Fresh videos and updates",
        newsLoading: "Loading news...",
        trailerTitle: "Trailer",
        developerTitle: "Developer",
        downloadTitle: "Download",
        descriptionTitle: "Description",
        videoTitle: "Video",
        videoDesc: "Community content",
        updatesTitle: "Updates",
        downloadBtn: "Download",
        feedbackTitle: "Ideas, bugs & feedback",
        feedbackDesc: "Share your thoughts, report bugs, or suggest improvements.",
        feedbackNewBtn: "Leave a message",
        feedbackLoading: "Loading feedback...",
        feedbackLoginPrompt: "Sign in with GitHub to participate",
        feedbackLoginBtn: "Sign in",
        feedbackTokenNote: "Your token stays only in your browser.",
        feedbackCancel: "Cancel",
        feedbackTabAll: "All",
        feedbackTabIdea: "💡 Ideas",
        feedbackTabBug: "🐛 Bugs",
        feedbackTabReview: "⭐ Reviews",
        feedbackLoadError: "Loading error.",
        feedbackRetry: "Retry",
        githubLoginTitle: "Sign in with GitHub",
        githubSecure: "Secure and transparent:",
        githubTokenNote: "token is stored in your browser and sent only to GitHub API.",
        githubHowTo: "How to get a token (simple way):",
        githubStep1: "Go to ",
        githubStep2: "Click \"Generate new token (classic)\".",
        githubStep3: "Give it a name, choose expiration (e.g., 30 days).",
        githubStep4: "In \"Select scopes\", check only ",
        githubStep5: "Copy the token and paste it here.",
        githubWarning: "Classic token gives access to all your repositories. This is fine for participating in discussions.",
        githubLoginBtn: "Sign in",
        githubAuthError: "Authentication error. Check token or try again.",
        githubProfile: "Profile",
        githubTokenActive: "Token active",
        githubLogout: "Logout",
        githubLoginVia: "Sign in with GitHub",
        githubWhy: "Why is this needed?",
        githubClearCache: "Clear cache",
        githubRevoke: "Manage tokens",
        githubTokenMissing: "Enter access token",
        githubTimeout: "Request timeout. Check your connection.",
        githubForbidden: "Access denied (403). Check token permissions.",
        githubNotFound: "Repository not found (404).",
        githubServerError: "GitHub server error",
        githubNetworkError: "Network error. Check your connection.",
        supportMenuItem: "Support",
        supportTitle: "Support",
        supportNewBtn: "New ticket",
        donateButton: "Support",
        licenseAccept: "By downloading the game, you accept the ",
        licenseLink: "license agreement",
        starveVersion: "Union 0.14.0",
        starveDownloadNote: "Version 0.14.0 · Update 2026-03-08",
        worldTitle: "Game World",
        worldDesc: "BRUTAL HARDCORE WORLD...",
        statusTitle: "Status",
        statusDesc: "Starve Neon is in early development but open for cross-platform multiplayer tests.",
        developmentTitle: "Development",
        developmentDesc: "Complete development system from spears and swords to F***ING MINIGUN...",
        alliesTitle: "Allies",
        alliesDesc: "Create alliances with factions and other players...",
        featuresTitle: "Features",
        feature1: "Internet not required.",
        feature2: "Frequent major updates.",
        feature3: "Built-in mod support.",
        feature4: "Direct communication with the developer.",
        feature5: "Multilingual support and easy addition of custom languages and fonts.",
        requirementsTitle: "System Requirements",
        requirementsNote: "Approximate values...",
        fps60: "60+ FPS",
        cpu60: "CPU: Xeon-E2650 v2 3.00 GHz",
        gpu60: "GPU: GT 730 4GB",
        fps180: "180+ FPS",
        cpu180: "CPU: AMD Athlon X4 840 3.10 GHz",
        gpu180: "GPU: GT 1030 2GB",
        fps1000: "1000+ FPS",
        cpu1000: "CPU: AMD Ryzen 7 7435HS 4.00 GHz",
        gpu1000: "GPU: RTX 3050 4GB Laptop",
        consumptionTitle: "Consumption",
        consumptionNote: "Approximate values",
        vram: "VRAM",
        vramVal: "512-1024 MB",
        ram: "RAM",
        ramVal: "512-1024 MB",
        storage: "Storage",
        storageVal: "256 MB",
        os: "OS",
        osVal: "Win 10+ 32 Bit / Android 7+",
        alphaVersion: "Patch 0.0.5.2",
        alphaDownloadNote: "Version 0.0.5.2 · Update 2024-01-21",
        alphaStoryTitle: "Story",
        alphaStoryDesc: "Alpha 01 is a top-down shooter where you are a robot with the code name Alpha 01...",
        alphaStatusTitle: "Status",
        alphaStatusDesc: "The game is in active development. Current version: 0.0.5.2",
        gcVersion: "Update 0.1.0",
        gcDownloadNote: "Version 0.1.0 · Update 2023-11-01",
        gcAboutTitle: "About",
        gcDescription: "Welcome to the ebanat zone: Gc adventure!!",
        licenseTitle: "License Agreement",
        licenseLastUpdate: "Last updated: April 9, 2026",
        licenseAllowedTitle: "Allowed",
        licenseAllowed1: "Distribution anywhere provided the original website is mentioned...",
        licenseForbiddenTitle: "Forbidden",
        licenseForbidden1: "Claiming game assets, names, logos as your own",
        licenseObligationTitle: "Obligations",
        licenseObligation1: "Retain original copyright notices",
        allRightsReserved: "All rights reserved.",
        licenseBack: "← Back to game",
        notFoundTitle: "404 — Page not found",
        notFoundDesc: "The requested page does not exist or has been moved.",
        backHome: "Back to home"
    }
};

function setLanguage(lang) {
    document.querySelectorAll('[data-lang]').forEach(element => {
        const key = element.getAttribute('data-lang');
        if (translations[lang] && translations[lang][key]) {
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = translations[lang][key];
            } else {
                element.textContent = translations[lang][key];
            }
        }
    });
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.langCode === lang);
    });
    const mainLangBtn = document.getElementById('current-lang-btn');
    if (mainLangBtn) {
        mainLangBtn.textContent = lang.toUpperCase();
        mainLangBtn.dataset.langCode = lang;
    }
    localStorage.setItem('preferredLanguage', lang);
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
}

function initLanguageSwitcher() {
    const savedLang = localStorage.getItem('preferredLanguage') || 'ru';
    setLanguage(savedLang);
    
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.removeEventListener('click', window._langClickHandler);
        const handler = () => setLanguage(btn.dataset.langCode);
        btn.addEventListener('click', handler);
        btn._langClickHandler = handler;
    });
    
    const langBtn = document.getElementById('current-lang-btn');
    const langDropdown = document.getElementById('lang-dropdown');
    if (langBtn && langDropdown) {
        langBtn.removeEventListener('click', window._langDropdownToggle);
        const toggle = () => {
            langDropdown.style.display = langDropdown.style.display === 'block' ? 'none' : 'block';
        };
        langBtn.addEventListener('click', toggle);
        window._langDropdownToggle = toggle;
        
        document.querySelectorAll('#lang-dropdown button').forEach(btn => {
            btn.removeEventListener('click', window._langItemHandler);
            const handler = () => {
                const lang = btn.dataset.langCode;
                setLanguage(lang);
                langBtn.textContent = lang.toUpperCase();
                langBtn.dataset.langCode = lang;
                langDropdown.style.display = 'none';
            };
            btn.addEventListener('click', handler);
            btn._langItemHandler = handler;
        });
        
        document.addEventListener('click', (e) => {
            if (!langBtn.contains(e.target) && !langDropdown.contains(e.target)) {
                langDropdown.style.display = 'none';
            }
        });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLanguageSwitcher);
} else {
    initLanguageSwitcher();
}

window.translations = translations;
window.setLanguage = setLanguage;
window.initLanguageSwitcher = initLanguageSwitcher;