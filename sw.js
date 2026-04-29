// sw.js — расширенный Service Worker: динамический кеш GitHub API, background sync, stale-while-revalidate
const STATIC_CACHE = 'static-v4';
const DYNAMIC_CACHE = 'dynamic-v4';
const API_CACHE = 'github-api-v4';
const SYNC_TAG = 'github-mutations';
const API_CACHE_MAX_AGE = 5 * 60 * 1000; // 5 минут

const PRECACHE_URLS = [
  'style.css',
  'css/variables.css',
  'css/base.css',
  'css/typography.css',
  'css/buttons.css',
  'css/navigation.css',
  'css/cards.css',
  'css/layout.css',
  'css/responsive.css',
  'css/feedback.css',
  'js/core/github-core.js',
  'js/features/ui-utils.js',
  'js/core/github-api.js',
  'js/core/github-auth.js',
  'js/features/ui-feedback.js',
  'js/lang.js',
  'js/common-init.js',
  'js/pages/news-feed.js',
  'index.html',
  'starve-neon.html',
  'alpha-01.html',
  'gc-adven.html',
  'license.html',
  '404.html',
  'images/default-news.webp',
  'images/logo-neon-imperium.webp',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => !currentCaches.includes(name)).map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

async function cacheWithTimestamp(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  const headers = new Headers(response.headers);
  headers.set('sw-cached-time', Date.now().toString());
  const cachedResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
  await cache.put(request, cachedResponse);
}

async function isApiCacheValid(cachedResponse) {
  const timestamp = cachedResponse.headers.get('sw-cached-time');
  if (!timestamp) return false;
  return (Date.now() - parseInt(timestamp)) < API_CACHE_MAX_AGE;
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ----- ВСЕ запросы к api.github.com -----
  if (url.hostname === 'api.github.com') {
    // Не‑GET запросы (POST, PATCH, DELETE, OPTIONS) отправляем напрямую
    if (event.request.method !== 'GET') {
      event.respondWith(fetch(event.request));
      return;
    }

    // GET‑запросы – network first + кэш
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse.ok) {
          await cacheWithTimestamp(API_CACHE, event.request, networkResponse.clone());
          return networkResponse;
        }
        throw new Error('Bad response');
      } catch (err) {
        const cached = await cache.match(event.request);
        if (cached && await isApiCacheValid(cached)) return cached;
        throw err; // Без fallback: страница получит ошибку
      }
    })());
    return;
  }

  // ----- HTML navigate -----
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(DYNAMIC_CACHE);
      const cached = await cache.match(event.request);
      const fetchPromise = fetch(event.request).then(resp => {
        if (resp.ok) cache.put(event.request, resp.clone());
        return resp;
      }).catch(() => cached || Response.error());
      return cached || fetchPromise;
    })());
    return;
  }

  // ----- Статические ресурсы -----
  if (event.request.method === 'GET' &&
      (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|webp|svg|woff2?|eot|ttf|ico)$/) ||
       url.origin.includes('cdnjs.cloudflare.com') ||
       url.origin.includes('fonts.googleapis.com') ||
       url.origin.includes('fonts.gstatic.com'))) {
    if (url.origin !== self.location.origin && 
        !url.origin.includes('cdnjs.cloudflare.com') && 
        !url.origin.includes('fonts.googleapis.com') &&
        !url.origin.includes('fonts.gstatic.com')) {
      event.respondWith(fetch(event.request));
      return;
    }
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(event.request);
      const fetchPromise = fetch(event.request).then(resp => {
        if (resp.ok) cache.put(event.request, resp.clone());
        return resp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })());
    return;
  }

  // ----- Остальные запросы (network first) -----
  event.respondWith((async () => {
    try {
      const networkResponse = await fetch(event.request);
      if (networkResponse.ok) {
        const cache = await caches.open(DYNAMIC_CACHE);
        cache.put(event.request, networkResponse.clone());
      }
      return networkResponse;
    } catch (err) {
      const cached = await caches.match(event.request);
      return cached || Response.error();
    }
  })());
});

// ----- Background sync (без изменений) -----
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil((async () => {
      const db = await openSyncDB();
      const tx = db.transaction('mutations', 'readwrite');
      const store = tx.objectStore('mutations');
      const mutations = await store.getAll();
      if (mutations.length === 0) return;

      const token = await getGitHubToken();
      if (!token) {
        const client = await self.clients.matchAll({ type: 'window' });
        if (client.length) client[0].postMessage({ type: 'REQUEST_TOKEN' });
        return;
      }

      for (const mutation of mutations) {
        try {
          const response = await fetch(mutation.url, {
            method: mutation.method,
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Accept': 'application/vnd.github.v3+json'
            },
            body: mutation.body ? JSON.stringify(mutation.body) : undefined
          });
          if (response.ok) await store.delete(mutation.id);
          else if (response.status === 401) break;
        } catch (err) {
          console.error('Sync failed for', mutation.id, err);
        }
      }
      await tx.done;
    })());
  }
});

function openSyncDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('NeonImperiumSync', 1);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('mutations')) db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('credentials')) db.createObjectStore('credentials', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getGitHubToken() {
  const db = await openSyncDB();
  const tx = db.transaction('credentials', 'readonly');
  const store = tx.objectStore('credentials');
  const record = await store.get('github_token');
  return record ? record.value : null;
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SAVE_TOKEN') {
    openSyncDB().then(db => {
      const tx = db.transaction('credentials', 'readwrite');
      const store = tx.objectStore('credentials');
      store.put({ key: 'github_token', value: event.data.token });
      return tx.done;
    }).catch(console.error);
  }
});