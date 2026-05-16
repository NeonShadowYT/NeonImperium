// js/lang.js — локализация с автоопределением, встроенным словарём и кешированием
(function() {
    const SUPPORTED = ['ru', 'en'];
    const DEFAULT = 'ru';
    const LOCALE_PATH = 'locales/';
    const CACHE_PREFIX = 'i18n_';

    let currentLang = DEFAULT;
    let translations = {};
    let observer = null;

    // Встроенные переводы (базовые)
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
            "requirementsTitle": "Системные требования",
            "storeTitle": "Площадки",
            "cloudTitle": "Хранилища",
            // License page
            "licenseMainTitle": "Лицензионное соглашение",
            "licenseLastUpdate": "Последнее обновление: 15 мая 2026 г.",
            "licenseOpenBadge": "Открытый код по запросу",
            "licenseDisclaimerTitle": "Отказ от ответственности",
            "licenseDisclaimerText": "Игры Neon Imperium (Starve Neon, Alpha 01, ГК Адвенчур) предоставляются «как есть», без каких-либо явных или подразумеваемых гарантий. Разработчики не несут ответственности за любые прямые, косвенные, случайные или иные убытки, возникшие в результате использования или невозможности использования игр, включая, но не ограничиваясь: потерю данных, повреждение оборудования, финансовые потери или моральный вред. Вы используете игры исключительно на свой страх и риск.\n\n**Подтверждение возраста:** скачивая, устанавливая или иным образом используя игру, вы подтверждаете, что вам исполнилось 18 лет, либо вы достигли совершеннолетия в соответствии с законодательством вашей страны. Если вам нет 18 лет, вы обязаны немедленно прекратить использование игры и удалить все её копии.",
            "licenseOpenSourceTitle": "Открытый исходный код",
            "licenseOpenSourceText": "Скрипты (программный код) наших игр распространяются под открытой лицензией. По вашему запросу мы можем предоставить репозиторий с исходным кодом (без ассетов). Ассеты (изображения, звуки, модели, текстуры, анимации) могут иметь отдельные ограничения, но основные игровые механики остаются открытыми для изучения, обучения и некоммерческих модификаций.\n\nЧтобы получить доступ к коду, свяжитесь с нами через Telegram. Мы оставляем за собой право отказать в доступе без объяснения причин.",
            "licensePrivacyTitle": "Приватность и анонимность",
            "licensePrivacyText": "Мы уважаем вашу приватность. Игры не собирают персональные данные без вашего явного согласия. Любая статистика использования анонимна и не привязана к конкретному пользователю. Мы не храним и не передаём третьим лицам ваши IP-адреса, историю игр или иную личную информацию.\n\nРазработчики и авторы сайта также предпочитают оставаться анонимными, выступая под псевдонимами (Neon Shadow, Golden Creeper). Это позволяет нам фокусироваться на творчестве, а не на публичности. Тем не менее, мы всегда открыты для диалога через указанные каналы связи.\n\n**Важно:** в случае отправки сообщений через GitHub Issues или комментарии, ваши данные (логин, аватар) будут видны публично в соответствии с политикой GitHub.",
            "licenseContactTitle": "Связь с нами",
            "licenseContactDesc": "Есть вопросы, предложения или нужен доступ к коду? Напишите нам в Telegram:",
            "licenseContactNote": "Ответ обычно в течение суток",
            "licenseAllowedTitle": "Разрешено",
            "licenseAllowed1": "Свободно играть, копировать и распространять оригинальные неизменённые версии игр",
            "licenseAllowed2": "Записывать видео, вести стримы, создавать обзоры, гайды и любой другой контент по играм, а также монетизировать этот контент (YouTube, Twitch, TikTok, иные платформы) без каких-либо отчислений авторам игр. Весь доход от такого контента полностью принадлежит вам.",
            "licenseAllowed3": "Создавать модификации (моды) при условии, что они распространяются с открытым исходным кодом и не нарушают законы",
            "licenseAllowed4": "Продавать собственные кастомные модификации, скины, мерч (футболки, кружки, наклейки), прохождения, консультации и любые другие продукты, связанные с игрой, без уплаты роялти разработчикам. Весь доход остаётся у вас.",
            "licenseForbiddenTitle": "Запрещено",
            "licenseForbidden1": "Выдавать игру или её части (включая код, ассеты) за свои, удалять уведомления об авторских правах",
            "licenseForbidden2": "Создавать вредоносные, читерские, проприетарные (закрытые) моды, а также моды, нарушающие законодательство РФ или международное право",
            "licenseForbidden3": "Использовать игру в коммерческих целях, не связанных с созданием контента или модов (например, продажа самой игры, сдача в аренду) без отдельного письменного разрешения",
            "licenseForbidden4": "Распространять игру на платных дисках, в составе сборок с платным доступом, а также встраивать в коммерческие продукты без явного согласия",
            "licenseObligationTitle": "Ваши обязанности",
            "licenseObligation1": "Сохранять исходные уведомления об авторстве и лицензии в оригинальных файлах игры",
            "licenseObligation2": "При публикации модов или видео указывать явную ссылку на официальный сайт или страницу игры (необязательно, но приветствуется)",
            "licenseObligation3": "Самостоятельно нести ответственность за любой контент, который вы создаёте на основе игры (моды, видео, мерч)",
            "allRightsReserved": "Все права защищены."
        },
        en: {
            // аналогично с английскими значениями (можно скопировать из en.json)
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
            "requirementsTitle": "System Requirements",
            "storeTitle": "Stores",
            "cloudTitle": "Cloud",
            "licenseMainTitle": "License Agreement",
            "licenseLastUpdate": "Last updated: May 15, 2026",
            "licenseOpenBadge": "Open source upon request",
            "licenseDisclaimerTitle": "Disclaimer of Liability",
            "licenseDisclaimerText": "Neon Imperium games are provided 'as is', without any warranties. Developers are not liable for any damages...",
            "licenseOpenSourceTitle": "Open Source Code",
            "licenseOpenSourceText": "The scripts of our games are distributed under an open license. Upon request, we can provide the source code...",
            "licensePrivacyTitle": "Privacy & Anonymity",
            "licensePrivacyText": "We respect your privacy. Games do not collect personal data without explicit consent...",
            "licenseContactTitle": "Contact Us",
            "licenseContactDesc": "Questions, suggestions, or need access to the code? Write to us on Telegram:",
            "licenseContactNote": "Usually replies within a day",
            "licenseAllowedTitle": "Permitted",
            "licenseAllowed1": "Freely play, copy, and distribute original unmodified versions",
            "licenseAllowed2": "Record videos, stream, create reviews, guides, and monetize that content",
            "licenseAllowed3": "Create modifications (mods) provided they are open source",
            "licenseAllowed4": "Sell your own custom mods, skins, merchandise",
            "licenseForbiddenTitle": "Prohibited",
            "licenseForbidden1": "Claim the game or its parts as your own",
            "licenseForbidden2": "Create malicious, cheating, proprietary mods",
            "licenseForbidden3": "Use the game for commercial purposes not related to content creation",
            "licenseForbidden4": "Distribute the game on paid media or in paid-access bundles",
            "licenseObligationTitle": "Your Obligations",
            "licenseObligation1": "Retain original copyright notices",
            "licenseObligation2": "Provide a link to the official website when publishing mods or videos",
            "licenseObligation3": "Solely bear responsibility for any content you create",
            "allRightsReserved": "All rights reserved."
        }
    };

    function detectBrowserLang() {
        const navLang = (navigator.language || navigator.userLanguage || '').split('-')[0];
        return SUPPORTED.includes(navLang) ? navLang : DEFAULT;
    }

    function getSavedLang() {
        return localStorage.getItem('preferredLanguage') || detectBrowserLang();
    }

    async function fetchTranslations(lang) {
        const cacheKey = CACHE_PREFIX + lang;
        const sessionCached = sessionStorage.getItem(cacheKey);
        if (sessionCached) {
            try { return JSON.parse(sessionCached); } catch(e) {}
        }
        const localCached = localStorage.getItem(cacheKey);
        if (localCached) {
            try {
                const data = JSON.parse(localCached);
                sessionStorage.setItem(cacheKey, JSON.stringify(data));
                return data;
            } catch(e) {}
        }
        try {
            const response = await fetch(`${LOCALE_PATH}${lang}.json`);
            if (!response.ok) throw new Error();
            const data = await response.json();
            sessionStorage.setItem(cacheKey, JSON.stringify(data));
            localStorage.setItem(cacheKey, JSON.stringify(data));
            return data;
        } catch {
            return null;
        }
    }

    function translate(key) {
        return translations[key] ?? EMBEDDED[currentLang]?.[key] ?? key;
    }

    function updateElements() {
        document.querySelectorAll('[data-lang]').forEach(el => {
            const key = el.getAttribute('data-lang');
            const text = translate(key);
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                if (el.placeholder !== undefined) el.placeholder = text;
                else el.textContent = text;
            } else {
                // Для обычных элементов заменяем содержимое, но если внутри есть HTML-теги (например, markdown-body), то оставляем их нетронутыми
                if (el.classList.contains('markdown-body')) {
                    // Для блоков с markdown мы должны вставлять текст как HTML с сохранением форматирования
                    el.innerHTML = text.replace(/\n/g, '<br>');
                } else {
                    el.textContent = text;
                }
            }
        });

        // Обновление заголовка страницы
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

        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.langCode === currentLang);
        });
    }

    async function setLanguage(lang) {
        if (lang === currentLang || !SUPPORTED.includes(lang)) return;
        currentLang = lang;
        localStorage.setItem('preferredLanguage', lang);
        translations = { ...EMBEDDED[lang] };
        updateElements();
        const full = await fetchTranslations(lang);
        if (full) {
            translations = full;
            updateElements();
        }
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
    }

    async function init() {
        currentLang = getSavedLang();
        translations = { ...EMBEDDED[currentLang] };
        updateElements();
        const full = await fetchTranslations(currentLang);
        if (full) {
            translations = full;
            updateElements();
        }
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.addEventListener('click', () => setLanguage(btn.dataset.langCode));
        });
        observer = new MutationObserver(mutations => {
            let needUpdate = false;
            for (const m of mutations) {
                if (m.type === 'childList' && m.addedNodes.length) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE && (node.matches?.('[data-lang]') || node.querySelector?.('[data-lang]'))) {
                            needUpdate = true;
                            break;
                        }
                    }
                }
            }
            if (needUpdate) updateElements();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.dispatchEvent(new CustomEvent('languageLoaded', { detail: { language: currentLang } }));
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.I18n = { setLanguage, translate, getCurrentLang: () => currentLang };
})();