// js/features/storage/metadata.js
// Извлечение метаданных из URL, парсинг видео, очистка URL от трекеров
// Добавлена поддержка множества резервных источников для превью и embedUrl

(function() {
  const { showToast } = window.UIUtils || {};

  function extractIframeSrc(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const iframe = div.querySelector('iframe');
    return iframe ? iframe.src : null;
  }

  /**
   * Очищает URL от отслеживающих параметров
   * Сохраняет важные параметры для видео (v, t, list и т.п.)
   */
  function cleanUrl(url) {
    if (!url) return url;
    try {
      const parsed = new URL(url);
      const removeParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'ref', 'source', 'fbclid', 'mc_cid', 'mc_eid', 'gs_l', 'gclid',
        'yclid', 'ysclid', 'utm_referrer', 'utm_visitor', 'utm_affiliate'
      ];
      let changed = false;
      for (const param of removeParams) {
        if (parsed.searchParams.has(param)) {
          parsed.searchParams.delete(param);
          changed = true;
        }
      }
      if (parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be')) {
        const allowed = ['v', 'list', 't', 'start', 'end'];
        const params = new URLSearchParams(parsed.search);
        const toDelete = [];
        for (const key of params.keys()) {
          if (!allowed.includes(key)) toDelete.push(key);
        }
        for (const key of toDelete) {
          params.delete(key);
          changed = true;
        }
        if (params.toString() === '' || (params.keys().length === 1 && params.has('v'))) {
          parsed.search = '';
        } else {
          parsed.search = params.toString();
        }
      }
      if (parsed.hostname.includes('vimeo.com') ||
          parsed.hostname.includes('dailymotion.com') ||
          parsed.hostname.includes('twitch.tv') ||
          parsed.hostname.includes('rutube.ru') ||
          parsed.hostname.includes('coub.com')) {
        if (parsed.search) {
          parsed.search = '';
          changed = true;
        }
      }
      // Специальный случай для view_video.php (общий)
      if (parsed.pathname.includes('view_video.php')) {
        const viewkey = parsed.searchParams.get('viewkey');
        if (viewkey) {
          parsed.search = '?viewkey=' + viewkey;
          changed = true;
        }
      }
      return changed ? parsed.toString() : url;
    } catch (e) {
      return url;
    }
  }

  /**
   * Парсит видео-ссылки и возвращает embedUrl и тип
   * Поддерживает: YouTube, Vimeo, Dailymotion, Twitch, RuTube, Coub, view_video.php
   */
  function parseVideoUrl(url) {
    let embedUrl = null;
    let type = 'video';
    let videoData = null;

    // YouTube
    let ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
    if (ytMatch) {
      const id = ytMatch[1];
      const params = new URLSearchParams();
      try {
        const parsed = new URL(url);
        const t = parsed.searchParams.get('t');
        if (t) params.set('t', t);
        const list = parsed.searchParams.get('list');
        if (list) params.set('list', list);
        const start = parsed.searchParams.get('start');
        if (start) params.set('start', start);
        const end = parsed.searchParams.get('end');
        if (end) params.set('end', end);
      } catch (e) {}
      const query = params.toString() ? '?' + params.toString() : '';
      embedUrl = `https://www.youtube-nocookie.com/embed/${id}${query}&rel=0&modestbranding=1&playsinline=1&autoplay=0`;
      videoData = { service: 'youtube', id };
      if (params.toString()) videoData.params = params.toString();
      return { embedUrl, type, videoData };
    }

    // Vimeo
    let vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) {
      const id = vimeoMatch[1];
      embedUrl = `https://player.vimeo.com/video/${id}`;
      videoData = { service: 'vimeo', id };
      return { embedUrl, type, videoData };
    }

    // Dailymotion
    let dmMatch = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
    if (dmMatch) {
      const id = dmMatch[1];
      embedUrl = `https://www.dailymotion.com/embed/video/${id}`;
      videoData = { service: 'dailymotion', id };
      return { embedUrl, type, videoData };
    }

    // Twitch
    let twitchMatch = url.match(/twitch\.tv\/(\w+)/);
    if (twitchMatch) {
      const channel = twitchMatch[1];
      let clipMatch = url.match(/clips\.twitch\.tv\/(\w+)/);
      if (clipMatch) {
        const clipId = clipMatch[1];
        embedUrl = `https://clips.twitch.tv/embed?clip=${clipId}&parent=${location.hostname}`;
        videoData = { service: 'twitch_clip', id: clipId };
      } else {
        embedUrl = `https://player.twitch.tv/?channel=${channel}&parent=${location.hostname}&autoplay=false`;
        videoData = { service: 'twitch_channel', channel };
      }
      return { embedUrl, type, videoData };
    }

    // RuTube
    let rutubeMatch = url.match(/rutube\.ru\/video\/([a-f0-9]+)/);
    if (rutubeMatch) {
      const id = rutubeMatch[1];
      embedUrl = `https://rutube.ru/embed/${id}`;
      videoData = { service: 'rutube', id };
      return { embedUrl, type, videoData };
    }

    // Coub
    let coubMatch = url.match(/coub\.com\/view\/([a-zA-Z0-9]+)/);
    if (coubMatch) {
      const id = coubMatch[1];
      embedUrl = `https://coub.com/embed/${id}`;
      videoData = { service: 'coub', id };
      return { embedUrl, type, videoData };
    }

    // view_video.php (общий случай)
    if (url.includes('view_video.php?viewkey=')) {
      const keyMatch = url.match(/viewkey=([^&]+)/);
      if (keyMatch) {
        const key = keyMatch[1];
        const baseUrl = url.split('view_video.php')[0];
        const candidates = [
          `${baseUrl}embed/${key}`,
          `${baseUrl}v/${key}`,
          `${baseUrl}video/${key}`,
          `${baseUrl}player.php?viewkey=${key}`
        ];
        let foundEmbed = candidates[0];
        embedUrl = foundEmbed;
        videoData = { service: 'custom', embedUrl };
        return { embedUrl, type, videoData };
      }
    }

    return null;
  }

  /**
   * Основная функция получения метаданных с множеством резервных способов
   */
  async function fetchMetadata(url) {
    const cleanedUrl = cleanUrl(url);
    
    // 1. Сначала пробуем наши парсеры для известных платформ
    const parsed = parseVideoUrl(cleanedUrl);
    if (parsed && parsed.embedUrl) {
      let title = cleanedUrl;
      let thumbnail = null;
      
      // Пытаемся получить заголовок и превью через oEmbed-сервисы
      const oembedServices = [
        { url: 'https://noembed.com/embed', params: { url: cleanedUrl } },
        { url: 'https://iframe.ly/api/oembed', params: { url: cleanedUrl } },
        { url: 'https://api.microlink.io/', params: { url: cleanedUrl, data: 'title,image,embed' } }
      ];

      for (const service of oembedServices) {
        try {
          const qs = new URLSearchParams(service.params).toString();
          const resp = await fetch(`${service.url}?${qs}`, { signal: AbortSignal.timeout(3000) });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.title) {
              title = data.title;
            }
            // Для microlink структура отличается
            if (data && data.data) {
              if (data.data.title) title = data.data.title;
              if (data.data.image && data.data.image.url) thumbnail = data.data.image.url;
            } else {
              if (data.thumbnail_url) thumbnail = data.thumbnail_url;
              else if (data.thumbnail) thumbnail = data.thumbnail;
            }
            if (title && thumbnail) break;
          }
        } catch (e) {
          // игнорируем ошибки, переходим к следующему
        }
      }

      // Если превью всё ещё нет, генерируем для известных платформ
      if (!thumbnail && parsed.videoData) {
        if (parsed.videoData.service === 'youtube' && parsed.videoData.id) {
          thumbnail = `https://img.youtube.com/vi/${parsed.videoData.id}/mqdefault.jpg`;
        } else if (parsed.videoData.service === 'vimeo' && parsed.videoData.id) {
          // Vimeo можно получить через api
          try {
            const resp = await fetch(`https://vimeo.com/api/v2/video/${parsed.videoData.id}.json`, { signal: AbortSignal.timeout(3000) });
            if (resp.ok) {
              const data = await resp.json();
              if (data && data.length && data[0].thumbnail_large) {
                thumbnail = data[0].thumbnail_large;
              }
            }
          } catch (e) {}
        } else if (parsed.videoData.service === 'dailymotion' && parsed.videoData.id) {
          try {
            const resp = await fetch(`https://api.dailymotion.com/video/${parsed.videoData.id}?fields=thumbnail_url`, { signal: AbortSignal.timeout(3000) });
            if (resp.ok) {
              const data = await resp.json();
              if (data && data.thumbnail_url) thumbnail = data.thumbnail_url;
            }
          } catch (e) {}
        } else if (parsed.videoData.service === 'twitch_clip' && parsed.videoData.id) {
          // Для клипов Twitch можно использовать стандартную заглушку
          thumbnail = null;
        } else if (parsed.videoData.service === 'rutube' && parsed.videoData.id) {
          try {
            const resp = await fetch(`https://rutube.ru/api/video/${parsed.videoData.id}/?format=json`, { signal: AbortSignal.timeout(3000) });
            if (resp.ok) {
              const data = await resp.json();
              if (data && data.thumbnail_url) thumbnail = data.thumbnail_url;
            }
          } catch (e) {}
        } else if (parsed.videoData.service === 'coub' && parsed.videoData.id) {
          try {
            const resp = await fetch(`https://coub.com/api/v2/coubs/${parsed.videoData.id}`, { signal: AbortSignal.timeout(3000) });
            if (resp.ok) {
              const data = await resp.json();
              if (data && data.thumbnail_medium) thumbnail = data.thumbnail_medium;
            }
          } catch (e) {}
        }
      }

      // Если всё ещё нет превью, пробуем парсить страницу через прокси allorigins
      if (!thumbnail) {
        try {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(cleanedUrl)}`;
          const proxyResp = await fetch(proxyUrl, { signal: AbortSignal.timeout(5000) });
          if (proxyResp.ok) {
            const html = await proxyResp.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const ogImage = doc.querySelector('meta[property="og:image"]');
            if (ogImage && ogImage.content) thumbnail = ogImage.content;
            if (!thumbnail) {
              const img = doc.querySelector('img[itemprop="thumbnailUrl"]');
              if (img && img.src) thumbnail = img.src;
            }
            if (!thumbnail) {
              // Пробуем найти первую большую картинку
              const imgEl = doc.querySelector('img[src]');
              if (imgEl && imgEl.src && imgEl.width > 100) thumbnail = imgEl.src;
            }
          }
        } catch (e) {
          // игнорируем
        }
      }

      // Если всё равно нет превью – оставляем null, в карточке будет заглушка
      return {
        title: title || cleanedUrl,
        thumbnail: thumbnail || null,
        embedUrl: parsed.embedUrl,
        type: parsed.type || 'video',
        videoData: parsed.videoData || null,
        cleanedUrl: cleanedUrl
      };
    }

    // 2. Если не удалось распарсить как видео – пробуем стандартные oEmbed как для ссылки
    try {
      const resp1 = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(cleanedUrl)}`, { signal: AbortSignal.timeout(5000) });
      if (resp1.ok) {
        const data = await resp1.json();
        if (data && data.title) {
          return {
            title: data.title,
            thumbnail: data.thumbnail_url || data.thumbnail || null,
            embedUrl: data.html ? extractIframeSrc(data.html) : null,
            type: data.type === 'video' ? 'video' : 'link',
            videoData: data.type === 'video' ? { service: 'oembed', embedUrl: data.html } : null,
            cleanedUrl: cleanedUrl
          };
        }
      }
    } catch (e) {}

    try {
      const resp2 = await fetch(`https://iframe.ly/api/oembed?url=${encodeURIComponent(cleanedUrl)}`, { signal: AbortSignal.timeout(5000) });
      if (resp2.ok) {
        const data = await resp2.json();
        if (data && data.title) {
          return {
            title: data.title,
            thumbnail: data.thumbnail_url || null,
            embedUrl: data.html ? extractIframeSrc(data.html) : null,
            type: data.type === 'video' ? 'video' : 'link',
            videoData: data.type === 'video' ? { service: 'iframe', embedUrl: data.html } : null,
            cleanedUrl: cleanedUrl
          };
        }
      }
    } catch (e) {}

    try {
      const resp3 = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(cleanedUrl)}&data.title&data.image&data.embed`, { signal: AbortSignal.timeout(5000) });
      if (resp3.ok) {
        const data = await resp3.json();
        if (data && data.data && data.data.title) {
          const embedHtml = data.data.embed?.html || null;
          return {
            title: data.data.title,
            thumbnail: data.data.image?.url || null,
            embedUrl: embedHtml ? extractIframeSrc(embedHtml) : null,
            type: data.data.embed?.type === 'video' ? 'video' : 'link',
            videoData: data.data.embed?.type === 'video' ? { service: 'microlink', embedUrl: embedHtml } : null,
            cleanedUrl: cleanedUrl
          };
        }
      }
    } catch (e) {}

    // 3. Если ничего не найдено, пробуем прокси allorigins для поиска видео в HTML
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(cleanedUrl)}`;
      const proxyResp = await fetch(proxyUrl, { signal: AbortSignal.timeout(5000) });
      if (proxyResp.ok) {
        const html = await proxyResp.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const videoEl = doc.querySelector('video[src]');
        if (videoEl && videoEl.src) {
          return {
            title: doc.querySelector('title')?.textContent || cleanedUrl,
            thumbnail: null,
            embedUrl: videoEl.src,
            type: 'video',
            videoData: { service: 'proxy', url: videoEl.src },
            cleanedUrl: cleanedUrl
          };
        }
        const source = doc.querySelector('source[src]');
        if (source && source.src) {
          return {
            title: doc.querySelector('title')?.textContent || cleanedUrl,
            thumbnail: null,
            embedUrl: source.src,
            type: 'video',
            videoData: { service: 'proxy', url: source.src },
            cleanedUrl: cleanedUrl
          };
        }
        const ogVideo = doc.querySelector('meta[property="og:video"]');
        if (ogVideo && ogVideo.content) {
          return {
            title: doc.querySelector('title')?.textContent || cleanedUrl,
            thumbnail: doc.querySelector('meta[property="og:image"]')?.content || null,
            embedUrl: ogVideo.content,
            type: 'video',
            videoData: { service: 'proxy', url: ogVideo.content },
            cleanedUrl: cleanedUrl
          };
        }
      }
    } catch (e) {}

    // 4. Всё else – возвращаем как ссылку с очищенным URL
    return { title: cleanedUrl, thumbnail: null, embedUrl: null, type: 'link', videoData: null, cleanedUrl: cleanedUrl };
  }

  window._StorageMetadata = {
    fetchMetadata,
    extractIframeSrc,
    parseVideoUrl,
    cleanUrl
  };
})();