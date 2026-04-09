// js/core/utils.js
(function() {
    const CACHE_PREFIX = `neon_${NeonConfig.CACHE_VERSION}_`;

    // ---------- Кеш ----------
    function cacheGet(key) {
        const fullKey = CACHE_PREFIX + key;
        const item = sessionStorage.getItem(fullKey);
        if (!item) return null;
        try {
            const parsed = JSON.parse(item);
            if (Date.now() - parsed.t > NeonConfig.CACHE_TTL) {
                sessionStorage.removeItem(fullKey);
                return null;
            }
            return parsed.v;
        } catch (e) {
            return null;
        }
    }

    function cacheSet(key, value) {
        const fullKey = CACHE_PREFIX + key;
        const data = { v: value, t: Date.now() };
        sessionStorage.setItem(fullKey, JSON.stringify(data));
    }

    function cacheRemove(key) {
        sessionStorage.removeItem(CACHE_PREFIX + key);
    }

    function cacheRemoveByPrefix(prefix) {
        const fullPrefix = CACHE_PREFIX + prefix;
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith(fullPrefix)) {
                sessionStorage.removeItem(key);
            }
        }
    }

    function clearAllCache() {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith('neon_')) sessionStorage.removeItem(key);
        }
    }

    // ---------- DOM / строки ----------
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function stripHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }

    // ---------- Встроенный парсер Markdown (HTML остаётся нетронутым) ----------
    function renderMarkdown(text) {
        if (!text) return '';
        let html = text;

        // Блоки кода — экранируем внутренности
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            return `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`;
        });

        // Инлайн-код — экранируем
        html = html.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);

        // Заголовки
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

        // Жирный, курсив, зачёркнутый
        html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        html = html.replace(/___(.*?)___/g, '<strong><em>$1</em></strong>');
        html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
        html = html.replace(/_(.*?)_/g, '<em>$1</em>');
        html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');

        // Горизонтальная линия
        html = html.replace(/^\s*[-*_]{3,}\s*$/gim, '<hr>');

        // Ссылки [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

        // Изображения ![alt](url)
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

        // Цитаты (символ > остаётся как есть, не экранируется)
        html = html.replace(/^\s*&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
        html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

        // Маркированные списки
        html = html.replace(/^[\s]*[-*+]\s+(.*)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/gs, (match) => '<ul>' + match + '</ul>');
        html = html.replace(/<\/ul>\s*<ul>/g, '');

        // Нумерованные списки
        html = html.replace(/^\s*\d+\.\s+(.*)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/gs, (match) => '<ol>' + match + '</ol>');
        html = html.replace(/<\/ol>\s*<ol>/g, '');

        // Таблицы (упрощённо)
        html = html.replace(/^\|(.+)\|$/gm, (row) => {
            const cells = row.split('|').filter(c => c.trim() !== '');
            const isHeader = row.includes('---');
            if (isHeader) return '';
            const cellTag = 'td';
            return '<tr>' + cells.map(cell => `<${cellTag}>${cell.trim()}</${cellTag}>`).join('') + '</tr>';
        });
        html = html.replace(/(<tr>.*<\/tr>)/gs, (match) => '<table>' + match + '</table>');

        // Перенос строк
        html = html.replace(/\n/g, '<br>');

        // Убираем лишние <br> перед и после блочных элементов
        html = html.replace(/<br>\s*(<(h[1-6]|ul|ol|table|blockquote|pre|hr|div))/g, '$1');
        html = html.replace(/(<\/(h[1-6]|ul|ol|table|blockquote|pre|div)>)\s*<br>/g, '$1');

        return html;
    }

    function extractMeta(body, tag) {
        const regex = new RegExp(`<!--\\s*${tag}:\\s*(.*?)\\s*-->`, 'i');
        const match = body?.match(regex);
        return match ? match[1].trim() : null;
    }

    function extractSummary(body) {
        return extractMeta(body, 'summary') || stripHtml(body).substring(0, 120) + '…';
    }

    function extractAllowed(body) {
        return extractMeta(body, 'allowed');
    }

    function extractProgress(body) {
        const val = extractMeta(body, 'progress');
        return val ? parseInt(val, 10) : null;
    }

    // ---------- Сеть ----------
    function createAbortable(timeout = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return { controller, timeoutId };
    }

    async function fetchWithTimeout(url, options = {}, timeout = 15000) {
        const { controller, timeoutId } = createAbortable(timeout);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            return response;
        } catch (err) {
            clearTimeout(timeoutId);
            throw err;
        }
    }

    // ---------- Дебаунс / троттлинг ----------
    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function throttle(fn, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                fn.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // ---------- Уведомления ----------
    function showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position:fixed;bottom:20px;right:20px;background:${type==='error'?'#f44336':type==='success'?'#4caf50':'var(--accent)'};
            color:#fff;padding:12px 24px;border-radius:30px;box-shadow:0 5px 15px rgba(0,0,0,0.3);
            z-index:10001;opacity:0;transform:translateY(20px);transition:opacity 0.3s,transform 0.3s;
            font-family:'Russo One',sans-serif;
        `;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; }, 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ---------- Модальные окна ----------
    function createModal(title, contentHtml, options = {}) {
        const { size = 'full', closeButton = true, onClose } = options;
        document.querySelectorAll('.modal-fullscreen, .modal').forEach(m => m.remove());

        const modal = document.createElement('div');
        let modalClass = 'modal' + (size === 'full' ? ' modal-fullscreen' : '');
        modal.className = modalClass;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        const headerHtml = `
            <div class="modal-header">
                <h2 id="modal-header-title">${escapeHtml(title)}</h2>
                <div class="modal-header-spacer"></div>
                ${closeButton ? '<button class="modal-close" aria-label="Закрыть"><i class="fas fa-times"></i></button>' : ''}
            </div>
        `;
        modal.innerHTML = `
            <div class="modal-content${size==='full'?' modal-content-full':''}">
                ${headerHtml}
                <div class="modal-body">${contentHtml}</div>
            </div>
        `;
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        modal.classList.add('active');

        const closeModal = () => {
            modal.remove();
            document.body.style.overflow = '';
            if (onClose) onClose();
        };

        modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        const escHandler = (e) => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);

        return { modal, closeModal };
    }

    // ---------- Черновики ----------
    function saveDraft(key, data) {
        try {
            sessionStorage.setItem(`draft_${key}`, JSON.stringify({ ...data, ts: Date.now() }));
        } catch (e) {}
    }

    function loadDraft(key) {
        try {
            const raw = sessionStorage.getItem(`draft_${key}`);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function clearDraft(key) {
        sessionStorage.removeItem(`draft_${key}`);
    }

    // ---------- Дедупликация ----------
    function deduplicateByNumber(items) {
        const seen = new Set();
        return items.filter(item => {
            if (seen.has(item.number)) return false;
            seen.add(item.number);
            return true;
        });
    }

    window.NeonUtils = {
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix, clearAllCache,
        escapeHtml, stripHtml, renderMarkdown,
        extractMeta, extractSummary, extractAllowed, extractProgress,
        createAbortable, fetchWithTimeout,
        debounce, throttle,
        showToast,
        createModal,
        saveDraft, loadDraft, clearDraft,
        deduplicateByNumber
    };
})();