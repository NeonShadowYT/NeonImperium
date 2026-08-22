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
      // Список параметров, которые нужно удалить
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
      // Для YouTube оставляем только v, list, t, start, end
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
        // Если остался только v и он единственный, можно убрать '?'
        if (params.toString() === '' || (params.keys().length === 1 && params.has('v'))) {
          parsed.search = '';
        } else {
          parsed.search = params.toString();
        }
      }
      // Для Vimeo оставляем только id
      if (parsed.hostname.includes('vimeo.com')) {
        // Удаляем все параметры
        if (parsed.search) {
          parsed.search = '';
          changed = true;
        }
      }
      // Для Dailymotion оставляем только id
      if (parsed.hostname.includes('dailymotion.com')) {
        // Удаляем все параметры
        if (parsed.search) {
          parsed.search = '';
          changed = true;
        }
      }
      // Для Twitch оставляем только channel или clip
      if (parsed.hostname.includes('twitch.tv') || parsed.hostname.includes('clips.twitch.tv')) {
        // Удаляем все параметры, кроме parent (если он есть, он может быть важен для embed)
        // Но для хранения ссылки мы можем оставить только путь
        const path = parsed.pathname;
        if (parsed.search) {
          parsed.search = '';
          changed = true;
        }
        // Если путь содержит '?' - удаляем
      }
      // Для RuTube оставляем только id
      if (parsed.hostname.includes('rutube.ru')) {
        if (parsed.search) {
          parsed.search = '';
          changed = true;
        }
      }
      // Для Coub оставляем только id
      if (parsed.hostname.includes('coub.com')) {
        if (parsed.search) {
          parsed.search = '';
          changed = true;
        }
      }
      // Для view_video.php оставляем только viewkey
      if (parsed.pathname.includes('view_video.php')) {
        const viewkey = parsed.searchParams.get('viewkey');
        if (viewkey) {
          parsed.search = '?viewkey=' + viewkey;
          changed = true;
        }
      }
      return changed ? parsed.toString() : url;
    } catch (e) {
      // Если URL невалидный, возвращаем как есть
      return url;
    }
  }

  function parseVideoUrl(url) {
    let embedUrl = null;
    let type = 'video';
    let videoData = null;

    // YouTube
    let ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
    if (ytMatch) {
      const id = ytMatch[1];
      // Сохраняем параметры t, list, start, end, если они есть
      const params = new URLSearchParams();
      let tParam = '';
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

    // Twitch (канал или клип)
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
        for (const candidate of candidates) {
          try {
            const resp = fetch(candidate, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
            foundEmbed = candidate;
            break;
          } catch (e) {}
        }
        embedUrl = foundEmbed || `${baseUrl}embed/${key}`;
        videoData = { service: 'custom', embedUrl };
        return { embedUrl, type, videoData };
      }
    }

    return null;
  }

  // ---- основная функция fetchMetadata ----
  async function fetchMetadata(url) {
    // Очищаем URL от трекеров
    const cleanedUrl = cleanUrl(url);
    
    // Сначала пробуем наши парсеры
    const parsed = parseVideoUrl(cleanedUrl);
    if (parsed && parsed.embedUrl) {
      let title = cleanedUrl;
      try {
        const resp = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(cleanedUrl)}`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.title) title = data.title;
        }
      } catch (e) {}
      return {
        title: title,
        thumbnail: null,
        embedUrl: parsed.embedUrl,
        type: parsed.type,
        videoData: parsed.videoData,
        cleanedUrl: cleanedUrl // сохраняем очищенный URL
      };
    }

    // Стандартные OEmbed-провайдеры
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