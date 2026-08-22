// js/features/storage/metadata.js
// Извлечение метаданных из URL, включая парсинг видео с различных платформ

(function() {
  const { showToast } = window.UIUtils || {};

  function extractIframeSrc(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const iframe = div.querySelector('iframe');
    return iframe ? iframe.src : null;
  }

  function parseVideoUrl(url) {
    let embedUrl = null;
    let type = 'video';
    let videoData = null;

    // YouTube
    let ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/);
    if (ytMatch) {
      const id = ytMatch[1];
      embedUrl = `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1&autoplay=0`;
      videoData = { service: 'youtube', id };
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
      // Проверяем, не клип ли это
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

    if (url.includes('view_video.php?viewkey=')) {
      const keyMatch = url.match(/viewkey=([^&]+)/);
      if (keyMatch) {
        const key = keyMatch[1];
        const baseUrl = url.split('view_video.php')[0];
        embedUrl = `${baseUrl}embed/${key}`;
        videoData = { service: 'custom', embedUrl };
        return { embedUrl, type, videoData };
      }
    }

    // Если ничего не подошло, возвращаем null
    return null;
  }

  // ---- основная функция fetchMetadata ----
  async function fetchMetadata(url) {
    // Сначала пробуем наши парсеры
    const parsed = parseVideoUrl(url);
    if (parsed && parsed.embedUrl) {
      // Попытаемся получить заголовок через oembed, если получится
      let title = url;
      try {
        const resp = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.title) title = data.title;
        }
      } catch (e) {}
      return {
        title: title,
        thumbnail: null, // можно попытаться извлечь позже
        embedUrl: parsed.embedUrl,
        type: parsed.type,
        videoData: parsed.videoData
      };
    }

    // Стандартные OEmbed-провайдеры
    try {
      const resp1 = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(5000) });
      if (resp1.ok) {
        const data = await resp1.json();
        if (data && data.title) {
          return {
            title: data.title,
            thumbnail: data.thumbnail_url || data.thumbnail || null,
            embedUrl: data.html ? extractIframeSrc(data.html) : null,
            type: data.type === 'video' ? 'video' : 'link',
            videoData: data.type === 'video' ? { service: 'oembed', embedUrl: data.html } : null
          };
        }
      }
    } catch (e) {}

    try {
      const resp2 = await fetch(`https://iframe.ly/api/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(5000) });
      if (resp2.ok) {
        const data = await resp2.json();
        if (data && data.title) {
          return {
            title: data.title,
            thumbnail: data.thumbnail_url || null,
            embedUrl: data.html ? extractIframeSrc(data.html) : null,
            type: data.type === 'video' ? 'video' : 'link',
            videoData: data.type === 'video' ? { service: 'iframe', embedUrl: data.html } : null
          };
        }
      }
    } catch (e) {}

    try {
      const resp3 = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}&data.title&data.image&data.embed`, { signal: AbortSignal.timeout(5000) });
      if (resp3.ok) {
        const data = await resp3.json();
        if (data && data.data && data.data.title) {
          const embedHtml = data.data.embed?.html || null;
          return {
            title: data.data.title,
            thumbnail: data.data.image?.url || null,
            embedUrl: embedHtml ? extractIframeSrc(embedHtml) : null,
            type: data.data.embed?.type === 'video' ? 'video' : 'link',
            videoData: data.data.embed?.type === 'video' ? { service: 'microlink', embedUrl: embedHtml } : null
          };
        }
      }
    } catch (e) {}

    // Если ничего не найдено, возвращаем как ссылку
    return { title: url, thumbnail: null, embedUrl: null, type: 'link', videoData: null };
  }

  window._StorageMetadata = {
    fetchMetadata,
    extractIframeSrc,
    parseVideoUrl
  };
})();