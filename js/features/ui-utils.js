// js/features/ui-utils.js — только UI-функции, используют GithubCore
// Оптимизации:
// - Очередь тостов (не более одного активного, остальные ждут)
// - Единый экземпляр модалки (переиспользуется, меняется содержимое)
// - Сохранение/загрузка черновиков (без изменений)

(function() {
    const { createElement, escapeHtml, loadModule } = window.GithubCore || {};

    // ---------- TOAST С ОЧЕРЕДЬЮ ----------
    let toastQueue = [];
    let activeToast = null;
    let toastContainer = null;

    function getToastContainer() {
        if (!toastContainer) {
            toastContainer = createElement('div', 'toast-container', {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                zIndex: '10001',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                pointerEvents: 'none',
                maxWidth: '400px',
                width: '100%'
            });
            document.body.appendChild(toastContainer);
        }
        return toastContainer;
    }

    function showToast(message, type = 'info', duration = 3000) {
        const container = getToastContainer();
        // Добавляем в очередь
        toastQueue.push({ message, type, duration });
        processToastQueue();
    }

    function processToastQueue() {
        if (activeToast || toastQueue.length === 0) return;
        const { message, type, duration } = toastQueue.shift();
        const toast = createElement('div', `toast toast-${type}`, {
            background: type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : 'var(--accent)',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '30px',
            boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
            opacity: '0',
            transform: 'translateY(20px)',
            transition: 'opacity 0.3s ease, transform 0.3s ease',
            fontFamily: "'Russo One', sans-serif",
            pointerEvents: 'auto',
            wordBreak: 'break-word'
        }, { role: 'alert' });
        toast.textContent = message;
        const container = getToastContainer();
        container.appendChild(toast);
        activeToast = toast;

        // Плавное появление
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        // Автоматическое закрытие
        const timer = setTimeout(() => {
            closeToast(toast);
        }, duration);

        // Закрытие по клику
        toast.addEventListener('click', () => {
            clearTimeout(timer);
            closeToast(toast);
        });
    }

    function closeToast(toast) {
        if (!toast || toast !== activeToast) return;
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
            activeToast = null;
            // Обрабатываем следующее сообщение из очереди
            processToastQueue();
        }, 300);
    }

    // ---------- ПЕРЕИСПОЛЬЗУЕМАЯ МОДАЛКА ----------
    let modalInstance = null;
    let modalCloseCallback = null;

    function createModal(title, contentHtml, options = {}) {
        const { onClose, size = 'full', closeButton = true } = options;

        // Если модалка уже существует, просто обновляем содержимое
        if (modalInstance) {
            const { modal, header, body, closeFn } = modalInstance;
            // Обновляем заголовок
            const titleEl = header.querySelector('h2');
            if (titleEl) titleEl.textContent = title;
            // Обновляем тело
            body.innerHTML = contentHtml;
            // Показываем модалку
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';

            // Обновляем колбэк закрытия
            if (modalCloseCallback) {
                // Удаляем старый обработчик
                const oldClose = modalCloseCallback;
                modalCloseCallback = null;
            }
            modalCloseCallback = onClose || null;

            return { modal, closeModal: closeFn };
        }

        // Создаём новую модалку в первый раз
        const modal = createElement('div', size === 'full' ? 'modal modal-fullscreen' : 'modal', {
            backgroundColor: 'rgba(0,0,0,0.7)'
        }, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-header-title' });

        const contentClass = size === 'full' ? 'modal-content modal-content-full' : 'modal-content';
        const headerHtml = `
            <div class="modal-header">
                <h2 id="modal-header-title">${escapeHtml(title)}</h2>
                <div class="modal-header-spacer"></div>
                ${closeButton ? '<button class="modal-close" aria-label="Закрыть"><i class="fas fa-times"></i></button>' : ''}
            </div>
        `;
        modal.innerHTML = `<div class="${contentClass}">${headerHtml}<div class="modal-body">${contentHtml}</div></div>`;
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        modal.classList.add('active');

        const header = modal.querySelector('.modal-header');
        const body = modal.querySelector('.modal-body');
        const closeBtn = modal.querySelector('.modal-close');

        const closeModal = () => {
            modal.classList.remove('active');
            document.body.style.overflow = '';
            // Не удаляем модалку из DOM, просто скрываем
            // Вызываем колбэк
            if (modalCloseCallback) {
                modalCloseCallback();
                modalCloseCallback = null;
            }
            // Не очищаем содержимое, чтобы при повторном открытии можно было переиспользовать
        };

        if (closeBtn) {
            closeBtn.addEventListener('click', closeModal);
        }
        modal.addEventListener('click', e => {
            if (e.target === modal) closeModal();
        });

        const escHandler = e => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        modalInstance = { modal, header, body, closeFn: closeModal };
        modalCloseCallback = onClose || null;

        return { modal, closeModal };
    }

    // ---------- ЧЕРНОВИКИ ----------
    function saveDraft(key, data) {
        try { sessionStorage.setItem(key, JSON.stringify({ ...data, timestamp: Date.now() })); } catch {}
    }
    function loadDraft(key) {
        try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
    }
    function clearDraft(key) { sessionStorage.removeItem(key); }

    // Экспорт
    window.UIUtils = { showToast, createModal, saveDraft, loadDraft, clearDraft };
})();