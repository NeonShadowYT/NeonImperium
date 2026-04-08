// init.js – точка входа с корректной загрузкой marked
(async function() {
    // Загрузка стилей Font Awesome
    await ScriptLoader.loadStylesheet('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css');
    
    // Определяем страницу
    const isGamePage = window.location.pathname.includes('starve-neon') ||
                       window.location.pathname.includes('alpha-01') ||
                       window.location.pathname.includes('gc-adven');
    const hasFeedback = document.getElementById('feedback-section') !== null;
    const hasNews = document.getElementById('news-feed') !== null;
    const hasUpdates = document.getElementById('game-updates') !== null;
    const hasDonate = document.getElementById('donate-button') !== null;
    
    // Загружаем marked, если нужен, используя надёжный CDN с корректным MIME
    if (hasFeedback || hasNews || hasUpdates) {
        try {
            // Пытаемся загрузить через cdnjs (отдаёт application/javascript)
            await ScriptLoader.load('https://cdnjs.cloudflare.com/ajax/libs/marked/9.0.0/marked.min.js');
            console.log('Marked loaded from cdnjs');
        } catch (e) {
            console.warn('Failed to load marked from cdnjs, trying fallback...', e);
            try {
                // Запасной вариант: jsdelivr с указанием type (но он всё равно может отдать text/plain)
                await ScriptLoader.load('https://cdn.jsdelivr.net/npm/marked/marked.min.js');
            } catch (e2) {
                console.error('Failed to load marked from both CDNs', e2);
                // Создаём заглушку, чтобы сайт не падал
                window.marked = { parse: (text) => Promise.resolve(GithubCore.escapeHtml(text)) };
            }
        }
    }
    
    // Загружаем Itch API для донатов
    if (hasDonate && typeof Itch === 'undefined') {
        try {
            await ScriptLoader.scripts.itch();
        } catch(e) { console.warn('Itch API not loaded, donate button may not work'); }
    }
    
    // Дополнительная инициализация переключателя языка (гарантия работы)
    if (typeof window.initLanguageSwitcher === 'function') {
        window.initLanguageSwitcher();
    }
})();