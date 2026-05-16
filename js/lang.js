// js/lang.js — локализация без встроенных словарей, только из JSON-файлов
(function() {
    const SUPPORTED = ['ru', 'en'];
    const DEFAULT = 'ru';
    const LOCALE_PATH = 'locales/';
    const CACHE_PREFIX = 'i18n_';

    let currentLang = DEFAULT;
    let translations = {};
    let observer = null;

    const OLD_KEYS = ['i18n_ru', 'i18n_en', 'i18n_ru_time', 'i18n_en_time'];
    OLD_KEYS.forEach(key => {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
    });

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
            try {
                return JSON.parse(sessionCached);
            } catch(e) {}
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
        } catch (err) {
            console.warn(`Failed to load translations for ${lang}`, err);
            return null;
        }
    }

    function translate(key) {
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
        translations = {};
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
        translations = await fetchTranslations(currentLang) || {};
        updateElements();

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