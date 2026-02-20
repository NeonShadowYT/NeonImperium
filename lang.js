const translations = {
    ru: {
        devNotice: "⚡ Сайт в разработке · актуальная информация на",
        originalSite: "Оригинальный сайт",
        navHome: "Neon Imperium",
        navStarve: "Starve Neon",
        navAlpha: "Alpha 01",
        navGc: "ГК Адвенчур",
        siteTitle: "Neon Imperium",
        mainProjectsTitle: "Главные проекты",
        mainProjectsDesc: "Игры с приоритетом разработки",
        starveDesc: "Выживание в брутальном мире с прокачкой и генетикой.",
        alphaDesc: "Top-down шутер, где вы робот, помогающий солдатам.",
        gcDesc: "Просто приключение ГКТМО.",
        detailsBtn: "Подробнее",
        smallProjectsTitle: "Небольшие проекты",
        smallProjectsDesc: "Игры созданные по рофлу",
        pnsd1Desc: "Первая часть безумной серии.",
        pnsd2Desc: "Продолжение, ещё безумнее.",
        comingSoon: "Скоро",
        developersTitle: "Разработчики",
        developersDesc: "Работаем в свободное время",
        youtubersTitle: "Ютуберы",
        youtubersDesc: "Собираем комьюнити",
        googleSites: "Google Sites",
        trailerTitle: "Трейлер",
        developerTitle: "Разработчик",
        downloadTitle: "Скачать игру",
        descriptionTitle: "Описание",
        videoTitle: "Видео",
        videoDesc: "Подборка контента от сообщества",
        videoHowTo: "Чтобы сюда попасть:",
        videoRule1: "Создай плейлист с настройкой сортировки \"сначала новые\" или \"по популярности\".",
        videoRule2: "Видео в плейлисте должны понравиться разработчику, после чего они могут попасть сюда.",
        updatesTitle: "Обновления",
        gcVersion: "Обновление 0.1.0",
        gcDeveloperRole: "Главный разработчик",
        gcDownloadNote: "Версия 0.1.0 · Обновление от 01.11.2023",
        gcAboutTitle: "Об игре",
        gcDescription: "Что тут писать? Просто приключение ГКТМО.",
        gcVideo1Title: "Обзор ГК Адвенчур",
        gcUpdateTitle: "Обновление 0.1.0",
        gcUpdateSummary: "Игра вышла",
        gcUpdateContent: "Первый релиз игры."
    },
    en: {
        devNotice: "⚡ Site under development · actual info at",
        originalSite: "Original site",
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
        pnsd1Desc: "First part of the crazy series.",
        pnsd2Desc: "Sequel, even crazier.",
        comingSoon: "Coming soon",
        developersTitle: "Developers",
        developersDesc: "Working in free time",
        youtubersTitle: "YouTubers",
        youtubersDesc: "Building community",
        googleSites: "Google Sites",
        trailerTitle: "Trailer",
        developerTitle: "Developer",
        downloadTitle: "Download game",
        descriptionTitle: "Description",
        videoTitle: "Video",
        videoDesc: "Community content",
        videoHowTo: "To get here:",
        videoRule1: "Create a playlist with 'newest first' or 'most popular' sorting.",
        videoRule2: "Videos in the playlist must be liked by the developer to be featured.",
        updatesTitle: "Updates",
        gcVersion: "Update 0.1.0",
        gcDeveloperRole: "Lead developer",
        gcDownloadNote: "Version 0.1.0 · Update 2023-11-01",
        gcAboutTitle: "About",
        gcDescription: "What to write? Just a GC adventure.",
        gcVideo1Title: "GC Adven Review",
        gcUpdateTitle: "Update 0.1.0",
        gcUpdateSummary: "Game released",
        gcUpdateContent: "First release of the game."
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
    // Обновляем активную кнопку
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.langCode === lang);
    });
    // Сохраняем выбор в localStorage
    localStorage.setItem('preferredLanguage', lang);
}

document.addEventListener('DOMContentLoaded', () => {
    // Загружаем сохранённый язык или русский по умолчанию
    const savedLang = localStorage.getItem('preferredLanguage') || 'ru';
    setLanguage(savedLang);

    // Обработчики для кнопок
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setLanguage(btn.dataset.langCode);
        });
    });
});