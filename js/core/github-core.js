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

// Рендер Markdown с дополнительными функциями
function renderMarkdown(text) {
    if (!text) return '';

    let html = '';

    if (window.marked) {
        marked.setOptions({
            gfm: true,
            breaks: true,
            pedantic: false,
            headerIds: false,
            mangle: false
        });
        html = marked.parse(text);
    } else {
        html = text.replace(/\n/g, '<br>');
    }

    const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s]*)/g;
    html = html.replace(youtubeRegex, (match, videoId) => {
        return `<div class="youtube-embed"><iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe></div>`;
    });

    return html;
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