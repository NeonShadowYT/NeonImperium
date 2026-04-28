// sw.js — расширенный Service Worker: динамический кеш GitHub API, background sync, stale-while-revalidate

const STATIC_CACHE = 'static-v2';
const DYNAMIC_CACHE = 'dynamic-v2';
const API_CACHE = 'github-api-v2';
const SYNC_TAG = 'github-mutations';
const API_CACHE_MAX_AGE = 2 * 60 * 1000; // 2 минуты

// Критические ресурсы для предварительного кеширования
const PRECACHE_URLS = [
  // CSS
  'style.css',
  'css/variables.css',
  'css/base.css',
  'css/typography.css',
  'css/buttons.css',
  'css/navigation.css',
  'css/cards.css',
  'css/layout.css',
  'css/responsive.css',
  // JavaScript (ядро и критические модули)
  'js/core/github-core.js',
  'js/features/ui-utils.js',
  'js/core/github-api.js',
  'js/core/github-auth.js',
  'js/features/ui-feedback.js',
  'js/lang.js',
  'js/common-init.js',
  // HTML-страницы
  'index.html',
  'starve-neon.html',
  'alpha-01.html',
  'gc-adven.html',
  'license.html',
  '404.html',
  // Изображения-заглушки и иконки
  'images/default-news.webp',
  'images/logo-neon-imperium.webp',
];

// Установка: предварительное кеширование
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Активация: удаление старых кешей
self.addEventListener('activate', event => {
  const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => !currentCaches.includes(name))
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Вспомогательная функция: сохранение в кеш с временной меткой
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

// Проверка, не устарел ли кешированный ответ API
async function isApiCacheValid(cachedResponse) {
  const timestamp = cachedResponse.headers.get('sw-cached-time');
  if (!timestamp) return false;
  return (Date.now() - parseInt(timestamp)) < API_CACHE_MAX_AGE;
}

// Универсальная функция для создания резервного Response (чтобы избежать undefined)
function fallbackResponse(status = 502, body = '') {
  return new Response(body, {
    status,
    statusText: 'Service Worker Fallback',
    headers: { 'Content-Type': 'text/plain' }
  });
}

// Основной обработчик fetch
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Запросы к GitHub API (GET) – network first, затем кеш с коротким TTL
  if (url.hostname === 'api.github.com' && event.request.method === 'GET') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE);
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse.ok) {
            await cacheWithTimestamp(API_CACHE, event.request, networkResponse.clone());
            return networkResponse;
          }
          throw new Error('Network response was not ok');
        } catch (err) {
          const cachedResponse = await cache.match(event.request);
          if (cachedResponse) {
            if (await isApiCacheValid(cachedResponse)) {
              return cachedResponse;
            } else {
              await cache.delete(event.request);
            }
          }
          // Возвращаем пустой JSON-ответ, чтобы не ломать UI
          if (url.pathname.includes('/reactions')) return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
          return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
        }
      })()
    );
    return;
  }

  // 2. HTML-страницы (navigate) – stale-while-revalidate
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(DYNAMIC_CACHE);
        const cachedResponse = await cache.match(event.request);
        const fetchPromise = fetch(event.request).then(networkResponse => {
          if (networkResponse.ok) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          // Если сеть недоступна, вернём закешированное или ошибку (но не undefined)
          return cachedResponse || fallbackResponse(503, 'Offline');
        });

        return cachedResponse || fetchPromise;
      })()
    );
    return;
  }

  // 3. Статические ресурсы (CSS, JS, изображения, шрифты) – cache first с обновлением в фоне
  if (event.request.method === 'GET' &&
      (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|webp|svg|woff2?|eot|ttf|ico)$/) ||
       url.origin.includes('cdnjs.cloudflare.com') ||
       url.origin.includes('fonts.googleapis.com') ||
       url.origin.includes('fonts.gstatic.com'))) {
    event.respondWith(
      (async () => {
        // Если это внешний ресурс, стараемся не кешировать (может заблокировать CORS)
        if (url.origin !== self.location.origin && !url.origin.includes('cdnjs.cloudflare.com') && !url.origin.includes('fonts.g')) {
          // Для внешних изображений (catbox.moe и т.п.) просто делаем network-only с безопасным fallback
          try {
            return await fetch(event.request);
          } catch {
            // Возвращаем пустой ответ, чтобы не сломать страницу
            return fallbackResponse(502, '');
          }
        }

        const cache = await caches.open(STATIC_CACHE);
        const cachedResponse = await cache.match(event.request);
        const fetchPromise = fetch(event.request).then(networkResponse => {
          if (networkResponse.ok) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(err => {
          // Возвращаем закешированное или ошибку
          return cachedResponse || fallbackResponse(502, '');
        });

        return cachedResponse || fetchPromise;
      })()
    );
    return;
  }

  // 4. Все остальные запросы – network first с fallback к кешу
  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse.ok) {
          const cache = await caches.open(DYNAMIC_CACHE);
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        const cachedResponse = await caches.match(event.request);
        return cachedResponse || fallbackResponse(504, 'Gateway Timeout');
      }
    })()
  );
});

// Обработка события background sync
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(
      (async () => {
        const db = await openSyncDB();
        const tx = db.transaction('mutations', 'readwrite');
        const store = tx.objectStore('mutations');
        const mutations = await store.getAll();
        if (mutations.length === 0) return;

        const token = await getGitHubToken();
        if (!token) {
          const client = await self.clients.matchAll({ type: 'window' });
          if (client.length) {
            client[0].postMessage({ type: 'REQUEST_TOKEN' });
          }
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
            if (response.ok) {
              await store.delete(mutation.id);
            } else if (response.status === 401) {
              console.error('Background sync: invalid token');
              break;
            }
          } catch (err) {
            console.error('Background sync failed for mutation', mutation.id, err);
          }
        }
        await tx.done;
      })()
    );
  }
});

// Вспомогательные функции для IndexedDB
function openSyncDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('NeonImperiumSync', 1);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('mutations')) {
        db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('credentials')) {
        db.createObjectStore('credentials', { keyPath: 'key' });
      }
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

// Слушаем сообщения от клиента, чтобы сохранить токен
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SAVE_TOKEN') {
    const token = event.data.token;
    openSyncDB().then(db => {
      const tx = db.transaction('credentials', 'readwrite');
      const store = tx.objectStore('credentials');
      store.put({ key: 'github_token', value: token });
      return tx.done;
    }).catch(console.error);
  }
});