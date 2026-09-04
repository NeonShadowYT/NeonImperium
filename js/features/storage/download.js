// js/features/storage/download.js
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

  const downloadServices = [
    {
      name: 'Loader.to',
      test: (url) => url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/),
      fetch: async (url, signal) => {
        const resp = await fetch(`https://loader.to/api/?link=${encodeURIComponent(url)}&mode=video`, { signal });
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
    {
      name: 'SSYouTube',
      test: (url) => url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/),
      fetch: async (url, signal) => {
        const resp = await fetch(`https://ssyoutube.com/api/convert?url=${encodeURIComponent(url)}`, { signal });
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
        if (resp.ok) {
          const data = await resp.json();
          return data.downloadUrl || null;
        }
        return null;
      }
    },
    {
      name: 'AllOrigins (HTML parse)',
      fetch: async (url, signal) => {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        const resp = await fetch(proxyUrl, { signal });
        if (resp.ok) {
          const html = await resp.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const videoEl = doc.querySelector('video[src]');
          if (videoEl && videoEl.src) return videoEl.src;
          const source = doc.querySelector('source[src]');
          if (source && source.src) return source.src;
          const links = html.match(/https?:\/\/[^\s]+\.(mp4|webm|mov|avi|mkv|m3u8)/gi);
          if (links && links.length) return links[0];
        }
        return null;
      }
    },
    {
      name: 'CorsProxy.io',
      fetch: async (url, signal) => {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const resp = await fetch(proxyUrl, { signal });
        if (resp.ok) {
          const html = await resp.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const videoEl = doc.querySelector('video[src]');
          if (videoEl && videoEl.src) return videoEl.src;
          const source = doc.querySelector('source[src]');
          if (source && source.src) return source.src;
          const links = html.match(/https?:\/\/[^\s]+\.(mp4|webm|mov|avi|mkv|m3u8)/gi);
          if (links && links.length) return links[0];
        }
        return null;
      }
    }
  ];

  async function fetchVideoDownloadUrl(url, forceRefresh = false) {
    if (!url) return null;
    if (!forceRefresh) {
      const cached = getCachedDownload(url);
      if (cached) return cached;
    }

    for (const service of downloadServices) {
      try {
        if (service.test && !service.test(url)) continue;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const result = await service.fetch(url, controller.signal);
        clearTimeout(timeout);
        if (result && result.startsWith('http')) {
          setCachedDownload(url, result);
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