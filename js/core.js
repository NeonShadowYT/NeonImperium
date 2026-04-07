// core.js – единое ядро: кеш, утилиты, UI, загрузка скриптов, Markdown
(function() {
    const CACHE_VERSION = 'v4';
    const CACHE_TTL = 10 * 60 * 1000; // 10 минут

    // ----- Кеширование -----
    function getCacheKey(key) {
        return `${CACHE_VERSION}_${key}`;
    }

    function cacheGet(key) {
        const fullKey = getCacheKey(key);
        const cached = sessionStorage.getItem(fullKey);
        const time = sessionStorage.getItem(`${fullKey}_time`);
        if (cached && time && (Date.now() - parseInt(time) < CACHE_TTL)) {
            try {
                return JSON.parse(cached);
            } catch(e) { return null; }
        }
        return null;
    }

    function cacheSet(key, data) {
        const fullKey = getCacheKey(key);
        sessionStorage.setItem(fullKey, JSON.stringify(data));
        sessionStorage.setItem(`${fullKey}_time`, Date.now().toString());
    }

    function cacheRemove(key) {
        const fullKey = getCacheKey(key);
        sessionStorage.removeItem(fullKey);
        sessionStorage.removeItem(`${fullKey}_time`);
    }

    function cacheRemoveByPrefix(prefix) {
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && (key.includes(prefix) || key.includes(`${prefix}_time`))) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => sessionStorage.removeItem(key));
    }

    function clearAllCache() {
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && (key.startsWith(CACHE_VERSION) || key.includes('_time'))) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => sessionStorage.removeItem(key));
    }

    // ----- Загрузка скриптов и стилей -----
    const loadedScripts = new Set();

    function loadScript(src, options = {}) {
        return new Promise((resolve, reject) => {
            if (loadedScripts.has(src)) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = options.async !== false;
            script.defer = options.defer !== false;
            if (options.integrity) script.integrity = options.integrity;
            if (options.crossorigin) script.crossOrigin = options.crossorigin;
            script.onload = () => {
                loadedScripts.add(src);
                resolve();
            };
            script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
            document.head.appendChild(script);
        });
    }

    function loadStylesheet(href) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`link[href="${href}"]`)) {
                resolve();
                return;
            }
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = resolve;
            link.onerror = reject;
            document.head.appendChild(link);
        });
    }

    // ----- Markdown (с fallback) -----
    async function renderMarkdown(text) {
        if (!text) return '';
        if (!window.marked) {
            try {
                await loadScript('https://cdn.jsdelivr.net/npm/marked/marked.min.js');
            } catch(e) {
                await loadScript('https://unpkg.com/marked/marked.min.js');
            }
        }
        if (window.marked) {
            if (window.marked.setOptions) marked.setOptions({ gfm: true, breaks: true });
            return marked.parse(text);
        }
        return escapeHtml(text);
    }

    // ----- DOM / HTML helpers -----
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

    function extractMeta(body, tag) {
        const regex = new RegExp(`<!--\\s*${tag}:\\s*(.*?)\\s*-->`, 'i');
        const match = body ? body.match(regex) : null;
        return match ? match[1].trim() : null;
    }

    function extractAllowed(body) { return extractMeta(body, 'allowed'); }
    function extractSummary(body) { return extractMeta(body, 'summary'); }
    function extractPreview(body) { return extractMeta(body, 'preview'); }

    // ----- Уведомления (toast) -----
    function showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.setAttribute('role', 'alert');
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            background: type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : 'var(--accent)',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '30px',
            boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
            zIndex: '10001',
            opacity: '0',
            transform: 'translateY(20px)',
            transition: 'opacity 0.3s, transform 0.3s',
            fontFamily: "'Russo One', sans-serif"
        });
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; }, 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ----- Модальное окно (унифицированное) -----
    function createModal(title, contentHtml, options = {}) {
        const { onClose, size = 'full', closeButton = true } = options;
        document.querySelectorAll('.modal-fullscreen, .modal').forEach(m => m.remove());

        const modal = document.createElement('div');
        let modalClass = 'modal';
        let contentClass = 'modal-content';
        if (size === 'full') {
            modalClass += ' modal-fullscreen';
            contentClass += ' modal-content-full';
        }
        modal.className = modalClass;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'modal-header-title');

        const headerHtml = `
            <div class="modal-header">
                <h2 id="modal-header-title">${escapeHtml(title)}</h2>
                <div class="modal-header-spacer"></div>
                ${closeButton ? '<button class="modal-close" aria-label="Закрыть"><i class="fas fa-times"></i></button>' : ''}
            </div>
        `;
        modal.innerHTML = `
            <div class="${contentClass}">
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

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        return { modal, closeModal };
    }

    // ----- Черновики (sessionStorage) -----
    function saveDraft(key, data) {
        try {
            sessionStorage.setItem(key, JSON.stringify({ ...data, timestamp: Date.now() }));
        } catch(e) { console.warn('Failed to save draft', e); }
    }
    function loadDraft(key) {
        try {
            const draft = sessionStorage.getItem(key);
            return draft ? JSON.parse(draft) : null;
        } catch(e) { return null; }
    }
    function clearDraft(key) { sessionStorage.removeItem(key); }

    // ----- Загрузка с таймаутом -----
    function createAbortable(timeout = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return { controller, timeoutId };
    }

    // ----- Утилита для дедупликации по номеру issue -----
    function deduplicateByNumber(items) {
        const seen = new Set();
        return items.filter(item => {
            if (seen.has(item.number)) return false;
            seen.add(item.number);
            return true;
        });
    }

    // ----- Загрузка с кнопкой "Загрузить ещё" (универсальная) -----
    function createLoadMoreButton(container, onLoad, options = {}) {
        let button = null;
        let isLoading = false;
        let hasMore = true;

        const show = () => {
            if (!button) {
                button = document.createElement('button');
                button.className = 'load-more-btn';
                button.textContent = options.label || 'Загрузить ещё';
                button.setAttribute('aria-label', options.ariaLabel || 'Загрузить ещё');
                button.addEventListener('click', async () => {
                    if (isLoading || !hasMore) return;
                    isLoading = true;
                    button.disabled = true;
                    button.textContent = options.loadingLabel || 'Загрузка...';
                    try {
                        const result = await onLoad();
                        if (result && result.hasMore === false) hasMore = false;
                    } catch (err) {
                        console.error('Load more error:', err);
                    } finally {
                        isLoading = false;
                        if (hasMore) {
                            button.disabled = false;
                            button.textContent = options.label || 'Загрузить ещё';
                        } else {
                            button.style.display = 'none';
                        }
                    }
                });
                container.parentNode.insertBefore(button, container.nextSibling);
            }
            button.style.display = hasMore ? 'block' : 'none';
        };

        const hide = () => { if (button) button.style.display = 'none'; };
        const reset = () => { hasMore = true; if (button) { button.disabled = false; button.textContent = options.label || 'Загрузить ещё'; button.style.display = 'block'; } };
        const setHasMore = (value) => { hasMore = value; if (!hasMore && button) button.style.display = 'none'; };

        return { show, hide, reset, setHasMore };
    }

    // ----- Публичное API -----
    window.Core = {
        // cache
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix, clearAllCache,
        // scripts & styles
        loadScript, loadStylesheet,
        // markdown
        renderMarkdown,
        // dom
        escapeHtml, stripHtml, extractMeta, extractAllowed, extractSummary, extractPreview,
        // ui
        showToast, createModal,
        // drafts
        saveDraft, loadDraft, clearDraft,
        // utils
        createAbortable, deduplicateByNumber,
        createLoadMoreButton,
        VERSION: CACHE_VERSION
    };
})();