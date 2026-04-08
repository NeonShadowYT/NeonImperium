// init.js
(async function() {
    // Загрузка стилей
    await ScriptLoader.loadStylesheet('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css');
    
    // Определяем страницу
    const isGamePage = window.location.pathname.includes('starve-neon') ||
                       window.location.pathname.includes('alpha-01') ||
                       window.location.pathname.includes('gc-adven');
    const hasFeedback = document.getElementById('feedback-section') !== null;
    const hasNews = document.getElementById('news-feed') !== null;
    const hasUpdates = document.getElementById('game-updates') !== null;
    const hasDonate = document.getElementById('donate-button') !== null;
    
    // Загружаем marked, если нужен
    if (hasFeedback || hasNews || hasUpdates) {
        try {
            await ScriptLoader.loadScript('https://cdn.jsdelivr.net/npm/marked/marked.min.js');
        } catch (e) {
            console.warn('Failed to load marked from primary CDN, trying fallback...');
            await ScriptLoader.loadScript('https://unpkg.com/marked/marked.min.js');
        }
    }
    
    // Загружаем Itch API для донатов
    if (hasDonate) {
        try {
            await ScriptLoader.scripts.itch();
        } catch(e) {
            console.warn('Itch API not loaded, donate button may not work');
        }
    }
    
    // Инициализируем языковой переключатель и прочее
    // (остальное уже инициализируется в других скриптах)
})();