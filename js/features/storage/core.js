// js/features/storage/core.js
// Ядро: шифрование, работа с Gist, хеши, константы, вспомогательные диалоги

(function() {
  const { getCurrentUser, getToken } = window.GithubAuth || {};
  const { showToast } = window.UIUtils || {};

  const GIST_FILENAME = 'neon-imperium-bookmarks.json';
  const GIST_DESCRIPTION = 'Neon Imperium encrypted bookmarks';
  const STORAGE_KEY_PREFIX = 'bookmarks_';
  const PASSWORD_CACHE_KEY = 'storage_password';
  const SALT = 'neon-storage-salt-v2';
  const SAVE_DEBOUNCE_MS = 2000;
  const MAX_BOOKMARKS = 100;
  const VERSION = 4;
  const GIST_CACHE_TTL = 5 * 60 * 1000; // 5 минут

  // ---- шифрование ----
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

  async function hashString(str) {
    const enc = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', enc.encode(str));
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function promptPassword(message) {
    return new Promise((resolve) => {
      const input = prompt(message);
      resolve(input);
    });
  }

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

  // ---- экспорт ----
  window._StorageCore = {
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
  };
})();