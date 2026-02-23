// ui-utils.js – общие компоненты интерфейса: тосты, модалки

(function() {
    // Показывает временное уведомление (тост)
    function showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.setAttribute('role', 'alert');
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : 'var(--accent)'};
            color: white;
            padding: 12px 24px;
            border-radius: 30px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
            z-index: 10001;
            opacity: 0;
            transform: translateY(20px);
            transition: opacity 0.3s, transform 0.3s;
            font-family: 'Russo One', sans-serif;
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }, 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // Создаёт модальное окно с заголовком и содержимым
    function createModal(title, contentHtml, options = {}) {
        const { onClose, size = 'full', closeButton = true } = options;
        
        // Удаляем предыдущие модальные окна, чтобы избежать конфликтов ID
        document.querySelectorAll('.modal-fullscreen, .modal').forEach(m => m.remove());
        
        const modal = document.createElement('div');
        // Определяем классы в зависимости от размера
        let modalClass = 'modal';
        let contentClass = 'modal-content';
        if (size === 'full') {
            modalClass += ' modal-fullscreen';   // используем класс из feedback.css
            contentClass += ' modal-content-full';
        }
        modal.className = modalClass;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'modal-title');
        modal.innerHTML = `
            <div class="${contentClass}">
                <div class="modal-header">
                    <h2 id="modal-title">${GithubCore.escapeHtml(title)}</h2>
                    ${closeButton ? '<button class="modal-close" aria-label="Закрыть"><i class="fas fa-times"></i></button>' : ''}
                </div>
                <div class="modal-body">${contentHtml}</div>
            </div>
        `;
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        // Активируем модальное окно (делаем видимым)
        modal.classList.add('active');

        const closeModal = () => {
            modal.remove();
            document.body.style.overflow = '';
            if (onClose) onClose();
        };

        modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        return { modal, closeModal };
    }

    window.UIUtils = { showToast, createModal };
})();