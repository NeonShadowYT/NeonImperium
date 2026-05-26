// js/features/ui-utils.js — UI-функции (модалки, тосты, черновики) с исправлением отображения
(function() {
    const { createElement, escapeHtml } = window.GithubCore;

    function showToast(message, type = 'info', duration = 3000) {
        const toast = createElement('div', `toast toast-${type}`, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            background: type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : 'var(--accent)',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '30px',
            boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
            zIndex: '100000',  // Очень высокий z-index, чтобы быть поверх всего
            opacity: '0',
            transform: 'translateY(20px)',
            transition: 'opacity 0.3s, transform 0.3s',
            fontFamily: "'Russo One', sans-serif",
            fontSize: '14px',
            pointerEvents: 'none'
        }, { role: 'alert' });
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    function createModal(title, contentHtml, options = {}) {
        const { onClose, size = 'full', closeButton = true } = options;

        // Удаляем старые модалки, чтобы не было конфликта
        const existingModals = document.querySelectorAll('.modal-fullscreen, .modal');
        existingModals.forEach(m => m.remove());

        const modal = createElement('div', size === 'full' ? 'modal modal-fullscreen' : 'modal', {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.85)',
            zIndex: '1000000',  // Максимальный приоритет
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(4px)'
        }, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-header-title' });

        const contentClass = size === 'full' ? 'modal-content modal-content-full' : 'modal-content';
        const headerHtml = `
            <div class="modal-header">
                <h2 id="modal-header-title">${escapeHtml(title)}</h2>
                <div class="modal-header-spacer"></div>
                ${closeButton ? '<button class="modal-close" aria-label="Закрыть"><i class="fas fa-times"></i></button>' : ''}
            </div>
        `;

        const modalContent = createElement('div', contentClass, {
            backgroundColor: 'var(--bg-card)',
            borderRadius: '24px',
            maxWidth: size === 'full' ? '900px' : '500px',
            width: '90%',
            maxHeight: '90vh',
            overflowY: 'auto',
            position: 'relative',
            border: '1px solid var(--accent)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
        });
        modalContent.innerHTML = headerHtml;
        const bodyDiv = createElement('div', 'modal-body', {
            padding: '30px',
            overflowY: 'auto'
        });
        bodyDiv.innerHTML = contentHtml;
        modalContent.appendChild(bodyDiv);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        // Принудительно устанавливаем display: flex для активной модалки (на случай, если CSS не сработал)
        modal.style.display = 'flex';
        // Активируем модалку с небольшой задержкой для анимации
        setTimeout(() => {
            modal.classList.add('active');
        }, 10);

        const closeModal = () => {
            modal.classList.remove('active');
            setTimeout(() => {
                modal.remove();
                document.body.style.overflow = '';
                if (onClose) onClose();
            }, 200);
        };

        const closeBtn = modalContent.querySelector('.modal-close');
        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        return { modal, closeModal };
    }

    function saveDraft(key, data) {
        try {
            sessionStorage.setItem(key, JSON.stringify({ ...data, timestamp: Date.now() }));
        } catch (e) {}
    }

    function loadDraft(key) {
        try {
            return JSON.parse(sessionStorage.getItem(key));
        } catch (e) {
            return null;
        }
    }

    function clearDraft(key) {
        sessionStorage.removeItem(key);
    }

    window.UIUtils = {
        showToast,
        createModal,
        saveDraft,
        loadDraft,
        clearDraft
    };
})();