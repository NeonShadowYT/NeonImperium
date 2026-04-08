// github-core.js – базовые конфиги и хелперы
(function() {
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium',
        CACHE_TTL: 10 * 60 * 1000,
        ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567']
    };

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async function renderMarkdown(text) {
        if (!text) return '';
        if (!window.marked) {
            if (typeof ScriptLoader !== 'undefined' && ScriptLoader.scripts && ScriptLoader.scripts.marked) {
                await ScriptLoader.scripts.marked();
            } else {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }
        }
        if (window.marked) {
            marked.setOptions({ gfm: true, breaks: true, pedantic: false, headerIds: false, mangle: false });
            return marked.parse(text);
        }
        return escapeHtml(text);
    }

    function deduplicateByNumber(items) {
        const seen = new Set();
        return items.filter(item => {
            if (seen.has(item.number)) return false;
            seen.add(item.number);
            return true;
        });
    }

    function createAbortable(timeout = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return { controller, timeoutId };
    }

    function stripHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }

    function extractMeta(body, tag) {
        const regex = new RegExp(`<!--\\s*${tag}:\\s*(.*?)\\s*-->`, 'i');
        const match = body ? body.match(regex) : null;
        return match ? match[1].trim() : null;
    }

    function extractAllowed(body) { return extractMeta(body, 'allowed'); }
    function extractSummary(body) { return extractMeta(body, 'summary'); }

    // Прокси к глобальному кешу
    function cacheGet(key) { return window.Cache ? window.Cache.get(key) : null; }
    function cacheSet(key, data) { if (window.Cache) window.Cache.set(key, data); }
    function cacheRemove(key) { if (window.Cache) window.Cache.remove(key); }
    function cacheRemoveByPrefix(prefix) { if (window.Cache) window.Cache.removeByPrefix(prefix); }

    window.GithubCore = {
        CONFIG,
        escapeHtml,
        renderMarkdown,
        deduplicateByNumber,
        createAbortable,
        stripHtml,
        extractMeta,
        extractAllowed,
        extractSummary,
        cacheGet,
        cacheSet,
        cacheRemove,
        cacheRemoveByPrefix
    };
})();