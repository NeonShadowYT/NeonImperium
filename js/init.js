// init.js – асинхронная инициализация (использует Core)
(async function() {
    await Core.loadStylesheet('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css');
    
    const isGamePage = window.location.pathname.includes('starve-neon') ||
                       window.location.pathname.includes('alpha-01') ||
                       window.location.pathname.includes('gc-adven');
    const hasFeedback = document.getElementById('feedback-section') !== null;
    const hasNews = document.getElementById('news-feed') !== null;
    const hasUpdates = document.getElementById('game-updates') !== null;
    const hasDonate = document.getElementById('donate-button') !== null;
    
    if (hasFeedback || hasNews || hasUpdates) {
        try {
            await Core.loadScript('https://cdn.jsdelivr.net/npm/marked/marked.min.js');
        } catch (e) {
            console.warn('Failed to load marked from primary CDN, trying fallback...');
            await Core.loadScript('https://unpkg.com/marked/marked.min.js');
        }
    }
    
    if (hasDonate) {
        try {
            await Core.loadScript('https://static.itch.io/api.js');
        } catch(e) {
            console.warn('Itch API not loaded, donate button may not work');
        }
    }
})();