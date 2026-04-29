// sw.js — расширенный Service Worker: статический кеш, background sync,
// для GitHub API и rss2json запросы пропускаются напрямую

const STATIC_CACHE = 'static-v5';
const DYNAMIC_CACHE = 'dynamic-v5';
const API_CACHE = 'github-api-v5';
const SYNC_TAG = 'github-mutations';
const API_CACHE_MAX_AGE = 5 * 60 * 1000;

const PRECACHE_URLS = [
  'style.css', 'css/variables.css', 'css/base.css', 'css/typography.css',
  'css/buttons.css', 'css/navigation.css', 'css/cards.css', 'css/layout.css',
  'css/responsive.css', 'css/feedback.css', 'js/core/github-core.js',
  'js/features/ui-utils.js', 'js/core/github-api.js', 'js/core/github-auth.js',
  'js/features/ui-feedback.js', 'js/lang.js', 'js/common-init.js',
  'js/pages/news-feed.js', 'index.html', 'starve-neon.html', 'alpha-01.html',
  'gc-adven.html', 'license.html', '404.html', 'images/default-news.webp',
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

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Пропускаем проблемные домены (Firefox NS_BINDING_ABORTED)
  if (url.hostname === 'api.github.com' ||
      url.hostname === 'api.rss2json.com' ||
      url.hostname === 'avatars.githubusercontent.com') {
    // Не вызываем respondWith – запрос выполняется напрямую
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

  // Статические ресурсы (включая CDN шрифтов)
  if (event.request.method === 'GET' && (
      url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico)$/) ||
      url.origin.includes('cdnjs.cloudflare.com') ||
      url.origin.includes('fonts.googleapis.com') ||
      url.origin.includes('fonts.gstatic.com')
  )) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(event.request);
      const network = fetch(event.request).then(resp => {
        if (resp.ok) cache.put(event.request, resp.clone());
        return resp;
      }).catch(() => cached || Response.error());
      return cached || network;
    })());
    return;
  }

  // Остальное – network first
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

// Background sync (без изменений)
self.addEventListener('sync', event => {
  if (event.tag !== SYNC_TAG) return;
  event.waitUntil((async () => {
    const db = await openSyncDB();
    const tx = db.transaction('mutations', 'readwrite');
    const store = tx.objectStore('mutations');
    const mutations = await store.getAll();
    if (!mutations.length) return;
    const token = await getGitHubToken();
    if (!token) {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients[0]?.postMessage({ type: 'REQUEST_TOKEN' });
      return;
    }
    for (const m of mutations) {
      try {
        const resp = await fetch(m.url, {
          method: m.method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
          },
          body: m.body ? JSON.stringify(m.body) : undefined
        });
        if (resp.ok) await store.delete(m.id);
        else if (resp.status === 401) break;
      } catch (e) { console.error('Sync failed', m.id, e); }
    }
    await tx.done;
  })());
});

function openSyncDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('NeonImperiumSync', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('mutations'))
        db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('credentials'))
        db.createObjectStore('credentials', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getGitHubToken() {
  const db = await openSyncDB();
  const tx = db.transaction('credentials', 'readonly');
  const store = tx.objectStore('credentials');
  const rec = await store.get('github_token');
  return rec?.value;
}

self.addEventListener('message', event => {
  if (event.data?.type === 'SAVE_TOKEN') {
    openSyncDB().then(db => {
      const tx = db.transaction('credentials', 'readwrite');
      tx.objectStore('credentials').put({ key: 'github_token', value: event.data.token });
      return tx.done;
    }).catch(console.error);
  }
});