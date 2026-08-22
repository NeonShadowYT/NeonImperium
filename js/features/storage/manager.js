// js/features/storage/manager.js
// Управление состоянием хранилища: загрузка, сохранение, добавление, удаление, экспорт/импорт
// Оптимизировано: кеширование Gist в localStorage, удаление byLogin/byToken при наличии пароля,
// минимизация запросов к API, работа с лимитами.

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
    GIST_CACHE_TTL,
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
  let masterKey = null;
  let bookmarks = [];
  let isInitialized = false;
  let isSaving = false;
  let saveDebounced = null;
  let lastUpdated = 0;
  let hasPassword = false; // установлен ли пароль (есть byPassword)

  // кеш в памяти
  let cachedMasterKey = null;
  let cachedBookmarks = null;
  let cachedLastUpdated = 0;

  let statusCallback = null;

  function updateStatus(text, type = 'info') {
    if (statusCallback) statusCallback(text, type);
  }

  // ---- кеширование Gist в localStorage ----
  function getGistCacheKey() {
    const user = getCurrentUser();
    return `storage_gist_${user}`;
  }

  function loadGistFromCache() {
    try {
      const key = getGistCacheKey();
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - data.timestamp < GIST_CACHE_TTL) {
        return data.payload;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function saveGistToCache(payload) {
    try {
      const key = getGistCacheKey();
      localStorage.setItem(key, JSON.stringify({
        payload: payload,
        timestamp: Date.now()
      }));
    } catch (e) {}
  }

  function clearGistCache() {
    try {
      const key = getGistCacheKey();
      localStorage.removeItem(key);
    } catch (e) {}
  }

  // ---- загрузка / создание хранилища с кешированием и лимитами ----
  async function loadOrCreateStorage(forceRefresh = false) {
    const user = getCurrentUser();
    const token = getToken();
    if (!user || !token) throw new Error('not_logged_in');

    currentUser = user;
    currentToken = token;

    // Проверяем кеш в памяти
    if (!forceRefresh && cachedMasterKey && cachedBookmarks && cachedLastUpdated) {
      masterKey = cachedMasterKey;
      bookmarks = cachedBookmarks;
      lastUpdated = cachedLastUpdated;
      isInitialized = true;
      return { bookmarks, lastUpdated };
    }

    // Проверяем кеш в localStorage
    if (!forceRefresh) {
      const cachedPayload = loadGistFromCache();
      if (cachedPayload) {
        try {
          // Пытаемся использовать кешированный payload
          const result = await processGistPayload(cachedPayload, user, token);
          if (result) {
            masterKey = result.masterKey;
            bookmarks = result.bookmarks;
            lastUpdated = result.lastUpdated;
            cachedMasterKey = masterKey;
            cachedBookmarks = bookmarks;
            cachedLastUpdated = lastUpdated;
            isInitialized = true;
            return { bookmarks, lastUpdated };
          }
        } catch (e) {
          // Если расшифровка не удалась, игнорируем кеш и идём в сеть
          console.warn('Кеш хранилища недействителен, загружаем из сети');
        }
      }
    }

    // Загрузка из сети
    // Проверяем лимиты (если доступны)
    if (window.RateLimits) {
      const hasLimit = await window.RateLimits.waitForLimit('cacheClears', 10000).catch(() => false);
      if (!hasLimit) {
        // Лимит исчерпан – пытаемся использовать устаревший кеш
        const stale = loadGistFromCache();
        if (stale) {
          const result = await processGistPayload(stale, user, token);
          if (result) {
            masterKey = result.masterKey;
            bookmarks = result.bookmarks;
            lastUpdated = result.lastUpdated;
            cachedMasterKey = masterKey;
            cachedBookmarks = bookmarks;
            cachedLastUpdated = lastUpdated;
            isInitialized = true;
            updateStatus('Используется кеш (лимиты исчерпаны)', 'warning');
            return { bookmarks, lastUpdated };
          }
        }
        throw new Error('Лимиты API исчерпаны, кеш недоступен');
      }
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

    // Сохраняем в кеш
    saveGistToCache(payload);

    const result = await processGistPayload(payload, user, token);
    if (!result) throw new Error('Не удалось обработать payload');

    masterKey = result.masterKey;
    bookmarks = result.bookmarks;
    lastUpdated = result.lastUpdated;
    cachedMasterKey = masterKey;
    cachedBookmarks = bookmarks;
    cachedLastUpdated = lastUpdated;
    isInitialized = true;
    return { bookmarks, lastUpdated };
  }

  // ---- обработка payload (общая логика) ----
  async function processGistPayload(payload, user, token) {
    const remoteUpdated = payload.lastUpdated || 0;
    let masterKeyArray = null;
    let usedMethod = null;
    const hasPasswordBlock = !!payload.masterKeyEncrypted?.byPassword;
    hasPassword = hasPasswordBlock;

    if (hasPasswordBlock) {
      // Только пароль
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
      // Пароля нет – используем byLogin или byToken
      const encryptedByLogin = payload.masterKeyEncrypted?.byLogin;
      const encryptedByToken = payload.masterKeyEncrypted?.byToken;

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
        // Ничего не подошло – предлагаем сброс
        const shouldReset = await confirmResetStorage();
        if (shouldReset) {
          await resetStorage(true);
          const newStorage = await createNewStorage(user, token);
          return {
            masterKey: newStorage.masterKey,
            bookmarks: newStorage.bookmarks,
            lastUpdated: newStorage.lastUpdated
          };
        } else {
          throw new Error('Unable to decrypt storage. No password set or credentials changed.');
        }
      }

      // Если пароля нет, проверяем смену логина/токена и обновляем блоки
      const storedLogin = payload.lastLogin || null;
      const storedTokenHash = payload.lastTokenHash || null;
      const currentTokenHash = await hashString(token);
      if (storedLogin !== user || storedTokenHash !== currentTokenHash) {
        // Обновляем ключи (перешифровываем мастер-ключ новыми логином и токеном)
        const masterKeyCrypto = await crypto.subtle.importKey(
          'raw',
          new Uint8Array(masterKeyArray),
          { name: 'AES-GCM' },
          true,
          ['encrypt', 'decrypt']
        );
        await updateMasterKeyEncryption(masterKeyCrypto, user, token, null);
      }
    }

    // Восстанавливаем мастер-ключ
    const masterKeyCrypto = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(masterKeyArray),
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );

    // Загружаем закладки
    let publicBookmarks = payload.publicBookmarks || [];
    let privateBookmarks = [];
    if (payload.encryptedBookmarks) {
      try {
        privateBookmarks = await decryptData(payload.encryptedBookmarks, masterKeyCrypto);
      } catch (e) {
        privateBookmarks = [];
      }
    }

    const merged = mergeBookmarksByType(publicBookmarks, privateBookmarks);

    return {
      masterKey: masterKeyCrypto,
      bookmarks: merged,
      lastUpdated: remoteUpdated
    };
  }

  // ---- создание нового хранилища (без пароля) ----
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
    saveGistToCache(payload);

    masterKey = newMasterKey;
    bookmarks = [];
    lastUpdated = payload.lastUpdated;
    hasPassword = false;
    cachedMasterKey = newMasterKey;
    cachedBookmarks = [];
    cachedLastUpdated = lastUpdated;
    isInitialized = true;
    return { masterKey: newMasterKey, bookmarks: [], lastUpdated };
  }

  // ---- обновление зашифрованных блоков мастер-ключа (без изменения закладок) ----
  async function updateMasterKeyEncryption(masterKeyCrypto, login, token, password = null) {
    const exported = await crypto.subtle.exportKey('raw', masterKeyCrypto);
    const masterKeyArray = Array.from(new Uint8Array(exported));

    // Если пароль НЕ установлен, обновляем byLogin и byToken
    // Если пароль установлен, мы не должны вызывать эту функцию для обновления byLogin/byToken,
    // но она может быть вызвана при смене пароля (см. setStoragePassword).
    // В этой функции мы не трогаем byPassword, если он уже есть – оставляем как есть.
    const gist = await gistFetch(gistId);
    if (!gist) throw new Error('Gist not found');
    const file = gist.files?.[GIST_FILENAME];
    if (!file) throw new Error('File not found');
    let payload = JSON.parse(file.content);

    // Если пароль активен, мы не обновляем byLogin и byToken
    const hasPasswordBlock = !!payload.masterKeyEncrypted?.byPassword;
    if (!hasPasswordBlock) {
      // Пароля нет – обновляем byLogin и byToken
      const keyLogin = await deriveKeyFromString(login);
      const keyToken = await deriveKeyFromString(token);
      const encryptedByLogin = await encryptData(masterKeyArray, keyLogin);
      const encryptedByToken = await encryptData(masterKeyArray, keyToken);
      payload.masterKeyEncrypted.byLogin = encryptedByLogin;
      payload.masterKeyEncrypted.byToken = encryptedByToken;
      payload.lastLogin = login;
      payload.lastTokenHash = await hashString(token);
    }

    // Если передан password, обновляем byPassword (может быть null для удаления)
    if (password !== undefined) {
      if (password) {
        const keyPassword = await deriveKeyFromString(password);
        payload.masterKeyEncrypted.byPassword = await encryptData(masterKeyArray, keyPassword);
      } else {
        payload.masterKeyEncrypted.byPassword = null;
      }
    }

    payload.lastUpdated = Date.now();

    const content = JSON.stringify(payload);
    await gistUpdate(gistId, content);
    // Обновляем кеш
    saveGistToCache(payload);
  }

  // ---- слияние публичных и приватных частей (оптимизированное) ----
  function mergeBookmarksByType(publicBm, privateBm) {
    const privateMap = new Map();
    privateBm.forEach(p => privateMap.set(p.id, p));

    const merged = publicBm.map(pub => {
      const priv = privateMap.get(pub.id);
      if (priv) {
        return { ...priv, ...pub };
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

  // ---- разделение на публичные и приватные (только непустые поля) ----
  function splitBookmarks(bmArray) {
    const publicList = [];
    const privateList = [];

    bmArray.forEach(bm => {
      const pub = { id: bm.id, added: bm.added, type: bm.type };
      if (bm.saveData) pub.saveData = bm.saveData;
      if (bm.game) pub.game = bm.game;
      if (bm.author) pub.author = bm.author;
      if (bm.date) pub.date = bm.date;
      publicList.push(pub);

      const priv = { id: bm.id };
      if (bm.url) priv.url = bm.url;
      if (bm.title) priv.title = bm.title;
      if (bm.thumbnail) priv.thumbnail = bm.thumbnail;
      if (bm.embedUrl) priv.embedUrl = bm.embedUrl;
      if (bm.downloadUrl) priv.downloadUrl = bm.downloadUrl;
      if (bm.postData) priv.postData = bm.postData;
      if (bm.videoData) priv.videoData = bm.videoData;
      if (bm.linkData) priv.linkData = bm.linkData;
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
      // Загружаем текущий Gist для проверки конфликтов
      const gist = await gistFetch(gistId);
      if (!gist) throw new Error('Gist not found');
      const file = gist.files?.[GIST_FILENAME];
      if (!file) throw new Error('File not found');
      let payload = JSON.parse(file.content);

      const remoteUpdated = payload.lastUpdated || 0;
      if (remoteUpdated > lastUpdated) {
        // Конфликт – объединяем
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

      // Обновляем payload
      payload.publicBookmarks = publicList;
      payload.encryptedBookmarks = encryptedPrivate;
      payload.lastUpdated = Date.now();

      // Если пароль активен, удаляем byLogin и byToken (если они есть)
      if (hasPassword) {
        if (payload.masterKeyEncrypted?.byLogin) {
          delete payload.masterKeyEncrypted.byLogin;
        }
        if (payload.masterKeyEncrypted?.byToken) {
          delete payload.masterKeyEncrypted.byToken;
        }
        // Убеждаемся, что byPassword есть
        if (!payload.masterKeyEncrypted?.byPassword) {
          // Это аварийная ситуация, но на всякий случай перешифруем мастер-ключ паролем
          // (но пароль должен быть в sessionStorage)
          const password = sessionStorage.getItem(PASSWORD_CACHE_KEY);
          if (password) {
            const keyPassword = await deriveKeyFromString(password);
            const exported = await crypto.subtle.exportKey('raw', masterKey);
            const masterKeyArray = Array.from(new Uint8Array(exported));
            payload.masterKeyEncrypted.byPassword = await encryptData(masterKeyArray, keyPassword);
          }
        }
      } else {
        // Пароля нет – убеждаемся, что byLogin и byToken есть
        if (!payload.masterKeyEncrypted?.byLogin || !payload.masterKeyEncrypted?.byToken) {
          // Перешифровываем текущим логином и токеном
          const exported = await crypto.subtle.exportKey('raw', masterKey);
          const masterKeyArray = Array.from(new Uint8Array(exported));
          const user = getCurrentUser();
          const token = getToken();
          if (user && token) {
            const keyLogin = await deriveKeyFromString(user);
            const keyToken = await deriveKeyFromString(token);
            payload.masterKeyEncrypted.byLogin = await encryptData(masterKeyArray, keyLogin);
            payload.masterKeyEncrypted.byToken = await encryptData(masterKeyArray, keyToken);
            payload.lastLogin = user;
            payload.lastTokenHash = await hashString(token);
          }
        }
      }

      const content = JSON.stringify(payload);
      await gistUpdate(gistId, content);
      lastUpdated = payload.lastUpdated;
      cachedLastUpdated = lastUpdated;
      cachedBookmarks = bookmarks.slice();
      // Обновляем кеш
      saveGistToCache(payload);

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
      if (meta.cleanedUrl) bookmarkData.url = meta.cleanedUrl;
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
    if (user) {
      localStorage.removeItem(STORAGE_KEY_PREFIX + user);
      clearGistCache();
    }
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

    // Загружаем текущий Gist
    const gist = await gistFetch(gistId);
    if (!gist) throw new Error('Gist not found');
    const file = gist.files?.[GIST_FILENAME];
    if (!file) throw new Error('File not found');
    let payload = JSON.parse(file.content);

    const hasOldPassword = !!payload.masterKeyEncrypted?.byPassword;

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

    // Создаём новые блоки
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

    // Если пароль устанавливается, удаляем byLogin и byToken
    if (newPassword) {
      if (payload.masterKeyEncrypted?.byLogin) delete payload.masterKeyEncrypted.byLogin;
      if (payload.masterKeyEncrypted?.byToken) delete payload.masterKeyEncrypted.byToken;
      // byPassword будет установлен
    } else {
      // Пароль отключается – создаём byLogin и byToken
      payload.masterKeyEncrypted.byLogin = encryptedByLogin;
      payload.masterKeyEncrypted.byToken = encryptedByToken;
      payload.lastLogin = user;
      payload.lastTokenHash = await hashString(token);
    }

    // Устанавливаем byPassword (может быть null)
    payload.masterKeyEncrypted.byPassword = encryptedByPassword;
    payload.lastUpdated = Date.now();

    const content = JSON.stringify(payload);
    await gistUpdate(gistId, content);
    lastUpdated = payload.lastUpdated;
    // Обновляем кеш
    saveGistToCache(payload);
    showToast(newPassword ? 'Пароль установлен' : 'Пароль отключён', 'success');
  }

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

  function setStatusCallback(cb) {
    statusCallback = cb;
  }

  // ---- экспорт ----
  window._StorageManager = {
    getState: () => ({
      bookmarks,
      isInitialized,
      hasPassword,
      lastUpdated
    }),
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
    getBookmarks: () => bookmarks,
    setBookmarks: (newBookmarks) => { bookmarks = newBookmarks; cachedBookmarks = newBookmarks.slice(); },
    setRefreshGridCallback: (cb) => { window._StorageManager.refreshGridCallback = cb; }
  };
})();