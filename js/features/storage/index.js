// js/features/storage/index.js
// Точка входа: загружает модули строго последовательно, дожидается инициализации
(function() {
  // Модули, которые нужно загрузить (core и metadata уже загружены в common-init)
  const modules = [
    'js/features/storage/preview.js',
    'js/features/storage/download.js',
    'js/features/storage/manager.js',
    'js/features/storage/ui.js'
  ];

  let initialized = false;
  let initPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Проверяем, загружен ли уже скрипт (по тегу)
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        // Если скрипт уже есть, проверяем, определился ли соответствующий модуль
        const moduleName = src.split('/').pop().replace('.js', '');
        const moduleMap = {
          'preview': '_StoragePreview',
          'download': '_StorageDownload',
          'manager': '_StorageManager',
          'ui': '_StorageUI'
        };
        const globalName = moduleMap[moduleName];
        if (globalName && window[globalName]) {
          resolve();
          return;
        }
        // Если модуль ещё не определён, но скрипт уже загружен — ждём немного
        let attempts = 0;
        const checkInterval = setInterval(() => {
          if (window[globalName]) {
            clearInterval(checkInterval);
            resolve();
          } else if (++attempts > 10) {
            clearInterval(checkInterval);
            // Если так и не появился, возможно, ошибка — пробуем перезагрузить
            document.head.removeChild(existing);
            const newScript = document.createElement('script');
            newScript.src = src;
            newScript.defer = true;
            newScript.onload = resolve;
            newScript.onerror = reject;
            document.head.appendChild(newScript);
          }
        }, 100);
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

  async function ensureModules() {
    if (initialized) return true;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        console.log('[Storage] Загрузка модулей...');
        // Загружаем модули последовательно
        for (const src of modules) {
          await loadScript(src);
          console.log(`[Storage] Loaded ${src}`);
        }

        // Проверяем, что все модули загружены
        const required = ['_StoragePreview', '_StorageDownload', '_StorageManager', '_StorageUI'];
        const missing = required.filter(name => !window[name]);
        if (missing.length > 0) {
          console.warn('[Storage] Отсутствуют модули:', missing);
          // Пробуем подгрузить их ещё раз через timeout
          for (const name of missing) {
            const moduleName = name.replace('_Storage', '').toLowerCase();
            const src = `js/features/storage/${moduleName}.js`;
            await loadScript(src);
          }
          // Проверяем снова
          const stillMissing = required.filter(name => !window[name]);
          if (stillMissing.length > 0) {
            throw new Error(`Некоторые модули не загружены: ${stillMissing.join(', ')}`);
          }
        }

        // Создаём основной объект BookmarkStorage
        const BookmarkStorage = {
          openStorageModal: async (...args) => {
            await ensureModules(); // на всякий случай
            if (!window._StorageUI) {
              showToast('Модуль UI хранилища не загружен', 'error');
              return;
            }
            return window._StorageUI.openStorageModal(...args);
          },
          addBookmark: async (...args) => {
            await ensureModules();
            if (!window._StorageManager) {
              showToast('Модуль хранилища не загружен', 'error');
              return;
            }
            return window._StorageManager.addBookmark(...args);
          },
          removeBookmark: async (...args) => {
            await ensureModules();
            if (!window._StorageManager) {
              showToast('Модуль хранилища не загружен', 'error');
              return;
            }
            return window._StorageManager.removeBookmark(...args);
          },
          loadBookmarks: async (...args) => {
            await ensureModules();
            if (!window._StorageManager) {
              showToast('Модуль хранилища не загружен', 'error');
              return { bookmarks: [] };
            }
            return window._StorageManager.loadBookmarks(...args);
          },
          resetStorage: async (...args) => {
            await ensureModules();
            if (!window._StorageManager) {
              showToast('Модуль хранилища не загружен', 'error');
              return;
            }
            return window._StorageManager.resetStorage(...args);
          },
          setStoragePassword: async (...args) => {
            await ensureModules();
            if (!window._StorageManager) {
              showToast('Модуль хранилища не загружен', 'error');
              return;
            }
            return window._StorageManager.setStoragePassword(...args);
          },
          ensureStorage: async (...args) => {
            await ensureModules();
            if (!window._StorageManager) {
              showToast('Модуль хранилища не загружен', 'error');
              return { bookmarks: [] };
            }
            return window._StorageManager.ensureStorage(...args);
          },
          exportBookmarks: async () => {
            await ensureModules();
            if (!window._StorageManager) {
              showToast('Модуль хранилища не загружен', 'error');
              return;
            }
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
            await ensureModules();
            if (!window._StorageManager) {
              showToast('Модуль хранилища не загружен', 'error');
              return;
            }
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
        initialized = true;
        console.log('[Storage] Инициализирован (модульная структура)');
        return true;
      } catch (err) {
        console.error('[Storage] Ошибка инициализации:', err);
        showToast('Ошибка загрузки хранилища: ' + err.message, 'error');
        return false;
      }
    })();

    return initPromise;
  }

  // Запускаем загрузку при загрузке страницы
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensureModules());
  } else {
    ensureModules();
  }

  // Экспортируем функцию ожидания модулей для других скриптов
  window._StorageEnsure = ensureModules;
})();