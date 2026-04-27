// sw.js — Service Worker с Cache First для статики и Network First для HTML

const STATIC_CACHE = 'static-cache-v1';
const GITHUB_API_CACHE = 'github-api-cache-v1';

// Ресурсы, которые кешируются при установке (предзагрузка)
const PRECACHE_URLS = [
  // CSS
  'style.css',
  // Критичные JS-модули
  'js/core/github-core.js',
  'js/features/ui-utils.js',
  'js/core/github-api.js',
  'js/core/github-auth.js',
  'js/features/ui-feedback.js',
  'js/lang.js',
  // HTML‑страницы
  'index.html',
  'starve-neon.html',
  'alpha-01.html',
  'gc-adven.html',
  'license.html',
  '404.html',
];

// Установка: предварительное кеширование критических ресурсов
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()) // активировать сразу
  );
});

// Активация: удаление старых кешей
self.addEventListener('activate', event => {
  const currentCaches = [STATIC_CACHE, GITHUB_API_CACHE];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => !currentCaches.includes(name))
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim()) // контролировать клиентов сразу
  );
});

// Обработка запросов
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Запросы к GitHub API (GET) — Network First с осторожным кешированием
  if (url.hostname === 'api.github.com' && event.request.method === 'GET') {
    event.respondWith(
      caches.open(GITHUB_API_CACHE).then(cache => {
        return fetch(event.request)
          .then(networkResponse => {
            // Кешируем только успешный ответ
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => {
            // При отсутствии сети – отдаём из кеша
            return cache.match(event.request);
          });
      })
    );
    return;
  }

  // 2. Навигационные запросы (HTML‑страницы) — Network First
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(STATIC_CACHE).then(cache => {
        return fetch(event.request)
          .then(networkResponse => {
            // Обновляем кеш свежим ответом
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          })
          .catch(() => {
            // Офлайн – отдаём из кеша, если нет – страницу 404
            return cache.match(event.request)
              .catch(() => cache.match('/404.html'));
          });
      })
    );
    return;
  }

  // 3. Все остальные ресурсы (CSS, JS, шрифты, изображения) — Cache First
  event.respondWith(
    caches.open(STATIC_CACHE).then(cache => {
      return cache.match(event.request).then(cachedResponse => {
        // Параллельно обновляем кеш из сети (Stale-While-Revalidate)
        const fetchPromise = fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {});

        // Возвращаем кешированный ответ, если он есть, иначе ждём сеть
        return cachedResponse || fetchPromise;
      });
    })
  );
});