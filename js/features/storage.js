// js/features/storage.js – полное хранилище с шифрованием, слиянием, метаданными, экспортом/импортом
// Пароль (если установлен) обязателен для расшифровки, даже при наличии логина и токена.
(function() {
  // ---- зависимости ----
  const {
    CONFIG, escapeHtml, createElement, formatDate, debounce,
    cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
    loadModule, performAction, showToast, getPlainTextLength
  } = window.GithubCore;

  const { getCurrentUser, getToken, hasScope } = window.GithubAuth;
  const { createModal, saveDraft, loadDraft, clearDraft } = window.UIUtils;

  // ---- константы ----
  const GIST_FILENAME = 'neon-imperium-bookmarks.json';
  const GIST_DESCRIPTION = 'Neon Imperium encrypted bookmarks';
  const STORAGE_KEY_PREFIX = 'bookmarks_';
  const PASSWORD_CACHE_KEY = 'storage_password';
  const SALT = 'neon-storage-salt-v2';
  const SAVE_DEBOUNCE_MS = 2000;
  const MAX_BOOKMARKS = 100;
  const VERSION = 4;

  // ---- состояние ----
  let currentUser = null;
  let currentToken = null;
  let gistId = null;
  let masterKey = null;          // расшифрованный мастер-ключ (CryptoKey)
  let bookmarks = [];            // расшифрованный массив закладок (полный)
  let isInitialized = false;
  let isSaving = false;
  let saveDebounced = null;
  let modalRef = null;
  let lastUpdated = 0;
  let hasPassword = false;       // есть ли в Gist блок byPassword

  // кеш
  let cachedMasterKey = null;
  let cachedBookmarks = null;
  let cachedLastUpdated = 0;

  // индикатор в модалке
  let statusElement = null;

  // ---- вспомогательные функции шифрования ----
  async function deriveKeyFromString(str, salt = SALT) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(str + salt),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode(salt),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptData(data, key) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      enc.encode(JSON.stringify(data))
    );
    return {
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted))
    };
  }

  async function decryptData(encryptedObj, key) {
    const iv = new Uint8Array(encryptedObj.iv);
    const data = new Uint8Array(encryptedObj.data);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );
    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decrypted));
  }

  // ---- работа с Gist ----
  async function gistFetch(gistId) {
    const url = `https://api.github.com/gists/${gistId}`;
    const token = getToken();
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, { headers });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`Gist fetch error: ${resp.status}`);
    return resp.json();
  }

  async function gistUpdate(gistId, content) {
    const url = `https://api.github.com/gists/${gistId}`;
    const token = getToken();
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ files: { [GIST_FILENAME]: { content } } })
    });
    if (!resp.ok) throw new Error(`Gist update error: ${resp.status}`);
    return resp.json();
  }

  async function gistCreate(content) {
    const url = 'https://api.github.com/gists';
    const token = getToken();
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false,
        files: { [GIST_FILENAME]: { content } }
      })
    });
    if (!resp.ok) throw new Error(`Gist create error: ${resp.status}`);
    const gist = await resp.json();
    return gist.id;
  }

  // ---- загрузка / создание хранилища (обновлённая логика) ----
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
      // миграция для старых версий не реализована, просто ошибка
      throw new Error('Unsupported storage version, please recreate');
    }

    const remoteUpdated = payload.lastUpdated || 0;
    const localUpdated = lastUpdated || 0;

    let masterKeyArray = null;
    let usedMethod = null;
    const hasPasswordBlock = !!payload.masterKeyEncrypted.byPassword;
    hasPassword = hasPasswordBlock;

    // ---- Новая логика расшифровки ----
    if (hasPasswordBlock) {
      // Если пароль установлен, расшифровка возможна ТОЛЬКО через пароль
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
      // Пароля нет – расшифровка через логин или токен
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
        // ничего не подошло – предлагаем пересоздать
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
      // Перешифровываем мастер-ключ новыми логином и токеном (если пароль не установлен, то byPassword останется null)
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
      // если пароль передан (может быть null для отключения)
      if (password) {
        const keyPassword = await deriveKeyFromString(password);
        encryptedByPassword = await encryptData(masterKeyArray, keyPassword);
      }
    } else {
      // если password === null, значит мы не хотим менять состояние byPassword (сохраняем как есть)
      // но для этого нужно загрузить текущий payload
    }

    const gist = await gistFetch(gistId);
    if (!gist) throw new Error('Gist not found');
    const file = gist.files?.[GIST_FILENAME];
    if (!file) throw new Error('File not found');
    let payload = JSON.parse(file.content);

    if (password !== null) {
      // явно задаём byPassword (может быть null)
      payload.masterKeyEncrypted.byPassword = encryptedByPassword;
    } else {
      // не трогаем byPassword (оставляем как было)
    }

    payload.lastLogin = login;
    payload.lastTokenHash = await hashString(token);
    payload.lastUpdated = Date.now();

    const content = JSON.stringify(payload);
    await gistUpdate(gistId, content);
  }

  // ---- слияние публичных и приватных частей ----
  function mergeBookmarksByType(publicBm, privateBm) {
    // Создаём карту приватных по id
    const privateMap = new Map();
    privateBm.forEach(p => privateMap.set(p.id, p));

    const merged = publicBm.map(pub => {
      const priv = privateMap.get(pub.id);
      if (priv) {
        // объединяем: публичные поля + приватные
        return { ...pub, ...priv };
      }
      // если нет приватной части, возвращаем только публичные (но это не должно происходить)
      return pub;
    });

    // Добавляем приватные, которых нет в публичных (не должно быть, но на всякий случай)
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
      // публичные поля
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

      // приватные поля
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
        // объединяем с локальными
        const merged = mergeBookmarks(bookmarks, remoteMerged);
        bookmarks = merged;
        cachedBookmarks = merged;
        lastUpdated = remoteUpdated;
      }

      // разделяем на публичные и приватные
      const { publicList, privateList } = splitBookmarks(bookmarks);

      // шифруем приватную часть
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

  // ---- функция слияния (конфликт) ----
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

  // индикатор статуса
  function updateStatus(text, type = 'info') {
    if (statusElement) {
      statusElement.textContent = text;
      statusElement.style.color = type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : 'var(--text-secondary)';
      statusElement.style.opacity = '1';
      setTimeout(() => { statusElement.style.opacity = '0.7'; }, 5000);
    }
  }

  // запрос пароля
  function promptPassword(message) {
    return new Promise((resolve) => {
      const input = prompt(message);
      resolve(input);
    });
  }

  // диалог пересоздания
  function confirmResetStorage() {
    return new Promise((resolve) => {
      const confirmed = confirm(
        'Не удалось расшифровать хранилище. Возможно, вы изменили логин, токен или не указали пароль.\n\n' +
        'Хотите пересоздать хранилище (все старые данные будут потеряны)?\n' +
        'Нажмите "Отмена", чтобы попробовать ввести пароль.'
      );
      resolve(confirmed);
    });
  }

  // хеш
  async function hashString(str) {
    const enc = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', enc.encode(str));
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
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

  // ---- добавление ----
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
    if (modalRef) renderBookmarks(modalRef.modal);
    return newBookmark;
  }

  // ---- удаление ----
  async function removeBookmark(id) {
    await ensureStorage();
    const t = (key) => window.I18n?.translate(key) || key;
    bookmarks = bookmarks.filter(b => b.id !== id);
    cachedBookmarks = bookmarks.slice();
    triggerSave();
    showToast(t('bookmarkDeleted'), 'success');
    if (modalRef) renderBookmarks(modalRef.modal);
  }

  // ---- загрузка ----
  async function loadBookmarks(forceRefresh = false) {
    const result = await ensureStorage(forceRefresh);
    return { bookmarks: result.bookmarks };
  }

  // ---- сброс ----
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

  // ---- установка/смена пароля (обновлённая) ----
  async function setStoragePassword(newPassword) {
    await ensureStorage();
    if (!masterKey) throw new Error('Storage not initialized');
    const user = getCurrentUser();
    const token = getToken();
    if (!user || !token) throw new Error('not_logged_in');

    // загружаем текущий gist
    const gist = await gistFetch(gistId);
    const file = gist.files?.[GIST_FILENAME];
    let payload = JSON.parse(file.content);

    const hasOldPassword = !!payload.masterKeyEncrypted.byPassword;

    if (hasOldPassword) {
      // для смены пароля нужно ввести старый
      const oldPassword = await promptPassword('Введите текущий пароль:');
      if (!oldPassword) throw new Error('Old password required');
      try {
        const keyOld = await deriveKeyFromString(oldPassword);
        await decryptData(payload.masterKeyEncrypted.byPassword, keyOld);
      } catch (e) {
        throw new Error('Invalid old password');
      }
    }

    // если новый пароль не пустой, проверяем, что он не равен токену
    if (newPassword && newPassword === token) {
      throw new Error('Пароль не должен совпадать с токеном GitHub');
    }

    // обновляем мастер-ключ
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

  // ---- экспорт ----
  async function exportBookmarks() {
    await ensureStorage();
    if (!masterKey) throw new Error('Storage not initialized');
    const password = await promptPassword('Введите пароль для шифрования экспортируемого файла (минимум 4 символа):');
    if (!password || password.length < 4) {
      showToast('Пароль должен быть не менее 4 символов', 'error');
      return;
    }
    const token = getToken();
    if (password === token) {
      showToast('Пароль не должен совпадать с токеном GitHub', 'error');
      return;
    }

    const exportData = {
      version: 1,
      exportedAt: Date.now(),
      bookmarks: bookmarks
    };
    const jsonStr = JSON.stringify(exportData);

    const key = await deriveKeyFromString(password);
    const encrypted = await encryptData(jsonStr, key);
    const blob = new Blob([JSON.stringify(encrypted)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `neon-bookmarks-${new Date().toISOString().slice(0,10)}.neonbk`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Экспорт выполнен', 'success');
  }

  // ---- импорт ----
  async function importBookmarks() {
    await ensureStorage();
    if (!masterKey) throw new Error('Storage not initialized');
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
          const password = await promptPassword('Введите пароль для расшифровки импортируемого файла:');
          if (!password) return;
          const key = await deriveKeyFromString(password);
          const decryptedStr = await decryptData(encrypted, key);
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
          showToast(`Импортировано ${added} закладок`, 'success');
          if (modalRef) renderBookmarks(modalRef.modal);
        } catch (err) {
          showToast('Ошибка импорта: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ---- fetchMetadata (реальная реализация) ----
  async function fetchMetadata(url) {
    try {
      const resp1 = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(5000) });
      if (resp1.ok) {
        const data = await resp1.json();
        if (data && data.title) {
          return {
            title: data.title,
            thumbnail: data.thumbnail_url || data.thumbnail || null,
            embedUrl: data.html ? extractIframeSrc(data.html) : null,
            type: data.type === 'video' ? 'video' : 'link',
            videoData: data.type === 'video' ? { service: 'oembed', embedUrl: data.html } : null
          };
        }
      }
    } catch (e) {}

    try {
      const resp2 = await fetch(`https://iframe.ly/api/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(5000) });
      if (resp2.ok) {
        const data = await resp2.json();
        if (data && data.title) {
          return {
            title: data.title,
            thumbnail: data.thumbnail_url || null,
            embedUrl: data.html ? extractIframeSrc(data.html) : null,
            type: data.type === 'video' ? 'video' : 'link',
            videoData: data.type === 'video' ? { service: 'iframe', embedUrl: data.html } : null
          };
        }
      }
    } catch (e) {}

    try {
      const resp3 = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}&data.title&data.image&data.embed`, { signal: AbortSignal.timeout(5000) });
      if (resp3.ok) {
        const data = await resp3.json();
        if (data && data.data && data.data.title) {
          const embedHtml = data.data.embed?.html || null;
          return {
            title: data.data.title,
            thumbnail: data.data.image?.url || null,
            embedUrl: embedHtml ? extractIframeSrc(embedHtml) : null,
            type: data.data.embed?.type === 'video' ? 'video' : 'link',
            videoData: data.data.embed?.type === 'video' ? { service: 'microlink', embedUrl: embedHtml } : null
          };
        }
      }
    } catch (e) {}

    return { title: url, thumbnail: null, embedUrl: null, type: 'link', videoData: null };
  }

  function extractIframeSrc(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const iframe = div.querySelector('iframe');
    return iframe ? iframe.src : null;
  }

  // ---- рендер закладок ----
  function renderBookmarks(modal) {
    const grid = modal.querySelector('#bookmarks-grid');
    if (!grid) return;
    const t = (key) => window.I18n?.translate(key) || key;

    let filtered = bookmarks.slice();
    const activeCat = modal.querySelector('.cat-btn.active');
    const category = activeCat ? activeCat.dataset.cat : 'all';
    const searchInput = modal.querySelector('#search-input');
    const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const sortOrder = modal.querySelector('.sort-btn.active')?.dataset.order || 'new';

    if (category !== 'all') filtered = filtered.filter(b => b.type === category);
    if (searchQuery) filtered = filtered.filter(b => b.title.toLowerCase().includes(searchQuery));
    if (sortOrder === 'new') filtered.sort((a,b) => new Date(b.added) - new Date(a.added));
    else filtered.sort((a,b) => new Date(a.added) - new Date(b.added));

    grid.innerHTML = '';
    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><p>${t('noBookmarks')}</p></div>`;
      return;
    }
    const fragment = document.createDocumentFragment();
    filtered.forEach(bm => {
      const card = createBookmarkCard(bm, modal);
      fragment.appendChild(card);
    });
    grid.appendChild(fragment);
  }

  function createBookmarkCard(bm, modal) {
    const wrapper = document.createElement('div');
    wrapper.className = 'bookmark-card-wrapper';
    const card = document.createElement('div');
    card.className = 'bookmark-card';
    card.style.cursor = 'pointer';

    const content = document.createElement('div');
    content.className = 'bookmark-content';
    const title = document.createElement('h4');
    title.textContent = bm.title || 'Закладка';
    content.appendChild(title);
    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:12px;color:var(--text-secondary)';
    meta.textContent = `${bm.type.charAt(0).toUpperCase()+bm.type.slice(1)} · ${formatDate(bm.added)}`;
    content.appendChild(meta);
    card.appendChild(content);

    const media = document.createElement('div');
    media.className = 'bookmark-media';
    if (bm.thumbnail) {
      const img = document.createElement('img');
      img.src = bm.thumbnail;
      img.alt = bm.title;
      img.onerror = () => img.style.display = 'none';
      media.appendChild(img);
      if (bm.type === 'video') {
        const play = document.createElement('div');
        play.className = 'play-overlay';
        play.innerHTML = '<i class="fas fa-play"></i>';
        media.appendChild(play);
      }
    } else {
      const icon = document.createElement('div');
      icon.className = 'bookmark-icon';
      const icons = { post: 'fa-newspaper', video: 'fa-video', save: 'fa-save', link: 'fa-link' };
      icon.innerHTML = `<i class="fas ${icons[bm.type] || 'fa-link'}"></i>`;
      media.appendChild(icon);
    }
    card.insertBefore(media, content);

    card.addEventListener('click', () => {
      if (bm.type === 'post' && bm.postData && bm.postData.id) {
        if (window.UIFeedback) {
          window.UIFeedback.openFullModal(bm.postData);
        } else {
          showToast('Пост недоступен', 'error');
        }
      } else if (bm.type === 'video' && bm.embedUrl) {
        const modalVideo = document.createElement('div');
        modalVideo.className = 'modal-fullscreen';
        modalVideo.style.zIndex = '10002';
        modalVideo.innerHTML = `
          <div class="modal-content-full" style="max-width:900px;">
            <div class="modal-header">
              <h2>${escapeHtml(bm.title)}</h2>
              <button class="modal-close"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body" style="padding:20px;">
              <div style="position:relative;padding-bottom:56.25%;height:0;">
                <iframe src="${escapeHtml(bm.embedUrl)}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allowfullscreen></iframe>
              </div>
            </div>
          </div>
        `;
        document.body.appendChild(modalVideo);
        modalVideo.classList.add('active');
        const close = () => { modalVideo.remove(); document.body.style.overflow = ''; };
        modalVideo.querySelector('.modal-close').addEventListener('click', close);
        modalVideo.addEventListener('click', (e) => { if (e.target === modalVideo) close(); });
      } else if (bm.type === 'save' && bm.saveData) {
        const binary = atob(bm.saveData.content);
        const bytes = new Uint8Array(binary.length);
        for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = bm.saveData.fileName || 'save.dat';
        a.click();
        URL.revokeObjectURL(a.href);
      } else if (bm.url) {
        window.open(bm.url, '_blank');
      }
    });

    const del = document.createElement('button');
    del.className = 'bookmark-delete-btn';
    del.innerHTML = '<i class="fas fa-trash-alt"></i>';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Удалить закладку?')) {
        await removeBookmark(bm.id);
        if (modal) renderBookmarks(modal);
      }
    });
    wrapper.appendChild(card);
    wrapper.appendChild(del);
    return wrapper;
  }

  // ---- открытие модалки ----
  async function openStorageModal(gameContext = null) {
    const t = (key) => window.I18n?.translate(key) || key;
    const user = getCurrentUser();
    if (!user) { showToast(t('loginToGitHub'), 'error'); return; }
    if (!hasScope('gist')) { showToast(t('needGistScope'), 'error'); return; }

    try {
      await ensureStorage();
    } catch (e) {
      showToast('Ошибка загрузки хранилища: ' + e.message, 'error');
      return;
    }

    const html = `
      <div class="storage-modal-container">
        <div class="storage-header">
          <div class="storage-controls">
            <div class="storage-sort">
              <button class="sort-btn active" data-order="new"><i class="fas fa-arrow-down"></i> ${t('new')}</button>
              <button class="sort-btn" data-order="old"><i class="fas fa-arrow-up"></i> ${t('old')}</button>
            </div>
            <div class="storage-categories">
              <button class="cat-btn active" data-cat="all"><i class="fas fa-globe"></i> ${t('all')}</button>
              <button class="cat-btn" data-cat="post"><i class="fas fa-newspaper"></i> ${t('posts')}</button>
              <button class="cat-btn" data-cat="video"><i class="fas fa-video"></i> ${t('videos')}</button>
              <button class="cat-btn" data-cat="link"><i class="fas fa-link"></i> ${t('links')}</button>
              <button class="cat-btn" data-cat="save"><i class="fas fa-save"></i> ${t('saves')}</button>
            </div>
          </div>
          <div class="storage-actions">
            <button class="storage-btn" id="password-btn" title="Установить пароль на хранилище"><i class="fas fa-lock"></i></button>
            <button class="storage-btn" id="export-btn" title="Экспорт закладок"><i class="fas fa-download"></i></button>
            <button class="storage-btn" id="import-btn" title="Импорт закладок"><i class="fas fa-upload"></i></button>
            <div class="search-wrapper">
              <input type="text" id="search-input" placeholder="${t('searchPlaceholder')}" class="storage-search">
            </div>
            <button class="storage-btn primary" id="toggle-add-btn"><i class="fas fa-plus"></i> ${t('addButton')}</button>
          </div>
        </div>
        <div id="add-form" class="storage-add-form" style="display:none;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <input type="url" id="new-url" placeholder="${t('addLinkPlaceholder')}" autocomplete="off" class="storage-url-input">
            <button class="storage-btn primary" id="confirm-add"><i class="fas fa-plus"></i> ${t('addButton')}</button>
          </div>
          <div style="margin-top:12px;border:2px dashed var(--border);border-radius:16px;padding:20px;text-align:center;color:var(--text-secondary);" id="drop-zone">
            <i class="fas fa-file-upload" style="font-size:32px;display:block;margin-bottom:8px;"></i>
            <p>${t('dropZoneText')}</p>
            <input type="file" id="file-input" accept=".ini,.starver" multiple style="display:none;">
            <button class="storage-btn" id="file-select-btn"><i class="fas fa-folder-open"></i> ${t('selectFiles')}</button>
          </div>
        </div>
        <div id="status-bar" style="padding:6px 12px;background:var(--bg-primary);border-radius:20px;font-size:13px;color:var(--text-secondary);opacity:0.8;transition:opacity 0.3s;display:flex;justify-content:space-between;align-items:center;">
          <span id="status-text">Готово</span>
          <span id="status-icon" style="font-size:16px;">✅</span>
        </div>
        <div class="bookmarks-grid" id="bookmarks-grid"></div>
      </div>
    `;

    const { modal, closeModal } = createModal(t('storageModalTitle'), html, { size: 'full' });
    modalRef = { modal, closeModal };
    statusElement = modal.querySelector('#status-text');

    const style = document.createElement('style');
    style.textContent = `
      .storage-modal-container{display:flex;flex-direction:column;gap:20px}
      .storage-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px}
      .storage-controls{display:flex;gap:15px;flex-wrap:wrap}
      .storage-sort,.storage-categories{display:flex;background:var(--bg-primary);border-radius:40px;padding:4px;border:1px solid var(--border)}
      .sort-btn,.cat-btn{background:0;border:0;color:var(--text-secondary);padding:8px 16px;border-radius:40px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:0.2s;font-family:'Russo One',sans-serif}
      .sort-btn.active,.cat-btn.active{background:var(--accent);color:#fff}
      .storage-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .storage-btn{background:var(--bg-primary);border:1px solid var(--border);color:var(--text-secondary);padding:8px 16px;border-radius:40px;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:0.2s;font-family:'Russo One',sans-serif}
      .storage-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
      .storage-btn:hover{transform:translateY(-2px);box-shadow:0 5px 15px rgba(0,0,0,0.2)}
      .bookmarks-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}
      .storage-add-form{background:var(--bg-inner-gradient);padding:16px;border-radius:20px;border:1px solid var(--border)}
      .storage-search{padding:6px 14px;border-radius:40px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text-primary);font-family:var(--font-family);font-size:14px;width:160px}
      .storage-search:focus{border-color:var(--accent);outline:none}
      .bookmark-card-wrapper{position:relative;transition:transform 0.2s}
      .bookmark-card-wrapper:hover{transform:translateY(-4px)}
      .bookmark-delete-btn{opacity:0;transition:opacity 0.2s;position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.6);border:none;border-radius:50%;width:28px;height:28px;color:#f44336;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;z-index:5}
      .bookmark-card-wrapper:hover .bookmark-delete-btn{opacity:1}
      .bookmark-card{background:var(--bg-inner-gradient);border-radius:20px;border:1px solid var(--border);overflow:hidden;display:flex;flex-direction:column;height:100%}
      .bookmark-media{position:relative;padding-bottom:56.25%;background:var(--bg-primary);border-bottom:1px solid var(--border);flex-shrink:0;overflow:hidden}
      .bookmark-media img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
      .play-overlay{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.7);border-radius:50%;width:60px;height:60px;display:flex;align-items:center;justify-content:center;color:white;font-size:30px;pointer-events:none}
      .bookmark-icon{display:flex;align-items:center;justify-content:center;font-size:48px;padding:20px 0;background:var(--bg-primary);border-bottom:1px solid var(--border)}
      .bookmark-content{padding:12px;flex:1;display:flex;flex-direction:column}
      .bookmark-content h4{margin:0 0 4px;font-size:16px;color:var(--text-primary)}
      #status-bar{margin:4px 0}
    `;
    modal.appendChild(style);

    renderBookmarks(modal);

    modal.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderBookmarks(modal);
      });
    });

    modal.querySelectorAll('.cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderBookmarks(modal);
      });
    });

    const searchInput = modal.querySelector('#search-input');
    searchInput.addEventListener('input', () => renderBookmarks(modal));

    const addForm = modal.querySelector('#add-form');
    const toggleAddBtn = modal.querySelector('#toggle-add-btn');
    let formVisible = false;
    toggleAddBtn.addEventListener('click', () => {
      formVisible = !formVisible;
      addForm.style.display = formVisible ? 'block' : 'none';
      toggleAddBtn.innerHTML = formVisible ? `<i class="fas fa-times"></i> ${t('cancelButton')}` : `<i class="fas fa-plus"></i> ${t('addButton')}`;
    });

    const urlInput = modal.querySelector('#new-url');
    const confirmAdd = modal.querySelector('#confirm-add');
    confirmAdd.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) { showToast(t('enterText'), 'error'); return; }
      try {
        const meta = await fetchMetadata(url);
        await addBookmark({
          url: url,
          title: meta.title || url,
          thumbnail: meta.thumbnail || null,
          embedUrl: meta.embedUrl || null,
          type: meta.type || 'link',
          videoData: meta.videoData || null,
          postData: meta.postData || null
        });
        urlInput.value = '';
        renderBookmarks(modal);
      } catch (e) {
        if (e.message !== 'duplicate') showToast(e.message, 'error');
      }
    });

    const dropZone = modal.querySelector('#drop-zone');
    const fileInput = modal.querySelector('#file-input');
    const fileSelectBtn = modal.querySelector('#file-select-btn');
    fileSelectBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (files.length) await processFiles(files, modal);
      fileInput.value = '';
    });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '';
      const files = e.dataTransfer.files;
      if (files.length) await processFiles(files, modal);
    });

    modal.querySelector('#password-btn').addEventListener('click', async () => {
      const t = (key) => window.I18n?.translate(key) || key;
      const newPass = prompt('Введите новый пароль для хранилища (оставьте пустым, чтобы отключить):\n\nВНИМАНИЕ: пароль становится обязательным для доступа, даже при наличии логина и токена.');
      if (newPass === null) return;
      try {
        await setStoragePassword(newPass || null);
        showToast('Пароль обновлён', 'success');
        // обновляем статус hasPassword
        if (newPass) hasPassword = true;
        else hasPassword = false;
      } catch (e) {
        showToast(e.message, 'error');
      }
    });

    modal.querySelector('#export-btn').addEventListener('click', exportBookmarks);
    modal.querySelector('#import-btn').addEventListener('click', importBookmarks);

    const closeWithCleanup = () => {
      modalRef = null;
      closeModal();
    };
    modal.querySelector('.modal-close').addEventListener('click', closeWithCleanup);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeWithCleanup(); });

    async function processFiles(files, modal) {
      const t = (key) => window.I18n?.translate(key) || key;
      for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext !== 'ini' && ext !== 'starver') {
          showToast(t('fileNotSupported').replace('{name}', file.name), 'error');
          continue;
        }
        try {
          const buffer = await file.arrayBuffer();
          const base64 = arrayBufferToBase64(buffer);
          const hash = await hashBuffer(buffer);
          await addBookmark({
            url: null,
            title: file.name,
            saveData: {
              fileName: file.name,
              content: base64,
              hash: hash,
              mimeType: 'text/plain',
              game: null
            },
            type: 'save'
          });
          showToast(t('saveAdded').replace('{name}', file.name), 'success');
        } catch (e) {
          showToast(e.message, 'error');
        }
      }
      renderBookmarks(modal);
    }

    function arrayBufferToBase64(buffer) {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i=0; i<bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }

    async function hashBuffer(buffer) {
      const hash = await crypto.subtle.digest('SHA-256', buffer);
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
    }

    updateStatus('Готово', 'success');
    return { modal, closeModal: closeWithCleanup };
  }

  // ---- экспорт ----
  window.BookmarkStorage = {
    openStorageModal,
    addBookmark,
    removeBookmark,
    loadBookmarks,
    resetStorage,
    setStoragePassword,
    ensureStorage,
    exportBookmarks,
    importBookmarks
  };
})();