// js/features/storage/preview.js
// Получение превью (thumbnail, title, embedUrl) для видео и ссылок.
//
// ВАЖНО: cacheGet/cacheSet — асинхронные. Все обёртки возвращают Promise.
// Вызывающая сторона обязана использовать await.

(function() {
    'use strict';

    const PREVIEW_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 часов
    const CACHE_KEY_PREFIX = 'video_preview_';
    const REQUEST_TIMEOUT = 5000;

    // ---- Cache helpers ----

    function getCacheApi() {
        const cache = window.ApiCache;
        if (cache && typeof cache.cacheGet === 'function' && typeof cache.cacheSet === 'function') {
            return cache;
        }
        const u = window.Utils;
        if (u && typeof u.cacheGet === 'function' && typeof u.cacheSet === 'function') {
            return { cacheGet: u.cacheGet, cacheSet: u.cacheSet };
        }
        return null;
    }

    /**
     * Читает закэшированное превью.
     * @param {string} url
     * @returns {Promise<object|null>}
     */
    async function getCachedPreview(url) {
        if (!url) return null;
        const cache = getCacheApi();
        if (!cache) return null;
        const key = CACHE_KEY_PREFIX + url;
        try {
            const value = await cache.cacheGet(key, PREVIEW_CACHE_TTL);
            return value === undefined ? null : value;
        } catch (e) {
            return null;
        }
    }

    /**
     * Кэширует превью.
     * @param {string} url
     * @param {object} data
     * @returns {Promise<void>}
     */
    async function setCachedPreview(url, data) {
        if (!url || !data) return;
        const cache = getCacheApi();
        if (!cache) return;
        const key = CACHE_KEY_PREFIX + url;
        try {
            await cache.cacheSet(key, data);
        } catch (e) { /* noop */ }
    }

    // ---- Helper ----

    function extractIframeSrc(html) {
        if (!html) return null;
        const div = document.createElement('div');
        div.innerHTML = html;
        const iframe = div.querySelector('iframe');
        return iframe ? iframe.src : null;
    }

    // ---- Services ----

    const services = [
        {
            name: 'Noembed',
            fetch: async (url, signal) => {
                const resp = await fetch(
                    `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
                    { signal }
                );
                if (!resp.ok) return null;
                const data = await resp.json();
                if (data && data.title) {
                    return {
                        title: data.title || null,
                        thumbnail: data.thumbnail_url || data.thumbnail || null,
                        embedUrl: data.html ? extractIframeSrc(data.html) : null,
                        type: data.type === 'video' ? 'video' : 'link'
                    };
                }
                return null;
            }
        },
        {
            name: 'Iframely',
            fetch: async (url, signal) => {
                const resp = await fetch(
                    `https://iframe.ly/api/oembed?url=${encodeURIComponent(url)}`,
                    { signal }
                );
                if (!resp.ok) return null;
                const data = await resp.json();
                if (data && data.title) {
                    return {
                        title: data.title || null,
                        thumbnail: data.thumbnail_url || null,
                        embedUrl: data.html ? extractIframeSrc(data.html) : null,
                        type: data.type === 'video' ? 'video' : 'link'
                    };
                }
                return null;
            }
        },
        {
            name: 'Microlink',
            fetch: async (url, signal) => {
                const resp = await fetch(
                    `https://api.microlink.io/?url=${encodeURIComponent(url)}&data.title&data.image&data.embed`,
                    { signal }
                );
                if (!resp.ok) return null;
                const data = await resp.json();
                if (data && data.data && data.data.title) {
                    return {
                        title: data.data.title || null,
                        thumbnail: data.data.image?.url || null,
                        embedUrl: data.data.embed?.html ? extractIframeSrc(data.data.embed.html) : null,
                        type: data.data.embed?.type === 'video' ? 'video' : 'link'
                    };
                }
                return null;
            }
        },
        {
            name: 'OpenUnfurl',
            fetch: async (url, signal) => {
                const resp = await fetch(
                    `https://openunfurl.vercel.app/api/unfurl?url=${encodeURIComponent(url)}`,
                    { signal }
                );
                if (!resp.ok) return null;
                const data = await resp.json();
                if (data && data.title) {
                    return {
                        title: data.title || null,
                        thumbnail: data.image || data.thumbnail || null,
                        embedUrl: data.oembed?.html ? extractIframeSrc(data.oembed.html) : null,
                        type: 'link'
                    };
                }
                return null;
            }
        },
        {
            name: 'OEmbed.com',
            fetch: async (url, signal) => {
                const resp = await fetch('https://oembed.com/providers.json', { signal });
                if (!resp.ok) return null;
                const providers = await resp.json();
                let provider = null;
                for (const p of providers) {
                    for (const endpoint of p.endpoints || []) {
                        if (endpoint.schemes && endpoint.schemes.some(s => {
                            try { return new RegExp(s.replace(/\*/g, '.*')).test(url); }
                            catch { return false; }
                        })) {
                            provider = endpoint;
                            break;
                        }
                    }
                    if (provider) break;
                }
                if (!provider) return null;
                const endpointUrl = provider.url
                    + (provider.url.includes('?') ? '&' : '?')
                    + `url=${encodeURIComponent(url)}&format=json`;
                const resp2 = await fetch(endpointUrl, { signal });
                if (!resp2.ok) return null;
                const data = await resp2.json();
                if (data && data.title) {
                    return {
                        title: data.title || null,
                        thumbnail: data.thumbnail_url || data.thumbnail || null,
                        embedUrl: data.html ? extractIframeSrc(data.html) : null,
                        type: data.type === 'video' ? 'video' : 'link'
                    };
                }
                return null;
            }
        },
        {
            name: 'YouTube oEmbed',
            test: (url) => url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/),
            fetch: async (url, signal) => {
                const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
                if (!match) return null;
                const id = match[1];
                const resp = await fetch(
                    `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
                    { signal }
                );
                if (resp.ok) {
                    const data = await resp.json();
                    return {
                        title: data.title || null,
                        thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
                        embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`,
                        type: 'video'
                    };
                }
                return {
                    title: null,
                    thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
                    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`,
                    type: 'video'
                };
            }
        },
        {
            name: 'Vimeo oEmbed',
            test: (url) => url.match(/vimeo\.com\/(\d+)/),
            fetch: async (url, signal) => {
                const resp = await fetch(
                    `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
                    { signal }
                );
                if (!resp.ok) return null;
                const data = await resp.json();
                return {
                    title: data.title || null,
                    thumbnail: data.thumbnail_url || null,
                    embedUrl: data.html ? extractIframeSrc(data.html) : null,
                    type: 'video'
                };
            }
        },
        {
            name: 'Dailymotion oEmbed',
            test: (url) => url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/),
            fetch: async (url, signal) => {
                const resp = await fetch(
                    `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(url)}&format=json`,
                    { signal }
                );
                if (!resp.ok) return null;
                const data = await resp.json();
                return {
                    title: data.title || null,
                    thumbnail: data.thumbnail_url || null,
                    embedUrl: data.html ? extractIframeSrc(data.html) : null,
                    type: 'video'
                };
            }
        },
        {
            name: 'Twitch oEmbed',
            test: (url) => url.match(/twitch\.tv\/(\w+)/),
            fetch: async (url, signal) => {
                const resp = await fetch(
                    `https://api.twitch.tv/v5/oembed?url=${encodeURIComponent(url)}`,
                    { signal }
                );
                if (!resp.ok) return null;
                const data = await resp.json();
                return {
                    title: data.title || null,
                    thumbnail: data.thumbnail_url || null,
                    embedUrl: data.html ? extractIframeSrc(data.html) : null,
                    type: 'video'
                };
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
                const title = doc.querySelector('title')?.textContent || null;
                let thumbnail = null;
                const ogImage = doc.querySelector('meta[property="og:image"]');
                if (ogImage) thumbnail = ogImage.content;
                if (!thumbnail) {
                    const twImage = doc.querySelector('meta[name="twitter:image"]');
                    if (twImage) thumbnail = twImage.content;
                }
                if (!thumbnail) {
                    const img = doc.querySelector('img[src]');
                    if (img && img.src && img.width > 100) thumbnail = img.src;
                }
                let embedUrl = null;
                const videoEl = doc.querySelector('video[src]');
                if (videoEl) embedUrl = videoEl.src;
                if (!embedUrl) {
                    const ogVideo = doc.querySelector('meta[property="og:video"]');
                    if (ogVideo) embedUrl = ogVideo.content;
                }
                if (title || thumbnail || embedUrl) {
                    return {
                        title: title || null,
                        thumbnail: thumbnail || null,
                        embedUrl: embedUrl || null,
                        type: embedUrl ? 'video' : 'link'
                    };
                }
                return null;
            }
        }
    ];

    /**
     * Параллельно опрашивает все сервисы, возвращает первый успешный результат.
     * @param {string} url
     * @param {boolean} forceRefresh — игнорировать кэш
     * @returns {Promise<object|null>}
     */
    async function fetchVideoPreview(url, forceRefresh = false) {
        if (!url) return null;

        // КРИТИЧНЫЙ ФИКС: await для асинхронного кэша
        if (!forceRefresh) {
            const cached = await getCachedPreview(url);
            if (cached) return cached;
        }

        const fetchPromises = services.map(service => {
            return new Promise(async (resolve) => {
                try {
                    if (service.test && !service.test(url)) {
                        resolve(null);
                        return;
                    }
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
                    resolve(result);
                } catch (e) {
                    resolve(null);
                }
            });
        });

        const results = await Promise.all(fetchPromises);
        const firstResult = results.find(r => r && (r.title || r.thumbnail || r.embedUrl));

        if (firstResult) {
            await setCachedPreview(url, firstResult);
            return firstResult;
        }
        return null;
    }

    window._StoragePreview = {
        fetchVideoPreview,
        getCachedPreview,
        setCachedPreview
    };
})();