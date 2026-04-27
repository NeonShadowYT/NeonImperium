// js/lang.js — локализация с автоопределением, встроенным словарём и кешированием

const I18n = (function() {
    const SUPPORTED = ['ru', 'en'];
    const DEFAULT = 'ru';
    const LOCALE_PATH = 'locales/';
    const CACHE_PREFIX = 'i18n_';

    let currentLang = DEFAULT;
    let translations = {};
    let loadedBundles = new Set();
    let observer = null;

    // Расширенный встроенный словарь для мгновенного рендеринга
    const EMBEDDED = {
        ru: {
            "navHome": "Neon Imperium",
            "navStarve": "Starve Neon",
            "navAlpha": "Alpha 01",
            "navGc": "ГК Адвенчур",
            "siteTitle": "Neon Imperium",
            "starvePageTitle": "Neon Imperium - Starve Neon",
            "alphaPageTitle": "Neon Imperium - Alpha 01",
            "gcPageTitle": "Neon Imperium - ГК Адвенчур",
            "notFoundTitle": "404 - Страница не найдена",
            "licenseTitle": "Лицензионное соглашение",
            "backHome": "Вернуться на главную",
            "donateButton": "Поддержать",
            "mainProjectsTitle": "Главные проекты",
            "mainProjectsDesc": "Игры с приоритетом разработки",
            "detailsBtn": "Подробнее",
            "smallProjectsTitle": "Небольшие проекты",
            "smallProjectsDesc": "Игры созданные по рофлу",
            "comingSoon": "Скоро",
            "downloadBtn": "Скачать",
            "developersTitle": "Разработчики",
            "developersDesc": "Работаем в свободное время",
            "youtubersTitle": "Ютуберы",
            "youtubersDesc": "Собираем комьюнити",
            "newsTitle": "📰 Последние новости",
            "newsDesc": "Свежие видео и обновления",
            "newsLoading": "Загрузка новостей...",
            "newsNoItems": "Пока нет новостей",
            "newsRetryVideo": "Повторить загрузку видео",
            "feedbackTitle": "Идеи, баги и отзывы",
            "feedbackDesc": "Делитесь мыслями, сообщайте об ошибках или предлагайте улучшения.",
            "feedbackNewBtn": "Оставить сообщение",
            "feedbackLoading": "Загрузка обратной связи...",
            "feedbackLoginPrompt": "Войдите через GitHub, чтобы участвовать в обсуждениях",
            "feedbackLoginBtn": "Войти",
            "feedbackFormTitle": "Оставить сообщение",
            "feedbackTitlePlaceholder": "Заголовок",
            "feedbackBodyPlaceholder": "Подробное описание...",
            "feedbackSubmitBtn": "Отправить",
            "feedbackCancel": "Отмена",
            "feedbackSendBtn": "Отправить",
            "feedbackLoadError": "Ошибка загрузки.",
            "feedbackNoItems": "Пока нет сообщений. Будьте первым!",
            "githubError": "Ошибка",
            "githubLoginTitle": "Вход через GitHub",
            "githubTokenNote": "токен хранится в вашем браузере и передаётся только в GitHub API.",
            "githubWarning": "Classic токен даёт доступ ко всем вашим репозиториям. Это нормально для участия в обсуждениях.",
            "githubLoginBtn": "Войти",
            "githubProfile": "Профиль",
            "githubLogout": "Выйти",
            "githubClearCache": "Очистить кеш",
            "updatesTitle": "Обновления",
            "trailerTitle": "Трейлер",
            "developerTitle": "Разработчик",
            "downloadTitle": "Скачать",
            "descriptionTitle": "Описание",
            "videoTitle": "Видео",
            "videoDesc": "Подборка контента от сообщества",
            "requirementsTitle": "Системные требования"
        },
        en: {
            "navHome": "Neon Imperium",
            "navStarve": "Starve Neon",
            "navAlpha": "Alpha 01",
            "navGc": "GC Adven",
            "siteTitle": "Neon Imperium",
            "starvePageTitle": "Neon Imperium - Starve Neon",
            "alphaPageTitle": "Neon Imperium - Alpha 01",
            "gcPageTitle": "Neon Imperium - GC Adven",
            "notFoundTitle": "404 - Page not found",
            "licenseTitle": "License Agreement",
            "backHome": "Back to home",
            "donateButton": "Support",
            "mainProjectsTitle": "Main Projects",
            "mainProjectsDesc": "Priority development games",
            "detailsBtn": "Details",
            "smallProjectsTitle": "Small Projects",
            "smallProjectsDesc": "Games made for fun",
            "comingSoon": "Coming soon",
            "downloadBtn": "Download",
            "developersTitle": "Developers",
            "developersDesc": "Working in free time",
            "youtubersTitle": "YouTubers",
            "youtubersDesc": "Building community",
            "newsTitle": "📰 Latest News",
            "newsDesc": "Fresh videos and updates",
            "newsLoading": "Loading news...",
            "newsNoItems": "No news yet",
            "newsRetryVideo": "Retry video loading",
            "feedbackTitle": "Ideas, bugs & feedback",
            "feedbackDesc": "Share your thoughts, report bugs, or suggest improvements.",
            "feedbackNewBtn": "Leave a message",
            "feedbackLoading": "Loading feedback...",
            "feedbackLoginPrompt": "Sign in with GitHub to participate",
            "feedbackLoginBtn": "Sign in",
            "feedbackFormTitle": "Leave a message",
            "feedbackTitlePlaceholder": "Title",
            "feedbackBodyPlaceholder": "Detailed description...",
            "feedbackSubmitBtn": "Submit",
            "feedbackCancel": "Cancel",
            "feedbackSendBtn": "Send",
            "feedbackLoadError": "Loading error.",
            "feedbackNoItems": "No messages yet. Be the first!",
            "githubError": "Error",
            "githubLoginTitle": "Sign in with GitHub",
            "githubTokenNote": "token is stored in your browser and sent only to GitHub API.",
            "githubWarning": "Classic token gives access to all your repositories. This is fine for participating in discussions.",
            "githubLoginBtn": "Sign in",
            "githubProfile": "Profile",
            "githubLogout": "Logout",
            "githubClearCache": "Clear cache",
            "updatesTitle": "Updates",
            "trailerTitle": "Trailer",
            "developerTitle": "Developer",
            "downloadTitle": "Download",
            "descriptionTitle": "Description",
            "videoTitle": "Video",
            "videoDesc": "Community content",
            "requirementsTitle": "System Requirements"
        }
    };

    // Определение языка браузера
    function detectBrowserLang() {
        const navLang = (navigator.language || navigator.userLanguage || '').split('-')[0];
        if (SUPPORTED.includes(navLang)) return navLang;
        return DEFAULT;
    }

    // Получить сохранённый язык
    function getSavedLang() {
        return localStorage.getItem('preferredLanguage') || detectBrowserLang();
    }

    // Загрузить переводы из сети или localStorage
    async function fetchTranslations(lang) {
        const cacheKey = CACHE_PREFIX + lang;
        // Попытка из sessionStorage
        const sessionCached = sessionStorage.getItem(cacheKey);
        if (sessionCached) {
            try {
                const data = JSON.parse(sessionCached);
                if (data && Object.keys(data).length > 0) return data;
            } catch (e) {}
        }
        // Попытка из localStorage
        const localCached = localStorage.getItem(cacheKey);
        if (localCached) {
            try {
                const data = JSON.parse(localCached);
                if (data && Object.keys(data).length > 0) {
                    sessionStorage.setItem(cacheKey, JSON.stringify(data));
                    return data;
                }
            } catch (e) {}
        }
        // Сетевой запрос
        try {
            const response = await fetch(`${LOCALE_PATH}${lang}.json`);
            if (!response.ok) throw new Error('Failed to load');
            const data = await response.json();
            // Кешируем
            sessionStorage.setItem(cacheKey, JSON.stringify(data));
            localStorage.setItem(cacheKey, JSON.stringify(data));
            return data;
        } catch (err) {
            console.error('Failed to load translations:', err);
            return null;
        }
    }

    // Применить переводы к элементам с data-lang
    function updateElements() {
        document.querySelectorAll('[data-lang]').forEach(el => {
            const key = el.getAttribute('data-lang');
            const text = translate(key);
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.placeholder = text;
            } else {
                el.textContent = text;
            }
        });

        // Обновить заголовок страницы
        const titleKeys = {
            '/': 'siteTitle',
            '/index.html': 'siteTitle',
            '/starve-neon.html': 'starvePageTitle',
            '/alpha-01.html': 'alphaPageTitle',
            '/gc-adven.html': 'gcPageTitle',
            '/license.html': 'licenseTitle'
        };
        const path = location.pathname;
        const titleKey = titleKeys[path] || titleKeys[path.split('/').pop()] || 'siteTitle';
        document.title = translate(titleKey);

        // Обновить кнопки языка
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.langCode === currentLang);
        });
    }

    // Публичный метод для динамических элементов
    function translateElement(el, key) {
        const text = translate(key);
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.placeholder = text;
        } else {
            el.textContent = text;
        }
    }

    // Получить перевод
    function translate(key) {
        return translations[key] ?? EMBEDDED[currentLang]?.[key] ?? key;
    }

    // Смена языка
    async function setLanguage(lang) {
        if (lang === currentLang || !SUPPORTED.includes(lang)) return;

        currentLang = lang;
        localStorage.setItem('preferredLanguage', lang);

        // Сначала встроенные переводы для мгновенного обновления
        translations = { ...EMBEDDED[lang] };
        updateElements();

        // Загружаем полный словарь
        const full = await fetchTranslations(lang);
        if (full) {
            translations = full;
            updateElements();
        }

        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
    }

    // Инициализация
    async function init() {
        currentLang = getSavedLang();
        translations = { ...EMBEDDED[currentLang] };
        updateElements();

        // Асинхронная загрузка полного словаря
        const full = await fetchTranslations(currentLang);
        if (full) {
            translations = full;
            updateElements();
        }

        // Обработчики кнопок
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.addEventListener('click', () => setLanguage(btn.dataset.langCode));
        });

        // MutationObserver для динамически добавленных элементов
        observer = new MutationObserver(mutations => {
            let needUpdate = false;
            for (const m of mutations) {
                if (m.type === 'childList' && m.addedNodes.length) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.matches?.('[data-lang]') || node.querySelector?.('[data-lang]')) {
                                needUpdate = true;
                                break;
                            }
                        }
                    }
                }
            }
            if (needUpdate) updateElements();
        });
        observer.observe(document.body, { childList: true, subtree: true });

        window.dispatchEvent(new CustomEvent('languageLoaded', { detail: { language: currentLang } }));
    }

    document.addEventListener('DOMContentLoaded', init);

    return {
        setLanguage,
        translate,
        translateElement,
        getCurrentLang: () => currentLang
    };
})();