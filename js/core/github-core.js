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
    // Постобработка для GitHub-алертов
    html = enhanceMarkdownAlerts(html);
    return html;
}

// Преобразует <blockquote> с [!NOTE] и т.п. в цветные блоки
function enhanceMarkdownAlerts(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.querySelectorAll('blockquote').forEach(blockquote => {
        const firstChild = blockquote.firstElementChild || blockquote.firstChild;
        if (firstChild && firstChild.nodeType === Node.TEXT_NODE) {
            const text = firstChild.textContent.trim();
            const match = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
            if (match) {
                const type = match[1].toLowerCase();
                // Удаляем маркер из текста
                firstChild.textContent = text.substring(match[0].length).trimStart();
                // Создаём div-алерт
                const alertDiv = document.createElement('div');
                alertDiv.className = `markdown-alert markdown-alert-${type}`;
                while (blockquote.firstChild) {
                    alertDiv.appendChild(blockquote.firstChild);
                }
                blockquote.parentNode.replaceChild(alertDiv, blockquote);
            }
        }
    });
    return doc.body.innerHTML;
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
    cacheRemove,
    escapeHtml,
    renderMarkdown,
    deduplicateByNumber,
    createAbortable,
    stripHtml
};