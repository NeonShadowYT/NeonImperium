// js/utils.js – централизованные утилиты для всего сайта
// Добавлены: throttleRAF, batchDOMUpdates, memoize, isLowPerformance

(function() {
    const CONFIG = window.GithubCore?.CONFIG || {
        CACHE_TTL: 10 * 60 * 1000,
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium'
    };

    // ---------- СУЩЕСТВУЮЩИЕ ФУНКЦИИ ----------
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function stripHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    }

    function createElement(tag, className, styles = {}, attrs = {}) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        Object.assign(el.style, styles);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    }

    function formatDate(date, lang = null) {
        const locale = lang || localStorage.getItem('preferredLanguage') || 'ru';
        const d = new Date(date);
        return d.toLocaleDateString(locale === 'en' ? 'en-US' : 'ru-RU', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    function cacheGet(key, ttl = CONFIG.CACHE_TTL) {
        const session = sessionStorage.getItem(key);
        const sessionTime = sessionStorage.getItem(`${key}_time`);
        if (session && sessionTime && (Date.now() - parseInt(sessionTime) < ttl)) {
            return JSON.parse(session);
        }
        try {
            const local = localStorage.getItem(key);
            const localTime = localStorage.getItem(`${key}_time`);
            if (local && localTime && (Date.now() - parseInt(localTime) < ttl)) {
                sessionStorage.setItem(key, local);
                sessionStorage.setItem(`${key}_time`, localTime);
                return JSON.parse(local);
            }
        } catch {}
        return null;
    }

    function cacheSet(key, data) {
        const str = JSON.stringify(data);
        sessionStorage.setItem(key, str);
        sessionStorage.setItem(`${key}_time`, Date.now().toString());
        try {
            localStorage.setItem(key, str);
            localStorage.setItem(`${key}_time`, Date.now().toString());
        } catch {}
    }

    function cacheRemove(key) {
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(`${key}_time`);
        try {
            localStorage.removeItem(key);
            localStorage.removeItem(`${key}_time`);
        } catch {}
    }

    function cacheRemoveByPrefix(prefix) {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith(prefix)) {
                sessionStorage.removeItem(k);
                sessionStorage.removeItem(k + '_time');
            }
        }
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.startsWith(prefix)) {
                    localStorage.removeItem(k);
                    localStorage.removeItem(k + '_time');
                }
            }
        } catch {}
    }

    function deduplicateByNumber(items) {
        const seen = new Set();
        return items.filter(i => {
            if (seen.has(i.number)) return false;
            seen.add(i.number);
            return true;
        });
    }

    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function throttle(fn, delay) {
        let last = 0;
        return function(...args) {
            const now = Date.now();
            if (now - last >= delay) {
                last = now;
                fn.apply(this, args);
            }
        };
    }

    function renderMarkdown(text) {
        if (!text) return '';
        if (window.marked) {
            if (typeof marked.setOptions === 'function') {
                marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
            }
            if (typeof marked.parse === 'function') {
                return marked.parse(text);
            } else if (typeof marked === 'function') {
                return marked(text);
            }
        }
        return text.replace(/\n/g, '<br>');
    }

    function createAbortable(timeout = 20000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return { controller, timeoutId };
    }

    const loadedScripts = new Set();
    function loadModule(path) {
        if (loadedScripts.has(path)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = path;
            script.async = true;
            script.onload = () => { loadedScripts.add(path); resolve(); };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function stripMarkdownAndHtml(text) {
        if (!text) return '';
        let cleaned = text;
        cleaned = cleaned.replace(/<details[\s\S]*?<\/details>/gi, '');
        cleaned = cleaned.replace(/<[^>]*>/g, ' ');
        cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
        cleaned = cleaned.replace(/<div class="youtube-embed">[\s\S]*?<\/div>/gi, '');
        cleaned = cleaned.replace(/\bhttps?:\/\/[^\s]+/g, '');
        cleaned = cleaned.replace(/[#*_~`>\-+=|]/g, ' ');
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        return cleaned;
    }

    function getPlainTextLength(text) {
        const plain = stripMarkdownAndHtml(text);
        return plain.length;
    }

    function containsGitHubToken(text) {
        if (!text) return false;
        const patterns = [
            /ghp_[a-zA-Z0-9]{36}/,
            /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/,
            /gho_[a-zA-Z0-9]{36}/,
            /ghu_[a-zA-Z0-9]{36}/,
            /ghs_[a-zA-Z0-9]{36}/,
            /gpl_[a-zA-Z0-9]{36}/
        ];
        for (const p of patterns) {
            if (p.test(text)) return true;
        }
        if (/\bgithub_token\b/i.test(text)) return true;
        return false;
    }

    // ---------- НОВЫЕ УТИЛИТЫ ----------

    function throttleRAF(fn) {
        let scheduled = false;
        let lastArgs = null;
        return function(...args) {
            lastArgs = args;
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                fn.apply(this, lastArgs);
                scheduled = false;
            });
        };
    }

    function batchDOMUpdates(updateFn, delay = 0) {
        let pending = false;
        let timer = null;
        return function(...args) {
            if (pending) return;
            pending = true;
            const execute = () => {
                pending = false;
                if (timer) { clearTimeout(timer); timer = null; }
                requestAnimationFrame(() => {
                    updateFn.apply(this, args);
                });
            };
            if (delay > 0) {
                timer = setTimeout(execute, delay);
            } else {
                execute();
            }
        };
    }

    function memoize(fn, keyGenerator = null, maxSize = 100) {
        const cache = new Map();
        return function(...args) {
            const key = keyGenerator ? keyGenerator(args) : JSON.stringify(args);
            if (cache.has(key)) {
                return cache.get(key);
            }
            const result = fn.apply(this, args);
            if (cache.size >= maxSize) {
                const firstKey = cache.keys().next().value;
                cache.delete(firstKey);
            }
            cache.set(key, result);
            return result;
        };
    }

    function isLowPerformance() {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return true;
        }
        const cores = navigator.hardwareConcurrency || 4;
        if (cores < 4) return true;
        const isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        const isSmallScreen = window.innerWidth < 768;
        if (isMobile && isSmallScreen) return true;
        if (navigator.deviceMemory && navigator.deviceMemory < 4) return true;
        return false;
    }

    // Экспорт
    window.Utils = {
        // Существующие
        escapeHtml, stripHtml, createElement, formatDate,
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
        deduplicateByNumber, debounce, throttle, renderMarkdown,
        createAbortable, loadModule,
        stripMarkdownAndHtml,
        getPlainTextLength,
        containsGitHubToken,
        // Новые
        throttleRAF,
        batchDOMUpdates,
        memoize,
        isLowPerformance
    };
})();