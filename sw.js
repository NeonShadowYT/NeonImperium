// sw.js — Service Worker с кэшированием, background sync, офлайн-поддержкой и кэшированием изображений.
// Конфигурация загружается из js/config.js через importScripts.
importScripts('js/config.js');

// ---- Читаем централизованную конфигурацию (с fallback на дефолты) ----
const NC = (typeof self !== 'undefined' && self.NeonConfig) || {};

const SW_CACHE_NAMES = NC.SW_CACHE_NAMES || {
  STATIC: 'static-v9',
  DYNAMIC: 'dynamic-v9',
  IMAGES: 'images-v9',
  API: 'github-api-v9',
  RSS: 'rss-v3'
};

const SW_CACHE_MAX_AGE = NC.SW_CACHE_MAX_AGE || {
  API: 5 * 60 * 1000,
  IMAGES: 30 * 24 * 60 * 60 * 1000,
  RSS: 30 * 60 * 1000
};

const STATIC_CACHE = SW_CACHE_NAMES.STATIC;
const DYNAMIC_CACHE = SW_CACHE_NAMES.DYNAMIC;
const IMAGES_CACHE = SW_CACHE_NAMES.IMAGES;
const API_CACHE = SW_CACHE_NAMES.API;
const RSS_CACHE = SW_CACHE_NAMES.RSS;
const SYNC_TAG = NC.SYNC_TAG || 'github-queue-sync';
const API_CACHE_MAX_AGE = SW_CACHE_MAX_AGE.API;
const IMAGES_CACHE_MAX_AGE = SW_CACHE_MAX_AGE.IMAGES;
const RSS_CACHE_MAX_AGE = SW_CACHE_MAX_AGE.RSS;

const PRECACHE_URLS = [
  'style.css',
  'js/config.js',
  'js/core/cache-crypto.js',
  'js/utils.js', 'js/core/github-core.js', 'js/github-client.js',
  'js/core/github-api.js', 'js/core/github-auth.js',
  'js/features/ui-utils.js', 'js/features/ui-feedback.js',
  'js/features/editor.js',
  'js/features/dialog.js',
  'js/features/rate-limits.js',
  'js/features/storage/core.js',
  'js/features/storage/metadata.js',
  'js/features/storage/preview.js',
  'js/features/storage/download.js',
  'js/features/storage/manager.js',
  'js/features/storage/ui.js',
  'js/features/storage/index.js',
  'js/lang.js', 'js/common-init.js', 'js/effects.js',
  'js/pages/news-feed.js', 'js/pages/feedback.js', 'js/pages/game-updates.js',
  'js/platform.js', 'js/features/background-gifs.js',
  'js/dust-particles.js',
  'index.html', 'starve-neon.html', 'alpha-01.html',
  'gc-adven.html', 'license.html', '404.html',
  'images/default-news.webp', 'images/logo-neon-imperium.webp', 'images/default-avatar.webp'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Не удалось precache:', url, err);
            return null;
          })
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE, IMAGES_CACHE, API_CACHE, RSS_CACHE];
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => !currentCaches.includes(n)).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

async function cacheWithTimestamp(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  const headers = new Headers(response.headers);
  headers.set('sw-cached-time', Date.now().toString());
  const cached = new Response(response.body, {
    status: response.status, statusText: response.statusText, headers
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

async function isRssCacheValid(cachedResponse) {
  const ts = cachedResponse.headers.get('sw-cached-time');
  return ts && (Date.now() - parseInt(ts) < RSS_CACHE_MAX_AGE);
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Пропускаем внешние API, которые не нужно кэшировать (кроме RSS)
  if (url.hostname === 'api.github.com' ||
      url.hostname === 'avatars.githubusercontent.com') {
    return;
  }

  // Кеширование RSS-запросов
  if (url.hostname === 'api.rss2json.com') {
    event.respondWith((async () => {
      const cache = await caches.open(RSS_CACHE);
      const cached = await cache.match(event.request);
      if (cached && await isRssCacheValid(cached)) {
        return cached;
      }
      try {
        const network = await fetch(event.request);
        if (network.ok) {
          await cacheWithTimestamp(RSS_CACHE, event.request, network.clone());
          return network;
        }
      } catch (e) {}
      return cached || Response.error();
    })());
    return;
  }

  // HTML – stale-while-revalidate
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

  // Изображения – CacheFirst с долгим TTL (30 дней)
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

  if (event.request.method === 'GET' && (
      url.pathname.match(/\.(css|js|woff2?|ttf)$/) ||
      url.origin.includes('cdnjs.cloudflare.com')
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

  // API-запросы к GitHub (GET) – NetworkFirst с кэшем на 5 минут
  if (event.request.method === 'GET' && url.pathname.includes('/repos/')) {
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      const cached = await cache.match(event.request);
      if (cached && await isApiCacheValid(cached)) {
        return cached;
      }
      try {
        const network = await fetch(event.request);
        if (network.ok) {
          await cacheWithTimestamp(API_CACHE, event.request, network.clone());
          return network;
        }
      } catch (err) {}
      return cached || Response.error();
    })());
    return;
  }

  // Остальное – NetworkFirst
  event.respondWith((async () => {
    try {
      const network = await fetch(event.request);
      if (network.ok) {
        const cache = await caches.open(DYNAMIC_CACHE);
        cache.put(event.request, network.clone());
      }
      return network;
    } catch {
      const cached = await caches.match(event.request);
      return cached || Response.error();
    }
  })());
});

// Background sync
self.addEventListener('sync', event => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      client.postMessage({ type: 'SYNC_TRIGGERED' });
    }
  })());
});

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