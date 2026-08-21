// sw.js — оптимизированный Service Worker с кешированием и фоном
const STATIC_CACHE = 'static-v9';
const DYNAMIC_CACHE = 'dynamic-v9';
const IMAGES_CACHE = 'images-v9';
const API_CACHE = 'github-api-v9';
const SYNC_TAG = 'github-mutations';

const API_CACHE_MAX_AGE = 5 * 60 * 1000;
const IMAGES_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

const PRECACHE_URLS = [
  'style.css',
  'js/utils.js',
  'js/core/github-core.js',
  'js/github-client.js',
  'js/core/github-api.js',
  'js/core/github-auth.js',
  'js/features/ui-utils.js',
  'js/features/ui-feedback.js',
  'js/features/editor.js',
  'js/features/storage.js',
  'js/features/rate-limits.js',
  'js/lang.js',
  'js/common-init.js',
  'js/effects.js',
  'js/pages/news-feed.js',
  'js/pages/feedback.js',
  'js/pages/game-updates.js',
  'js/platform.js',
  'js/features/background-gifs.js',
  'index.html',
  'starve-neon.html',
  'alpha-01.html',
  'gc-adven.html',
  'license.html',
  '404.html',
  'images/default-news.webp',
  'images/logo-neon-imperium.webp',
  'images/default-avatar.webp'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE, IMAGES_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => !currentCaches.includes(n)).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Вспомогательная функция для кеширования с timestamp
async function cacheWithTimestamp(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  const headers = new Headers(response.headers);
  headers.set('sw-cached-time', Date.now().toString());
  const cached = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
  await cache.put(request, cached);
}

async function isApiCacheValid(cachedResponse) {
  const ts = cachedResponse.headers.get('sw-cached-time');
  return ts && (Date.now() - parseInt(ts) < API_CACHE_MAX_AGE);
}

async function isImageCacheValid(cachedResponse) {
  const ts = cachedResponse.headers.get('sw-cached-time');
  return ts && (Date.now() - parseInt(ts) < IMAGES_CACHE_MAX_AGE);
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Пропускаем API-запросы, они обрабатываются отдельно клиентом
  if (url.hostname === 'api.github.com' || url.hostname === 'avatars.githubusercontent.com') {
    return;
  }

  // Навигация – stale-while-revalidate
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(DYNAMIC_CACHE);
      const cached = await cache.match(event.request);
      const network = fetch(event.request).then(resp => {
        if (resp.ok) cache.put(event.request, resp.clone());
        return resp;
      }).catch(() => cached || Response.error());
      return cached || network;
    })());
    return;
  }

  // Изображения – кеш с проверкой возраста
  if (event.request.method === 'GET' && url.pathname.match(/\.(webp|png|jpg|jpeg|gif|svg|ico)$/)) {
    event.respondWith((async () => {
      const cache = await caches.open(IMAGES_CACHE);
      const cached = await cache.match(event.request);
      if (cached && await isImageCacheValid(cached)) {
        return cached;
      }
      try {
        const network = await fetch(event.request);
        if (network.ok) {
          await cacheWithTimestamp(IMAGES_CACHE, event.request, network.clone());
          return network;
        }
      } catch (err) {}
      return cached || Response.error();
    })());
    return;
  }

  // Статика (CSS, JS, шрифты) – из кеша, если есть
  if (event.request.method === 'GET' && (
      url.pathname.match(/\.(css|js|woff2?|ttf)$/) ||
      url.origin.includes('cdnjs.cloudflare.com') ||
      url.origin.includes('fonts.googleapis.com') ||
      url.origin.includes('fonts.gstatic.com')
  )) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const network = await fetch(event.request);
      if (network.ok) cache.put(event.request, network.clone());
      return network;
    })());
    return;
  }

  // Остальные GET-запросы – динамический кеш с обновлением
  if (event.request.method === 'GET') {
    event.respondWith((async () => {
      const cache = await caches.open(DYNAMIC_CACHE);
      try {
        const network = await fetch(event.request);
        if (network.ok) cache.put(event.request, network.clone());
        return network;
      } catch {
        const cached = await cache.match(event.request);
        return cached || Response.error();
      }
    })());
    return;
  }

  // Для POST и других – просто пробрасываем
  event.respondWith(fetch(event.request));
});

// Фоновая синхронизация
self.addEventListener('sync', event => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      client.postMessage({ type: 'SYNC_TRIGGERED' });
    }
  })());
});

// Сообщение для сохранения токена
self.addEventListener('message', event => {
  if (event.data?.type === 'SAVE_TOKEN') {
    event.waitUntil((async () => {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'TOKEN_RECEIVED', token: event.data.token });
      }
    })());
  }
});