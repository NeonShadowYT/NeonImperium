// js/features/dialog.js
// Кастомные диалоговые окна: prompt / confirm / alert в стиле сайта.
// Поддерживают focus trap, закрытие по Escape и клику на оверлей.
(function() {
  const t = (key) => window.I18n?.translate(key) || key;

  // ---- Единоразовая инъекция стилей ----
  function injectStyles() {
    if (document.getElementById('dialog-styles')) return;
    const style = document.createElement('style');
    style.id = 'dialog-styles';
    style.textContent = `
      @keyframes dialogShimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      @keyframes dialogFadeIn {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
      @keyframes dialogSlideIn {
        0% { opacity: 0; transform: translateY(-10px) scale(0.97); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      .custom-dialog-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        z-index: 10050;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
        animation: dialogFadeIn 0.2s cubic-bezier(0.2, 0.9, 0.4, 1);
      }
      .custom-dialog {
        background: var(--glass-bg, rgba(30, 30, 48, 0.85));
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid var(--glass-border, rgba(61, 158, 179, 0.15));
        border-radius: var(--radius-lg, 24px);
        box-shadow: var(--shadow, 0 12px 28px rgba(0,0,0,0.8));
        max-width: 480px;
        width: 100%;
        max-height: 90vh;
        overflow-y: auto;
        padding: 28px;
        color: var(--text-primary, #fff);
        font-family: var(--font-family, 'Russo One', sans-serif);
        position: relative;
        animation: dialogSlideIn 0.25s cubic-bezier(0.2, 0.9, 0.4, 1);
      }
      .custom-dialog::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 4px;
        background: linear-gradient(90deg, transparent, var(--accent, #3d9eb3), var(--accent-light, #5ab5c9), var(--accent, #3d9eb3), transparent);
        background-size: 200% 100%;
        animation: dialogShimmer 3s infinite linear;
        border-radius: var(--radius-lg, 24px) var(--radius-lg, 24px) 0 0;
      }
      .custom-dialog-title {
        margin: 0 0 12px;
        font-size: 20px;
        color: var(--accent, #3d9eb3);
        text-shadow: 0 0 20px rgba(61,158,179,0.2);
        padding-right: 32px;
      }
      .custom-dialog-title.danger {
        color: #f44336;
        text-shadow: 0 0 20px rgba(244,67,54,0.2);
      }
      .custom-dialog-message {
        margin: 0 0 16px;
        color: var(--text-secondary, #c0c0d0);
        font-size: 14px;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .custom-dialog-input,
      .custom-dialog-textarea {
        width: 100%;
        padding: 12px 16px;
        background: var(--bg-primary, #0f0f1a);
        border: 1px solid var(--border, #3a3a55);
        border-radius: var(--radius-pill, 40px);
        color: var(--text-primary, #fff);
        font-family: var(--font-family, 'Russo One', sans-serif);
        font-size: 14px;
        box-sizing: border-box;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      .custom-dialog-textarea {
        border-radius: var(--radius-md, 20px);
        min-height: 90px;
        resize: vertical;
        line-height: 1.5;
      }
      .custom-dialog-input:focus,
      .custom-dialog-textarea:focus {
        border-color: var(--accent, #3d9eb3);
        box-shadow: 0 0 0 3px rgba(61,158,179,0.2);
      }
      .custom-dialog-error {
        color: #f44336;
        font-size: 12px;
        margin-top: 6px;
        min-height: 16px;
      }
      .custom-dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 20px;
        flex-wrap: wrap;
      }
      .custom-dialog-btn {
        padding: 10px 24px;
        border-radius: var(--radius-pill, 40px);
        font-family: var(--font-family, 'Russo One', sans-serif);
        font-size: 14px;
        cursor: pointer;
        border: 1px solid var(--glass-border, rgba(61, 158, 179, 0.15));
        background: var(--glass-bg, rgba(30, 30, 48, 0.65));
        color: var(--text-secondary, #c0c0d0);
        transition: all 0.2s ease;
      }
      .custom-dialog-btn:hover {
        background: rgba(61,158,179,0.12);
        color: var(--text-primary, #fff);
      }
      .custom-dialog-btn.primary {
        background: var(--accent, #3d9eb3);
        color: #fff;
        border-color: var(--accent, #3d9eb3);
        box-shadow: 0 0 20px rgba(61,158,179,0.2);
      }
      .custom-dialog-btn.primary:hover {
        background: var(--accent-light, #5ab5c9);
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(61,158,179,0.4);
      }
      .custom-dialog-btn.danger {
        background: #f44336;
        color: #fff;
        border-color: #f44336;
        box-shadow: 0 0 20px rgba(244,67,54,0.3);
      }
      .custom-dialog-btn.danger:hover {
        background: #d32f2f;
        transform: translateY(-2px);
      }
      .custom-dialog-close {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 1px solid var(--glass-border, rgba(61, 158, 179, 0.15));
        background: var(--glass-bg, rgba(30, 30, 48, 0.65));
        color: var(--text-secondary, #c0c0d0);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        transition: all 0.2s ease;
        padding: 0;
      }
      .custom-dialog-close:hover {
        background: var(--accent, #3d9eb3);
        color: #fff;
        border-color: var(--accent, #3d9eb3);
        transform: rotate(90deg);
      }
    `;
    document.head.appendChild(style);
  }

  function getFocusable(root) {
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return Array.from(root.querySelectorAll(sel)).filter(el => !el.disabled && el.offsetParent !== null);
  }

  function createDialog({ title, message, danger = false, showClose = true }) {
    injectStyles();

    const overlay = document.createElement('div');
    overlay.className = 'custom-dialog-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const modal = document.createElement('div');
    modal.className = 'custom-dialog';

    if (showClose) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'custom-dialog-close';
      closeBtn.innerHTML = '<i class="fas fa-times"></i>';
      closeBtn.setAttribute('aria-label', t('cancelButton') || 'Закрыть');
      modal.appendChild(closeBtn);
    }

    const h = document.createElement('h3');
    h.className = 'custom-dialog-title' + (danger ? ' danger' : '');
    h.textContent = title || '';
    modal.appendChild(h);

    if (message) {
      const p = document.createElement('p');
      p.className = 'custom-dialog-message';
      p.textContent = message;
      modal.appendChild(p);
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return { overlay, modal, prevOverflow };
  }

  /**
   * Настраивает поведение диалога: focus trap, Escape, клик по оверлею.
   * @returns {Function} cleanup — снимает обработчики и удаляет оверлей
   */
  function setupDialogBehavior(overlay, modal, prevOverflow, onCancel, resolveFn) {
    const previouslyFocused = document.activeElement;

    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
        if (onCancel) onCancel();
        if (resolveFn) resolveFn(null);
        return;
      }
      if (e.key === 'Tab') {
        const focusables = getFocusable(modal);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (!modal.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    const handleClickOutside = (e) => {
      if (e.target === overlay) {
        cleanup();
        if (onCancel) onCancel();
        if (resolveFn) resolveFn(null);
      }
    };

    const cleanup = () => {
      document.removeEventListener('keydown', handleKeydown, true);
      overlay.removeEventListener('click', handleClickOutside);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.body.style.overflow = prevOverflow || '';
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try { previouslyFocused.focus(); } catch (e) { /* noop */ }
      }
    };

    document.addEventListener('keydown', handleKeydown, true);
    overlay.addEventListener('click', handleClickOutside);

    setTimeout(() => {
      const focusables = getFocusable(modal);
      if (focusables.length > 0) {
        try { focusables[0].focus(); } catch (e) { /* noop */ }
      }
    }, 30);

    return cleanup;
  }

  // ---- showPrompt ----
  function showPrompt({
    title = '',
    message = '',
    defaultValue = '',
    placeholder = '',
    multiline = false,
    minLength = 0,
    maxLength = Infinity,
    validate = null
  } = {}) {
    return new Promise((resolve) => {
      const { overlay, modal, prevOverflow } = createDialog({ title, message, showClose: true });

      const input = document.createElement(multiline ? 'textarea' : 'input');
      input.className = multiline ? 'custom-dialog-textarea' : 'custom-dialog-input';
      if (!multiline) input.type = 'text';
      input.value = defaultValue || '';
      if (placeholder) input.placeholder = placeholder;
      if (maxLength !== Infinity && !multiline) input.maxLength = maxLength;
      modal.appendChild(input);

      const err = document.createElement('div');
      err.className = 'custom-dialog-error';
      modal.appendChild(err);

      const actions = document.createElement('div');
      actions.className = 'custom-dialog-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'custom-dialog-btn';
      cancelBtn.textContent = t('feedbackCancel') || 'Отмена';

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'custom-dialog-btn primary';
      okBtn.textContent = 'OK';

      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      modal.appendChild(actions);

      const cleanup = setupDialogBehavior(overlay, modal, prevOverflow, null, resolve);

      const trySubmit = () => {
        const value = input.value;
        if (value.length < minLength) {
          err.textContent = `Минимум ${minLength} символов`;
          input.focus();
          return;
        }
        if (value.length > maxLength) {
          err.textContent = `Максимум ${maxLength} символов`;
          input.focus();
          return;
        }
        if (typeof validate === 'function') {
          const v = validate(value);
          if (v !== true && v != null && v !== '') {
            err.textContent = typeof v === 'string' ? v : 'Некорректное значение';
            input.focus();
            return;
          }
        }
        cleanup();
        resolve(value);
      };

      cancelBtn.addEventListener('click', () => {
        cleanup();
        resolve(null);
      });
      okBtn.addEventListener('click', trySubmit);

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !multiline && !e.shiftKey) {
          e.preventDefault();
          trySubmit();
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && multiline) {
          e.preventDefault();
          trySubmit();
        }
      });

      const closeBtn = modal.querySelector('.custom-dialog-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          cleanup();
          resolve(null);
        });
      }
    });
  }

  // ---- showConfirm ----
  function showConfirm({
    title = '',
    message = '',
    confirmText = 'OK',
    cancelText = t('feedbackCancel') || 'Отмена',
    danger = false
  } = {}) {
    return new Promise((resolve) => {
      const { overlay, modal, prevOverflow } = createDialog({ title, message, danger, showClose: true });

      const actions = document.createElement('div');
      actions.className = 'custom-dialog-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'custom-dialog-btn';
      cancelBtn.textContent = cancelText;

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'custom-dialog-btn ' + (danger ? 'danger' : 'primary');
      okBtn.textContent = confirmText;

      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      modal.appendChild(actions);

      const cleanup = setupDialogBehavior(overlay, modal, prevOverflow, null, null);

      cancelBtn.addEventListener('click', () => {
        cleanup();
        resolve(false);
      });
      okBtn.addEventListener('click', () => {
        cleanup();
        resolve(true);
      });

      const closeBtn = modal.querySelector('.custom-dialog-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          cleanup();
          resolve(false);
        });
      }
    });
  }

  // ---- showAlert ----
  function showAlert({ title = '', message = '', type = 'info' } = {}) {
    return new Promise((resolve) => {
      const { overlay, modal, prevOverflow } = createDialog({
        title,
        message,
        danger: type === 'error',
        showClose: false
      });

      const actions = document.createElement('div');
      actions.className = 'custom-dialog-actions';

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'custom-dialog-btn ' + (type === 'error' ? 'danger' : 'primary');
      okBtn.textContent = 'OK';

      actions.appendChild(okBtn);
      modal.appendChild(actions);

      const cleanup = setupDialogBehavior(overlay, modal, prevOverflow, null, null);

      okBtn.addEventListener('click', () => {
        cleanup();
        resolve();
      });
    });
  }

  window.Dialog = {
    showPrompt,
    showConfirm,
    showAlert
  };
})();