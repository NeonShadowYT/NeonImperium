// js/features/storage/download.js
// Модуль для получения ссылок на скачивание видео
// Использует: Invidious, Piped, loader.to, ssyoutube, y2mate,
// AllMedia Downloader, TikWM, AIO Downloader, allorigins

(function() {
  const { cacheGet, cacheSet } = window.GithubCore || {};

  const DOWNLOAD_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 часов
  const CACHE_KEY_PREFIX = 'video_download_';

  function getCachedDownload(url) {
    const key = CACHE_KEY_PREFIX + url;
    return cacheGet(key, DOWNLOAD_CACHE_TTL) || null;
  }

  function setCachedDownload(url, data) {
    const key = CACHE_KEY_PREFIX + url;
    cacheSet(key, data);
  }

  /**
   * Получение ссылки на скачивание видео
   * @param {string} url - URL видео
   * @param {boolean} forceRefresh - игнорировать кеш
   * @returns {Promise<string|null>}
   */
  async function fetchVideoDownloadUrl(url, forceRefresh = false) {
    if (!url) return null;

    if (!forceRefresh) {
      const cached = getCachedDownload(url);
      if (cached) return cached;
    }

    const services = [
      // 1. Invidious (YouTube)
      {
        name: 'Invidious',
        test: (u) => u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/),
        fetch: async (videoUrl) => {
          const match = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
          if (!match) return null;
          const resp = await fetch(`https://invidious.private.coffee/api/v1/videos/${match[1]}`, {
            signal: AbortSignal.timeout(8000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.formatStreams) {
              const stream = data.formatStreams.find(s => s.type && s.type.startsWith('video/mp4'));
              return stream ? stream.url : null;
            }
          }
          return null;
        }
      },

      // 2. Piped (YouTube)
      {
        name: 'Piped',
        test: (u) => u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/),
        fetch: async (videoUrl) => {
          const match = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
          if (!match) return null;
          const resp = await fetch(`https://pipedapi.kavin.rocks/streams/${match[1]}`, {
            signal: AbortSignal.timeout(8000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.videoStreams) {
              const stream = data.videoStreams.find(s => s.quality === '720p' || s.quality === '1080p');
              return stream ? stream.url : null;
            }
          }
          return null;
        }
      },

      // 3. loader.to (YouTube)
      {
        name: 'Loader.to',
        test: (u) => u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/),
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://loader.to/api/?link=${encodeURIComponent(videoUrl)}&mode=video`, {
            signal: AbortSignal.timeout(10000)
          });
          if (resp.ok) {
            const text = await resp.text();
            try {
              const json = JSON.parse(text);
              return json.downloadUrl || null;
            } catch { return null; }
          }
          return null;
        }
      },

      // 4. ssyoutube.com (YouTube)
      {
        name: 'SSYouTube',
        test: (u) => u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/),
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://ssyoutube.com/api/convert?url=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(10000)
          });
          if (resp.ok) {
            const text = await resp.text();
            try {
              const json = JSON.parse(text);
              return json.downloadUrl || null;
            } catch { return null; }
          }
          return null;
        }
      },

      // 5. y2mate.com (YouTube)
      {
        name: 'Y2Mate',
        test: (u) => u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/),
        fetch: async (videoUrl) => {
          const formData = new URLSearchParams();
          formData.append('url', videoUrl);
          formData.append('type', 'YouTube');
          const resp = await fetch('https://www.y2mate.com/mates/analyzeAjax', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData,
            signal: AbortSignal.timeout(10000)
          });
          if (resp.ok) {
            const data = await resp.json();
            return data.downloadUrl || null;
          }
          return null;
        }
      },

      // 6. AllMedia Downloader (YouTube, Instagram, TikTok, X и другие)
      {
        name: 'AllMedia',
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://api.allmedia.download/api?url=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(10000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.downloadUrl) return data.downloadUrl;
            if (data && data.video && data.video.url) return data.video.url;
            return null;
          }
          return null;
        }
      },

      // 7. TikWM API (TikTok)
      {
        name: 'TikWM',
        test: (u) => u.match(/tiktok\.com\/(@\w+\/video\/\d+|v\/\d+)/),
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(10000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.data && data.data.play) return data.data.play;
            return null;
          }
          return null;
        }
      },

      // 8. AIO Downloader (YouTube, Instagram, TikTok, Pinterest, X)
      {
        name: 'AIODownloader',
        fetch: async (videoUrl) => {
          const resp = await fetch(`https://api.aio-downloader.com/api?url=${encodeURIComponent(videoUrl)}`, {
            signal: AbortSignal.timeout(10000)
          });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.downloadUrl) return data.downloadUrl;
            if (data && data.video && data.video.url) return data.video.url;
            return null;
          }
          return null;
        }
      },

      // 9. allorigins.win (прокси для парсинга HTML — запасной)
      {
        name: 'AllOrigins',
        fetch: async (videoUrl) => {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(videoUrl)}`;
          const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
          if (resp.ok) {
            const html = await resp.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const videoEl = doc.querySelector('video[src]');
            if (videoEl && videoEl.src) return videoEl.src;
            const source = doc.querySelector('source[src]');
            if (source && source.src) return source.src;
            const ogVideo = doc.querySelector('meta[property="og:video"]');
            if (ogVideo && ogVideo.content) return ogVideo.content;
            const dataVideo = doc.querySelector('[data-video]');
            if (dataVideo && dataVideo.dataset.video) return dataVideo.dataset.video;
            return null;
          }
          return null;
        }
      }
    ];

    for (const service of services) {
      try {
        if (service.test && !service.test(url)) continue;
        const result = await service.fetch(url);
        if (result && result.startsWith('http')) {
          setCachedDownload(url, result);
          return result;
        }
      } catch (e) {
        console.warn('[Download] Сервис ' + service.name + ' не ответил:', e);
        continue;
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