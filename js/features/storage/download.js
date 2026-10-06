// js/features/storage/download.js
// Получение прямых ссылок на скачивание видео через публичные сервисы.
//
// ВАЖНО: cacheGet/cacheSet — асинхронные (шифрование через CacheCrypto).
// Все обёртки над ними возвращают Promise. Вызывающая сторона обязана
// использовать await.

(function() {
    'use strict';

    const DOWNLOAD_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 часов
    const CACHE_KEY_PREFIX = 'video_download_';
    const REQUEST_TIMEOUT = 8000;

    // ---- Cache helpers (динамически, устойчиво к порядку загрузки) ----

    function getCacheApi() {
        const cache = window.ApiCache;
        if (cache && typeof cache.cacheGet === 'function' && typeof cache.cacheSet === 'function') {
            return cache;
        }
        // Fallback на Utils (merge с ApiCache)
        const u = window.Utils;
        if (u && typeof u.cacheGet === 'function' && typeof u.cacheSet === 'function') {
            return { cacheGet: u.cacheGet, cacheSet: u.cacheSet };
        }
        return null;
    }

    /**
     * Читает закэшированную ссылку на скачивание.
     * @param {string} url
     * @returns {Promise<string|null>}
     */
    async function getCachedDownload(url) {
        if (!url) return null;
        const cache = getCacheApi();
        if (!cache) return null;
        const key = CACHE_KEY_PREFIX + url;
        try {
            const value = await cache.cacheGet(key, DOWNLOAD_CACHE_TTL);
            return value === undefined ? null : value;
        } catch (e) {
            return null;
        }
    }

    /**
     * Кэширует ссылку на скачивание.
     * @param {string} url
     * @param {string} data
     * @returns {Promise<void>}
     */
    async function setCachedDownload(url, data) {
        if (!url || !data) return;
        const cache = getCacheApi();
        if (!cache) return;
        const key = CACHE_KEY_PREFIX + url;
        try {
            await cache.cacheSet(key, data);
        } catch (e) { /* noop */ }
    }

    // ---- Download services ----

    const downloadServices = [
        {
            name: 'Loader.to',
            test: (url) => url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/),
            fetch: async (url, signal) => {
                const resp = await fetch(
                    `https://loader.to/api/?link=${encodeURIComponent(url)}&mode=video`,
                    { signal }
                );
                if (!resp.ok) return null;
                const text = await resp.text();
                try {
                    const json = JSON.parse(text);
                    return json.downloadUrl || null;
                } catch { return null; }
            }
        },
        {
            name: 'SSYouTube',
            test: (url) => url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/),
            fetch: async (url, signal) => {
                const resp = await fetch(
                    `https://ssyoutube.com/api/convert?url=${encodeURIComponent(url)}`,
                    { signal }
                );
                if (!resp.ok) return null;
                const text = await resp.text();
                try {
                    const json = JSON.parse(text);
                    return json.downloadUrl || null;
                } catch { return null; }
            }
        },
        {
            name: 'Y2Mate',
            test: (url) => url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/),
            fetch: async (url, signal) => {
                const formData = new URLSearchParams();
                formData.append('url', url);
                formData.append('type', 'YouTube');
                const resp = await fetch('https://www.y2mate.com/mates/analyzeAjax', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData,
                    signal
                });
                if (!resp.ok) return null;
                const data = await resp.json();
                return data.downloadUrl || null;
            }
        },
        {
            name: 'AllOrigins (HTML parse)',
            fetch: async (url, signal) => {
                const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
                const resp = await fetch(proxyUrl, { signal });
                if (!resp.ok) return null;
                const html = await resp.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const videoEl = doc.querySelector('video[src]');
                if (videoEl && videoEl.src) return videoEl.src;
                const source = doc.querySelector('source[src]');
                if (source && source.src) return source.src;
                const links = html.match(/https?:\/\/[^\s]+\.(mp4|webm|mov|avi|mkv|m3u8)/gi);
                if (links && links.length) return links[0];
                return null;
            }
        },
        {
            name: 'CorsProxy.io',
            fetch: async (url, signal) => {
                const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
                const resp = await fetch(proxyUrl, { signal });
                if (!resp.ok) return null;
                const html = await resp.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const videoEl = doc.querySelector('video[src]');
                if (videoEl && videoEl.src) return videoEl.src;
                const source = doc.querySelector('source[src]');
                if (source && source.src) return source.src;
                const links = html.match(/https?:\/\/[^\s]+\.(mp4|webm|mov|avi|mkv|m3u8)/gi);
                if (links && links.length) return links[0];
                return null;
            }
        }
    ];

    /**
     * Ищет прямую ссылку на скачивание видео.
     * @param {string} url
     * @param {boolean} forceRefresh — игнорировать кэш
     * @returns {Promise<string|null>}
     */
    async function fetchVideoDownloadUrl(url, forceRefresh = false) {
        if (!url) return null;

        // КРИТИЧНЫЙ ФИКС: await для асинхронного кэша
        if (!forceRefresh) {
            const cached = await getCachedDownload(url);
            if (cached) return cached;
        }

        for (const service of downloadServices) {
            try {
                if (service.test && !service.test(url)) continue;

                const controller = new AbortController();
                const timeout = setTimeout(() => {
                    try { controller.abort(new Error('timeout')); }
                    catch { controller.abort(); }
                }, REQUEST_TIMEOUT);

                let result = null;
                try {
                    result = await service.fetch(url, controller.signal);
                } finally {
                    clearTimeout(timeout);
                }

                if (result && typeof result === 'string' && result.startsWith('http')) {
                    await setCachedDownload(url, result);
                    return result;
                }
            } catch (e) {
                console.warn('[Download] Service', service.name, 'failed:', e);
            }
        }

        return null;
    }

    window._StorageDownload = {
        fetchVideoDownloadUrl,
        getCachedDownload,
        setCachedDownload
    };
})();