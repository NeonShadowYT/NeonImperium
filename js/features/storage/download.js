// js/features/storage/download.js
// Модуль для получения ссылок на скачивание видео
// Использует множество публичных прокси и парсинг HTML
(function() {
  const { cacheGet, cacheSet } = window.GithubCore || {};

  const DOWNLOAD_CACHE_TTL = 6 * 60 * 60 * 1000;
  const CACHE_KEY_PREFIX = 'video_download_';

  function getCachedDownload(url) {
    const key = CACHE_KEY_PREFIX + url;
    return cacheGet(key, DOWNLOAD_CACHE_TTL) || null;
  }

  function setCachedDownload(url, data) {
    const key = CACHE_KEY_PREFIX + url;
    cacheSet(key, data);
  }

  // Парсинг HTML для извлечения ссылок на видео
  function extractVideoLinksFromHtml(html, baseUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = [];

    // 1. Прямые теги video и source
    const videoEl = doc.querySelector('video[src]');
    if (videoEl && videoEl.src) links.push(videoEl.src);
    const sources = doc.querySelectorAll('source[src]');
    sources.forEach(s => { if (s.src) links.push(s.src); });

    // 2. Мета-теги
    const ogVideo = doc.querySelector('meta[property="og:video"]');
    if (ogVideo && ogVideo.content) links.push(ogVideo.content);
    const twitterPlayer = doc.querySelector('meta[name="twitter:player"]');
    if (twitterPlayer && twitterPlayer.content) links.push(twitterPlayer.content);

    // 3. Атрибуты data-video
    const dataVideo = doc.querySelector('[data-video]');
    if (dataVideo && dataVideo.dataset.video) links.push(dataVideo.dataset.video);

    // 4. Поиск iframe с YouTube/Vimeo/Dailymotion и извлечение ID
    const iframes = doc.querySelectorAll('iframe[src*="youtube.com"], iframe[src*="vimeo.com"], iframe[src*="dailymotion.com"]');
    iframes.forEach(iframe => {
      const src = iframe.src;
      // YouTube
      let match = src.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([^&\n?#]+)/);
      if (match) {
        const id = match[1];
        links.push(`https://www.youtube-nocookie.com/embed/${id}`);
      }
      // Vimeo
      match = src.match(/vimeo\.com\/(\d+)/);
      if (match) {
        const id = match[1];
        links.push(`https://player.vimeo.com/video/${id}`);
      }
      // Dailymotion
      match = src.match(/dailymotion\.com\/embed\/video\/([a-zA-Z0-9]+)/);
      if (match) {
        const id = match[1];
        links.push(`https://www.dailymotion.com/embed/video/${id}`);
      }
    });

    // 5. Поиск ссылок на видео в тексте
    const text = doc.body?.textContent || '';
    const urlRegex = /https?:\/\/[^\s]+\.(mp4|webm|mov|avi|mkv|m3u8)/gi;
    const textMatches = text.match(urlRegex);
    if (textMatches) links.push(...textMatches);

    // 6. Относительные ссылки -> абсолютные
    const base = baseUrl ? new URL(baseUrl).origin : '';
    return links.map(link => {
      try {
        return new URL(link, base).href;
      } catch { return link; }
    }).filter(l => l && l.startsWith('http'));
  }

  async function fetchViaProxy(url, proxyUrl) {
    try {
      const resp = await fetch(proxyUrl + encodeURIComponent(url), {
        signal: AbortSignal.timeout(10000)
      });
      if (resp.ok) return await resp.text();
    } catch (e) {}
    return null;
  }

  async function fetchVideoDownloadUrl(url, forceRefresh = false) {
    if (!url) return null;

    if (!forceRefresh) {
      const cached = getCachedDownload(url);
      if (cached) return cached;
    }

    // Список сервисов и методов
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

      // 6. Прокси через corsproxy.io (универсальный)
      {
        name: 'CorsProxy.io',
        fetch: async (videoUrl) => {
          const html = await fetchViaProxy(videoUrl, 'https://corsproxy.io/?');
          if (html) {
            const links = extractVideoLinksFromHtml(html, videoUrl);
            return links.length > 0 ? links[0] : null;
          }
          return null;
        }
      },

      // 7. Прокси через thingproxy (freeboard.io)
      {
        name: 'ThingProxy',
        fetch: async (videoUrl) => {
          const html = await fetchViaProxy(videoUrl, 'https://thingproxy.freeboard.io/fetch/');
          if (html) {
            const links = extractVideoLinksFromHtml(html, videoUrl);
            return links.length > 0 ? links[0] : null;
          }
          return null;
        }
      },

      // 8. Прокси через crossorigin.me
      {
        name: 'Crossorigin.me',
        fetch: async (videoUrl) => {
          const html = await fetchViaProxy(videoUrl, 'https://cors-anywhere.herokuapp.com/');
          if (html) {
            const links = extractVideoLinksFromHtml(html, videoUrl);
            return links.length > 0 ? links[0] : null;
          }
          return null;
        }
      },

      // 9. allorigins.win (прямой парсинг)
      {
        name: 'AllOrigins',
        fetch: async (videoUrl) => {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(videoUrl)}`;
          const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
          if (resp.ok) {
            const html = await resp.text();
            const links = extractVideoLinksFromHtml(html, videoUrl);
            return links.length > 0 ? links[0] : null;
          }
          return null;
        }
      },

      // 10. Универсальный парсинг через getvideo (попытка извлечь прямую ссылку)
      {
        name: 'GetVideo',
        fetch: async (videoUrl) => {
          // Пробуем разные форматы прямых ссылок
          const candidates = [
            videoUrl.replace(/\/watch\?v=/, '/embed/') + '?rel=0',
            videoUrl.replace(/\/watch\?v=/, '/v/'),
            videoUrl.replace(/\/watch\?v=/, '/download/')
          ];
          for (const cand of candidates) {
            try {
              const resp = await fetch(cand, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
              if (resp.ok && resp.headers.get('content-type')?.includes('video')) {
                return cand;
              }
            } catch (e) {}
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