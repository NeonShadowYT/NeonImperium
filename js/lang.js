// js/lang.js — улучшенная локализация с асинхронной загрузкой и кешированием

const I18n = (function() {
    const DEFAULT_LANG = 'ru';
    const SUPPORTED_LANGS = ['ru', 'en'];
    const LOCALE_PATH = 'locales/';

    let currentLang = DEFAULT_LANG;
    let translations = {};
    let loadedBundles = new Set();
    let observer = null;

    // Встроенный минимальный словарь для предотвращения мерцания
    const EMBEDDED = {
        ru: {
            navHome: "Neon Imperium",
            navStarve: "Starve Neon",
            navAlpha: "Alpha 01",
            navGc: "ГК Адвенчур",
            siteTitle: "Neon Imperium",
            backHome: "Вернуться на главную",
            donateButton: "Поддержать"
        },
        en: {
            navHome: "Neon Imperium",
            navStarve: "Starve Neon",
            navAlpha: "Alpha 01",
            navGc: "GC Adven",
            siteTitle: "Neon Imperium",
            backHome: "Back to home",
            donateButton: "Support"
        }
    };

    // Получить сохранённый язык
    function getSavedLang() {
        return localStorage.getItem('preferredLanguage') || DEFAULT_LANG;
    }

    // Сохранить язык
    function saveLang(lang) {
        localStorage.setItem('preferredLanguage', lang);
    }

    // Загрузить JSON с переводом
    async function fetchTranslations(lang) {
        try {
            const response = await fetch(`${LOCALE_PATH}${lang}.json`);
            if (!response.ok) throw new Error(`Failed to load ${lang}.json`);
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Ошибка загрузки переводов:', error);
            // Возвращаем пустой объект, чтобы использовать встроенные
            return {};
        }
    }

    // Загрузить переводы с кешированием в localStorage
    async function loadTranslations(lang) {
        if (loadedBundles.has(lang)) return;

        const cacheKey = `i18n_${lang}`;
        const cached = localStorage.getItem(cacheKey);

        if (cached) {
            try {
                const parsed = JSON.parse(cached);
                if (parsed && Object.keys(parsed).length > 0) {
                    translations = { ...translations, ...parsed };
                    loadedBundles.add(lang);
                    return;
                }
            } catch (e) { /* ignore corrupt cache */ }
        }

        // Загружаем из сети
        const data = await fetchTranslations(lang);
        if (Object.keys(data).length > 0) {
            localStorage.setItem(cacheKey, JSON.stringify(data));
            translations = { ...translations, ...data };
        }
        loadedBundles.add(lang);
    }

    // Получить перевод
    function translate(key) {
        return translations[key] ?? EMBEDDED?.[currentLang]?.[key] ?? key;
    }

    // Обновить все элементы с data-lang
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

        // Обновить заголовок
        const titleKey = document.title.includes('Starve') ? 'starvePageTitle' :
                         (document.title.includes('Alpha') ? 'alphaPageTitle' :
                         (document.title.includes('ГК') || document.title.includes('GC') ? 'gcPageTitle' : 'siteTitle'));
        document.title = translate(titleKey);

        // Обновить кнопки языка
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.langCode === currentLang);
        });
    }

    // Стартовая инициализация
    async function init() {
        currentLang = getSavedLang();
        translations = { ...EMBEDDED[currentLang] };
        loadedBundles.add(currentLang);

        // Быстрое применение встроенных переводов
        updateElements();

        // Асинхронная загрузка полного словаря
        await loadTranslations(currentLang);
        updateElements();

        // Установка обработчиков для кнопок языка
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.addEventListener('click', () => setLanguage(btn.dataset.langCode));
        });

        // MutationObserver для динамических элементов
        observer = new MutationObserver(mutations => {
            let needUpdate = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Проверяем, есть ли в добавленных узлах элементы с data-lang
                    for (const node of mutation.addedNodes) {
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
    }

    // Смена языка
    async function setLanguage(lang) {
        if (lang === currentLang) return;
        if (!SUPPORTED_LANGS.includes(lang)) return;

        currentLang = lang;
        saveLang(lang);

        translations = { ...EMBEDDED[lang] };
        updateElements();

        // Загружаем полный словарь
        loadedBundles.delete(lang); // разрешаем перезагрузку
        await loadTranslations(lang);
        updateElements();

        // Оповещаем другие модули
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
    }

    // Инициализация при загрузке DOM
    document.addEventListener('DOMContentLoaded', init);

    return {
        setLanguage,
        translate,
        loadTranslations,
        getCurrentLang: () => currentLang
    };
})();