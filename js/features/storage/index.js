// js/features/storage/index.js
// Точка входа: загружает все модули хранилища с улучшенной обработкой ошибок
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
  let hasError = false;

  function checkReady() {
    loaded++;
    if (loaded === modules.length) {
      // Проверяем, что все модули загружены
      if (!window._StorageCore || !window._StorageMetadata || !window._StoragePreview || !window._StorageDownload || !window._StorageManager || !window._StorageUI) {
        console.warn('[Storage] Некоторые модули не загружены, но продолжаем инициализацию');
        // Всё равно создаём объект, чтобы не ломать остальной код
      }

      const BookmarkStorage = {
        openStorageModal: window._StorageUI ? window._StorageUI.openStorageModal : null,
        addBookmark: window._StorageManager ? window._StorageManager.addBookmark : null,
        removeBookmark: window._StorageManager ? window._StorageManager.removeBookmark : null,
        loadBookmarks: window._StorageManager ? window._StorageManager.loadBookmarks : null,
        resetStorage: window._StorageManager ? window._StorageManager.resetStorage : null,
        setStoragePassword: window._StorageManager ? window._StorageManager.setStoragePassword : null,
        ensureStorage: window._StorageManager ? window._StorageManager.ensureStorage : null,
        exportBookmarks: async () => {
          const t = (key) => window.I18n?.translate(key) || key;
          if (!window._StorageManager) {
            window.UIUtils.showToast('Модуль хранилища не загружен', 'error');
            return;
          }
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
          if (!window._StorageManager) {
            window.UIUtils.showToast('Модуль хранилища не загружен', 'error');
            return;
          }
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
                if (window._StorageUI && window._StorageUI.currentModal) {
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

  function loadModule(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function loadAllModules() {
    for (const src of modules) {
      try {
        await loadModule(src);
        loaded++;
      } catch (err) {
        console.error('[Storage] Ошибка загрузки модуля:', src, err);
        hasError = true;
        loaded++; // всё равно считаем, чтобы не зависнуть
      }
    }
    checkReady();
  }

  // Запускаем загрузку
  loadAllModules();
})();