// js/features/storage/preview.js
// Модуль для получения превью видео с различных сервисов
// Использует: noembed, iframely, openunfurl, microlink, YouTube oEmbed, Vimeo oEmbed,
// Dailymotion oEmbed, Twitch oEmbed, LinkPreview, URLPreview, LinkPeek, Apify, allorigins

(function() {
  const { cacheGet, cacheSet } = window.GithubCore || {};

  const PREVIEW_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 часов
  const CACHE_KEY_PREFIX = 'video_preview_';

  function getCachedPreview(url) {
    const key = CACHE_KEY_PREFIX + url;
    return cacheGet(key, PREVIEW_CACHE_TTL) || null;
  }

  function setCachedPreview(url, data) {
    const key = CACHE_KEY_PREFIX + url;
    cacheSet(key, data);
  }

  /**
   * Получение превью видео с использованием множества сервисов
   * @param {string} url - URL видео
   * @param {boolean} forceRefresh - игнорировать кеш
   * @returns {Promise<{title: string, thumbnail: string, embedUrl: string, type: string}>}
   */
  async function fetchVideoPreview(url, forceRefresh = false) {
    if (!url) return null;

    if (!forceRefresh) {
      const cached = getCachedPreview(url);
      if (cached) return cached;
    }

    const services = [
      // 1. YouTube oEmbed
      {
        name: 'YouTube oEmbed',
        test: (u) => u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/),
        fetch: async (videoUrl) => {
          const match = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
          if (!match) return null;
          const id = match[1];
          const resp = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`, {
            signal: AbortSignal.timeout(5000)
          });
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

      // 2. Vimeo oEmbed
      {
        name: 'Vimeo oEmbed',
        test: (u) => u.match(/vimeo\.com\/(\d+)/),
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            return {
              title: data.title || null,
              thumbnail: data.thumbnail_url || null,
              embedUrl: data.html ? data.html.match(/src="([^"]+)"/)?.[1] : null,
              type: 'video'
            };
          }
          return null;
        }
      },

      // 3. Dailymotion oEmbed
      {
        name: 'Dailymotion oEmbed',
        test: (u) => u.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/),
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(videoUrl)}&format=json`, {
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            return {
              title: data.title || null,
              thumbnail: data.thumbnail_url || null,
              embedUrl: data.html ? data.html.match(/src="([^"]+)"/)?.[1] : null,
              type: 'video'
            };
          }
          return null;
        }
      },

      // 4. Twitch oEmbed
      {
        name: 'Twitch oEmbed',
        test: (u) => u.match(/twitch\.tv\/(\w+)/),
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://api.twitch.tv/v5/oembed?url=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            return {
              title: data.title || null,
              thumbnail: data.thumbnail_url || null,
              embedUrl: data.html ? data.html.match(/src="([^"]+)"/)?.[1] : null,
              type: 'video'
            };
          }
          return null;
        }
      },

      // 5. Noembed
      {
        name: 'Noembed',
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.title) {
              return {
                title: data.title || null,
                thumbnail: data.thumbnail_url || data.thumbnail || null,
                embedUrl: data.html ? data.html.match(/src="([^"]+)"/)?.[1] : null,
                type: data.type === 'video' ? 'video' : 'link'
              };
            }
          }
          return null;
        }
      },

      // 6. Iframely
      {
        name: 'Iframely',
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://iframe.ly/api/oembed?url=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.title) {
              return {
                title: data.title || null,
                thumbnail: data.thumbnail_url || null,
                embedUrl: data.html ? data.html.match(/src="([^"]+)"/)?.[1] : null,
                type: data.type === 'video' ? 'video' : 'link'
              };
            }
          }
          return null;
        }
      },

      // 7. OpenUnfurl
      {
        name: 'OpenUnfurl',
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://openunfurl.vercel.app/api/unfurl?url=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.title) {
              return {
                title: data.title || null,
                thumbnail: data.image || data.thumbnail || null,
                embedUrl: data.oembed?.html ? data.oembed.html.match(/src="([^"]+)"/)?.[1] : null,
                type: 'link'
              };
            }
          }
          return null;
        }
      },

      // 8. Microlink
      {
        name: 'Microlink',
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(videoUrl)}&data.title&data.image&data.embed`, {
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.data && data.data.title) {
              return {
                title: data.data.title || null,
                thumbnail: data.data.image?.url || null,
                embedUrl: data.data.embed?.html ? data.data.embed.html.match(/src="([^"]+)"/)?.[1] : null,
                type: data.data.embed?.type === 'video' ? 'video' : 'link'
              };
            }
          }
          return null;
        }
      },

      // 9. LinkPreview API (бесплатно до 20 000 запросов)
      {
        name: 'LinkPreview',
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://api.linkpreview.net?q=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.title) {
              return {
                title: data.title || null,
                thumbnail: data.image || null,
                embedUrl: null,
                type: 'link'
              };
            }
          }
          return null;
        }
      },

      // 10. URLPreview
      {
        name: 'URLPreview',
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://urlpreview.io/api/?url=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.title) {
              return {
                title: data.title || null,
                thumbnail: data.image || null,
                embedUrl: null,
                type: 'link'
              };
            }
          }
          return null;
        }
      },

      // 11. LinkPeek (100 запросов/день бесплатно)
      {
        name: 'LinkPeek',
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://linkpeek.com/api?url=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.title) {
              return {
                title: data.title || null,
                thumbnail: data.image || null,
                embedUrl: null,
                type: 'link'
              };
            }
          }
          return null;
        }
      },

      // 12. Apify Open Graph Extractor
      {
        name: 'Apify',
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://api.apify.com/v2/key-value-stores/TpQz6oQ5tzcW4izvU/records/LATEST?url=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.ogTitle) {
              return {
                title: data.ogTitle || null,
                thumbnail: data.ogImage || null,
                embedUrl: null,
                type: 'link'
              };
            }
          }
          return null;
        }
      },

      // 13. allorigins.win (прокси для парсинга HTML — запасной вариант)
      {
        name: 'AllOrigins',
        fetch: async (videoUrl) => {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(videoUrl)}`;
          const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
          if (resp.ok) {
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
          }
          return null;
        }
      }
    ];

    for (const service of services) {
      try {
        if (service.test && !service.test(url)) continue;
        const result = await service.fetch(url);
        if (result && (result.title || result.thumbnail || result.embedUrl)) {
          setCachedPreview(url, result);
          return result;
        }
      } catch (e) {
        console.warn('[Preview] Сервис ' + service.name + ' не ответил:', e);
        continue;
      }
    }

    return null;
  }

  window._StoragePreview = {
    fetchVideoPreview,
    getCachedPreview,
    setCachedPreview
  };
})();