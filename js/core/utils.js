// utils.js – toast, модалки, черновики, загрузка кнопок
(function() {
    function showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.setAttribute('role', 'alert');
        Object.assign(toast.style, {
            position: 'fixed', bottom: '20px', right: '20px',
            background: type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : 'var(--accent)',
            color: 'white', padding: '12px 24px', borderRadius: '30px',
            boxShadow: '0 5px 15px rgba(0,0,0,0.3)', zIndex: '10001',
            opacity: '0', transform: 'translateY(20px)',
            transition: 'opacity 0.3s, transform 0.3s', fontFamily: "'Russo One', sans-serif"
        });
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; }, 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    function createModal(title, contentHtml, options = {}) {
        const { onClose, size = 'full', closeButton = true } = options;
        document.querySelectorAll('.modal-fullscreen, .modal').forEach(m => m.remove());
        const modal = document.createElement('div');
        modal.className = size === 'full' ? 'modal modal-fullscreen' : 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'modal-header-title');
        modal.innerHTML = `
            <div class="${size === 'full' ? 'modal-content-full' : 'modal-content'}">
                <div class="modal-header">
                    <h2 id="modal-header-title">${GithubCore.escapeHtml(title)}</h2>
                    <div class="modal-header-spacer"></div>
                    ${closeButton ? '<button class="modal-close" aria-label="Закрыть"><i class="fas fa-times"></i></button>' : ''}
                </div>
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

    function saveDraft(key, data) {
        try { sessionStorage.setItem(key, JSON.stringify({ ...data, timestamp: Date.now() })); } catch(e) {}
    }
    function loadDraft(key) {
        try { const draft = sessionStorage.getItem(key); return draft ? JSON.parse(draft) : null; } catch(e) { return null; }
    }
    function clearDraft(key) { sessionStorage.removeItem(key); }

    function setButtonLoading(button, isLoading, originalText = null) {
        if (!button) return;
        if (isLoading) {
            button.dataset.originalText = originalText || button.textContent;
            button.classList.add('loading');
            button.disabled = true;
            button.textContent = 'Загрузка...';
        } else {
            button.classList.remove('loading');
            button.disabled = false;
            if (button.dataset.originalText) {
                button.textContent = button.dataset.originalText;
                delete button.dataset.originalText;
            }
        }
    }

    window.UIUtils = { showToast, createModal, saveDraft, loadDraft, clearDraft, setButtonLoading };
})();