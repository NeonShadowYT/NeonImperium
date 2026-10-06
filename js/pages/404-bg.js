// js/pages/404-bg.js — активация фонового GIF-слоя на странице 404.
// Вынесено из inline-скрипта для соответствия CSP без 'unsafe-inline'.

(function() {
    'use strict';

    function activate() {
        const layer = document.getElementById('bgGifLayer');
        if (layer) {
            setTimeout(() => layer.classList.add('active'), 100);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', activate, { once: true });
    } else {
        activate();
    }
})();