// js/lang.js — локализация без встроенных словарей, только из JSON-файлов
(function() {
    const SUPPORTED = ['ru', 'en'];
    const DEFAULT = 'ru';
    const LOCALE_PATH = 'locales/';
    const CACHE_PREFIX = 'i18n_';

    let currentLang = DEFAULT;
    let translations = {};       // загруженные переводы
    let observer = null;

    function detectBrowserLang() {
        const navLang = (navigator.language || navigator.userLanguage || '').split('-')[0];
        return SUPPORTED.includes(navLang) ? navLang : DEFAULT;
    }

    function getSavedLang() {
        return localStorage.getItem('preferredLanguage') || detectBrowserLang();
    }

    async function fetchTranslations(lang) {
        const cacheKey = CACHE_PREFIX + lang;
        // сначала из sessionStorage
        const sessionCached = sessionStorage.getItem(cacheKey);
        if (sessionCached) {
            try {
                return JSON.parse(sessionCached);
            } catch(e) {}
        }
        // потом из localStorage
        const localCached = localStorage.getItem(cacheKey);
        if (localCached) {
            try {
                const data = JSON.parse(localCached);
                sessionStorage.setItem(cacheKey, JSON.stringify(data));
                return data;
            } catch(e) {}
        }
        // загрузка с сервера
        try {
            const response = await fetch(`${LOCALE_PATH}${lang}.json`);
            if (!response.ok) throw new Error();
            const data = await response.json();
            sessionStorage.setItem(cacheKey, JSON.stringify(data));
            localStorage.setItem(cacheKey, JSON.stringify(data));
            return data;
        } catch (err) {
            console.warn(`Не удалось загрузить перевод для ${lang}`, err);
            return null;
        }
    }

    function translate(key) {
        // если перевод найден – отдаём его, иначе сам ключ
        return translations[key] ?? key;
    }

    function updateElements() {
        document.querySelectorAll('[data-lang]').forEach(el => {
            const key = el.getAttribute('data-lang');
            const text = translate(key);
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                if (el.placeholder !== undefined) el.placeholder = text;
                else el.textContent = text;
            } else {
                if (el.classList.contains('markdown-body')) {
                    el.innerHTML = text.replace(/\n/g, '<br>');
                } else {
                    el.textContent = text;
                }
            }
        });

        // заголовок страницы
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

        // активная кнопка языка
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.langCode === currentLang);
        });
    }

    async function setLanguage(lang) {
        if (lang === currentLang || !SUPPORTED.includes(lang)) return;
        currentLang = lang;
        localStorage.setItem('preferredLanguage', lang);
        // сначала пустые переводы, потом грузим
        translations = {};
        updateElements(); // временно покажет ключи
        const full = await fetchTranslations(lang);
        if (full) {
            translations = full;
            updateElements();
        }
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
    }

    async function init() {
        currentLang = getSavedLang();
        translations = await fetchTranslations(currentLang) || {};
        updateElements();

        // обработчики кнопок переключения языка
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.addEventListener('click', () => setLanguage(btn.dataset.langCode));
        });

        // следим за динамически добавляемыми элементами с data-lang
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