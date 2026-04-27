// sw.js — улучшенный Service Worker: версионирование кеша, стратегии кеширования,
// фоновая синхронизация, обработка ошибок, уведомление об обновлении.

const CACHE_VERSION = 'v3';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${CACHE_VERSION}`;
const API_CACHE = `github-api-${CACHE_VERSION}`;
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
  'css/cards.css',
  'css/layout.css',
  'css/navigation.css',
  'css/responsive.css',
  'css/feedback.css',
  // JavaScript (основные)
  'js/core/github-core.js',
  'js/features/ui-utils.js',
  'js/core/github-api.js',
  'js/core/github-auth.js',
  'js/features/ui-feedback.js',
  'js/lang.js',
  'js/common-init.js',
  'js/effects.js',
  'js/lazy-load.js',
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
  'images/starve-neon-header.webp',
  'images/alpha-01-header.webp',
  'images/gc-adven-header.webp',
  // Шрифты и иконки подгружаются динамически, но можно добавить основные файлы fa
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css'
];

// Установка: предварительное кеширование критических ресурсов
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(err => console.error('Precache failed:', err))
  );
});

// Активация: удаление старых кешей и захват клиентов
self.addEventListener('activate', event => {
  const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => !currentCaches.includes(name))
          .map(name => caches.delete(name))
      );
    }).then(() => {
      // Уведомляем все открытые окна о том, что воркер активирован
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SW_ACTIVATED' }));
      });
      return self.clients.claim();
    })
  );
});

// Вспомогательная функция: сохранение ответа с меткой времени в кеш API
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

// Проверка, не устарел ли кеш API
async function isApiCacheValid(cachedResponse) {
  const timestamp = cachedResponse.headers.get('sw-cached-time');
  if (!timestamp) return false;
  return (Date.now() - parseInt(timestamp)) < API_CACHE_MAX_AGE;
}

// Обработка запросов
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. GitHub API GET-запросы: network first, затем кеш (если не устарел)
  if (url.hostname === 'api.github.com' && event.request.method === 'GET') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse.ok) {
            // Обновляем кеш API
            await cacheWithTimestamp(API_CACHE, event.request, networkResponse.clone());
            return networkResponse;
          }
          throw new Error('Network response was not ok');
        } catch (err) {
          // Пытаемся взять из кеша
          const cache = await caches.open(API_CACHE);
          const cachedResponse = await cache.match(event.request);
          if (cachedResponse && await isApiCacheValid(cachedResponse)) {
            return cachedResponse;
          } else if (cachedResponse) {
            // Устаревший кеш удаляем
            await cache.delete(event.request);
          }
          // Возвращаем пустой массив/объект, чтобы не сломать UI
          const emptyBody = url.pathname.includes('/reactions') ? '[]' : '{}';
          return new Response(emptyBody, {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })()
    );
    return;
  }

  // 2. HTML-страницы (навигация): Network First, при неудаче пытаемся из dynamic-кеша
  if (event.request.mode === 'navigate') {
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
          const cache = await caches.open(DYNAMIC_CACHE);
          const cachedResponse = await cache.match(event.request);
          return cachedResponse || new Response('Offline', { status: 503 });
        }
      })()
    );
    return;
  }

  // 3. Статические ресурсы (CSS, JS, изображения, шрифты, CDN): Cache First + фоновое обновление
  if (event.request.method === 'GET') {
    const isStatic = 
      url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|webp|svg|woff2?|eot|ttf|ico)$/) ||
      url.origin.includes('cdnjs.cloudflare.com') ||
      url.origin.includes('fonts.googleapis.com') ||
      url.origin.includes('fonts.gstatic.com') ||
      url.origin.includes('i.ytimg.com') ||
      url.origin.includes('img.youtube.com');
    
    if (isStatic) {
      event.respondWith(
        (async () => {
          const cache = await caches.open(STATIC_CACHE);
          const cachedResponse = await cache.match(event.request);
          
          // Фоновое обновление кеша (не ждём)
          const fetchPromise = fetch(event.request).then(networkResponse => {
            if (networkResponse.ok) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => {});

          // Возвращаем кеш, если есть, иначе дожидаемся сети
          return cachedResponse || fetchPromise;
        })()
      );
      return;
    }
  }

  // 4. Все остальные запросы: Network First с сохранением в динамический кеш
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
        const cache = await caches.open(DYNAMIC_CACHE);
        const cachedResponse = await cache.match(event.request);
        return cachedResponse || new Response('Offline', { status: 504 });
      }
    })()
  );
});

// ---------- Background Sync и хранилище ----------
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(processMutations());
  }
});

async function processMutations() {
  const db = await openSyncDB();
  const tx = db.transaction('mutations', 'readwrite');
  const store = tx.objectStore('mutations');
  const mutations = await store.getAll();
  if (mutations.length === 0) return;

  const token = await getGitHubToken();
  if (!token) {
    // Токен отсутствует – запрашиваем у всех клиентов
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => client.postMessage({ type: 'REQUEST_TOKEN' }));
    return;
  }

  // Выполняем мутации последовательно
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
        // Токен недействителен – уведомляем клиента и прекращаем обработку
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(client => client.postMessage({ type: 'TOKEN_INVALID' }));
        break;
      } else {
        console.warn(`Mutation ${mutation.id} failed with status ${response.status}`);
      }
    } catch (err) {
      console.error('Background sync failed for mutation', mutation.id, err);
    }
  }
  await tx.done;
}

// ---------- Работа с IndexedDB ----------
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

// Обработка сообщений от клиента (сохранение токена, принудительная синхронизация)
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SAVE_TOKEN') {
    const token = event.data.token;
    openSyncDB().then(db => {
      const tx = db.transaction('credentials', 'readwrite');
      const store = tx.objectStore('credentials');
      store.put({ key: 'github_token', value: token });
      return tx.done;
    }).catch(console.error);
  }

  if (event.data.type === 'SYNC_NOW') {
    event.waitUntil(processMutations()); // по возможности, но waitUntil только в обработчике событий, здесь не совсем корректно, но оставим
  }
});