// sw.js — Service Worker Neon Imperium.
// Стратегии:
//   — HTML navigate     → StaleWhileRevalidate
//   — CSS/JS/шрифты     → CacheFirst (immutable, без opaque)
//   — api.github.com    → NetworkFirst с TTL 5 мин (ETag поддерживается клиентом)
//   — api.rss2json.com  → NetworkFirst с TTL 30 мин
//   — Изображения       → CacheFirst с TTL 30 дней + LRU (200 записей)
//                          Opaque-ответы (cross-origin без CORS) кешируются без TTL.
//   — Всё остальное     → NetworkFirst с fallback на dynamic-v10
//
// Безопасность:
//   — Кешируются только GET.
//   — Запросы с Authorization кешируются только к api.github.com.
//   — cache.put только для response.ok (или opaque для изображений).
//   — Non-http(s) запросы пропускаются.
//   — Opaque не кешируется для CSS/JS — нельзя проверить SRI-целостность.

importScripts('js/config.js');

// ---- Конфигурация (с fallback) ----
const NC = (typeof self !== 'undefined' && self.NeonConfig) || {};

const SW_CACHE_NAMES = NC.SW_CACHE_NAMES || {
    STATIC: 'static-v10',
    DYNAMIC: 'dynamic-v10',
    IMAGES: 'images-v10',
    API: 'api-v10',
    RSS: 'rss-v4'
};

const SW_CACHE_MAX_AGE = NC.SW_CACHE_MAX_AGE || {
    API: 5 * 60 * 1000,
    IMAGES: 30 * 24 * 60 * 60 * 1000,
    RSS: 30 * 60 * 1000
};

const SYNC_TAG = NC.SYNC_TAG || 'github-queue-sync';

const STATIC_CACHE = SW_CACHE_NAMES.STATIC;
const DYNAMIC_CACHE = SW_CACHE_NAMES.DYNAMIC;
const IMAGES_CACHE = SW_CACHE_NAMES.IMAGES;
const API_CACHE = SW_CACHE_NAMES.API;
const RSS_CACHE = SW_CACHE_NAMES.RSS;

const API_CACHE_MAX_AGE = SW_CACHE_MAX_AGE.API;
const IMAGES_CACHE_MAX_AGE = SW_CACHE_MAX_AGE.IMAGES;
const RSS_CACHE_MAX_AGE = SW_CACHE_MAX_AGE.RSS;

// ---- LRU-лимит для изображений ----
const MAX_IMAGES_CACHE_ENTRIES = 200;
const MAX_IMAGES_CACHE_SIZE = 50 * 1024 * 1024; // 50 MB (задел)
const BACKGROUND_FETCH_TIMEOUT = 5000;

// ---- Precache (critical only) ----
const PRECACHE_URLS = [
    'style.css',
    // Core JS
    'js/config.js',
    'js/core/cache-crypto.js',
    'js/core/dom-utils.js',
    'js/core/api-cache.js',
    'js/utils.js',
    'js/features/dialog.js',
    'js/core/github-core.js',
    'js/github-client.js',
    'js/features/ui-utils.js',
    'js/core/github-api.js',
    'js/core/github-auth.js',
    'js/features/rate-limits.js',
    'js/lang.js',
    'js/common-init.js',
    // Локализации
    'locales/ru.json',
    'locales/en.json',
    // Изображения по умолчанию
    'images/logo-neon-imperium.webp',
    'images/default-avatar.webp',
    'images/default-news.webp',
    // Шрифты
    'fonts/RussoOne.woff2',
    // HTML
    'index.html',
    './',
    'starve-neon.html',
    'alpha-01.html',
    'gc-adven.html',
    'license.html',
    '404.html'
];

// ---- Утилиты ----

function isValidResponse(response) {
    if (!response) return false;
    if (response.ok) return true;
    if (response.type === 'opaque') return true;
    return false;
}

/**
 * Сохраняет response в кеш с меткой времени.
 * Для opaque-ответов (cross-origin без CORS) — сохраняем клон как есть,
 * т.к. тело нечитаемо, а заголовки недоступны. Метка sw-cached-time
 * в этом случае не ставится → isFresh() вернёт false для таких записей.
 */
async function cacheWithTimestamp(cache, request, response) {
    if (response.type === 'opaque') {
        await cache.put(request, response.clone());
        return;
    }
    const headers = new Headers(response.headers);
    headers.set('sw-cached-time', Date.now().toString());
    const cached = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
    await cache.put(request, cached);
}

function isFresh(cachedResponse, maxAge) {
    if (!cachedResponse) return false;
    const ts = cachedResponse.headers.get('sw-cached-time');
    if (!ts) return false;
    const age = Date.now() - parseInt(ts, 10);
    return !isNaN(age) && age < maxAge;
}

async function matchWithIndexFallback(cache, request) {
    let response = await cache.match(request);
    if (response) return response;
    try {
        const url = new URL(request.url);
        if (url.pathname.endsWith('/')) {
            url.pathname += 'index.html';
            response = await cache.match(url.toString());
        }
    } catch (e) { /* noop */ }
    return response || null;
}

// ---- Стратегии ----

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await matchWithIndexFallback(cache, request);

    const networkPromise = fetch(request)
        .then(response => {
            if (isValidResponse(response)) {
                cacheWithTimestamp(cache, request, response.clone()).catch(() => {});
            }
            return response;
        })
        .catch(() => null);

    return cached || networkPromise || Response.error();
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
        const response = await fetch(request);
        // Opaque для CSS/JS не кешируем: невозможно проверить SRI-целостность.
        if (response.ok && response.type !== 'opaque') {
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (err) {
        return Response.error();
    }
}

