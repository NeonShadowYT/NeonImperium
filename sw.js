// sw.js — сервис-воркер с сетевой стратегией и динамическим кешированием
const CACHE_NAME = 'neon-imperium-v6';
const STATIC_ASSETS = [
  '/NeonImperium/',
  '/NeonImperium/index.html',
  '/NeonImperium/starve-neon.html',
  '/NeonImperium/alpha-01.html',
  '/NeonImperium/gc-adven.html',
  '/NeonImperium/license.html',
  '/NeonImperium/css/variables.css',
  '/NeonImperium/css/base.css',
  '/NeonImperium/css/typography.css',
  '/NeonImperium/css/buttons.css',
  '/NeonImperium/css/navigation.css',
  '/NeonImperium/css/cards.css',
  '/NeonImperium/css/layout.css',
  '/NeonImperium/css/responsive.css',
  '/NeonImperium/css/feedback.css',
  '/NeonImperium/style.css',
  '/NeonImperium/js/core/github-core.js',
  '/NeonImperium/js/features/ui-utils.js',
  '/NeonImperium/js/core/github-api.js',
  '/NeonImperium/js/core/github-auth.js',
  '/NeonImperium/js/features/ui-feedback.js',
  '/NeonImperium/js/features/editor.js',
  '/NeonImperium/js/features/storage.js',
  '/NeonImperium/js/pages/feedback.js',
  '/NeonImperium/js/pages/game-updates.js',
  '/NeonImperium/js/pages/news-feed.js',
  '/NeonImperium/js/lang.js',
  '/NeonImperium/js/effects.js',
  '/NeonImperium/js/common-init.js',
  '/NeonImperium/js/platform.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Russo+One&display=swap',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Пропускаем запросы к GitHub API и внешним ресурсам, которые не должны кешироваться
  if (url.hostname === 'api.github.com') return;
  if (url.hostname === 'files.catbox.moe' || url.hostname === 'avatars.githubusercontent.com') return;
  if (url.hostname === 'i.ytimg.com' || url.hostname === 'img.youtube.com') return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache => {
      return cache.match(event.request).then(cached => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          if (networkResponse.ok && (url.hostname === self.location.hostname || url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'cdn.jsdelivr.net')) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => cached);
        return cached || fetchPromise;
      });
    })
  );
});