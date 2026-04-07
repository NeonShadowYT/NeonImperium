// accessibility.js – улучшение доступности (aria-метки, клавиатурные модалки, объявления)
(function() {
    function addAriaLabels() {
        document.querySelectorAll('.nav-link').forEach(link => {
            if (!link.getAttribute('aria-label')) {
                link.setAttribute('aria-label', `Перейти к ${link.textContent.trim()}`);
            }
        });
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.setAttribute('aria-label', `Изменить язык на ${btn.textContent.trim()}`);
        });
        document.querySelectorAll('.project-card-link').forEach(card => {
            if (!card.getAttribute('aria-label')) {
                const title = card.querySelector('h3')?.textContent;
                if (title) card.setAttribute('aria-label', `Открыть: ${title}`);
            }
        });
        document.querySelectorAll('.button, .download-button').forEach(btn => {
            if (!btn.getAttribute('aria-label') && btn.textContent.trim()) {
                btn.setAttribute('aria-label', btn.textContent.trim());
            }
        });
    }

    function handleKeyboardModals() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modal = document.querySelector('.modal.active, .modal-fullscreen');
                if (modal) {
                    const closeBtn = modal.querySelector('.modal-close');
                    if (closeBtn) closeBtn.click();
                }
            }
        });
    }

    function announceDynamicContent(message, priority = 'polite') {
        let announcer = document.getElementById('aria-announcer');
        if (!announcer) {
            announcer = document.createElement('div');
            announcer.id = 'aria-announcer';
            announcer.setAttribute('aria-live', priority);
            announcer.setAttribute('aria-atomic', 'true');
            announcer.className = 'visually-hidden';
            document.body.appendChild(announcer);
        }
        announcer.textContent = message;
        setTimeout(() => { announcer.textContent = ''; }, 3000);
    }

    function init() {
        addAriaLabels();
        handleKeyboardModals();
        window.announceDynamicContent = announceDynamicContent;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();