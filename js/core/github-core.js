const GITHUB_CONFIG = {
    REPO_OWNER: 'NeonShadowYT',
    REPO_NAME: 'NeonImperium',
    CACHE_TTL: 10 * 60 * 1000,
    ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567']
};

function cacheGet(key) {
    const cached = sessionStorage.getItem(key);
    const time = sessionStorage.getItem(`${key}_time`);
    if (cached && time && (Date.now() - parseInt(time) < GITHUB_CONFIG.CACHE_TTL)) {
        return JSON.parse(cached);
    }
    return null;
}

function cacheSet(key, data) {
    sessionStorage.setItem(key, JSON.stringify(data));
    sessionStorage.setItem(`${key}_time`, Date.now().toString());
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderMarkdown(text) {
    if (!text) return '';
    let html = '';
    if (window.marked) {
        marked.setOptions({ gfm: true, breaks: true, pedantic: false, headerIds: false, mangle: false });
        html = marked.parse(text);
    } else {
        html = text.replace(/\n/g, '<br>');
    }
    return html;
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

window.GithubCore = {
    CONFIG: GITHUB_CONFIG,
    cacheGet,
    cacheSet,
    escapeHtml,
    renderMarkdown,
    deduplicateByNumber,
    createAbortable,
    stripHtml
};