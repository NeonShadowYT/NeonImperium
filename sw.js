// sw.js — кеширование shell для оффлайн-доступа
const CACHE_NAME = 'neon-imperium-v3';
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
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
});

self.addEventListener('fetch', event => {
  // не кешируем запросы к GitHub API (они обрабатываются динамически)
  if (event.request.url.includes('api.github.com')) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});