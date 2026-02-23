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

// Преобразует <blockquote> с [!NOTE] и т.п. в цветные блоки с иконками и заголовками
function enhanceMarkdownAlerts(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const alertTypes = {
        note: { icon: 'fa-info-circle', title: 'Note' },
        tip: { icon: 'fa-lightbulb', title: 'Tip' },
        important: { icon: 'fa-exclamation', title: 'Important' },
        warning: { icon: 'fa-exclamation-triangle', title: 'Warning' },
        caution: { icon: 'fa-bolt', title: 'Caution' }
    };

    doc.querySelectorAll('blockquote').forEach(blockquote => {
        const firstChild = blockquote.firstChild;
        if (!firstChild) return;
        
        let textNode = firstChild.nodeType === Node.TEXT_NODE ? firstChild : null;
        if (!textNode) return;
        
        const text = textNode.textContent.trim();
        const match = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
        if (!match) return;
        
        const type = match[1].toLowerCase();
        const typeInfo = alertTypes[type];
        if (!typeInfo) return;
        
        // Удаляем маркер из текста
        textNode.textContent = text.substring(match[0].length);
        
        // Создаём новый div-алерт
        const alertDiv = document.createElement('div');
        alertDiv.className = `markdown-alert markdown-alert-${type}`;
        
        // Заголовок с иконкой
        const titleDiv = document.createElement('div');
        titleDiv.className = 'markdown-alert-title';
        titleDiv.innerHTML = `<i class="fas ${typeInfo.icon}"></i> ${typeInfo.title}`;
        alertDiv.appendChild(titleDiv);
        
        // Контейнер для содержимого (все оставшиеся узлы blockquote)
        const contentDiv = document.createElement('div');
        contentDiv.className = 'markdown-alert-content';
        while (blockquote.firstChild) {
            contentDiv.appendChild(blockquote.firstChild);
        }
        alertDiv.appendChild(contentDiv);
        
        // Заменяем blockquote на alertDiv
        blockquote.parentNode.replaceChild(alertDiv, blockquote);
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