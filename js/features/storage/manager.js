// js/features/storage/manager.js
// Управление состоянием хранилища: загрузка, сохранение, добавление, удаление, экспорт/импорт
// Исправлено: надёжное получение токена из sessionStorage, улучшенная обработка ошибок

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

  // ---- Надёжное получение токена ----
  function getAuthToken() {
    // Сначала пробуем через GithubAuth
    if (window.GithubAuth && typeof window.GithubAuth.getToken === 'function') {
      const token = window.GithubAuth.getToken();
      if (token) return token;
    }
    // Fallback: читаем из sessionStorage напрямую
    return sessionStorage.getItem('github_token') || null;
  }

  function getCurrentUserLogin() {
    if (window.GithubAuth && typeof window.GithubAuth.getCurrentUser === 'function') {
      return window.GithubAuth.getCurrentUser();
    }
    // Fallback: читаем из sessionStorage
    try {
      const userData = JSON.parse(sessionStorage.getItem('github_user') || 'null');
      return userData?.login || null;
    } catch {
      return null;
    }
  }

  function isAdminUser() {
    const user = getCurrentUserLogin();
    return user && window.GithubCore?.CONFIG?.ALLOWED_AUTHORS?.includes(user);
  }

  let currentUser = null;
  let currentToken = null;
  let gistId = null;
  let masterKey = null;
  let bookmarks = [];
  let isInitialized = false;
  let isSaving = false;
  let saveDebounced = null;
  let lastUpdated = 0;
  let hasPassword = false;

  let cachedMasterKey = null;
  let cachedBookmarks = null;
  let cachedLastUpdated = 0;

  let statusCallback = null;
  let backgroundUpdateTimer = null;

  const TOKEN_HASH_KEY = 'storage_token_hash';

  function getStoredTokenHash() {
    return sessionStorage.getItem(TOKEN_HASH_KEY);
  }

  function setStoredTokenHash(hash) {
    if (hash) {
      sessionStorage.setItem(TOKEN_HASH_KEY, hash);
    } else {
      sessionStorage.removeItem(TOKEN_HASH_KEY);
    }
  }

  function updateStatus(text, type = 'info') {
    if (statusCallback) statusCallback(text, type);
  }

  function getGistCacheKey() {
    const user = getCurrentUserLogin();
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

  // ---- Поиск существующего Gist'а по имени файла (с авторизацией) ----
  async function findExistingGist(user, token) {
    if (!user || !token) return null;
    try {
      const url = `https://api.github.com/gists?per_page=100`;
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      };
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        console.warn('[Storage] Не удалось получить список Gist\'ов:', resp.status);
        return null;
      }
      const gists = await resp.json();
      const found = gists.find(g => {
        const files = g.files;
        return files && files[GIST_FILENAME];
      });
      if (found) {
        console.log('[Storage] Найден существующий Gist:', found.id);
        return found.id;
      }
      return null;
    } catch (e) {
      console.warn('[Storage] Ошибка поиска Gist\'ов:', e);
      return null;
    }
  }

  // ---- Загрузка или создание хранилища ----
  async function loadOrCreateStorage(forceRefresh = false) {
    const user = getCurrentUserLogin();
    const token = getAuthToken();
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

    if (!forceRefresh) {
      const cachedPayload = loadGistFromCache();
      if (cachedPayload) {
        try {
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
          console.warn('Кеш хранилища недействителен, загружаем из сети');
        }
      }
    }

    if (window.RateLimits) {
      const hasLimit = await window.RateLimits.waitForLimit('cacheClears', 10000).catch(() => false);
      if (!hasLimit) {
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

    // Пытаемся получить gistId из localStorage
    let stored = localStorage.getItem(STORAGE_KEY_PREFIX + user);
    if (stored) {
      try {
        gistId = JSON.parse(stored).gistId;
      } catch (e) {}
    }

    // Если gistId нет в localStorage – ищем среди всех Gist'ов пользователя
    if (!gistId) {
      console.log('[Storage] gistId не найден в localStorage, выполняем поиск...');
      const foundId = await findExistingGist(user, token);
      if (foundId) {
        gistId = foundId;
        localStorage.setItem(STORAGE_KEY_PREFIX + user, JSON.stringify({ gistId }));
        console.log('[Storage] Найденный gistId сохранён в localStorage');
      } else {
        console.log('[Storage] Существующий Gist не найден, будет создан новый.');
      }
    }

    let gistData = null;
    let payload = null;

    if (gistId) {
      gistData = await gistFetch(gistId);
    }

    if (!gistData) {
      if (!gistId) {
        const foundId = await findExistingGist(user, token);
        if (foundId) {
          gistId = foundId;
          localStorage.setItem(STORAGE_KEY_PREFIX + user, JSON.stringify({ gistId }));
          gistData = await gistFetch(gistId);
        }
      }
      if (!gistData) {
        console.log('[Storage] Создаём новый Gist');
        return await createNewStorage(user, token);
      }
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

  // ---- Обработка payload (общая логика) ----
  async function processGistPayload(payload, user, token) {
    const remoteUpdated = payload.lastUpdated || 0;
    let masterKeyArray = null;
    const hasPasswordBlock = !!payload.masterKeyEncrypted?.byPassword;
    hasPassword = hasPasswordBlock;

    if (hasPasswordBlock) {
      let cachedPassword = sessionStorage.getItem(PASSWORD_CACHE_KEY);
      if (cachedPassword) {
        try {
          const keyPassword = await deriveKeyFromString(cachedPassword);
          masterKeyArray = await decryptData(payload.masterKeyEncrypted.byPassword, keyPassword);
          return buildResult(masterKeyArray, payload, remoteUpdated);
        } catch (e) {
          sessionStorage.removeItem(PASSWORD_CACHE_KEY);
        }
      }

      const MAX_ATTEMPTS = 3;
      let attempts = 0;
      let password = null;
      let cancelled = false;

      while (attempts < MAX_ATTEMPTS) {
        const input = await promptPassword(
          `Хранилище защищено паролем. Введите пароль для доступа (попытка ${attempts+1}/${MAX_ATTEMPTS}):`
        );
        if (input === null) {
          cancelled = true;
          break;
        }
        password = input.trim();
        if (!password) {
          showToast('Пароль не может быть пустым', 'error');
          attempts++;
          continue;
        }

        try {
          const keyPassword = await deriveKeyFromString(password);
          masterKeyArray = await decryptData(payload.masterKeyEncrypted.byPassword, keyPassword);
          sessionStorage.setItem(PASSWORD_CACHE_KEY, password);
          break;
        } catch (e) {
          attempts++;
          if (attempts < MAX_ATTEMPTS) {
            showToast(`Неверный пароль. Осталось попыток: ${MAX_ATTEMPTS - attempts}`, 'error');
          } else {
            showToast('Неверный пароль. Попытки исчерпаны.', 'error');
          }
        }
      }

      if (!masterKeyArray) {
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
          throw new Error('Доступ к хранилищу отклонён. Невозможно загрузить данные.');
        }
      }

      return buildResult(masterKeyArray, payload, remoteUpdated);
    }

    const encryptedByToken = payload.masterKeyEncrypted?.byToken;
    if (!encryptedByToken) {
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
        throw new Error('Нет доступного способа расшифровки хранилища.');
      }
    }

    try {
      const keyToken = await deriveKeyFromString(token);
      masterKeyArray = await decryptData(encryptedByToken, keyToken);
      const currentTokenHash = await hashString(token);
      const storedHash = getStoredTokenHash();
      if (!storedHash || storedHash !== currentTokenHash) {
        const masterKeyCrypto = await crypto.subtle.importKey(
          'raw',
          new Uint8Array(masterKeyArray),
          { name: 'AES-GCM' },
          true,
          ['encrypt', 'decrypt']
        );
        await updateMasterKeyEncryption(masterKeyCrypto, user, token, null);
        setStoredTokenHash(currentTokenHash);
        console.log('[Storage] Шифрование обновлено новым токеном');
      } else {
        if (!storedHash) {
          setStoredTokenHash(currentTokenHash);
        }
      }
      return buildResult(masterKeyArray, payload, remoteUpdated);
    } catch (e) {
      showToast('Текущий токен не подходит для расшифровки. Введите старый токен.', 'warning');

      const MAX_ATTEMPTS = 3;
      let attempts = 0;
      let oldToken = null;
      let cancelled = false;

      while (attempts < MAX_ATTEMPTS) {
        const input = await promptPassword(
          `Введите старый GitHub-токен, которым было зашифровано хранилище (попытка ${attempts+1}/${MAX_ATTEMPTS}):`
        );
        if (input === null) {
          cancelled = true;
          break;
        }
        oldToken = input.trim();
        if (!oldToken) {
          showToast('Токен не может быть пустым', 'error');
          attempts++;
          continue;
        }

        try {
          const keyOld = await deriveKeyFromString(oldToken);
          masterKeyArray = await decryptData(encryptedByToken, keyOld);
          const masterKeyCrypto = await crypto.subtle.importKey(
            'raw',
            new Uint8Array(masterKeyArray),
            { name: 'AES-GCM' },
            true,
            ['encrypt', 'decrypt']
          );
          await updateMasterKeyEncryption(masterKeyCrypto, user, token, null);
          const newHash = await hashString(token);
          setStoredTokenHash(newHash);
          showToast('Хранилище успешно обновлено под новый токен', 'success');
          break;
        } catch (err) {
          attempts++;
          if (attempts < MAX_ATTEMPTS) {
            showToast(`Неверный токен. Осталось попыток: ${MAX_ATTEMPTS - attempts}`, 'error');
          } else {
            showToast('Неверный токен. Попытки исчерпаны.', 'error');
          }
        }
      }

      if (!masterKeyArray) {
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
          throw new Error('Не удалось расшифровать хранилище. Доступ отклонён.');
        }
      }

      return buildResult(masterKeyArray, payload, remoteUpdated);
    }
  }

  async function buildResult(masterKeyArray, payload, remoteUpdated) {
    const masterKeyCrypto = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(masterKeyArray),
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt']
    );

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

  async function createNewStorage(user, token) {
    const newMasterKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const exported = await crypto.subtle.exportKey('raw', newMasterKey);
    const masterKeyArray = Array.from(new Uint8Array(exported));

    const keyToken = await deriveKeyFromString(token);
    const encryptedByToken = await encryptData(masterKeyArray, keyToken);

    const payload = {
      version: VERSION,
      salt: SALT,
      masterKeyEncrypted: {
        byToken: encryptedByToken,
        byPassword: null
      },
      publicBookmarks: [],
      encryptedBookmarks: null,
      lastUpdated: Date.now()
    };

    const content = JSON.stringify(payload);
    const newGistId = await gistCreate(content);
    gistId = newGistId;
    localStorage.setItem(STORAGE_KEY_PREFIX + user, JSON.stringify({ gistId }));
    saveGistToCache(payload);

    const tokenHash = await hashString(token);
    setStoredTokenHash(tokenHash);

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

  async function updateMasterKeyEncryption(masterKeyCrypto, login, token, password = null) {
    const exported = await crypto.subtle.exportKey('raw', masterKeyCrypto);
    const masterKeyArray = Array.from(new Uint8Array(exported));

    const gist = await gistFetch(gistId);
    if (!gist) throw new Error('Gist not found');
    const file = gist.files?.[GIST_FILENAME];
    if (!file) throw new Error('File not found');
    let payload = JSON.parse(file.content);

    if (password === null) {
      const keyToken = await deriveKeyFromString(token);
      const encryptedByToken = await encryptData(masterKeyArray, keyToken);
      payload.masterKeyEncrypted.byToken = encryptedByToken;
      payload.masterKeyEncrypted.byPassword = null;
      hasPassword = false;
    } else {
      const keyPassword = await deriveKeyFromString(password);
      const encryptedByPassword = await encryptData(masterKeyArray, keyPassword);
      payload.masterKeyEncrypted.byPassword = encryptedByPassword;
      delete payload.masterKeyEncrypted.byToken;
      hasPassword = true;
    }

    payload.lastUpdated = Date.now();

    const content = JSON.stringify(payload);
    await gistUpdate(gistId, content);
    saveGistToCache(payload);
  }

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
      if (bm.downloadUrlExpires) priv.downloadUrlExpires = bm.downloadUrlExpires;
      if (bm.postData) priv.postData = bm.postData;
      if (bm.videoData) priv.videoData = bm.videoData;
      if (bm.linkData) priv.linkData = bm.linkData;
      privateList.push(priv);
    });

    return { publicList, privateList };
  }

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

      if (hasPassword) {
        if (!payload.masterKeyEncrypted?.byPassword) {
          const password = sessionStorage.getItem(PASSWORD_CACHE_KEY);
          if (password) {
            const keyPassword = await deriveKeyFromString(password);
            const exported = await crypto.subtle.exportKey('raw', masterKey);
            const masterKeyArray = Array.from(new Uint8Array(exported));
            payload.masterKeyEncrypted.byPassword = await encryptData(masterKeyArray, keyPassword);
            delete payload.masterKeyEncrypted.byToken;
          }
        }
        if (payload.masterKeyEncrypted?.byToken) {
          delete payload.masterKeyEncrypted.byToken;
        }
      } else {
        if (!payload.masterKeyEncrypted?.byToken) {
          const exported = await crypto.subtle.exportKey('raw', masterKey);
          const masterKeyArray = Array.from(new Uint8Array(exported));
          const user = getCurrentUserLogin();
          const token = getAuthToken();
          if (user && token) {
            const keyToken = await deriveKeyFromString(token);
            payload.masterKeyEncrypted.byToken = await encryptData(masterKeyArray, keyToken);
          }
        }
        if (payload.masterKeyEncrypted?.byPassword) {
          delete payload.masterKeyEncrypted.byPassword;
        }
      }

      const content = JSON.stringify(payload);
      await gistUpdate(gistId, content);
      lastUpdated = payload.lastUpdated;
      cachedLastUpdated = lastUpdated;
      cachedBookmarks = bookmarks.slice();
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

  async function updateBookmark(id, updates) {
    await ensureStorage();
    const idx = bookmarks.findIndex(b => b.id === id);
    if (idx === -1) throw new Error('Bookmark not found');
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        bookmarks[idx][key] = value;
      }
    }
    cachedBookmarks = bookmarks.slice();
    triggerSave();
    if (window._StorageUI && window._StorageUI.updateBookmarkCard) {
      window._StorageUI.updateBookmarkCard(id, bookmarks[idx]);
    }
    return bookmarks[idx];
  }

  async function batchUpdateVideoLinks() {
    await ensureStorage();
    const videoBookmarks = bookmarks.filter(b => b.type === 'video' && b.url);
    let updated = 0;
    let failed = 0;
    for (const bm of videoBookmarks) {
      if (bm.downloadUrl && bm.downloadUrlExpires && Date.now() < bm.downloadUrlExpires) {
        continue;
      }
      try {
        const { getVideoDownloadUrl } = window._StorageUI || {};
        if (typeof getVideoDownloadUrl === 'function') {
          const url = await getVideoDownloadUrl(bm.url);
          if (url) {
            const expires = Date.now() + 24 * 60 * 60 * 1000;
            await updateBookmark(bm.id, { downloadUrl: url, downloadUrlExpires: expires });
            updated++;
          } else {
            failed++;
          }
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
        console.warn('Failed to update video link for', bm.id, e);
      }
    }
    return { updated, failed, total: videoBookmarks.length };
  }

  function startBackgroundUpdate() {
    if (backgroundUpdateTimer) return;
    backgroundUpdateTimer = setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        const result = await batchUpdateVideoLinks();
        if (result.updated > 0) {
          updateStatus(`Обновлено ${result.updated} видео-ссылок`, 'success');
        }
      } catch (e) {
        console.warn('Background update error:', e);
      }
    }, 24 * 60 * 60 * 1000);
  }

  function stopBackgroundUpdate() {
    if (backgroundUpdateTimer) {
      clearInterval(backgroundUpdateTimer);
      backgroundUpdateTimer = null;
    }
  }

  function exportAllBookmarks() {
    return bookmarks.slice();
  }

  async function importBookmarksBatch(bookmarksArray) {
    await ensureStorage();
    let added = 0;
    let skipped = 0;
    for (const bm of bookmarksArray) {
      try {
        if (bm.url && bookmarks.some(b => b.url === bm.url)) {
          skipped++;
          continue;
        }
        if (bm.saveData && bm.saveData.hash && bookmarks.some(b => b.saveData && b.saveData.hash === bm.saveData.hash)) {
          skipped++;
          continue;
        }
        const newBm = {
          id: 'bm-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
          added: new Date().toISOString(),
          ...bm
        };
        bookmarks.unshift(newBm);
        added++;
        if (bookmarks.length > MAX_BOOKMARKS) {
          bookmarks.splice(MAX_BOOKMARKS);
        }
      } catch (e) {
        console.warn('Import skip:', e);
      }
    }
    if (added > 0) {
      cachedBookmarks = bookmarks.slice();
      triggerSave();
    }
    return { added, skipped };
  }

  async function ensureStorage(forceRefresh = false) {
    if (isInitialized && !forceRefresh) return { bookmarks };
    try {
      const result = await loadOrCreateStorage(forceRefresh);
      if (!backgroundUpdateTimer) startBackgroundUpdate();
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
      downloadUrlExpires: bookmarkData.downloadUrlExpires || null,
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

    const modal = window._StorageUI?.currentModal;
    if (window._StorageUI && window._StorageUI.addBookmarkCard && modal) {
      window._StorageUI.addBookmarkCard(newBookmark, modal);
    }
    return newBookmark;
  }

  async function removeBookmark(id) {
    await ensureStorage();
    const t = (key) => window.I18n?.translate(key) || key;
    const idx = bookmarks.findIndex(b => b.id === id);
    if (idx === -1) return;
    bookmarks.splice(idx, 1);
    cachedBookmarks = bookmarks.slice();
    triggerSave();
    showToast(t('bookmarkDeleted'), 'success');
    const modal = window._StorageUI?.currentModal;
    if (window._StorageUI && window._StorageUI.removeBookmarkCard && modal) {
      window._StorageUI.removeBookmarkCard(id, modal);
    }
  }

  async function loadBookmarks(forceRefresh = false) {
    const result = await ensureStorage(forceRefresh);
    return { bookmarks: result.bookmarks };
  }

  async function resetStorage(silent = false) {
    if (gistId) {
      const token = getAuthToken();
      if (token) {
        await fetch(`https://api.github.com/gists/${gistId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => {});
      }
    }
    const user = getCurrentUserLogin();
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
    sessionStorage.removeItem(TOKEN_HASH_KEY);
    stopBackgroundUpdate();
    if (!silent) showToast('Хранилище сброшено', 'info');
  }

  async function setStoragePassword(newPassword) {
    await ensureStorage();
    if (!masterKey) throw new Error('Storage not initialized');
    const user = getCurrentUserLogin();
    const token = getAuthToken();
    if (!user || !token) throw new Error('not_logged_in');

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

    if (newPassword) {
      const keyPassword = await deriveKeyFromString(newPassword);
      const encryptedByPassword = await encryptData(masterKeyArray, keyPassword);
      payload.masterKeyEncrypted.byPassword = encryptedByPassword;
      delete payload.masterKeyEncrypted.byToken;
      sessionStorage.setItem(PASSWORD_CACHE_KEY, newPassword);
      hasPassword = true;
    } else {
      const keyToken = await deriveKeyFromString(token);
      const encryptedByToken = await encryptData(masterKeyArray, keyToken);
      payload.masterKeyEncrypted.byToken = encryptedByToken;
      delete payload.masterKeyEncrypted.byPassword;
      sessionStorage.removeItem(PASSWORD_CACHE_KEY);
      hasPassword = false;
    }

    payload.lastUpdated = Date.now();

    const content = JSON.stringify(payload);
    await gistUpdate(gistId, content);
    lastUpdated = payload.lastUpdated;
    saveGistToCache(payload);
    showToast(newPassword ? 'Пароль установлен' : 'Пароль отключён', 'success');
  }

  async function exportBookmarksData(password) {
    await ensureStorage();
    if (!masterKey) throw new Error('Storage not initialized');
    if (!password || password.length < 4) {
      throw new Error('Пароль должен быть не менее 4 символов');
    }
    const token = getAuthToken();
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

  // ---- Экспорт публичного API ----
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
    updateBookmark,
    loadBookmarks,
    resetStorage,
    setStoragePassword,
    exportBookmarksData,
    importBookmarksData,
    setStatusCallback,
    getBookmarks: () => bookmarks,
    setBookmarks: (newBookmarks) => { bookmarks = newBookmarks; cachedBookmarks = newBookmarks.slice(); },
    setRefreshGridCallback: (cb) => { window._StorageManager.refreshGridCallback = cb; },
    batchUpdateVideoLinks,
    exportAllBookmarks,
    importBookmarksBatch,
    startBackgroundUpdate,
    stopBackgroundUpdate
  };
})();