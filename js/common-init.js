// js/common-init.js — централизованный bootstrap страницы.
//   — Preconnect.
//   — Глобальный fallback изображений (data-fallback).
//   — Динамическая подгрузка page-скриптов.
//   — marked@18.1.0 (UMD) — БЕЗ SRI.
//   — DOMPurify@3.4.16 — БЕЗ SRI.
//   — Service Worker + controllerchange.
//   — Rate limits.
//   — window.loadStorageModules.
//
// Модальное окно подтверждения лицензии удалено:
// проект распространяется под MIT, дополнительная галочка не требуется.

(function() {
    'use strict';

    const isMobile = (typeof window.isMobile === 'boolean')
        ? window.isMobile
        : (() => {
            const hasTouch =
                window.matchMedia('(pointer: coarse)').matches ||
                window.matchMedia('(hover: none)').matches ||
                ('ontouchstart' in window);
            const isNarrow = window.innerWidth <= 768;
            return hasTouch || isNarrow;
        })();

    window.isMobile = isMobile;

    // ============================================================
    // Мобильный класс
    // ============================================================

    const MOBILE_CLASS_OBSERVER_TIMEOUT = 2000;

    function applyMobileClass() {
        if (document.body) {
            document.body.classList.toggle('is-mobile', isMobile);
            return;
        }
        const observer = new MutationObserver(() => {
            if (document.body) {
                document.body.classList.toggle('is-mobile', isMobile);
                observer.disconnect();
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), MOBILE_CLASS_OBSERVER_TIMEOUT);
    }

    // ============================================================
    // Глобальный fallback изображений
    // ============================================================

    function initImageFallbacks() {
        document.addEventListener('error', (e) => {
            const target = e.target;
            if (!target || target.tagName !== 'IMG') return;
            if (target.dataset.fallbackApplied === '1') return;
            target.dataset.fallbackApplied = '1';
            const fallback = target.dataset.fallback;
            if (fallback) target.src = fallback;
        }, true);
    }

    // ============================================================
    // Preconnect
    // ============================================================

    const PRECONNECT_URLS = [
        { url: 'https://cdnjs.cloudflare.com', crossOrigin: false },
        { url: 'https://cdn.jsdelivr.net', crossOrigin: true },
        { url: 'https://api.github.com', crossOrigin: true },
        { url: 'https://api.rss2json.com', crossOrigin: true },
        { url: 'https://img.youtube.com', crossOrigin: false },
        { url: 'https://i.ytimg.com', crossOrigin: false },
        { url: 'https://static-cdn.jtvnw.net', crossOrigin: false },
        { url: 'https://img.shields.io', crossOrigin: false },
        { url: 'https://telegram-badge.vercel.app', crossOrigin: false },
        { url: 'https://r.jina.ai', crossOrigin: false }
    ];

    function addPreconnects() {
        for (const item of PRECONNECT_URLS) {
            const selector = `link[rel="preconnect"][href="${item.url}"]`;
            if (document.querySelector(selector)) continue;
            const link = document.createElement('link');
            link.rel = 'preconnect';
            link.href = item.url;
            if (item.crossOrigin) link.crossOrigin = 'anonymous';
            document.head.appendChild(link);
        }
    }

    // ============================================================
    // Проверки зависимостей
    // ============================================================

    function ensureConfig() {
        if (!window.NeonConfig) {
            console.warn('[common-init] window.NeonConfig не найден.');
        }
    }

    function ensureDialog() {
        if (!window.Dialog || typeof window.Dialog.showPrompt !== 'function') {
            console.warn('[common-init] window.Dialog не найден.');
        }
    }

    function ensureCacheCrypto() {
        if (!window.CacheCrypto || typeof window.CacheCrypto.encryptCacheValue !== 'function') {
            console.warn('[common-init] CacheCrypto не загружен.');
        }
    }

    // ============================================================
    // Page scripts
    // ============================================================

    const PAGE_SCRIPTS = {
        'index': ['js/pages/news-feed.js'],
        'starve-neon': [
            'js/pages/feedback.js',
            'js/pages/game-updates.js',
            'js/platform.js',
            'js/features/background-gifs.js',
            'js/features/hashtag-videos.js'],
        'alpha-01': ['js/pages/feedback.js', 'js/pages/game-updates.js'],
        'gc-adven': ['js/pages/feedback.js', 'js/pages/game-updates.js'],
        'license': []
    };

    function getPageName() {
        const path = location.pathname;
        let page = path.split('/').pop().replace('.html', '');
        if (!page || page === 'index') return 'index';
        return page;
    }

    function loadPageScripts() {
        const page = getPageName();
        const scripts = PAGE_SCRIPTS[page] || [];
        for (const src of scripts) {
            if (!src) continue;
            if (document.querySelector(`script[src="${src}"]`)) continue;
            const s = document.createElement('script');
            s.src = src;
            s.defer = true;
            document.head.appendChild(s);
        }
    }

    // ============================================================
    // Единый загрузчик скриптов
    // ============================================================

    function loadScript(item, timeout = 10000) {
        const src = typeof item === 'string' ? item : item.src;
        const crossOrigin = (typeof item === 'object' && item.crossOrigin) ? item.crossOrigin : null;

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            if (crossOrigin) script.crossOrigin = crossOrigin;
            script.defer = true;

            const timer = setTimeout(
                () => reject(new Error(`Timeout loading ${src}`)),
                timeout
            );
            script.onload = () => { clearTimeout(timer); resolve(); };
            script.onerror = () => { clearTimeout(timer); reject(new Error(`Failed to load ${src}`)); };
            document.head.appendChild(script);
        });
    }

    // ============================================================
    // marked@18.1.0 — UMD
    // ============================================================

    const MARKED_CDNS = [
        { src: 'https://cdn.jsdelivr.net/npm/marked@18.1.0/lib/marked.umd.js', crossOrigin: 'anonymous' },
        { src: 'https://unpkg.com/marked@18.1.0/lib/marked.umd.js' }
    ];

    async function ensureMarked() {
        if (typeof window.marked !== 'undefined' && typeof window.marked.parse === 'function') {
            return;
        }
        for (const item of MARKED_CDNS) {
            try {
                await loadScript(item);
                if (typeof window.marked !== 'undefined' && typeof window.marked.parse === 'function') {
                    return;
                }
            } catch (err) {
                console.warn(`[common-init] marked: не удалось загрузить ${item.src}`);
            }
        }
        console.warn('[common-init] Все CDN для marked недоступны, используем минимальный fallback');
        window.marked = {
            parse: (txt) => Promise.resolve(String(txt).replace(/\n/g, '<br>')),
            setOptions: () => {}
        };
    }

    // ============================================================
    // DOMPurify@3.4.16
    // ============================================================

    const DOMPURIFY_CDNS = [
        { src: 'https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js', crossOrigin: 'anonymous' },
        { src: 'https://unpkg.com/dompurify@3.4.16/dist/purify.min.js' }
    ];

    async function ensureDOMPurify() {
        if (typeof window.DOMPurify !== 'undefined' && typeof window.DOMPurify.sanitize === 'function') {
            return;
        }
        for (const item of DOMPURIFY_CDNS) {
            try {
                await loadScript(item);
                if (typeof window.DOMPurify !== 'undefined' && typeof window.DOMPurify.sanitize === 'function') {
                    return;
                }
            } catch (err) {
                console.warn(`[common-init] DOMPurify: не удалось загрузить ${item.src}`, err);
            }
        }
        console.warn('[common-init] DOMPurify не загружен.');
    }

    // ============================================================
    // Dust particles (только desktop)
    // ============================================================

    function loadDustParticles() {
        if (window.isMobile) return;
        if (document.querySelector('script[src="js/dust-particles.js"]')) return;
        const script = document.createElement('script');
        script.src = 'js/dust-particles.js';
        script.defer = true;
        document.head.appendChild(script);
    }

    // ============================================================
    // Service Worker
    // ============================================================

    let refreshing = false;

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });

        navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
            .then(registration => {
                console.log('[common-init] SW registered:', registration.scope);

                if (registration.waiting) showUpdateNotification();

                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            showUpdateNotification();
                        }
                    });
                });
            })
            .catch(error => console.error('[common-init] SW registration error:', error));
    }

    function showUpdateNotification() {
        try {
            if (sessionStorage.getItem('update_notification_shown')) return;
            sessionStorage.setItem('update_notification_shown', '1');
        } catch { /* noop */ }

        const t = (window.I18n && window.I18n.translate) ? window.I18n.translate : (k => k);
        const note = document.createElement('div');
        note.id = 'update-notification';
        note.style.cssText = `
            position: fixed; bottom: 90px; right: 24px;
            z-index: 10001;
            background: var(--accent); color: #fff;
            padding: 12px 20px;
            border-radius: 40px;
            box-shadow: 0 6px 14px rgba(0,0,0,0.4);
            font-family: 'Russo One', sans-serif;
            display: flex; align-items: center; gap: 12px;
        `;

        const span = document.createElement('span');
        span.textContent = t('newVersionAvailable');
        note.appendChild(span);

        const btn = document.createElement('button');
        btn.id = 'update-btn';
        btn.textContent = t('updateBtn');
        btn.style.cssText = 'background:white;color:var(--accent);border:none;padding:6px 16px;border-radius:20px;cursor:pointer;font-family:inherit;';
        btn.addEventListener('click', () => window.location.reload());
        note.appendChild(btn);

        document.body.appendChild(note);
    }

    // ============================================================
    // Rate limits
    // ============================================================

    function initRateLimits() {
        const attachMenuItem = () => {
            const profile = document.querySelector('.nav-profile');
            if (!profile) return;
            const dropdown = profile.querySelector('.profile-dropdown');
            if (!dropdown || dropdown.querySelector('[data-action="rate-panel"]')) return;
            const t = (window.I18n && window.I18n.translate) ? window.I18n.translate : (k => k);
            const item = document.createElement('div');
            item.className = 'profile-dropdown-item';
            item.dataset.action = 'rate-panel';
            item.innerHTML = `<i class="fas fa-chart-bar"></i> ${t('ratePanel')}`;
            const divider = dropdown.querySelector('.profile-dropdown-divider');
            if (divider) dropdown.insertBefore(item, divider);
            else dropdown.appendChild(item);
        };

        if (window.RateLimits) {
            if (typeof window.RateLimits.init === 'function') window.RateLimits.init();
            window.addEventListener('github-auth-ready', attachMenuItem);
        } else {
            const script = document.createElement('script');
            script.src = 'js/features/rate-limits.js';
            script.defer = true;
            script.onload = () => {
                if (window.RateLimits && typeof window.RateLimits.init === 'function') {
                    window.RateLimits.init();
                }
                window.dispatchEvent(new CustomEvent('github-auth-ready'));
            };
            document.head.appendChild(script);
        }
    }

    // ============================================================
    // Storage (lazy load)
    // ============================================================

    let storageLoadPromise = null;

    async function loadStorageModules() {
        if (window.BookmarkStorage && typeof window.BookmarkStorage.openStorageModal === 'function') {
            return window.BookmarkStorage;
        }

        if (storageLoadPromise) return storageLoadPromise;

        storageLoadPromise = (async () => {
            const modules = [
                'js/features/storage/core.js',
                'js/features/storage/metadata.js',
                'js/features/storage/preview.js',
                'js/features/storage/download.js',
                'js/features/storage/manager.js',
                'js/features/storage/ui.js',
                'js/features/storage/index.js'
            ];

            for (const src of modules) {
                if (document.querySelector(`script[src="${src}"]`)) continue;
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = src;
                    script.defer = true;
                    script.onload = resolve;
                    script.onerror = () => reject(new Error(`Failed to load ${src}`));
                    document.head.appendChild(script);
                });
            }

            if (typeof window._StorageEnsure === 'function') {
                try { await window._StorageEnsure(); }
                catch (e) { console.warn('[Storage] ensure error:', e); }
            }
            return window.BookmarkStorage;
        })();

        try {
            return await storageLoadPromise;
        } finally {
            if (!window.BookmarkStorage) storageLoadPromise = null;
        }
    }

    // ============================================================
    // Language switcher → dropdown
    // ============================================================

    function transformLangSwitcherToDropdown() {
        const switcher = document.querySelector('.lang-switcher');
        if (!switcher) return;
        if (switcher.dataset.dropdownInitialized === 'true') return;
        switcher.dataset.dropdownInitialized = 'true';
        switcher.innerHTML = '';

        const currentLang = (window.I18n && typeof window.I18n.getCurrentLang === 'function')
            ? window.I18n.getCurrentLang()
            : 'ru';

        const dropdown = document.createElement('div');
        dropdown.className = 'lang-dropdown';

        const btn = document.createElement('button');
        btn.className = 'lang-dropdown-btn';
        btn.type = 'button';
        btn.textContent = currentLang.toUpperCase();
        dropdown.appendChild(btn);

        const menu = document.createElement('div');
        menu.className = 'lang-dropdown-menu';

        const languages = [
            { code: 'ru', label: 'Русский' },
            { code: 'en', label: 'English' }
        ];

        for (const lang of languages) {
            const item = document.createElement('div');
            item.className = 'lang-dropdown-item' + (lang.code === currentLang ? ' active' : '');
            item.textContent = lang.label;
            item.dataset.langCode = lang.code;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.I18n && typeof window.I18n.setLanguage === 'function') {
                    window.I18n.setLanguage(lang.code);
                }
                menu.classList.remove('open');
                btn.textContent = lang.code.toUpperCase();
                menu.querySelectorAll('.lang-dropdown-item').forEach(el => {
                    el.classList.toggle('active', el.dataset.langCode === lang.code);
                });
            });
            menu.appendChild(item);
        }
        dropdown.appendChild(menu);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('open');
        });

        document.addEventListener('click', () => menu.classList.remove('open'));

        switcher.appendChild(dropdown);
    }

    // ============================================================
    // Init page modules
    // ============================================================

    function initPageModules() {
        if (typeof window.initNewsFeed === 'function') window.initNewsFeed();
        if (typeof window.initFeedback === 'function') window.initFeedback();
        if (typeof window.initGameUpdates === 'function') window.initGameUpdates();
        if (typeof window.initPlatform === 'function') window.initPlatform();
    }

    // ============================================================
    // Ожидание языка
    // ============================================================

    function waitForLanguageAndInit() {
        const tryInit = () => {
            if (!window.I18n || typeof window.I18n.getCurrentLang !== 'function') return false;
            if (!window.I18n.getCurrentLang()) return false;
            const testKey = window.I18n.translate ? window.I18n.translate('siteTitle') : null;
            if (!testKey || testKey === 'siteTitle') return false;
            initPageModules();
            transformLangSwitcherToDropdown();
            return true;
        };

        if (tryInit()) return;

        document.addEventListener('languageLoaded', () => {
            initPageModules();
            transformLangSwitcherToDropdown();
        }, { once: true });

        setTimeout(() => { tryInit(); }, 800);
    }

    // ============================================================
    // Non-language init
    // ============================================================

    function initNonLanguageDependent() {
        ensureConfig();
        ensureCacheCrypto();
        ensureDialog();

        loadPageScripts();
        loadDustParticles();
        registerServiceWorker();
        initRateLimits();

        return Promise.all([ensureMarked(), ensureDOMPurify()]);
    }

    // ============================================================
    // Bootstrap
    // ============================================================

    async function bootstrap() {
        applyMobileClass();
        addPreconnects();
        initImageFallbacks();
        await initNonLanguageDependent();
        waitForLanguageAndInit();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }

    // ---- Экспорт ----
    window.loadStorageModules = loadStorageModules;
    window.ensureDOMPurify = ensureDOMPurify;
})();