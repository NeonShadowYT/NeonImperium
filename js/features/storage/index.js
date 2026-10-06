// js/features/storage/index.js
// Точка входа для хранилища. Загружает модули, экспортирует window.BookmarkStorage.

(function() {
    'use strict';

    let initialized = false;
    let initPromise = null;

    async function loadScript(src) {
        if (document.querySelector(`script[src="${src}"]`)) {
            const moduleName = src.split('/').pop().replace('.js', '');
            const globalName = {
                'core': '_StorageCore',
                'metadata': '_StorageMetadata',
                'preview': '_StoragePreview',
                'download': '_StorageDownload',
                'manager': '_StorageManager',
                'ui': '_StorageUI'
            }[moduleName];
            if (globalName && window[globalName]) return;
            await new Promise((resolve) => {
                const check = () => {
                    if (window[globalName]) resolve();
                    else setTimeout(check, 50);
                };
                check();
            });
            return;
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.defer = true;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    async function ensureModules() {
        if (initialized) return true;
        if (initPromise) return initPromise;
        initPromise = (async () => {
            try {
                const modules = [
                    'js/features/storage/core.js',
                    'js/features/storage/metadata.js',
                    'js/features/storage/preview.js',
                    'js/features/storage/download.js',
                    'js/features/storage/manager.js',
                    'js/features/storage/ui.js'
                ];
                for (const src of modules) await loadScript(src);
                const required = ['_StorageCore', '_StorageMetadata', '_StoragePreview', '_StorageDownload', '_StorageManager', '_StorageUI'];
                const missing = required.filter(name => !window[name]);
                if (missing.length) throw new Error(`Missing modules: ${missing.join(', ')}`);

                const BookmarkStorage = {
                    openStorageModal: async (...args) => {
                        await ensureModules();
                        return window._StorageUI.openStorageModal(...args);
                    },
                    addBookmark: async (...args) => {
                        await ensureModules();
                        return window._StorageManager.addBookmark(...args);
                    },
                    removeBookmark: async (...args) => {
                        await ensureModules();
                        return window._StorageManager.removeBookmark(...args);
                    },
                    loadBookmarks: async (...args) => {
                        await ensureModules();
                        return window._StorageManager.loadBookmarks(...args);
                    },
                    resetStorage: async (...args) => {
                        await ensureModules();
                        return window._StorageManager.resetStorage(...args);
                    },
                    setStoragePassword: async (...args) => {
                        await ensureModules();
                        return window._StorageManager.setStoragePassword(...args);
                    },
                    ensureStorage: async (...args) => {
                        await ensureModules();
                        return window._StorageManager.ensureStorage(...args);
                    },
                    // Диагностика и восстановление
                    getGistId: () => window._StorageManager.getGistId(),
                    getStoredGistId: () => window._StorageManager.getStoredGistId(),
                    normalizeGistId: (input) => window._StorageCore.normalizeGistId(input),
                    setGistIdManually: (id) => window._StorageManager.setGistIdManually(id),
                    tryLoadByGistId: async (id) => {
                        await ensureModules();
                        return window._StorageManager.tryLoadByGistId(id);
                    },
                    createNewStorageManually: async () => {
                        await ensureModules();
                        return window._StorageManager.createNewStorageManually();
                    },
                    showRecovery: async (onSuccess) => {
                        await ensureModules();
                        return window._StorageUI.showRecoveryModal(onSuccess);
                    },
                    // Экспорт/импорт
                    exportBookmarks: async () => {
                        await ensureModules();
                        const password = await window.Dialog.showPrompt({
                            title: 'Экспорт закладок',
                            message: 'Введите пароль для шифрования (минимум 4 символа):',
                            placeholder: 'Пароль',
                            minLength: 4
                        });
                        if (!password || password.length < 4) {
                            if (password !== null) window.UIUtils?.showToast('Пароль должен быть не менее 4 символов', 'error');
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
                            window.UIUtils?.showToast('Экспорт выполнен', 'success');
                        } catch (e) { window.UIUtils?.showToast(e.message, 'error'); }
                    },
                    importBookmarks: async () => {
                        await ensureModules();
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
                                    const password = await window.Dialog.showPrompt({
                                        title: 'Импорт закладок',
                                        message: 'Введите пароль для расшифровки:',
                                        placeholder: 'Пароль',
                                        minLength: 1
                                    });
                                    if (!password) return;
                                    const added = await window._StorageManager.importBookmarksData(encrypted, password);
                                    window.UIUtils?.showToast(`Импортировано ${added} закладок`, 'success');
                                    if (window._StorageUI && window._StorageUI.currentModal) {
                                        window._StorageUI.renderBookmarks(window._StorageUI.currentModal);
                                    }
                                } catch (err) {
                                    window.UIUtils?.showToast('Ошибка импорта: ' + err.message, 'error');
                                }
                            };
                            reader.readAsText(file);
                        };
                        input.click();
                    }
                };
                window.BookmarkStorage = BookmarkStorage;
                initialized = true;
                console.log('[Storage] Инициализирован');
                return true;
            } catch (err) {
                console.error('[Storage] Ошибка инициализации:', err);
                window.UIUtils?.showToast('Ошибка загрузки хранилища: ' + err.message, 'error');
                return false;
            }
        })();
        return initPromise;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ensureModules());
    } else {
        ensureModules();
    }

    window._StorageEnsure = ensureModules;
})();