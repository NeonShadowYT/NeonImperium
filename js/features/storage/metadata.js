// js/features/storage/metadata.js
// Извлечение метаданных из URL, парсинг видео, очистка URL от трекеров

(function() {
  const { showToast } = window.UIUtils || {};

  function extractIframeSrc(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const iframe = div.querySelector('iframe');
    return iframe ? iframe.src : null;
  }

  /**
   * Очищает URL от отслеживающих параметров (utm_*, ref, source, fbclid, mc_* и др.)
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
          if (!allowed.includes(key)) {
            toDelete.push(key);
          }
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
      if (parsed.hostname.includes('vimeo.com')) {
        if (parsed.search) {
          parsed.search = '';
          changed = true;
        }
      }
      if (parsed.hostname.includes('dailymotion.com')) {
        if (parsed.search) {
          parsed.search = '';
          changed = true;
        }
      }
      if (parsed.hostname.includes('twitch.tv') || parsed.hostname.includes('clips.twitch.tv')) {
        if (parsed.search) {
          parsed.search = '';
          changed = true;
        }
      }
      if (parsed.hostname.includes('rutube.ru')) {
        if (parsed.search) {
          parsed.search = '';
          changed = true;
        }
      }
      if (parsed.hostname.includes('coub.com')) {
        if (parsed.search) {
          parsed.search = '';
          changed = true;
        }
      }
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

    // YouTube (все вариации)
    // 1. youtube.com/watch?v=ID
    // 2. youtu.be/ID
    // 3. youtube.com/embed/ID
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

    // view_video.php (специфичный для некоторых сайтов)
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
        let foundEmbed = null;
        // Пытаемся найти рабочий embed через HEAD (но CORS может мешать – просто берём первый)
        foundEmbed = candidates[0]; // по умолчанию embed
        embedUrl = foundEmbed;
        videoData = { service: 'custom', embedUrl };
        return { embedUrl, type, videoData };
      }
    }

    return null;
  }

  // ---- основная функция fetchMetadata ----
  async function fetchMetadata(url) {
    const cleanedUrl = cleanUrl(url);
    
    // Сначала пробуем наши парсеры
    const parsed = parseVideoUrl(cleanedUrl);
    if (parsed && parsed.embedUrl) {
      let title = cleanedUrl;
      let thumbnail = null;
      // Пытаемся получить заголовок и превью через oembed (для улучшения)
      try {
        const resp = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(cleanedUrl)}`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.title) title = data.title;
          if (data && data.thumbnail_url) thumbnail = data.thumbnail_url;
        }
      } catch (e) {}
      // Если noembed не дал превью, пробуем iframely
      if (!thumbnail) {
        try {
          const resp = await fetch(`https://iframe.ly/api/oembed?url=${encodeURIComponent(cleanedUrl)}`, { signal: AbortSignal.timeout(3000) });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.thumbnail_url) thumbnail = data.thumbnail_url;
          }
        } catch (e) {}
      }
      // Если всё равно нет превью, попробуем microlink
      if (!thumbnail) {
        try {
          const resp = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(cleanedUrl)}&data.image`, { signal: AbortSignal.timeout(3000) });
          if (resp.ok) {
            const data = await resp.json();
            if (data && data.data && data.data.image && data.data.image.url) {
              thumbnail = data.data.image.url;
            }
          }
        } catch (e) {}
      }
      // Для YouTube можно сгенерировать превью сами
      if (!thumbnail && parsed.videoData && parsed.videoData.service === 'youtube' && parsed.videoData.id) {
        thumbnail = `https://img.youtube.com/vi/${parsed.videoData.id}/mqdefault.jpg`;
      }
      return {
        title: title,
        thumbnail: thumbnail,
        embedUrl: parsed.embedUrl,
        type: parsed.type,
        videoData: parsed.videoData,
        cleanedUrl: cleanedUrl
      };
    }

    // Стандартные OEmbed-провайдеры (fallback)
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

    // Если ничего не найдено, возвращаем как ссылку с очищенным URL
    return { title: cleanedUrl, thumbnail: null, embedUrl: null, type: 'link', videoData: null, cleanedUrl: cleanedUrl };
  }

  window._StorageMetadata = {
    fetchMetadata,
    extractIframeSrc,
    parseVideoUrl,
    cleanUrl
  };
})();