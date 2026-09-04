// js/features/ui-utils.js — только UI-функции, используют GithubCore
(function() {
    const { createElement, escapeHtml, loadModule } = GithubCore;

    function showToast(message, type = 'info', duration = 3000) {
        const toast = createElement('div', `toast toast-${type}`, {}, { role: 'alert' });
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    function createModal(title, contentHtml, options = {}) {
        const { onClose, size = 'full', closeButton = true } = options;
        document.querySelectorAll('.modal-overlay, .modal-fullscreen').forEach(m => m.remove());

        const modal = createElement('div', size === 'full' ? 'modal-fullscreen' : 'modal-overlay', {}, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-header-title' });
        const contentClass = size === 'full' ? 'modal-content-full' : 'modal-content';
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

        const closeModal = () => {
            modal.remove();
            document.body.style.overflow = '';
            onClose?.();
        };

        modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
        modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

        const escHandler = e => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);

        return { modal, closeModal };
    }

    function saveDraft(key, data) {
        try { sessionStorage.setItem(key, JSON.stringify({ ...data, timestamp: Date.now() })); } catch {}
    }
    function loadDraft(key) {
        try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
    }
    function clearDraft(key) { sessionStorage.removeItem(key); }

    window.UIUtils = { showToast, createModal, saveDraft, loadDraft, clearDraft };
})();