// sw.js — Service Worker с кэшированием, background sync и офлайн-поддержкой
const STATIC_CACHE = 'static-v6';
const DYNAMIC_CACHE = 'dynamic-v6';
const API_CACHE = 'github-api-v6';
const SYNC_TAG = 'github-mutations';
const API_CACHE_MAX_AGE = 5 * 60 * 1000; // 5 минут

// Список предварительно кэшируемых ресурсов
const PRECACHE_URLS = [
  'style.css',
  'css/variables.css', 'css/base.css', 'css/typography.css',
  'css/buttons.css', 'css/navigation.css', 'css/cards.css',
  'css/layout.css', 'css/responsive.css', 'css/feedback.css',
  'js/utils.js', 'js/core/github-core.js', 'js/github-client.js',
  'js/core/github-api.js', 'js/core/github-auth.js', 'js/offline-queue.js',
  'js/features/ui-utils.js', 'js/features/ui-feedback.js',
  'js/features/editor.js', 'js/features/storage.js',
  'js/lang.js', 'js/common-init.js', 'js/effects.js',
  'js/pages/news-feed.js', 'js/pages/feedback.js', 'js/pages/game-updates.js',
  'js/platform.js', 'js/features/background-gifs.js',
  'index.html', 'starve-neon.html', 'alpha-01.html',
  'gc-adven.html', 'license.html', '404.html',
  'images/default-news.webp', 'images/logo-neon-imperium.webp',
  'images/default-avatar.webp'
];

// Установка – кэшируем статику
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Активация – удаляем старые кэши
self.addEventListener('activate', event => {
  const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => !currentCaches.includes(n)).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Вспомогательная функция для сохранения в кэш с меткой времени
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

// Проверка актуальности кэша API
async function isApiCacheValid(cachedResponse) {
  const ts = cachedResponse.headers.get('sw-cached-time');
  return ts && (Date.now() - parseInt(ts) < API_CACHE_MAX_AGE);
}

// Обработка запросов
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Пропускаем запросы, которые не нужно кэшировать (аналитика, внешние API)
  if (url.hostname === 'api.github.com' ||
      url.hostname === 'api.rss2json.com' ||
      url.hostname === 'avatars.githubusercontent.com') {
    return;
  }

  // HTML – стратегия stale-while-revalidate
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

  // Статические ресурсы (CSS, JS, изображения, шрифты, иконки)
  if (event.request.method === 'GET' && (
      url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico)$/) ||
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

// Обработка background sync – отправляем уведомление клиентам
self.addEventListener('sync', event => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      client.postMessage({ type: 'SYNC_TRIGGERED' });
    }
  })());
});

// Сообщения от клиента (например, сохранение токена)
self.addEventListener('message', event => {
  if (event.data?.type === 'SAVE_TOKEN') {
    // Сохраняем токен в IndexedDB через OfflineQueue (если нужно)
    // Здесь просто передаём дальше, клиент сам сохранит
    event.waitUntil((async () => {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'TOKEN_RECEIVED', token: event.data.token });
      }
    })());
  }
});