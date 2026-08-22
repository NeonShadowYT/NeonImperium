// js/features/storage/manager.js
// Управление состоянием хранилища: загрузка, сохранение, добавление, удаление, экспорт/импорт

(function() {
  const {
    GIST_FILENAME,
    GIST_DESCRIPTION,
    STORAGE_KEY_PREFIX,
    PASSWORD_CACHE_KEY,
    SALT,
    SAVE_DEBOUNCE_MS,
    MAX_BOOKMARKS,
    VERSION,
    deriveKeyFromString,
    encryptData,
    decryptData,
    gistFetch,
    gistUpdate,
    gistCreate,
    hashString,
    promptPassword,
    confirmResetStorage
  } = window._StorageCore;

  const { fetchMetadata } = window._StorageMetadata;

  const { getCurrentUser, getToken, hasScope } = window.GithubAuth || {};
  const { showToast, createModal, saveDraft, loadDraft, clearDraft } = window.UIUtils || {};
  const { debounce, performAction } = window.GithubCore || {};

  // ---- состояние ----
  let currentUser = null;
  let currentToken = null;
  let gistId = null;
  let masterKey = null;          // расшифрованный мастер-ключ (CryptoKey)
  let bookmarks = [];            // расшифрованный массив закладок (полный)
  let isInitialized = false;
  let isSaving = false;
  let saveDebounced = null;
  let lastUpdated = 0;
  let hasPassword = false;       // есть ли в Gist блок byPassword

  // кеш
  let cachedMasterKey = null;
  let cachedBookmarks = null;
  let cachedLastUpdated = 0;

  // индикатор статуса (будет установлен из ui)
  let statusCallback = null;

  // ---- обновление статуса (через колбэк) ----
  function updateStatus(text, type = 'info') {
    if (statusCallback) statusCallback(text, type);
  }

  // ---- загрузка / создание хранилища ----
  async function loadOrCreateStorage(forceRefresh = false) {
    const user = getCurrentUser();
    const token = getToken();
    if (!user || !token) throw new Error('not_logged_in');

    currentUser = user;
    currentToken = token;

    if (!forceRefresh && cachedMasterKey && cachedBookmarks && cachedLastUpdated) {
      masterKey = cachedMasterKey;
      bookmarks = cachedBookmarks;
      lastUpdated = cachedLastUpdated;
      isInitialized = true;
      return { bookmarks, lastUpdated };
    }

    const stored = localStorage.getItem(STORAGE_KEY_PREFIX + user);
    if (stored) {
      try {
        gistId = JSON.parse(stored).gistId;
      } catch (e) {}
    }

    let gistData = null;
    let payload = null;

    if (gistId) {
      gistData = await gistFetch(gistId);
    }

    if (!gistData) {
      return await createNewStorage(user, token);
    }

    const file = gistData.files?.[GIST_FILENAME];
    if (!file) throw new Error('Gist file not found');

    try {
      payload = JSON.parse(file.content);
    } catch (e) {
      throw new Error('Invalid JSON in gist');
    }

    if (payload.version !== VERSION) {
      throw new Error('Unsupported storage version, please recreate');
    }

    const remoteUpdated = payload.lastUpdated || 0;
    const localUpdated = lastUpdated || 0;

    let masterKeyArray = null;
    let usedMethod = null;
    const hasPasswordBlock = !!payload.masterKeyEncrypted.byPassword;
    hasPassword = hasPasswordBlock;

    // ---- расшифровка ----
    if (hasPasswordBlock) {
      let password = sessionStorage.getItem(PASSWORD_CACHE_KEY);
      if (!password) {
        password = await promptPassword('Введите пароль для доступа к хранилищу:');
        if (!password) throw new Error('Password required');
      }
      try {
        const keyPassword = await deriveKeyFromString(password);
        masterKeyArray = await decryptData(payload.masterKeyEncrypted.byPassword, keyPassword);
        usedMethod = 'password';
        sessionStorage.setItem(PASSWORD_CACHE_KEY, password);
      } catch (e) {
        sessionStorage.removeItem(PASSWORD_CACHE_KEY);
        throw new Error('Invalid password');
      }
    } else {
      const encryptedByLogin = payload.masterKeyEncrypted.byLogin;
      const encryptedByToken = payload.masterKeyEncrypted.byToken;

      if (encryptedByLogin) {
        try {
          const keyLogin = await deriveKeyFromString(user);
          masterKeyArray = await decryptData(encryptedByLogin, keyLogin);
          usedMethod = 'login';
        } catch (e) {}
      }

      if (!masterKeyArray && encryptedByToken) {
        try {
          const keyToken = await deriveKeyFromString(token);
          masterKeyArray = await decryptData(encryptedByToken, keyToken);
          usedMethod = 'token';
        } catch (e) {}
      }

      if (!masterKeyArray) {
        const shouldReset = await confirmResetStorage();
        if (shouldReset) {
          await resetStorage(true);
          return await createNewStorage(user, token);
        } else {
          throw new Error('Unable to decrypt storage. No password set or credentials changed.');
        }
      }
    }

    // восстановили мастер-ключ
    const masterKeyCrypto = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(masterKeyArray),
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );

    // загружаем закладки
    let publicBookmarks = payload.publicBookmarks || [];
    let privateBookmarks = [];
    if (payload.encryptedBookmarks) {
      try {
        privateBookmarks = await decryptData(payload.encryptedBookmarks, masterKeyCrypto);
      } catch (e) {
        privateBookmarks = [];
      }
    }

    // объединяем публичные и приватные части
    const merged = mergeBookmarksByType(publicBookmarks, privateBookmarks);

    // сохраняем в кеш
    masterKey = masterKeyCrypto;
    bookmarks = merged;
    lastUpdated = remoteUpdated;
    cachedMasterKey = masterKeyCrypto;
    cachedBookmarks = merged;
    cachedLastUpdated = remoteUpdated;
    isInitialized = true;

    // если изменился логин или токен – обновляем ключи (только если нет пароля или после успешной расшифровки)
    const storedLogin = payload.lastLogin || null;
    const storedTokenHash = payload.lastTokenHash || null;
    const currentTokenHash = await hashString(token);
    if (storedLogin !== user || storedTokenHash !== currentTokenHash) {
      await updateMasterKeyEncryption(masterKeyCrypto, user, token, null);
    }

    return { bookmarks, lastUpdated };
  }

  // создание нового хранилища (без пароля)
  async function createNewStorage(user, token) {
    const newMasterKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const exported = await crypto.subtle.exportKey('raw', newMasterKey);
    const masterKeyArray = Array.from(new Uint8Array(exported));

    const keyLogin = await deriveKeyFromString(user);
    const keyToken = await deriveKeyFromString(token);
    const encryptedByLogin = await encryptData(masterKeyArray, keyLogin);
    const encryptedByToken = await encryptData(masterKeyArray, keyToken);

    const payload = {
      version: VERSION,
      salt: SALT,
      masterKeyEncrypted: {
        byLogin: encryptedByLogin,
        byToken: encryptedByToken,
        byPassword: null
      },
      publicBookmarks: [],
      encryptedBookmarks: null,
      lastUpdated: Date.now(),
      lastLogin: user,
      lastTokenHash: await hashString(token)
    };

    const content = JSON.stringify(payload);
    const newGistId = await gistCreate(content);
    gistId = newGistId;
    localStorage.setItem(STORAGE_KEY_PREFIX + user, JSON.stringify({ gistId }));

    masterKey = newMasterKey;
    bookmarks = [];
    lastUpdated = payload.lastUpdated;
    hasPassword = false;
    cachedMasterKey = newMasterKey;
    cachedBookmarks = [];
    cachedLastUpdated = payload.lastUpdated;
    isInitialized = true;
    return { bookmarks: [] };
  }

  // обновление зашифрованных блоков мастер-ключа (без изменения закладок)
  async function updateMasterKeyEncryption(masterKeyCrypto, login, token, password = null) {
    const exported = await crypto.subtle.exportKey('raw', masterKeyCrypto);
    const masterKeyArray = Array.from(new Uint8Array(exported));

    const keyLogin = await deriveKeyFromString(login);
    const keyToken = await deriveKeyFromString(token);
    const encryptedByLogin = await encryptData(masterKeyArray, keyLogin);
    const encryptedByToken = await encryptData(masterKeyArray, keyToken);

    let encryptedByPassword = null;
    if (password !== null) {
      if (password) {
        const keyPassword = await deriveKeyFromString(password);
        encryptedByPassword = await encryptData(masterKeyArray, keyPassword);
      }
    } else {
      // не трогаем byPassword
    }

    const gist = await gistFetch(gistId);
    if (!gist) throw new Error('Gist not found');
    const file = gist.files?.[GIST_FILENAME];
    if (!file) throw new Error('File not found');
    let payload = JSON.parse(file.content);

    if (password !== null) {
      payload.masterKeyEncrypted.byPassword = encryptedByPassword;
    }

    payload.lastLogin = login;
    payload.lastTokenHash = await hashString(token);
    payload.lastUpdated = Date.now();

    const content = JSON.stringify(payload);
    await gistUpdate(gistId, content);
  }

  // ---- слияние публичных и приватных частей ----
  function mergeBookmarksByType(publicBm, privateBm) {
    const privateMap = new Map();
    privateBm.forEach(p => privateMap.set(p.id, p));

    const merged = publicBm.map(pub => {
      const priv = privateMap.get(pub.id);
      if (priv) {
        return { ...pub, ...priv };
      }
      return pub;
    });

    privateBm.forEach(priv => {
      if (!merged.some(m => m.id === priv.id)) {
        merged.push(priv);
      }
    });

    return merged;
  }

  // ---- разделение на публичные и приватные перед сохранением ----
  function splitBookmarks(bmArray) {
    const publicList = [];
    const privateList = [];

    bmArray.forEach(bm => {
      const pub = {
        id: bm.id,
        added: bm.added,
        type: bm.type,
        saveData: bm.saveData || null,
        game: bm.game || null,
        author: bm.author || null,
        date: bm.date || null
      };
      publicList.push(pub);

      const priv = {
        id: bm.id,
        url: bm.url || null,
        title: bm.title || null,
        thumbnail: bm.thumbnail || null,
        embedUrl: bm.embedUrl || null,
        downloadUrl: bm.downloadUrl || null,
        postData: bm.postData || null,
        videoData: bm.videoData || null,
        linkData: bm.linkData || null
      };
      privateList.push(priv);
    });

    return { publicList, privateList };
  }

  // ---- сохранение с разделением ----
  async function saveBookmarksToGist() {
    if (!masterKey || !gistId) return;
    if (isSaving) return;
    isSaving = true;
    try {
      const gist = await gistFetch(gistId);
      if (!gist) throw new Error('Gist not found');
      const file = gist.files?.[GIST_FILENAME];
      if (!file) throw new Error('File not found');
      let payload = JSON.parse(file.content);

      const remoteUpdated = payload.lastUpdated || 0;
      if (remoteUpdated > lastUpdated) {
        // конфликт – объединяем
        let remotePublic = payload.publicBookmarks || [];
        let remotePrivate = [];
        if (payload.encryptedBookmarks) {
          try {
            remotePrivate = await decryptData(payload.encryptedBookmarks, masterKey);
          } catch (e) {}
        }
        const remoteMerged = mergeBookmarksByType(remotePublic, remotePrivate);
        const merged = mergeBookmarks(bookmarks, remoteMerged);
        bookmarks = merged;
        cachedBookmarks = merged;
        lastUpdated = remoteUpdated;
      }

      const { publicList, privateList } = splitBookmarks(bookmarks);
      const encryptedPrivate = await encryptData(privateList, masterKey);

      payload.publicBookmarks = publicList;
      payload.encryptedBookmarks = encryptedPrivate;
      payload.lastUpdated = Date.now();

      const content = JSON.stringify(payload);
      await gistUpdate(gistId, content);
      lastUpdated = payload.lastUpdated;
      cachedLastUpdated = lastUpdated;
      cachedBookmarks = bookmarks.slice();

      updateStatus('Сохранено', 'success');
    } catch (e) {
      console.error('Save error:', e);
      updateStatus('Ошибка сохранения', 'error');
      throw e;
    } finally {
      isSaving = false;
    }
  }

  function mergeBookmarks(local, remote) {
    const localMap = new Map();
    local.forEach(b => localMap.set(b.id, b));

    const remoteMap = new Map();
    remote.forEach(b => remoteMap.set(b.id, b));

    const merged = [...remote];
    for (const [id, localBook] of localMap) {
      if (!remoteMap.has(id)) {
        merged.push(localBook);
      } else {
        const remoteBook = remoteMap.get(id);
        if (new Date(localBook.added) > new Date(remoteBook.added)) {
          const idx = merged.findIndex(b => b.id === id);
          if (idx !== -1) merged[idx] = localBook;
        }
      }
    }
    merged.sort((a, b) => new Date(b.added) - new Date(a.added));
    return merged;
  }

  // дебаунс
  function triggerSave() {
    if (!saveDebounced) {
      saveDebounced = debounce(async () => {
        await performAction('storageAdds', { bookmarks }, saveBookmarksToGist);
      }, SAVE_DEBOUNCE_MS);
    }
    saveDebounced();
  }

  // ---- публичные API ----
  async function ensureStorage(forceRefresh = false) {
    if (isInitialized && !forceRefresh) return { bookmarks };
    try {
      const result = await loadOrCreateStorage(forceRefresh);
      return result;
    } catch (e) {
      console.error('Ensure storage error:', e);
      throw e;
    }
  }

  async function addBookmark(bookmarkData) {
    await ensureStorage();
    const t = (key) => window.I18n?.translate(key) || key;

    if (bookmarkData.url) {
      if (bookmarks.some(b => b.url === bookmarkData.url)) {
        showToast(t('addedToFavorites'), 'info');
        throw new Error('duplicate');
      }
    }
    if (bookmarkData.saveData && bookmarkData.saveData.hash) {
      if (bookmarks.some(b => b.saveData && b.saveData.hash === bookmarkData.saveData.hash)) {
        showToast(t('addedToFavorites'), 'info');
        throw new Error('duplicate');
      }
    }

    if (!bookmarkData.title && bookmarkData.url) {
      const meta = await fetchMetadata(bookmarkData.url);
      bookmarkData.title = meta.title || bookmarkData.url;
      bookmarkData.thumbnail = meta.thumbnail || null;
      bookmarkData.embedUrl = meta.embedUrl || null;
      bookmarkData.type = meta.type || 'link';
      bookmarkData.videoData = meta.videoData || null;
      bookmarkData.postData = meta.postData || null;
    }

    const newBookmark = {
      id: 'bm-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      added: new Date().toISOString(),
      url: bookmarkData.url || null,
      title: bookmarkData.title || (bookmarkData.saveData ? bookmarkData.saveData.fileName : 'Закладка'),
      type: bookmarkData.type || 'link',
      thumbnail: bookmarkData.thumbnail || null,
      embedUrl: bookmarkData.embedUrl || null,
      downloadUrl: bookmarkData.downloadUrl || null,
      postData: bookmarkData.postData || null,
      videoData: bookmarkData.videoData || null,
      linkData: bookmarkData.linkData || null,
      saveData: bookmarkData.saveData || null,
      author: bookmarkData.author || null,
      date: bookmarkData.date || null,
      game: bookmarkData.game || null
    };

    bookmarks.unshift(newBookmark);
    if (bookmarks.length > MAX_BOOKMARKS) {
      const removed = bookmarks.splice(MAX_BOOKMARKS);
      showToast(t('maxBookmarksReached').replace('{max}', MAX_BOOKMARKS), 'warning');
    }

    cachedBookmarks = bookmarks.slice();
    triggerSave();
    showToast(t('bookmarkAdded'), 'success');
    // вызовем перерисовку, если модалка открыта (через колбэк из ui)
    if (window._StorageUI && window._StorageUI.refreshBookmarksGrid) {
      window._StorageUI.refreshBookmarksGrid();
    }
    return newBookmark;
  }

  async function removeBookmark(id) {
    await ensureStorage();
    const t = (key) => window.I18n?.translate(key) || key;
    bookmarks = bookmarks.filter(b => b.id !== id);
    cachedBookmarks = bookmarks.slice();
    triggerSave();
    showToast(t('bookmarkDeleted'), 'success');
    if (window._StorageUI && window._StorageUI.refreshBookmarksGrid) {
      window._StorageUI.refreshBookmarksGrid();
    }
  }

  async function loadBookmarks(forceRefresh = false) {
    const result = await ensureStorage(forceRefresh);
    return { bookmarks: result.bookmarks };
  }

  async function resetStorage(silent = false) {
    if (gistId) {
      const token = getToken();
      if (token) {
        await fetch(`https://api.github.com/gists/${gistId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => {});
      }
    }
    const user = getCurrentUser();
    if (user) localStorage.removeItem(STORAGE_KEY_PREFIX + user);
    gistId = null;
    masterKey = null;
    bookmarks = [];
    cachedMasterKey = null;
    cachedBookmarks = null;
    cachedLastUpdated = 0;
    lastUpdated = 0;
    hasPassword = false;
    isInitialized = false;
    sessionStorage.removeItem(PASSWORD_CACHE_KEY);
    if (!silent) showToast('Хранилище сброшено', 'info');
  }

  async function setStoragePassword(newPassword) {
    await ensureStorage();
    if (!masterKey) throw new Error('Storage not initialized');
    const user = getCurrentUser();
    const token = getToken();
    if (!user || !token) throw new Error('not_logged_in');

    const gist = await gistFetch(gistId);
    const file = gist.files?.[GIST_FILENAME];
    let payload = JSON.parse(file.content);

    const hasOldPassword = !!payload.masterKeyEncrypted.byPassword;

    if (hasOldPassword) {
      const oldPassword = await promptPassword('Введите текущий пароль:');
      if (!oldPassword) throw new Error('Old password required');
      try {
        const keyOld = await deriveKeyFromString(oldPassword);
        await decryptData(payload.masterKeyEncrypted.byPassword, keyOld);
      } catch (e) {
        throw new Error('Invalid old password');
      }
    }

    if (newPassword && newPassword === token) {
      throw new Error('Пароль не должен совпадать с токеном GitHub');
    }

    const exported = await crypto.subtle.exportKey('raw', masterKey);
    const masterKeyArray = Array.from(new Uint8Array(exported));

    const keyLogin = await deriveKeyFromString(user);
    const keyToken = await deriveKeyFromString(token);
    const encryptedByLogin = await encryptData(masterKeyArray, keyLogin);
    const encryptedByToken = await encryptData(masterKeyArray, keyToken);

    let encryptedByPassword = null;
    if (newPassword) {
      const keyPassword = await deriveKeyFromString(newPassword);
      encryptedByPassword = await encryptData(masterKeyArray, keyPassword);
      sessionStorage.setItem(PASSWORD_CACHE_KEY, newPassword);
      hasPassword = true;
    } else {
      sessionStorage.removeItem(PASSWORD_CACHE_KEY);
      hasPassword = false;
    }

    payload.masterKeyEncrypted = {
      byLogin: encryptedByLogin,
      byToken: encryptedByToken,
      byPassword: encryptedByPassword
    };
    payload.lastLogin = user;
    payload.lastTokenHash = await hashString(token);
    payload.lastUpdated = Date.now();

    const content = JSON.stringify(payload);
    await gistUpdate(gistId, content);
    lastUpdated = payload.lastUpdated;
    showToast('Пароль хранилища обновлён', 'success');
  }

  // ---- экспорт/импорт (логика, но UI-часть вынесена) ----
  async function exportBookmarksData(password) {
    await ensureStorage();
    if (!masterKey) throw new Error('Storage not initialized');
    if (!password || password.length < 4) {
      throw new Error('Пароль должен быть не менее 4 символов');
    }
    const token = getToken();
    if (password === token) {
      throw new Error('Пароль не должен совпадать с токеном GitHub');
    }

    const exportData = {
      version: 1,
      exportedAt: Date.now(),
      bookmarks: bookmarks
    };
    const jsonStr = JSON.stringify(exportData);
    const key = await deriveKeyFromString(password);
    const encrypted = await encryptData(jsonStr, key);
    return encrypted;
  }

  async function importBookmarksData(encryptedData, password) {
    await ensureStorage();
    if (!masterKey) throw new Error('Storage not initialized');
    const key = await deriveKeyFromString(password);
    const decryptedStr = await decryptData(encryptedData, key);
    const importData = JSON.parse(decryptedStr);
    if (!importData.bookmarks || !Array.isArray(importData.bookmarks)) {
      throw new Error('Invalid import data');
    }
    let added = 0;
    for (const bm of importData.bookmarks) {
      try {
        delete bm.id;
        await addBookmark(bm);
        added++;
      } catch (err) {
        if (err.message === 'duplicate') continue;
        console.warn('Ошибка импорта закладки:', err);
      }
    }
    return added;
  }

  // ---- установка колбэка статуса ----
  function setStatusCallback(cb) {
    statusCallback = cb;
  }

  // ---- экспорт ----
  window._StorageManager = {
    // состояние (для доступа из ui)
    getState: () => ({
      bookmarks,
      isInitialized,
      hasPassword,
      lastUpdated
    }),
    // функции
    loadOrCreateStorage,
    createNewStorage,
    updateMasterKeyEncryption,
    mergeBookmarksByType,
    splitBookmarks,
    saveBookmarksToGist,
    triggerSave,
    ensureStorage,
    addBookmark,
    removeBookmark,
    loadBookmarks,
    resetStorage,
    setStoragePassword,
    exportBookmarksData,
    importBookmarksData,
    setStatusCallback,
    // доступ к bookmarks для ui
    getBookmarks: () => bookmarks,
    setBookmarks: (newBookmarks) => { bookmarks = newBookmarks; cachedBookmarks = newBookmarks.slice(); },
    // рефреш грида (устанавливается из ui)
    refreshGridCallback: null,
    setRefreshGridCallback: (cb) => { window._StorageManager.refreshGridCallback = cb; }
  };
})();