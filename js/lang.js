// js/lang.js — локализация через JSON-файлы (locales/ru.json, locales/en.json).
// Кеширует переводы в sessionStorage + localStorage.
// Поддерживает HTML в переводах через DomUtils.setElementText (санитизация).
// Языковой переключатель создаётся в common-init.js как dropdown.

(function() {
    'use strict';

    const SUPPORTED = ['ru', 'en'];
    const DEFAULT = 'ru';
    const LOCALE_PATH = 'locales/';
    const CACHE_PREFIX = 'i18n_';

    let currentLang = DEFAULT;
    let translations = {};
    let observer = null;

    function cleanLegacyKeys() {
        const legacy = ['i18n_ru', 'i18n_en', 'i18n_ru_time', 'i18n_en_time'];
        for (const key of legacy) {
            try { sessionStorage.removeItem(key); } catch { /* noop */ }
            try { localStorage.removeItem(key); } catch { /* noop */ }
        }
    }

    function detectBrowserLang() {
        const navLang = (navigator.language || navigator.userLanguage || '').split('-')[0];
        return SUPPORTED.includes(navLang) ? navLang : DEFAULT;
    }

    function getSavedLang() {
        try {
            const saved = localStorage.getItem('preferredLanguage');
            if (saved && SUPPORTED.includes(saved)) return saved;
        } catch { /* noop */ }
        return detectBrowserLang();
    }

    async function fetchTranslations(lang) {
        const cacheKey = CACHE_PREFIX + lang;

        try {
            const cached = sessionStorage.getItem(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && typeof parsed === 'object') return parsed;
            }
        } catch { /* noop */ }

        try {
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed && typeof parsed === 'object') {
                    try { sessionStorage.setItem(cacheKey, cached); } catch { /* noop */ }
                    return parsed;
                }
            }
        } catch { /* noop */ }

        try {
            const response = await fetch(`${LOCALE_PATH}${lang}.json`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* noop */ }
            try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch { /* noop */ }
            return data;
        } catch (err) {
            console.warn(`[I18n] Failed to load translations for ${lang}:`, err);
            return null;
        }
    }

    function translate(key) {
        if (!key) return '';
        if (Object.prototype.hasOwnProperty.call(translations, key)) {
            return translations[key];
        }
        return key;
    }

    function updateElements() {
        const setText = (window.DomUtils && window.DomUtils.setElementText)
            ? window.DomUtils.setElementText
            : (el, text) => { el.textContent = text == null ? '' : String(text); };

        document.querySelectorAll('[data-lang]').forEach(el => {
            const key = el.getAttribute('data-lang');
            if (!key) return;
            setText(el, translate(key));
        });

        const titleKeys = {
            '/': 'siteTitle',
            '/index.html': 'siteTitle',
            '/starve-neon.html': 'starvePageTitle',
            '/alpha-01.html': 'alphaPageTitle',
            '/gc-adven.html': 'gcPageTitle',
            '/license.html': 'licenseTitle',
            '/404.html': 'notFoundTitle'
        };
        const path = location.pathname;
        const fileName = path.split('/').pop() || 'index.html';
        const titleKey = titleKeys[path] || titleKeys[fileName] || 'siteTitle';
        document.title = translate(titleKey);
    }

    async function setLanguage(lang) {
        if (lang === currentLang || !SUPPORTED.includes(lang)) return;

        currentLang = lang;
        try { localStorage.setItem('preferredLanguage', lang); }
        catch { /* noop */ }

        const full = await fetchTranslations(lang);
        if (full) {
            translations = full;
            updateElements();
        }

        window.dispatchEvent(new CustomEvent('languageChanged', {
            detail: { language: lang }
        }));
    }

    async function init() {
        cleanLegacyKeys();

        currentLang = getSavedLang();
        const loaded = await fetchTranslations(currentLang);
        translations = loaded || {};

        updateElements();

        if (observer) observer.disconnect();
        observer = new MutationObserver(mutations => {
            let needUpdate = false;
            for (const m of mutations) {
                if (m.type !== 'childList' || !m.addedNodes.length) continue;
                for (const node of m.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    if (node.matches && node.matches('[data-lang]')) { needUpdate = true; break; }
                    if (node.querySelector && node.querySelector('[data-lang]')) { needUpdate = true; break; }
                }
                if (needUpdate) break;
            }
            if (needUpdate) updateElements();
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Очистка observer при уходе со страницы
        window.addEventListener('pagehide', () => {
            if (observer) { observer.disconnect(); observer = null; }
        }, { once: true });

        window.dispatchEvent(new CustomEvent('languageLoaded', {
            detail: { language: currentLang }
        }));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    window.I18n = {
        setLanguage,
        translate,
        getCurrentLang: () => currentLang
    };
})();