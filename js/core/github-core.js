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

function cacheRemove(key) {
    sessionStorage.removeItem(key);
    sessionStorage.removeItem(`${key}_time`);
}

function cacheRemoveByPrefix(prefix) {
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(prefix)) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => {
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(key + '_time');
    });
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

function extractMeta(body, tag) {
    const regex = new RegExp(`<!--\\s*${tag}:\\s*(.*?)\\s*-->`, 'i');
    const match = body ? body.match(regex) : null;
    return match ? match[1].trim() : null;
}

function extractAllowed(body) {
    return extractMeta(body, 'allowed');
}

function extractSummary(body) {
    return extractMeta(body, 'summary');
}

window.GithubCore = {
    CONFIG: GITHUB_CONFIG,
    cacheGet,
    cacheSet,
    cacheRemove,
    cacheRemoveByPrefix,
    escapeHtml,
    renderMarkdown,
    deduplicateByNumber,
    createAbortable,
    stripHtml,
    extractMeta,
    extractAllowed,
    extractSummary
};