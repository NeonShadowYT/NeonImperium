// js/features/storage/index.js
// Точка входа: загружает недостающие модули и инициализирует хранилище
(function() {
  // Загружаем только те модули, которые ещё не загружены (core и metadata уже в common-init)
  const modules = [
    'js/features/storage/preview.js',
    'js/features/storage/download.js',
    'js/features/storage/manager.js',
    'js/features/storage/ui.js'
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  function showToast(msg, type = 'error') {
    if (window.UIUtils && window.UIUtils.showToast) {
      window.UIUtils.showToast(msg, type);
    } else {
      console.warn('[Storage]', msg);
    }
  }

  async function init() {
    try {
      // Даём время на загрузку core и metadata из common-init
      await new Promise(r => setTimeout(r, 100));

      for (const src of modules) {
        await loadScript(src);
        console.log(`[Storage] Loaded ${src}`);
      }

      if (!window._StorageManager) {
        console.warn('[Storage] _StorageManager not found');
        showToast('Модуль хранилища не загружен', 'error');
        return;
      }

      if (!window._StorageUI) {
        console.warn('[Storage] _StorageUI not found');
        showToast('Модуль UI хранилища не загружен', 'error');
        return;
      }

      const BookmarkStorage = {
        openStorageModal: window._StorageUI.openStorageModal || (() => showToast('Модуль хранилища не загружен', 'error')),
        addBookmark: window._StorageManager.addBookmark || (() => showToast('Модуль хранилища не загружен', 'error')),
        removeBookmark: window._StorageManager.removeBookmark || (() => showToast('Модуль хранилища не загружен', 'error')),
        loadBookmarks: window._StorageManager.loadBookmarks || (() => Promise.resolve({ bookmarks: [] })),
        resetStorage: window._StorageManager.resetStorage || (() => showToast('Модуль хранилища не загружен', 'error')),
        setStoragePassword: window._StorageManager.setStoragePassword || (() => showToast('Модуль хранилища не загружен', 'error')),
        ensureStorage: window._StorageManager.ensureStorage || (() => Promise.resolve({ bookmarks: [] })),
        exportBookmarks: async () => {
          if (!window._StorageManager) return showToast('Модуль хранилища не загружен', 'error');
          const t = (key) => window.I18n?.translate(key) || key;
          const password = prompt('Введите пароль для шифрования экспортируемого файла (минимум 4 символа):');
          if (!password || password.length < 4) {
            showToast('Пароль должен быть не менее 4 символов', 'error');
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
            showToast('Экспорт выполнен', 'success');
          } catch (e) {
            showToast(e.message, 'error');
          }
        },
        importBookmarks: async () => {
          if (!window._StorageManager) return showToast('Модуль хранилища не загружен', 'error');
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
                showToast(`Импортировано ${added} закладок`, 'success');
                if (window._StorageUI && window._StorageUI.currentModal) {
                  window._StorageUI.renderBookmarks(window._StorageUI.currentModal);
                }
              } catch (err) {
                showToast('Ошибка импорта: ' + err.message, 'error');
              }
            };
            reader.readAsText(file);
          };
          input.click();
        }
      };

      window.BookmarkStorage = BookmarkStorage;
      console.log('[Storage] Инициализирован (модульная структура)');
    } catch (err) {
      console.error('[Storage] Ошибка инициализации:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();