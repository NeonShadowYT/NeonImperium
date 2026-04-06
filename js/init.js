(async function() {
    // Загружаем базовые стили и скрипты, которые нужны всегда
    await ScriptLoader.loadStylesheet('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css');
    
    const isGamePage = window.location.pathname.includes('starve-neon') ||
                       window.location.pathname.includes('alpha-01') ||
                       window.location.pathname.includes('gc-adven');
    const hasFeedback = document.getElementById('feedback-section') !== null;
    const hasNews = document.getElementById('news-feed') !== null;
    const hasUpdates = document.getElementById('game-updates') !== null;
    const hasDonate = document.getElementById('donate-button') !== null;
    
    if (hasFeedback || hasNews || hasUpdates) {
        await ScriptLoader.scripts.marked();
    }
    
    if (hasDonate) {
        await ScriptLoader.scripts.itch();
    }
})();