async function networkFirstWithTTL(request, cacheName, maxAge) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    if (cached && isFresh(cached, maxAge)) {
        // Фоновое обновление с таймаутом — не тратим сеть, если страница уже ушла.
        fetch(request, { signal: AbortSignal.timeout(BACKGROUND_FETCH_TIMEOUT) })
            .then(response => {
                if (isValidResponse(response)) {
                    cacheWithTimestamp(cache, request, response.clone()).catch(() => {});
                }
            })
            .catch(() => {});
        return cached;
    }

    try {
        const response = await fetch(request);
        if (isValidResponse(response)) {
            await cacheWithTimestamp(cache, request, response.clone());
        }
        return response;
    } catch (err) {
        if (cached) return cached;
        return Response.error();
    }
}

async function cacheFirstImages(request, cacheName, maxAge) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    if (cached) {
        const ts = cached.headers.get('sw-cached-time');
        // Opaque-записи (без ts) — отдаём как есть (CacheFirst без TTL).
        // Обычные записи — проверяем свежесть.
        if (!ts || isFresh(cached, maxAge)) return cached;
    }

    try {
        const response = await fetch(request);
        if (isValidResponse(response)) {
            await enforceImagesLRU(cache);
            await cacheWithTimestamp(cache, request, response.clone());
        }
        return response;
    } catch (err) {
        if (cached) return cached;
        return Response.error();
    }
}

async function enforceImagesLRU(cache) {
    try {
        const keys = await cache.keys();
        if (keys.length < MAX_IMAGES_CACHE_ENTRIES) return;
        // FIFO: удаляем самые старые (первые в keys()).
        const overflow = keys.length - MAX_IMAGES_CACHE_ENTRIES + 1;
        const toDelete = keys.slice(0, overflow);
        for (const req of toDelete) {
            try { await cache.delete(req); } catch (e) { /* noop */ }
        }
    } catch (e) { /* noop */ }
}

async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    try {
        const response = await fetch(request);
        if (isValidResponse(response)) {
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (err) {
        if (cached) return cached;
        return Response.error();
    }
}

// ---- Lifecycle ----

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => Promise.allSettled(
                PRECACHE_URLS.map(url =>
                    cache.add(url).catch(err => {
                        console.warn('[SW] Precache failed:', url, err && err.message ? err.message : err);
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
        caches.keys()
            .then(names => Promise.all(
                names
                    .filter(n => !currentCaches.includes(n))
                    .map(n => caches.delete(n).catch(() => false))
            ))
            .then(() => self.clients.claim())
    );
});

// ---- Fetch ----

self.addEventListener('fetch', event => {
    const req = event.request;

    if (req.method !== 'GET') return;

    let url;
    try { url = new URL(req.url); }
    catch (e) { return; }

    if (!url.protocol.startsWith('http')) return;

    // Пропускаем сам SW.
    if (url.pathname.endsWith('/sw.js') || url.pathname === '/sw.js') return;

    // Не кешируем Authorization, кроме api.github.com.
    const hasAuth = req.headers && typeof req.headers.get === 'function'
        ? req.headers.get('Authorization')
        : null;
    if (hasAuth && url.hostname !== 'api.github.com') return;

    // 1. HTML (navigate) → SWR.
    if (req.mode === 'navigate') {
        event.respondWith(staleWhileRevalidate(req, DYNAMIC_CACHE));
        return;
    }

    // 2. GitHub API.
    if (url.hostname === 'api.github.com') {
        event.respondWith(networkFirstWithTTL(req, API_CACHE, API_CACHE_MAX_AGE));
        return;
    }

    // 3. RSS.
    if (url.hostname === 'api.rss2json.com') {
        event.respondWith(networkFirstWithTTL(req, RSS_CACHE, RSS_CACHE_MAX_AGE));
        return;
    }

    // 4. Изображения.
    if (/\.(webp|png|jpg|jpeg|gif|svg|ico|avif)$/i.test(url.pathname)) {
        event.respondWith(cacheFirstImages(req, IMAGES_CACHE, IMAGES_CACHE_MAX_AGE));
        return;
    }

    // 5. CSS / JS / шрифты — immutable, без opaque.
    if (/\.(css|js|woff2?|ttf|otf|eot)$/i.test(url.pathname) ||
        url.hostname === 'cdnjs.cloudflare.com' ||
        url.hostname === 'cdn.jsdelivr.net') {
        event.respondWith(cacheFirst(req, STATIC_CACHE));
        return;
    }

    // 6. Fallback.
    event.respondWith(networkFirst(req, DYNAMIC_CACHE));
});

// ---- Background Sync ----

self.addEventListener('sync', event => {
    if (event.tag !== SYNC_TAG) return;
    event.waitUntil((async () => {
        try {
            const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            for (const client of clients) {
                try { client.postMessage({ type: 'SYNC_TRIGGERED' }); }
                catch (e) { /* noop */ }
            }
        } catch (err) {
            console.warn('[SW] sync broadcast error:', err);
        }
    })());
});

// ---- Message ----

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SAVE_TOKEN') {
        event.waitUntil((async () => {
            try {
                const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
                for (const client of clients) {
                    try { client.postMessage({ type: 'TOKEN_RECEIVED', token: event.data.token }); }
                    catch (e) { /* noop */ }
                }
            } catch (err) {
                console.warn('[SW] message broadcast error:', err);
            }
        })());
    }
});