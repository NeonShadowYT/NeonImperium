// js/features/donate.js
(function() {
    function initDonateButton() {
        const btn = document.getElementById('donate-button');
        if (!btn) return;
        if (typeof Itch === 'undefined') {
            btn.classList.add('error-bounce');
            return;
        }
        try {
            Itch.attachBuyButton(btn, {
                user: 'neon-imperium',
                game: 'starve-neon',
                width: 700,
                height: 500
            });
        } catch (e) {
            btn.classList.add('error-bounce');
        }
        updateText();
        window.addEventListener('languageChanged', updateText);
        function updateText() {
            const span = btn.querySelector('span');
            if (span) span.textContent = (NeonState.getState('language') === 'en') ? 'Support' : 'Поддержать';
        }
    }
    document.addEventListener('DOMContentLoaded', initDonateButton);
})();