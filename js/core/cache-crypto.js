// js/core/cache-crypto.js
// Шифрование кэша на устройстве пользователя с помощью WebCrypto AES-GCM 256.
// Ключ хранится в sessionStorage (base64 от raw-экспорта) и уникален для сессии браузера.
(function() {
  const KEY_STORAGE = 'cache_encryption_key';

  // Ключи, которые НЕ шифруются. Значения в них читаются/пишутся как есть.
  const EXCLUDED_KEYS = [
    'rate_limits',
    'rate_history',
    'license_agreed_v1',
    'license_version',
    'license_agreed_timestamp',
    'preferredLanguage',
    'github_token',
    'github_token_local',
    'remember_me',
    'last_cache_clear',
    'cache_encryption_key',
    'storage_token_hash',
    'storage_password'
  ];

  let cachedKey = null;
  let keyPromise = null;

  /**
   * Определяет, нужно ли шифровать значение под данным ключом.
   * @param {string} key
   * @returns {boolean} true — если ключ в исключениях и шифровать не нужно
   */
  function isExcludedKey(key) {
    if (!key) return true;
    if (EXCLUDED_KEYS.includes(key)) return true;
    if (key.startsWith('storage_gist_')) return true;
    if (key.startsWith('i18n_')) return true;
    return false;
  }

  function uint8ToBase64(arr) {
    let binary = '';
    for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
    return btoa(binary);
  }

  function base64ToUint8(str) {
    const binary = atob(str);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return arr;
  }

  /**
   * Возвращает CryptoKey из sessionStorage. Если ключа нет — генерирует новый.
   * @returns {Promise<CryptoKey>}
   */
  async function getOrCreateCacheKey() {
    if (cachedKey) return cachedKey;
    if (keyPromise) return keyPromise;

    keyPromise = (async () => {
      // Пытаемся восстановить из sessionStorage
      try {
        const stored = sessionStorage.getItem(KEY_STORAGE);
        if (stored) {
          const raw = base64ToUint8(stored);
          cachedKey = await crypto.subtle.importKey(
            'raw',
            raw,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt']
          );
          return cachedKey;
        }
      } catch (e) {
        console.warn('[CacheCrypto] Не удалось импортировать сохранённый ключ, генерируем новый:', e);
      }

      // Генерируем новый ключ
      const newKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      try {
        const exported = await crypto.subtle.exportKey('raw', newKey);
        sessionStorage.setItem(KEY_STORAGE, uint8ToBase64(new Uint8Array(exported)));
      } catch (e) {
        console.warn('[CacheCrypto] Не удалось сохранить ключ в sessionStorage:', e);
      }

      cachedKey = newKey;
      return newKey;
    })();

    return keyPromise;
  }

  /**
   * Шифрует строку. Возвращает base64(JSON({iv:[...], data:[...]})).
   * @param {string} value
   * @returns {Promise<string>}
   */
  async function encryptCacheValue(value) {
    const key = await getOrCreateCacheKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(value);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );
    const obj = {
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted))
    };
    return btoa(JSON.stringify(obj));
  }

  /**
   * Расшифровывает значение. При ошибке возвращает null.
   * @param {string} encrypted
   * @returns {Promise<string|null>}
   */
  async function decryptCacheValue(encrypted) {
    if (!encrypted) return null;
    try {
      const key = await getOrCreateCacheKey();
      const obj = JSON.parse(atob(encrypted));
      const iv = new Uint8Array(obj.iv);
      const data = new Uint8Array(obj.data);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        data
      );
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      return null;
    }
  }

  window.CacheCrypto = {
    getOrCreateCacheKey,
    encryptCacheValue,
    decryptCacheValue,
    isExcludedKey,
    KEY_STORAGE,
    EXCLUDED_KEYS
  };
})();