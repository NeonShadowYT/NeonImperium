// js/features/storage/index.js
// Точка входа: загружает все модули хранилища

(function() {
  const modules = [
    'js/features/storage/core.js',
    'js/features/storage/metadata.js',
    'js/features/storage/preview.js',
    'js/features/storage/download.js',
    'js/features/storage/manager.js',
    'js/features/storage/ui.js'
  ];

  let loaded = 0;

  function checkReady() {
    loaded++;
    if (loaded === modules.length) {
      if (!window._StorageCore || !window._StorageMetadata || !window._StoragePreview || !window._StorageDownload || !window._StorageManager || !window._StorageUI) {
        console.error('[Storage] Не все модули загружены');
        return;
      }

      const BookmarkStorage = {
        openStorageModal: window._StorageUI.openStorageModal,
        addBookmark: window._StorageManager.addBookmark,
        removeBookmark: window._StorageManager.removeBookmark,
        loadBookmarks: window._StorageManager.loadBookmarks,
        resetStorage: window._StorageManager.resetStorage,
        setStoragePassword: window._StorageManager.setStoragePassword,
        ensureStorage: window._StorageManager.ensureStorage,
        exportBookmarks: async () => {
          const t = (key) => window.I18n?.translate(key) || key;
          const password = prompt('Введите пароль для шифрования экспортируемого файла (минимум 4 символа):');
          if (!password || password.length < 4) {
            window.UIUtils.showToast('Пароль должен быть не менее 4 символов', 'error');
            return;
          }
          try {
            const encrypted = await window._StorageManager.exportBookmarksData(password);
            const blob = new Blob([JSON.stringify(encrypted)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `neon-bookmarks-${new Date().toISOString().slice(0,10)}.neonbk`;
            a.click();
            URL.revokeObjectURL(a.href);
            window.UIUtils.showToast('Экспорт выполнен', 'success');
          } catch (e) {
            window.UIUtils.showToast(e.message, 'error');
          }
        },
        importBookmarks: async () => {
          const t = (key) => window.I18n?.translate(key) || key;
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.neonbk';
          input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (ev) => {
              try {
                const encrypted = JSON.parse(ev.target.result);
                const password = prompt('Введите пароль для расшифровки импортируемого файла:');
                if (!password) return;
                const added = await window._StorageManager.importBookmarksData(encrypted, password);
                window.UIUtils.showToast(`Импортировано ${added} закладок`, 'success');
                if (window._StorageUI.currentModal) {
                  window._StorageUI.renderBookmarks(window._StorageUI.currentModal);
                }
              } catch (err) {
                window.UIUtils.showToast('Ошибка импорта: ' + err.message, 'error');
              }
            };
            reader.readAsText(file);
          };
          input.click();
        }
      };

      window.BookmarkStorage = BookmarkStorage;
      console.log('[Storage] Инициализирован (модульная структура, оптимизирован)');
    }
  }

  for (const src of modules) {
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.onload = checkReady;
    script.onerror = () => {
      console.error('[Storage] Ошибка загрузки:', src);
      loaded++;
      checkReady();
    };
    document.head.appendChild(script);
  }
})();