// js/core/dom-utils.js
(function() {
    /**
     * Создаёт DOM-элемент с заданными свойствами.
     * @param {string} tag - тег элемента
     * @param {string|string[]} [className] - класс(ы)
     * @param {Object} [styles] - CSS-стили в camelCase
     * @param {Object} [attrs] - атрибуты
     * @param {string|Element|Node} [children] - дочерний контент (строка HTML или узел)
     * @returns {HTMLElement}
     */
    function createElement(tag, className, styles = {}, attrs = {}, children = null) {
        const el = document.createElement(tag);
        if (className) {
            if (Array.isArray(className)) {
                el.classList.add(...className);
            } else {
                el.className = className;
            }
        }
        Object.assign(el.style, styles);
        for (const [key, value] of Object.entries(attrs)) {
            el.setAttribute(key, value);
        }
        if (children) {
            if (typeof children === 'string') {
                el.innerHTML = children;
            } else if (children instanceof Node || Array.isArray(children)) {
                const append = (child) => {
                    if (child instanceof Node) el.appendChild(child);
                    else if (typeof child === 'string') el.innerHTML += child;
                };
                if (Array.isArray(children)) {
                    children.forEach(append);
                } else {
                    append(children);
                }
            }
        }
        return el;
    }

    /**
     * Добавляет или удаляет класс на элементе с анимацией перехода.
     * @param {HTMLElement} el
     * @param {string} className
     * @param {boolean} add
     */
    function toggleClassWithTransition(el, className, add) {
        if (add) {
            el.classList.add(className);
        } else {
            el.classList.remove(className);
        }
    }

    /**
     * Устанавливает CSS-переменную для элемента.
     */
    function setCssVar(el, name, value) {
        el.style.setProperty(name, value);
    }

    /**
     * Удаляет все дочерние узлы.
     */
    function emptyElement(el) {
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
    }

    /**
     * Вставляет элемент после другого.
     */
    function insertAfter(newNode, referenceNode) {
        referenceNode.parentNode.insertBefore(newNode, referenceNode.nextSibling);
    }

    window.DomUtils = {
        createElement,
        toggleClassWithTransition,
        setCssVar,
        emptyElement,
        insertAfter
    };
})();