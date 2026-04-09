// js/app.js
(function() {
    // Загружаем только необходимые модули сразу
    // Остальные подгружаются по требованию через динамический импорт (если нужно) или события

    // Инициализация базовых вещей уже выполнена в подключённых скриптах

    // Ленивая загрузка marked при первом вызове рендеринга
    const originalRender = NeonUtils.renderMarkdown;
    NeonUtils.renderMarkdown = function(text) {
        if (typeof marked === 'undefined') {
            Editor.ensureMarked().then(() => {
                // Но рендеринг должен быть синхронным, поэтому возвращаем fallback
            });
        }
        return originalRender(text);
    };

    // Глобальные обработчики для открытия редактора и модалок
    window.addEventListener('open-comment-editor', (e) => {
        import('./features/editor-full.js').then(module => {
            module.openCommentEditor(e.detail);
        });
    });

    // Экспортируем UIFeedback.openEditorModal
    window.UIFeedback = window.UIFeedback || {};
    window.UIFeedback.openEditorModal = (mode, data, type) => {
        import('./features/editor-full.js').then(module => {
            module.openEditorModal(mode, data, type);
        });
    };
    window.UIFeedback.openFullModal = (post) => {
        import('./features/feedback.js').then(module => {
            module.openFullModal(post);
        });
    };
})();