// js/core/animations.js
(function() {
    /**
     * Анимирует появление элемента с fadeInUp.
     * @param {HTMLElement} el
     * @param {number} delay - задержка в мс
     * @param {number} duration - длительность в мс
     */
    function fadeInUp(el, delay = 0, duration = 600) {
        if (!el) return;
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = `opacity ${duration}ms cubic-bezier(0.2, 0.9, 0.4, 1), transform ${duration}ms cubic-bezier(0.2, 0.9, 0.4, 1)`;
        el.style.willChange = 'opacity, transform';
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, delay);
    }

    /**
     * Анимирует исчезновение.
     */
    function fadeOut(el, duration = 300) {
        if (!el) return Promise.resolve();
        return new Promise((resolve) => {
            el.style.transition = `opacity ${duration}ms ease`;
            el.style.opacity = '0';
            setTimeout(() => {
                resolve();
            }, duration);
        });
    }

    /**
     * Троттлинг с requestAnimationFrame.
     */
    function throttleRAF(fn) {
        let running = false;
        return function(...args) {
            if (running) return;
            running = true;
            requestAnimationFrame(() => {
                fn.apply(this, args);
                running = false;
            });
        };
    }

    /**
     * Дебаунс с requestAnimationFrame.
     */
    function debounceRAF(fn, delay = 0) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => {
                requestAnimationFrame(() => {
                    fn.apply(this, args);
                });
            }, delay);
        };
    }

    /**
     * Применяет will-change для оптимизации перед анимацией, затем удаляет.
     */
    function optimizeForAnimation(el, props = 'transform, opacity') {
        el.style.willChange = props;
        // Удаляем will-change после завершения анимации, чтобы не занимать память.
        const onFinish = () => {
            el.style.willChange = 'auto';
            el.removeEventListener('transitionend', onFinish);
        };
        el.addEventListener('transitionend', onFinish);
    }

    window.Animations = {
        fadeInUp,
        fadeOut,
        throttleRAF,
        debounceRAF,
        optimizeForAnimation
    };
})();