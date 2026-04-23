// js/features/ui-utils.js — утилиты для интерфейса
(function() {
    function showToast(message, type = 'info', duration = 3000) {
        const toast = GithubCore.createElement('div', `toast toast-${type}`, {
            position: 'fixed', bottom: '20px', right: '20px',
            background: type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : 'var(--accent)',
            color: 'white', padding: '12px 24px', borderRadius: '30px',
            boxShadow: '0 5px 15px rgba(0,0,0,0.3)', zIndex: '10001',
            opacity: '0', transform: 'translateY(20px)',
            transition: 'opacity 0.3s, transform 0.3s',
            fontFamily: "'Russo One', sans-serif"
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
        document.querySelectorAll('.modal-fullscreen, .modal').forEach(m => m.remove());

        const modal = GithubCore.createElement('div', size === 'full' ? 'modal modal-fullscreen' : 'modal', {
            backgroundColor: 'rgba(0,0,0,0.7)'
        }, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-header-title' });

        const contentClass = size === 'full' ? 'modal-content modal-content-full' : 'modal-content';
        const headerHtml = `
            <div class="modal-header">
                <h2 id="modal-header-title">${GithubCore.escapeHtml(title)}</h2>
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