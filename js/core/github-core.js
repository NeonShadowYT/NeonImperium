// github-core.js — общие утилиты

const GITHUB_CONFIG = {
    REPO_OWNER: 'NeonShadowYT',
    REPO_NAME: 'NeonImperium',
    CACHE_TTL: 10 * 60 * 1000, // 10 минут
    ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567']
};

// Кеширование
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

// Экранирование
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Рендер Markdown
function renderMarkdown(text) {
    if (window.marked) {
        return marked.parse(text);
    }
    return text.replace(/\n/g, '<br>');
}

// Экспорт
window.GithubCore = {
    CONFIG: GITHUB_CONFIG,
    cacheGet,
    cacheSet,
    cacheRemove,
    escapeHtml,
    renderMarkdown
};