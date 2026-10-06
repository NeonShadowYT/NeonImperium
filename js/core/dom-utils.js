// js/core/dom-utils.js
// Чистые DOM-утилиты без побочных эффектов.
// Публикует window.DomUtils и расширяет window.Utils для обратной совместимости.

(function() {
    'use strict';

    function escapeHtml(text) {
        if (text == null) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    function stripHtml(html) {
        if (html == null) return '';
        const div = document.createElement('div');
        div.innerHTML = String(html);
        return div.textContent || div.innerText || '';
    }

    function createElement(tag, className, styles = {}, attrs = {}) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (styles && typeof styles === 'object') {
            Object.assign(el.style, styles);
        }
        if (attrs && typeof attrs === 'object') {
            for (const [k, v] of Object.entries(attrs)) {
                if (v != null) el.setAttribute(k, String(v));
            }
        }
        return el;
    }

    function formatDate(date, lang = null) {
        let locale = lang;
        if (!locale) {
            try { locale = localStorage.getItem('preferredLanguage') || 'ru'; }
            catch { locale = 'ru'; }
        }
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString(locale === 'en' ? 'en-US' : 'ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    /**
     * Устанавливает текст/HTML в элемент с поддержкой HTML-разметки.
     * Для INPUT/TEXTAREA — placeholder или value.
     * Для остальных — innerHTML через sanitizeHtml (если есть HTML-теги),
     * иначе textContent.
     *
     * Безопасность: если DOMPurify не загружен — textContent (не innerHTML).
     */
    function setElementText(el, text) {
        if (!el) return;
        const tag = el.tagName;
        const value = text == null ? '' : String(text);

        if (tag === 'INPUT' || tag === 'TEXTAREA') {
            if (el.hasAttribute('placeholder')) el.placeholder = value;
            else el.value = value;
            return;
        }

        // Быстрая проверка: есть ли HTML-теги
        const looksLikeHtml = /<[a-z][\s\S]*>/i.test(value);
        if (!looksLikeHtml) {
            el.textContent = value;
            return;
        }

        const hasDOMPurify = typeof window.DOMPurify !== 'undefined'
            && typeof window.DOMPurify.sanitize === 'function';
        const hasSanitizer = window.Utils
            && typeof window.Utils.sanitizeHtml === 'function';

        if (hasDOMPurify && hasSanitizer) {
            el.innerHTML = window.Utils.sanitizeHtml(value);
        } else {
            // HTML, но санитайзера нет — textContent безопаснее
            el.textContent = value;
        }
    }

    const api = { escapeHtml, stripHtml, createElement, formatDate, setElementText };
    window.DomUtils = api;
    window.Utils = Object.assign(window.Utils || {}, api);
})();