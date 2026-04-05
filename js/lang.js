// ==================== СЛОВАРИ ====================
const translations = {
    ru: {
        // Навигация
        navHome: "Neon Imperium",
        navStarve: "Starve Neon",
        navAlpha: "Alpha 01",
        navGc: "ГК Адвенчур",
        
        // Главная
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
        
        // Общие для страниц игр
        trailerTitle: "Трейлер",
        developerTitle: "Разработчик",
        nextUpdateProgress: "Следующее обновление:",
        downloadTitle: "Скачать",
        descriptionTitle: "Описание",
        videoTitle: "Видео",
        videoDesc: "Подборка контента от сообщества",
        updatesTitle: "Обновления",
        polls: "Опросы",
        downloadBtn: "Скачать",
        feedbackTitle: "Идеи, баги и отзывы",
        feedbackDesc: "Делитесь мыслями, сообщайте об ошибках или предлагайте улучшения.",
        feedbackNewBtn: "Оставить сообщение",
        feedbackLoading: "Загрузка обратной связи...",
        feedbackLoginPrompt: "Войдите через GitHub, чтобы участвовать в обсуждениях",
        feedbackLoginBtn: "Войти",
        feedbackFormTitle: "Оставить сообщение",
        feedbackTitlePlaceholder: "Заголовок",
        feedbackBodyPlaceholder: "Подробное описание...",
        feedbackCategoryLabel: "Категория",
        feedbackCategoryIdea: "💡 Идея",
        feedbackCategoryBug: "🐛 Баг",
        feedbackCategoryReview: "⭐ Отзыв",
        feedbackSubmitBtn: "Отправить",
        feedbackComments: "Комментарии",
        feedbackAddComment: "Написать комментарий...",
        feedbackSendBtn: "Отправить",
        feedbackLoadMore: "Загрузить ещё",
        feedbackNoItems: "Пока нет сообщений. Будьте первым!",
        feedbackCancel: "Отмена",
        feedbackTabAll: "Все",
        feedbackTabIdea: "💡 Идеи",
        feedbackTabBug: "🐛 Баги",
        feedbackTabReview: "⭐ Отзывы",
        feedbackLoadError: "Ошибка загрузки.",
        feedbackRetry: "Повторить",
        feedbackTokenNote: "Ваш токен останется только у вас в браузере.",
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
        githubError: "Ошибка",
        githubRetry: "Попробовать снова",
        githubRevoke: "Управление токенами",
        githubTokenMissing: "Введите токен доступа",
        githubTimeout: "Превышено время ожидания. Проверьте соединение.",
        githubForbidden: "Доступ запрещён (403). Проверьте права токена.",
        githubNotFound: "Репозиторий не найден (404).",
        githubServerError: "Ошибка сервера GitHub",
        githubNetworkError: "Ошибка сети. Проверьте подключение.",

        // Фраза про лицензию
        licenseAccept: "Скачивая игру, вы принимаете ",
        licenseLink: "лицензионное соглашение",
        
        // Starve Neon
        starveDownloadNote: "Версия 0.14.0 · Обновление от 08.03.2026",
        starveVersion: "Объединение 0.14.0",
        worldTitle: "Игровой мир",
        worldDesc: "БРУТАЛЬНЫЙ ХАРДКОРНЫЙ МИР. Я не буду держать тебя за руку, приятель. Я оставлю небольшой туториал по базовой механике, а дальше ты сам по себе ;}",
        statusTitle: "Статус",
        statusDesc: "Starve Neon находится на ранней стадии разработки, но открыт для кроссплатформенного многопользовательского тестирования.",
        developmentTitle: "Развитие",
        developmentDesc: "Полная система развития от копий и мечей до ГРЕБАНОГО МИНИГАНА, ЧУВАК! Броня для разных биомов, модули и система генетики, подобная RimWorld.",
        alliesTitle: "Союзники",
        alliesDesc: "Создавай союзы с фракциями и другими игроками, участвуй в битвах на арене и приручай животных. Отправляйся кланом на рейд подобно Rust.",
        featuresTitle: "Особенности",
        feature1: "Интернет необязателен.",
        feature2: "Частые крупные обновления.",
        feature3: "Встроенная поддержка модов.",
        feature4: "Прямое общение с разработчиком.",
        feature5: "Многоязычная поддержка и простое добавление пользовательских языков и шрифтов.",
        requirementsTitle: "Системные требования",
        requirementsNote: "Примерные значения основанные на стандартных настройках для этих устройств",
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
        video1Title: "Обзор Starve Neon",
        video2Title: "Гайд для новичков",
        video3Title: "Прохождение мультиплеера",
        video4Title: "Лучшие моменты",
        video5Title: "Секреты и пасхалки",
        starveUpdateTitle: "Бета 0.14.0",
        spoilerTutorial: "Туториал",
        tutorialContent: "Цели по всей игре",
        spoilerRewards: "Награды",
        rewardsContent: "Локализация\nУлучшены возможности перевода",
        spoilerQuality: "Удобства",
        qualityContent: "Интерфейс\nУправление",
        spoilerBalance: "Баланс",
        balanceContent: "Награды за уровень\nИзменение прогрессии",
        spoilerBugfix: "Багфикс",
        bugfixContent: "Множество мелких исправлений",
        
        // Alpha 01
        alphaVersion: "Патч 0.0.5.2",
        alphaDownloadNote: "Версия 0.0.5.2 · Обновление от 21.01.2024",
        alphaStoryTitle: "Сюжет",
        alphaStoryDesc: "Alpha 01 - это topdown шутер, где вы - робот с кодовым названием Альфа 01. Ваша цель заключается в том, чтобы помочь солдатам и остановить хаос, творящийся в мире. Кто же стоит за началом хаоса?..",
        alphaStatusTitle: "Статус",
        alphaStatusDesc: "Игра находится в активной разработке. Текущая версия: 0.0.5.2",
        alphaVideo1Title: "Обзор Alpha 01",
        alphaVideo2Title: "Прохождение",
        alphaVideo3Title: "Стрим с разработчиком",
        alphaUpdateTitle: "Патч 0.0.5.2",
        spoilerGameplay: "Геймплей",
        gameplayContent: "Добавлена 1 точка бандитов на свалке",
        spoilerCraft: "Крафт",
        craftContent: "Метеоритные пули теперь можно скрафтить в лесу",
        spoilerGraphics: "Графика",
        graphicsContent: "Улучшение меню",
        
        // ГК Адвенчур
        gcVersion: "Обновление 0.1.0",
        gcDownloadNote: "Версия 0.1.0 · Обновление от 01.11.2023",
        gcAboutTitle: "Об игре",
        gcDescription: "Welcome to the ebanat zone: Gc adventure!! Гк адвенчур - это жёсткое экшен приключение где тебе предстоит спасти мир от хаоса! Однажды, кот Мурзик приходит к гк чтобы он помог ему. Но они не успевают и начинается ХАОС! Теперь вам предстоит остановить это. Но вы будете не одни, у вас будут помощники! Вот они, слева направо: Мурзик, Мурочка, Митми, Неон, Оборотень, Стейси! Вы все должны будете остановить это всё, нажав на 2 кнопочки",
        gcVideo1Title: "Обзор ГК Адвенчур",
        gcVideo2Title: "Прохождение",
        gcUpdateTitle: "Обновление 0.1.0",
        gcUpdateSummary: "Игра вышла",
        gcUpdateContent: "Первый релиз игры.",
        
        // 404
        notFoundTitle: "404 — Страница не найдена",
        notFoundDesc: "Запрашиваемая страница не существует или была перемещена.",
        backHome: "Вернуться на главную",
        
        // Лицензионное соглашение (новые ключи)
        licenseTitle: "Лицензионное соглашение",
        licenseLastUpdate: "Последнее обновление: 9 апреля 2026 г.",
        licenseAllowedTitle: "Разрешено",
        licenseAllowed1: "Распространение игры где угодно при условии упоминания оригинального сайта и наличия ссылки на него в игре",
        licenseAllowed2: "Модификация для локального использования или на собственных серверах",
        licenseAllowed3: "Создание платных модов и получение дохода (без отчислений)",
        licenseAllowed4: "Запись и публикация видеороликов с указанием авторства",
        licenseAllowed5: "Бесплатные обновления",
        licenseForbiddenTitle: "Запрещено",
        licenseForbidden1: "Выдавать имена, товарные знаки, логотипы за свои",
        licenseForbidden2: "Читы/моды, дающие преимущество на официальных серверах",
        licenseForbidden3: "Вредоносные модификации (вирусы, майнеры)",
        licenseForbidden4: "Коммерческая перепродажа без разрешения",
        licenseObligationTitle: "Обязанности",
        licenseObligation1: "Сохранять первоначальные авторские права",
        licenseObligation2: "В изменённых версиях указывать неофициальный статус и ссылку на оригинальный сайт",
        licenseObligation3: "Моды с открытым исходным кодом должны содержать ссылку на исходники",
        licenseObligation4: "Указывать ссылки на оригинальные страницы и автора",
        licenseObligation5: "Ты отдаёшь свою душу авторам приложений ;} (шутка)",
        licenseBack: "← Вернуться к игре",
        allRightsReserved: "Все права защищены.",
        
        // Дополнительные ключи для новых разделов лицензии
        licenseRefundTitle: "Возврат средств",
        licenseRefundText1: "Если в будущем в играх появится платный контент, возврат возможен через Telegram @NeonShindowsYT при подтверждении платежа.",
        licenseRefundText2: "Возвращается сумма за вычетом всех комиссий и налогов (чистая сумма, полученная разработчиком).",
        licenseRefundText3: "Срок возврата — 30 дней с момента подтверждения. Пожертвования возврату не подлежат.",
        licenseMarsJoke: "Споры рассматриваются на планете Марс (шутка). Реально — по месту жительства ответчика.",
        licenseTelegramContact: "Жалобы на контент: @NeonShindowsYT (ответ не гарантируется)",
        licenseOriginalSite: "Оригинальный сайт: https://neonshadowyt.github.io/NeonImperium/"
    },
    
    en: {
        // Navigation
        navHome: "Neon Imperium",
        navStarve: "Starve Neon",
        navAlpha: "Alpha 01",
        navGc: "GC Adven",
        
        // Home
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
        
        // Common for game pages
        trailerTitle: "Trailer",
        developerTitle: "Developer",
        nextUpdateProgress: "Next update:",
        downloadTitle: "Download",
        descriptionTitle: "Description",
        videoTitle: "Video",
        videoDesc: "Community content",
        updatesTitle: "Updates",
        polls: "Polls",
        downloadBtn: "Download",
        feedbackTitle: "Ideas, bugs & feedback",
        feedbackDesc: "Share your thoughts, report bugs, or suggest improvements.",
        feedbackNewBtn: "Leave a message",
        feedbackLoading: "Loading feedback...",
        feedbackLoginPrompt: "Sign in with GitHub to participate",
        feedbackLoginBtn: "Sign in",
        feedbackFormTitle: "Leave a message",
        feedbackTitlePlaceholder: "Title",
        feedbackBodyPlaceholder: "Detailed description...",
        feedbackCategoryLabel: "Category",
        feedbackCategoryIdea: "💡 Idea",
        feedbackCategoryBug: "🐛 Bug",
        feedbackCategoryReview: "⭐ Review",
        feedbackSubmitBtn: "Submit",
        feedbackComments: "Comments",
        feedbackAddComment: "Write a comment...",
        feedbackSendBtn: "Send",
        feedbackLoadMore: "Load more",
        feedbackNoItems: "No messages yet. Be the first!",
        feedbackCancel: "Cancel",
        feedbackTabAll: "All",
        feedbackTabIdea: "💡 Ideas",
        feedbackTabBug: "🐛 Bugs",
        feedbackTabReview: "⭐ Reviews",
        feedbackLoadError: "Loading error.",
        feedbackRetry: "Retry",
        feedbackTokenNote: "Your token stays only in your browser.",
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
        githubError: "Error",
        githubRetry: "Try again",
        githubRevoke: "Manage tokens",
        githubTokenMissing: "Enter access token",
        githubTimeout: "Request timeout. Check your connection.",
        githubForbidden: "Access denied (403). Check token permissions.",
        githubNotFound: "Repository not found (404).",
        githubServerError: "GitHub server error",
        githubNetworkError: "Network error. Check your connection.",

        licenseAccept: "By downloading the game, you accept the ",
        licenseLink: "license agreement",
        
        // Starve Neon
        starveDownloadNote: "Version 0.14.0 · Update 2026-03-08",
        starveVersion: "Union 0.14.0",
        worldTitle: "Game World",
        worldDesc: "BRUTAL HARDCORE WORLD. I won't hold your hand, buddy. I'll leave a short tutorial on the basic mechanics, and then you're on your own ;}",
        statusTitle: "Status",
        statusDesc: "Starve Neon is in early development but open for cross-platform multiplayer tests.",
        developmentTitle: "Development",
        developmentDesc: "Complete development system from spears and swords to F***ING MINIGUN, DUDE! Armor for different biomes, modules and a genetics system similar to RimWorld.",
        alliesTitle: "Allies",
        alliesDesc: "Create alliances with factions and other players, take part in arena battles and tame animals. Go on a raid with your clan like Rust.",
        featuresTitle: "Features",
        feature1: "Internet not required.",
        feature2: "Frequent major updates.",
        feature3: "Built-in mod support.",
        feature4: "Direct communication with the developer.",
        feature5: "Multilingual support and easy addition of custom languages and fonts.",
        requirementsTitle: "System Requirements",
        requirementsNote: "Approximate values based on standard settings for these devices",
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
        video1Title: "Starve Neon Review",
        video2Title: "Beginner's Guide",
        video3Title: "Multiplayer Walkthrough",
        video4Title: "Highlights",
        video5Title: "Secrets & Easter Eggs",
        starveUpdateTitle: "Beta 0.14.0",
        spoilerTutorial: "Tutorial",
        tutorialContent: "Goals throughout the game",
        spoilerRewards: "Rewards",
        rewardsContent: "Localization\nImproved translation capabilities",
        spoilerQuality: "Quality of Life",
        qualityContent: "Interface\nControls",
        spoilerBalance: "Balance",
        balanceContent: "Level rewards\nProgression changes",
        spoilerBugfix: "Bugfix",
        bugfixContent: "Many minor fixes",
        
        // Alpha 01
        alphaVersion: "Patch 0.0.5.2",
        alphaDownloadNote: "Version 0.0.5.2 · Update 2024-01-21",
        alphaStoryTitle: "Story",
        alphaStoryDesc: "Alpha 01 is a top-down shooter where you are a robot with the code name Alpha 01. Your goal is to help the soldiers and stop the chaos raging in the world. Who is behind the beginning of the chaos?..",
        alphaStatusTitle: "Status",
        alphaStatusDesc: "The game is in active development. Current version: 0.0.5.2",
        alphaVideo1Title: "Alpha 01 Review",
        alphaVideo2Title: "Walkthrough",
        alphaVideo3Title: "Dev Stream",
        alphaUpdateTitle: "Patch 0.0.5.2",
        spoilerGameplay: "Gameplay",
        gameplayContent: "Added 1 bandit point at the dump",
        spoilerCraft: "Crafting",
        craftContent: "Meteorite bullets can now be crafted in the forest",
        spoilerGraphics: "Graphics",
        graphicsContent: "Menu improvement",
        
        // GC Adven
        gcVersion: "Update 0.1.0",
        gcDownloadNote: "Version 0.1.0 · Update 2023-11-01",
        gcAboutTitle: "About",
        gcDescription: "Welcome to the ebanat zone: Gc adventure!! GC Adven is a hardcore action adventure where you have to save the world from chaos! One day, the cat Murzik comes to GC to ask for help. But they don't make it in time and CHAOS begins! Now you have to stop it. But you won't be alone, you'll have helpers! Here they are, from left to right: Murzik, Murochka, Mitmi, Neon, Oboroten, Stasy! You all must stop all this by pressing 2 buttons.",
        gcVideo1Title: "GC Adven Review",
        gcVideo2Title: "Walkthrough",
        gcUpdateTitle: "Update 0.1.0",
        gcUpdateSummary: "Game released",
        gcUpdateContent: "First release of the game.",
        
        // 404
        notFoundTitle: "404 — Page not found",
        notFoundDesc: "The requested page does not exist or has been moved.",
        backHome: "Back to home",
        
        // License Agreement (new keys)
        licenseTitle: "License Agreement",
        licenseLastUpdate: "Last updated: April 9, 2026",
        licenseAllowedTitle: "Allowed",
        licenseAllowed1: "Distribution anywhere provided the original website is mentioned and a link is present in the game",
        licenseAllowed2: "Modification for local use or on own servers",
        licenseAllowed3: "Creating paid mods and keeping 100% of revenue",
        licenseAllowed4: "Recording and publishing gameplay videos with credit",
        licenseAllowed5: "Free updates",
        licenseForbiddenTitle: "Forbidden",
        licenseForbidden1: "Claiming game assets, names, logos as your own",
        licenseForbidden2: "Cheats/mods that give advantage on official servers",
        licenseForbidden3: "Malicious modifications (viruses, miners)",
        licenseForbidden4: "Commercial resale without permission",
        licenseObligationTitle: "Obligations",
        licenseObligation1: "Retain original copyright notices",
        licenseObligation2: "Mark unofficial versions and include a link to the original site",
        licenseObligation3: "Open-source mods must provide source link",
        licenseObligation4: "Provide links to original game pages and authors",
        licenseObligation5: "You give your soul to the game authors ;} (joke)",
        licenseBack: "← Back to game",
        allRightsReserved: "All rights reserved.",
        
        // Additional license keys
        licenseRefundTitle: "Refunds",
        licenseRefundText1: "If paid content appears in games, refunds are possible via Telegram @NeonShindowsYT upon payment confirmation.",
        licenseRefundText2: "The refunded amount is the net amount received by the developer after all fees and taxes.",
        licenseRefundText3: "Refund period is 30 days after confirmation. Donations are non-refundable.",
        licenseMarsJoke: "Disputes are heard on Mars (joke). In reality — at the respondent's place of residence.",
        licenseTelegramContact: "Content complaints: @NeonShindowsYT (response not guaranteed)",
        licenseOriginalSite: "Original website: https://neonshadowyt.github.io/NeonImperium/"
    }
};

// ==================== ФУНКЦИИ ПЕРЕКЛЮЧЕНИЯ ЯЗЫКА ====================
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

document.addEventListener('DOMContentLoaded', () => {
    const savedLang = localStorage.getItem('preferredLanguage') || 'ru';
    setLanguage(savedLang);
    
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setLanguage(btn.dataset.langCode);
        });
    });
});

const langBtn = document.getElementById('current-lang-btn');
const langDropdown = document.getElementById('lang-dropdown');
if (langBtn && langDropdown) {
    langBtn.addEventListener('click', () => {
        langDropdown.style.display = langDropdown.style.display === 'block' ? 'none' : 'block';
    });
    document.querySelectorAll('#lang-dropdown button').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.dataset.langCode;
            setLanguage(lang);
            langBtn.textContent = lang.toUpperCase();
            langBtn.dataset.langCode = lang;
            langDropdown.style.display = 'none';
        });
    });
    document.addEventListener('click', (e) => {
        if (!langBtn.contains(e.target) && !langDropdown.contains(e.target)) {
            langDropdown.style.display = 'none';
        }
    });
}