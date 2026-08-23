// js/features/storage/ui.js
// UI-рендеринг закладок, модалка, статус, обработка файлов
// Оптимизировано: добавление/удаление без полной перерисовки, кеширование downloadUrl с TTL
// Добавлено: групповые операции, запись видео через MediaRecorder, парсинг HTML, офлайн-кеширование
// Исправлено: клик по видео открывает модальный плеер, кнопка записи минималистична
// Добавлена прокси-загрузка видео через allorigins.win

(function() {
  const { escapeHtml, formatDate, loadModule, createElement, debounce } = window.GithubCore || {};
  const { getCurrentUser, hasScope } = window.GithubAuth || {};
  const { showToast, createModal } = window.UIUtils || {};
  const { fetchMetadata } = window._StorageMetadata || {};

  const {
    ensureStorage,
    addBookmark,
    removeBookmark,
    updateBookmark,
    getBookmarks,
    setBookmarks,
    triggerSave,
    exportBookmarksData,
    importBookmarksData,
    importBookmarksBatch,
    exportAllBookmarks,
    batchUpdateVideoLinks,
    setStatusCallback,
    refreshGridCallback
  } = window._StorageManager;

  let statusElement = null;
  const bookmarkElements = new Map();

  const DOWNLOAD_URL_TTL = 24 * 60 * 60 * 1000;

  function updateStatus(text, type = 'info') {
    if (statusElement) {
      statusElement.textContent = text;
      statusElement.style.color = 'var(--text-secondary)';
      statusElement.style.opacity = '0.7';
    }
  }

  function truncateTitle(title, maxLength = 50) {
    if (!title) return 'Закладка';
    if (title.length <= maxLength) return title;
    return title.slice(0, maxLength) + '…';
  }

  // ---- Расширенное получение ссылки на скачивание с кешированием + прокси ----
  async function getVideoDownloadUrl(url, forceRefresh = false) {
    if (!url) return null;

    const apis = [
      // 1. Cobalt
      {
        url: 'https://api.cobalt.tools/api/json',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: (videoUrl) => JSON.stringify({ url: videoUrl, videoQuality: '720', audioFormat: 'best' })
      },
      // 2. VideoFetcher
      {
        url: 'https://api.videofetcher.net/parse',
        method: 'GET',
        params: (videoUrl) => ({ url: videoUrl })
      },
      // 3. Invidious
      {
        url: (videoUrl) => {
          const match = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
          if (match) {
            return `https://invidious.private.coffee/api/v1/videos/${match[1]}`;
          }
          return null;
        },
        method: 'GET',
        parser: (data) => {
          if (data && data.formatStreams && data.formatStreams.length) {
            const stream = data.formatStreams.find(s => s.type && s.type.startsWith('video/mp4'));
            return stream ? stream.url : null;
          }
          return null;
        }
      },
      // 4. Piped
      {
        url: (videoUrl) => {
          const match = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
          if (match) {
            return `https://pipedapi.kavin.rocks/streams/${match[1]}`;
          }
          return null;
        },
        method: 'GET',
        parser: (data) => {
          if (data && data.videoStreams && data.videoStreams.length) {
            const stream = data.videoStreams.find(s => s.quality === '720p' || s.quality === '1080p');
            return stream ? stream.url : null;
          }
          return null;
        }
      },
      // 5. yt-dlp-web
      {
        url: 'https://yt-dlp-web.herokuapp.com/api/info',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: (videoUrl) => JSON.stringify({ url: videoUrl }),
        parser: (data) => {
          if (data && data.url) return data.url;
          if (data && data.formats && data.formats.length) {
            const best = data.formats.find(f => f.quality && f.quality > 0);
            return best ? best.url : null;
          }
          return null;
        }
      },
      // 6. savefrom.net (неофициальный)
      {
        url: 'https://savefrom.net/',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: (videoUrl) => `url=${encodeURIComponent(videoUrl)}`,
        parser: (html) => {
          const match = html.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*download[^"]*"/i);
          return match ? match[1] : null;
        }
      },
      // 7. y2mate.com
      {
        url: 'https://www.y2mate.com/mates/analyzeAjax',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: (videoUrl) => `url=${encodeURIComponent(videoUrl)}&type=YouTube`,
        parser: (data) => {
          if (data && data.downloadUrl) return data.downloadUrl;
          return null;
        }
      },
      // 8. loader.to
      {
        url: (videoUrl) => {
          const match = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
          if (match) {
            return `https://loader.to/api/?link=${encodeURIComponent(videoUrl)}&mode=video`;
          }
          return null;
        },
        method: 'GET',
        parser: (data) => {
          try {
            const json = JSON.parse(data);
            return json.downloadUrl || null;
          } catch { return null; }
        }
      },
      // 9. ssyoutube.com (через api)
      {
        url: (videoUrl) => {
          const match = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
          if (match) {
            return `https://ssyoutube.com/api/convert?url=${encodeURIComponent(videoUrl)}`;
          }
          return null;
        },
        method: 'GET',
        parser: (data) => {
          try {
            const json = JSON.parse(data);
            return json.downloadUrl || null;
          } catch { return null; }
        }
      }
    ];

    // Пробуем все API
    for (const api of apis) {
      try {
        let requestUrl;
        if (typeof api.url === 'function') {
          requestUrl = api.url(url);
          if (!requestUrl) continue;
        } else {
          requestUrl = api.url;
        }

        let response;
        let bodyData;
        if (api.method === 'POST') {
          bodyData = typeof api.body === 'function' ? api.body(url) : api.body;
          response = await fetch(requestUrl, {
            method: 'POST',
            headers: api.headers || {},
            body: bodyData,
            signal: AbortSignal.timeout(10000)
          });
        } else {
          const params = typeof api.params === 'function' ? api.params(url) : {};
          const query = new URLSearchParams(params).toString();
          const fullUrl = query ? `${requestUrl}?${query}` : requestUrl;
          response = await fetch(fullUrl, {
            signal: AbortSignal.timeout(10000)
          });
        }

        if (!response.ok) continue;

        let data;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else {
          data = await response.text();
        }

        let downloadUrl = null;
        if (api.parser) {
          downloadUrl = api.parser(data);
        } else {
          if (data && typeof data === 'object') {
            downloadUrl = data.url || data.downloadUrl || data.download_url || data.link || data.download;
          }
        }

        if (downloadUrl && downloadUrl.startsWith('http')) {
          return downloadUrl;
        }
      } catch (e) {
        console.warn('[Storage] API error:', e);
        continue;
      }
    }

    // Если ничего не получилось, пробуем прокси через allorigins для парсинга HTML
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const html = await response.text();
        // Ищем ссылку на видео в HTML
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // Ищем video тег с src
        const videoEl = doc.querySelector('video[src]');
        if (videoEl && videoEl.src) {
          return videoEl.src;
        }
        // Ищем source
        const source = doc.querySelector('source[src]');
        if (source && source.src) {
          return source.src;
        }
        // Ищем meta og:video
        const meta = doc.querySelector('meta[property="og:video"]');
        if (meta && meta.content) {
          return meta.content;
        }
      }
    } catch (e) {
      console.warn('[Storage] Proxy fallback failed:', e);
    }

    return null;
  }

  // ---- Проверка и обновление downloadUrl в закладке ----
  async function ensureDownloadUrl(bm) {
    if (!bm || bm.type !== 'video' || !bm.url) return null;
    if (bm.downloadUrl && bm.downloadUrlExpires && Date.now() < bm.downloadUrlExpires) {
      return bm.downloadUrl;
    }
    try {
      const url = await getVideoDownloadUrl(bm.url);
      if (url) {
        const expires = Date.now() + DOWNLOAD_URL_TTL;
        await updateBookmark(bm.id, { downloadUrl: url, downloadUrlExpires: expires });
        return url;
      }
    } catch (e) {
      console.warn('Ошибка получения ссылки:', e);
    }
    return null;
  }

  // ---- Прямое извлечение видео через MediaRecorder (запись экрана/потока) ----
  async function recordVideoFromIframe(iframeElement, duration = 10000) {
    try {
      // Получаем поток из iframe (только если это видео-элемент внутри)
      const videoEl = iframeElement.contentDocument?.querySelector('video');
      if (!videoEl) {
        // Если не удалось, пробуем захватить экран (пользователь должен разрешить)
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        return await recordStream(stream, duration);
      }
      // Если нашли video-элемент, используем его поток
      const stream = videoEl.captureStream ? videoEl.captureStream() : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      return await recordStream(stream, duration);
    } catch (err) {
      console.warn('Recording failed:', err);
      throw err;
    }
  }

  async function recordStream(stream, duration = 10000) {
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    mediaRecorder.start();
    await new Promise(resolve => setTimeout(resolve, duration));
    mediaRecorder.stop();
    await new Promise(resolve => mediaRecorder.onstop = resolve);
    const blob = new Blob(chunks, { type: 'video/webm' });
    stream.getTracks().forEach(t => t.stop());
    return blob;
  }

  // ---- Парсинг HTML для извлечения ссылки на видео (для сайтов без oembed) ----
  async function parseVideoFromHtml(url) {
    try {
      // Используем прокси для обхода CORS (публичный)
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return null;
      const html = await response.text();
      // Ищем видео-элементы
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const videoEl = doc.querySelector('video');
      if (videoEl && videoEl.src) {
        return videoEl.src;
      }
      // Ищем ссылки на видео в атрибутах source
      const sources = doc.querySelectorAll('source[src]');
      for (const src of sources) {
        if (src.src.startsWith('http')) return src.src;
      }
      // Ищем ссылки в meta
      const metaOgVideo = doc.querySelector('meta[property="og:video"]');
      if (metaOgVideo) return metaOgVideo.content;
      return null;
    } catch (e) {
      console.warn('HTML parse failed:', e);
      return null;
    }
  }

  // ---- Умное определение типа ссылки (по содержимому) ----
  async function detectLinkType(url) {
    try {
      // Сначала пробуем oembed
      const meta = await fetchMetadata(url);
      if (meta.type === 'video' || meta.type === 'link') return meta;

      // Если не удалось, пробуем парсинг HTML
      const videoUrl = await parseVideoFromHtml(url);
      if (videoUrl) {
        return {
          title: meta.title || url,
          thumbnail: meta.thumbnail || null,
          embedUrl: videoUrl,
          type: 'video',
          videoData: { service: 'parsed', url: videoUrl },
          cleanedUrl: url
        };
      }

      // Иначе считаем ссылкой
      return {
        title: meta.title || url,
        thumbnail: null,
        embedUrl: null,
        type: 'link',
        videoData: null,
        cleanedUrl: url
      };
    } catch (e) {
      return { title: url, thumbnail: null, embedUrl: null, type: 'link', videoData: null, cleanedUrl: url };
    }
  }

  // ---- Открытие видео в модальном окне ----
  function openVideoModal(bm) {
    const t = window.I18n?.translate || (k => k);
    const html = `
      <div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;background:#000;border-radius:12px;">
        <iframe src="${bm.embedUrl}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allowfullscreen allow="autoplay; encrypted-media; gyroscope; picture-in-picture"></iframe>
      </div>
      <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <span style="color:var(--text-primary);font-size:18px;">${escapeHtml(bm.title)}</span>
        <div style="display:flex;gap:8px;">
          <button class="button small" id="video-download-btn" style="background:var(--accent);color:#fff;">${t('downloadBtn') || 'Скачать'}</button>
          <button class="button small" id="video-record-btn" style="background:rgba(0,0,0,0.5);color:#fff;">⏺ ${t('record') || 'Записать 10с'}</button>
        </div>
      </div>
    `;
    const { modal, closeModal } = createModal(bm.title, html, { size: 'full' });
    // Обработчик скачивания
    const downloadBtn = modal.querySelector('#video-download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async () => {
        const url = await ensureDownloadUrl(bm);
        if (url) {
          const a = document.createElement('a');
          a.href = url;
          a.download = bm.title + '.mp4';
          a.target = '_blank';
          a.click();
        } else {
          showToast('Не удалось получить ссылку', 'error');
        }
      });
    }
    // Обработчик записи
    const recordBtn = modal.querySelector('#video-record-btn');
    if (recordBtn) {
      recordBtn.addEventListener('click', async () => {
        const iframe = modal.querySelector('iframe');
        if (!iframe) { showToast('Плеер не найден', 'error'); return; }
        try {
          const blob = await recordVideoFromIframe(iframe, 10000);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${bm.title || 'video'}.webm`;
          a.click();
          showToast('Запись сохранена', 'success');
        } catch (err) {
          showToast('Ошибка записи: ' + err.message, 'error');
        }
      });
    }
    return { modal, closeModal };
  }

  // ---- Создание DOM-элемента карточки (с учётом кеширования) ----
  function createBookmarkCardElement(bm, modal) {
    const t = (key) => window.I18n?.translate(key) || key;
    const wrapper = document.createElement('div');
    wrapper.className = 'bookmark-card-wrapper';
    wrapper.dataset.id = bm.id;
    const card = document.createElement('div');
    card.className = 'bookmark-card';
    card.style.cursor = 'pointer';

    const media = document.createElement('div');
    media.className = 'bookmark-media';

    const isVideo = bm.type === 'video' && bm.embedUrl;
    const isPost = bm.type === 'post';
    const isSave = bm.type === 'save';
    const isLink = bm.type === 'link';

    // Превью
    if (isVideo) {
      // Показываем iframe
      const iframe = document.createElement('iframe');
      let src = bm.embedUrl;
      if (!src.includes('autoplay')) {
        src += (src.includes('?') ? '&' : '?') + 'autoplay=0';
      }
      if (src.includes('youtube')) {
        src += '&controls=1&showinfo=0&iv_load_policy=3&rel=0';
      }
      iframe.src = src;
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.setAttribute('allowfullscreen', 'true');
      iframe.allow = 'autoplay; encrypted-media; gyroscope; picture-in-picture';
      media.appendChild(iframe);
      // Добавляем кнопку записи (минималистичная, справа снизу)
      const recordBtn = document.createElement('button');
      recordBtn.className = 'record-btn-mini';
      recordBtn.innerHTML = '⏺';
      recordBtn.style.cssText = `
        position: absolute;
        bottom: 8px;
        right: 8px;
        background: rgba(0,0,0,0.6);
        border: none;
        border-radius: 50%;
        width: 28px;
        height: 28px;
        color: #fff;
        font-size: 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.5;
        transition: opacity 0.2s, transform 0.2s;
        z-index: 10;
      `;
      recordBtn.addEventListener('mouseenter', () => {
        recordBtn.style.opacity = '1';
        recordBtn.style.transform = 'scale(1.1)';
      });
      recordBtn.addEventListener('mouseleave', () => {
        recordBtn.style.opacity = '0.5';
        recordBtn.style.transform = 'scale(1)';
      });
      recordBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const blob = await recordVideoFromIframe(iframe, 10000);
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${bm.title || 'video'}.webm`;
          a.click();
          showToast('Запись сохранена', 'success');
        } catch (err) {
          showToast('Ошибка записи: ' + err.message, 'error');
        }
      });
      media.appendChild(recordBtn);
    } else if (bm.thumbnail) {
      const img = document.createElement('img');
      img.src = bm.thumbnail;
      img.alt = bm.title;
      img.onerror = () => img.style.display = 'none';
      media.appendChild(img);
      if (isPost) {
        const overlay = document.createElement('div');
        overlay.className = 'play-overlay';
        overlay.innerHTML = '<i class="fas fa-newspaper"></i>';
        media.appendChild(overlay);
      }
    } else {
      const icon = document.createElement('div');
      icon.className = 'bookmark-icon';
      const icons = { post: 'fa-newspaper', video: 'fa-video', save: 'fa-save', link: 'fa-link' };
      icon.innerHTML = `<i class="fas ${icons[bm.type] || 'fa-link'}"></i>`;
      media.appendChild(icon);
    }
    card.appendChild(media);

    const content = document.createElement('div');
    content.className = 'bookmark-content';

    const title = document.createElement('h4');
    title.textContent = truncateTitle(bm.title, 50);
    title.title = bm.title || 'Закладка';
    content.appendChild(title);

    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:12px;color:var(--text-secondary)';
    meta.textContent = `${bm.type.charAt(0).toUpperCase()+bm.type.slice(1)} · ${formatDate(bm.added)}`;
    content.appendChild(meta);

    // Кнопка скачивания
    const downloadContainer = document.createElement('div');
    downloadContainer.style.cssText = 'margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;';
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'button small';
    downloadBtn.textContent = '⬇ ' + (t('downloadBtn') || 'Скачать');
    downloadBtn.style.cssText = 'background:var(--accent);color:#fff;border:none;padding:4px 12px;border-radius:20px;cursor:pointer;font-size:12px;font-family:var(--font-family);transition:0.2s;';
    downloadBtn.addEventListener('mouseenter', () => { downloadBtn.style.transform = 'scale(1.05)'; });
    downloadBtn.addEventListener('mouseleave', () => { downloadBtn.style.transform = 'scale(1)'; });
    downloadContainer.appendChild(downloadBtn);

    const hasValidDownload = bm.downloadUrl && bm.downloadUrlExpires && Date.now() < bm.downloadUrlExpires;

    if (hasValidDownload) {
      downloadContainer.style.display = 'flex';
      downloadBtn.onclick = (e) => {
        e.stopPropagation();
        const a = document.createElement('a');
        a.href = bm.downloadUrl;
        a.download = bm.title + '.mp4';
        a.target = '_blank';
        a.click();
      };
    } else if (isVideo) {
      downloadContainer.style.display = 'none';
      const fetchDownload = async (e) => {
        e.stopPropagation();
        if (downloadBtn.disabled) return;
        downloadBtn.disabled = true;
        downloadBtn.textContent = '⏳ ...';
        try {
          const url = await ensureDownloadUrl(bm);
          if (url) {
            downloadContainer.style.display = 'flex';
            downloadBtn.onclick = (ev) => {
              ev.stopPropagation();
              const a = document.createElement('a');
              a.href = url;
              a.download = bm.title + '.mp4';
              a.target = '_blank';
              a.click();
            };
            downloadBtn.textContent = '⬇ ' + (t('downloadBtn') || 'Скачать');
            showToast('Ссылка получена', 'success');
          } else {
            showToast('Не удалось получить ссылку', 'error');
            downloadBtn.textContent = '❌ Ошибка';
            setTimeout(() => {
              downloadBtn.textContent = '⬇ ' + (t('downloadBtn') || 'Скачать');
              downloadBtn.disabled = false;
              downloadContainer.style.display = 'none';
            }, 3000);
          }
        } catch (err) {
          showToast('Ошибка: ' + err.message, 'error');
          downloadBtn.textContent = '❌ Ошибка';
          setTimeout(() => {
            downloadBtn.textContent = '⬇ ' + (t('downloadBtn') || 'Скачать');
            downloadBtn.disabled = false;
            downloadContainer.style.display = 'none';
          }, 3000);
        }
      };
      downloadBtn.addEventListener('click', fetchDownload);
    } else {
      downloadContainer.style.display = 'none';
    }
    content.appendChild(downloadContainer);

    card.appendChild(content);

    // Клик по карточке
    card.addEventListener('click', async (e) => {
      if (e.target.closest('button')) return;

      if (isVideo && bm.embedUrl) {
        e.stopPropagation();
        openVideoModal(bm);
        return;
      }

      if (isPost && bm.postData && bm.postData.id) {
        if (window.UIFeedback) {
          window.UIFeedback.openFullModal(bm.postData);
        } else {
          showToast(t('viewerNotAvailable'), 'error');
        }
        return;
      }

      if (isSave && bm.saveData) {
        try {
          const binary = atob(bm.saveData.content);
          const bytes = new Uint8Array(binary.length);
          for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: 'text/plain' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = bm.saveData.fileName || 'save.dat';
          a.click();
          URL.revokeObjectURL(a.href);
        } catch (err) {
          showToast('Ошибка скачивания', 'error');
        }
        return;
      }

      if (bm.url) {
        window.open(bm.url, '_blank');
      }
    });

    // Кнопка удаления
    const del = document.createElement('button');
    del.className = 'bookmark-delete-btn';
    del.innerHTML = '<i class="fas fa-trash-alt"></i>';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(t('deleteConfirm'))) {
        await removeBookmark(bm.id);
      }
    });
    wrapper.appendChild(card);
    wrapper.appendChild(del);
    return wrapper;
  }

  // ---- Инкрементальное обновление ----
  function addBookmarkCard(bm, modal) {
    const grid = modal?.querySelector('#bookmarks-grid');
    if (!grid) return;
    const existing = grid.querySelector(`.bookmark-card-wrapper[data-id="${bm.id}"]`);
    if (existing) existing.remove();
    const wrapper = createBookmarkCardElement(bm, modal);
    grid.prepend(wrapper);
    bookmarkElements.set(bm.id, wrapper);
  }

  function removeBookmarkCard(id, modal) {
    const grid = modal?.querySelector('#bookmarks-grid');
    if (!grid) return;
    const el = grid.querySelector(`.bookmark-card-wrapper[data-id="${id}"]`);
    if (el) el.remove();
    bookmarkElements.delete(id);
  }

  function renderBookmarks(modal) {
    const grid = modal?.querySelector('#bookmarks-grid');
    if (!grid) return;
    const t = (key) => window.I18n?.translate(key) || key;

    let bookmarks = getBookmarks() || [];
    let filtered = bookmarks.slice();
    const activeCat = modal.querySelector('.cat-btn.active');
    const category = activeCat ? activeCat.dataset.cat : 'all';
    const searchInput = modal.querySelector('#search-input');
    const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const sortOrder = modal.querySelector('.sort-btn.active')?.dataset.order || 'new';

    if (category !== 'all') filtered = filtered.filter(b => b.type === category);
    if (searchQuery) filtered = filtered.filter(b => b.title.toLowerCase().includes(searchQuery));
    if (sortOrder === 'new') filtered.sort((a,b) => new Date(b.added) - new Date(a.added));
    else filtered.sort((a,b) => new Date(a.added) - new Date(b.added));

    grid.innerHTML = '';
    bookmarkElements.clear();
    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><p>${t('noBookmarks')}</p></div>`;
      return;
    }
    const fragment = document.createDocumentFragment();
    filtered.forEach(bm => {
      const wrapper = createBookmarkCardElement(bm, modal);
      fragment.appendChild(wrapper);
      bookmarkElements.set(bm.id, wrapper);
    });
    grid.appendChild(fragment);
  }

  // ---- Обработка файлов ----
  async function processFiles(files, modal) {
    const t = (key) => window.I18n?.translate(key) || key;
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext !== 'ini' && ext !== 'starver') {
        showToast(t('fileNotSupported').replace('{name}', file.name), 'error');
        continue;
      }
      try {
        const buffer = await file.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);
        const hash = await hashBuffer(buffer);
        await addBookmark({
          url: null,
          title: file.name,
          saveData: {
            fileName: file.name,
            content: base64,
            hash: hash,
            mimeType: 'text/plain',
            game: null
          },
          type: 'save'
        });
        showToast(t('saveAdded').replace('{name}', file.name), 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    }
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i=0; i<bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  async function hashBuffer(buffer) {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // ---- Групповые действия в модалке ----
  function addBatchActions(modal) {
    const t = (key) => window.I18n?.translate(key) || key;
    const container = modal.querySelector('.storage-actions');
    if (!container) return;

    // Кнопка "Обновить видео"
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'storage-btn';
    refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> ' + (t('refreshVideos') || 'Обновить видео');
    refreshBtn.title = 'Обновить ссылки на скачивание для всех видео';
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ...';
      try {
        const result = await batchUpdateVideoLinks();
        showToast(`Обновлено: ${result.updated}, ошибок: ${result.failed}`, result.failed > 0 ? 'warning' : 'success');
        renderBookmarks(modal);
      } catch (e) {
        showToast('Ошибка: ' + e.message, 'error');
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> ' + (t('refreshVideos') || 'Обновить видео');
      }
    });
    container.appendChild(refreshBtn);
  }

  // ---- Модалка хранилища ----
  async function openStorageModal(gameContext = null) {
    const t = (key) => window.I18n?.translate(key) || key;
    const user = getCurrentUser();
    if (!user) { showToast(t('loginToGitHub'), 'error'); return; }
    if (!hasScope('gist')) { showToast(t('needGistScope'), 'error'); return; }

    try {
      await ensureStorage();
    } catch (e) {
      showToast('Ошибка загрузки хранилища: ' + e.message, 'error');
      return;
    }

    const html = `
      <div class="storage-modal-container">
        <div class="storage-header">
          <div class="storage-controls">
            <div class="storage-sort">
              <button class="sort-btn active" data-order="new"><i class="fas fa-arrow-down"></i> ${t('new')}</button>
              <button class="sort-btn" data-order="old"><i class="fas fa-arrow-up"></i> ${t('old')}</button>
            </div>
            <div class="storage-categories">
              <button class="cat-btn active" data-cat="all"><i class="fas fa-globe"></i> ${t('all')}</button>
              <button class="cat-btn" data-cat="post"><i class="fas fa-newspaper"></i> ${t('posts')}</button>
              <button class="cat-btn" data-cat="video"><i class="fas fa-video"></i> ${t('videos')}</button>
              <button class="cat-btn" data-cat="link"><i class="fas fa-link"></i> ${t('links')}</button>
              <button class="cat-btn" data-cat="save"><i class="fas fa-save"></i> ${t('saves')}</button>
            </div>
          </div>
          <div class="storage-actions">
            <button class="storage-btn" id="password-btn" title="Установить пароль на хранилище"><i class="fas fa-lock"></i></button>
            <button class="storage-btn" id="export-btn" title="Экспорт закладок (зашифрованный)"><i class="fas fa-download"></i></button>
            <button class="storage-btn" id="import-btn" title="Импорт закладок (зашифрованный)"><i class="fas fa-upload"></i></button>
            <div class="search-wrapper">
              <input type="text" id="search-input" placeholder="${t('searchPlaceholder')}" class="storage-search">
            </div>
            <button class="storage-btn primary" id="toggle-add-btn"><i class="fas fa-plus"></i> ${t('addButton')}</button>
          </div>
        </div>
        <div id="add-form" class="storage-add-form" style="display:none;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <input type="url" id="new-url" placeholder="${t('addLinkPlaceholder')}" autocomplete="off" class="storage-url-input" style="flex:1; padding:8px 16px; border-radius:40px; background:var(--bg-primary); border:1px solid var(--border); color:var(--text-primary); font-family:var(--font-family); font-size:14px; min-width:150px;">
            <button class="storage-btn primary" id="confirm-add"><i class="fas fa-plus"></i> ${t('addButton')}</button>
          </div>
          <div style="margin-top:12px;border:2px dashed var(--border);border-radius:16px;padding:20px;text-align:center;color:var(--text-secondary);" id="drop-zone">
            <i class="fas fa-file-upload" style="font-size:32px;display:block;margin-bottom:8px;"></i>
            <p>${t('dropZoneText')}</p>
            <input type="file" id="file-input" accept=".ini,.starver" multiple style="display:none;">
            <button class="storage-btn" id="file-select-btn"><i class="fas fa-folder-open"></i> ${t('selectFiles')}</button>
          </div>
        </div>
        <div class="bookmarks-grid" id="bookmarks-grid"></div>
      </div>
    `;

    const { modal, closeModal } = createModal(t('storageModalTitle'), html, { size: 'full' });
    const header = modal.querySelector('.modal-header');
    if (header) {
      const h2 = header.querySelector('h2');
      if (h2) {
        const statusSpan = document.createElement('span');
        statusSpan.id = 'modal-status-mini';
        statusSpan.style.cssText = 'font-size:12px; color:var(--text-secondary); margin-left:16px; opacity:0.7; font-weight:normal;';
        statusSpan.textContent = 'Готово';
        statusElement = statusSpan;
        h2.parentNode.insertBefore(statusSpan, h2.nextSibling);
      }
    }

    window._StorageUI = window._StorageUI || {};
    window._StorageUI.currentModal = modal;

    setStatusCallback(updateStatus);
    window._StorageManager.setRefreshGridCallback(() => renderBookmarks(modal));

    if (!document.getElementById('storage-ui-styles')) {
      const style = document.createElement('style');
      style.id = 'storage-ui-styles';
      style.textContent = `
        .storage-modal-container{display:flex;flex-direction:column;gap:20px}
        .storage-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px}
        .storage-controls{display:flex;gap:15px;flex-wrap:wrap}
        .storage-sort,.storage-categories{display:flex;background:var(--bg-primary);border-radius:40px;padding:4px;border:1px solid var(--border)}
        .sort-btn,.cat-btn{background:0;border:0;color:var(--text-secondary);padding:8px 16px;border-radius:40px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:0.2s;font-family:'Russo One',sans-serif}
        .sort-btn.active,.cat-btn.active{background:var(--accent);color:#fff}
        .storage-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .storage-btn{background:var(--bg-primary);border:1px solid var(--border);color:var(--text-secondary);padding:8px 16px;border-radius:40px;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:0.2s;font-family:'Russo One',sans-serif}
        .storage-btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
        .storage-btn:hover{transform:translateY(-2px);box-shadow:0 5px 15px rgba(0,0,0,0.2)}
        .bookmarks-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}
        .storage-add-form{background:var(--bg-inner-gradient);padding:16px;border-radius:20px;border:1px solid var(--border)}
        .storage-search{padding:6px 14px;border-radius:40px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text-primary);font-family:var(--font-family);font-size:14px;width:160px}
        .storage-search:focus{border-color:var(--accent);outline:none}
        .storage-url-input{flex:1;padding:8px 16px;border-radius:40px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text-primary);font-family:var(--font-family);font-size:14px;min-width:150px}
        .storage-url-input:focus{border-color:var(--accent);outline:none}
        .bookmark-card-wrapper{position:relative;transition:transform 0.2s;height:100%}
        .bookmark-card-wrapper:hover{transform:translateY(-4px)}
        .bookmark-delete-btn{opacity:0;transition:opacity 0.2s;position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.6);border:none;border-radius:50%;width:28px;height:28px;color:#f44336;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;z-index:5}
        .bookmark-card-wrapper:hover .bookmark-delete-btn{opacity:1}
        .bookmark-card{background:var(--bg-inner-gradient);border-radius:20px;border:1px solid var(--border);overflow:hidden;display:flex;flex-direction:column;height:100%}
        .bookmark-media{position:relative;padding-bottom:56.25%;background:var(--bg-primary);border-bottom:1px solid var(--border);flex-shrink:0;overflow:hidden}
        .bookmark-media img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
        .bookmark-media iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none;border-radius:12px 12px 0 0}
        .play-overlay{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.7);border-radius:50%;width:60px;height:60px;display:flex;align-items:center;justify-content:center;color:white;font-size:30px;pointer-events:none}
        .bookmark-icon{display:flex;align-items:center;justify-content:center;font-size:48px;padding:20px 0;background:var(--bg-primary);border-bottom:1px solid var(--border);height:100%}
        .bookmark-content{padding:12px;flex:1;display:flex;flex-direction:column}
        .bookmark-content h4{margin:0 0 4px;font-size:16px;color:var(--text-primary);word-break:break-word}
        .bookmark-content .button.small{padding:4px 12px;font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:30px;cursor:pointer;font-family:var(--font-family);transition:0.2s}
        .bookmark-content .button.small:hover{background:var(--accent-light);transform:translateY(-2px)}
        #modal-status-mini { font-size:12px; color:var(--text-secondary); margin-left:16px; opacity:0.7; font-weight:normal; }
        .record-btn-mini {
          background: rgba(0,0,0,0.6);
          border: none;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          color: #fff;
          font-size: 14px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.5;
          transition: opacity 0.2s, transform 0.2s;
          z-index: 10;
          position: absolute;
          bottom: 8px;
          right: 8px;
        }
        .record-btn-mini:hover {
          opacity: 1;
          transform: scale(1.1);
        }
      `;
      document.head.appendChild(style);
    }

    // Добавляем групповые кнопки
    addBatchActions(modal);

    renderBookmarks(modal);

    // Обработчики сортировки/фильтрации
    modal.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderBookmarks(modal);
      });
    });

    modal.querySelectorAll('.cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderBookmarks(modal);
      });
    });

    const searchInput = modal.querySelector('#search-input');
    searchInput.addEventListener('input', () => renderBookmarks(modal));

    // Добавление закладки (с умным определением типа)
    const addForm = modal.querySelector('#add-form');
    const toggleAddBtn = modal.querySelector('#toggle-add-btn');
    let formVisible = false;
    toggleAddBtn.addEventListener('click', () => {
      formVisible = !formVisible;
      addForm.style.display = formVisible ? 'block' : 'none';
      toggleAddBtn.innerHTML = formVisible ? `<i class="fas fa-times"></i> ${t('cancelButton')}` : `<i class="fas fa-plus"></i> ${t('addButton')}`;
    });

    const urlInput = modal.querySelector('#new-url');
    const confirmAdd = modal.querySelector('#confirm-add');
    confirmAdd.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) { showToast(t('enterText'), 'error'); return; }
      try {
        // Используем умное определение
        const meta = await detectLinkType(url);
        await addBookmark({
          url: meta.cleanedUrl || url,
          title: meta.title || meta.cleanedUrl || url,
          thumbnail: meta.thumbnail || null,
          embedUrl: meta.embedUrl || null,
          type: meta.type || 'link',
          videoData: meta.videoData || null,
          postData: meta.postData || null
        });
        urlInput.value = '';
      } catch (e) {
        if (e.message !== 'duplicate') showToast(e.message, 'error');
      }
    });

    // Drag-and-drop файлов
    const dropZone = modal.querySelector('#drop-zone');
    const fileInput = modal.querySelector('#file-input');
    const fileSelectBtn = modal.querySelector('#file-select-btn');
    fileSelectBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (files.length) await processFiles(files, modal);
      fileInput.value = '';
    });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.style.borderColor = '';
      const files = e.dataTransfer.files;
      if (files.length) await processFiles(files, modal);
    });

    // Пароль
    modal.querySelector('#password-btn').addEventListener('click', async () => {
      const t = (key) => window.I18n?.translate(key) || key;
      const newPass = prompt('Введите новый пароль для хранилища (оставьте пустым, чтобы отключить):\n\nВНИМАНИЕ: пароль становится обязательным для доступа, даже при наличии логина и токена.');
      if (newPass === null) return;
      try {
        await setStoragePassword(newPass || null);
        showToast('Пароль обновлён', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    });

    // Экспорт/импорт (зашифрованный)
    modal.querySelector('#export-btn').addEventListener('click', async () => {
      const t = (key) => window.I18n?.translate(key) || key;
      const password = prompt('Введите пароль для шифрования экспортируемого файла (минимум 4 символа):');
      if (!password || password.length < 4) {
        showToast('Пароль должен быть не менее 4 символов', 'error');
        return;
      }
      try {
        const encrypted = await exportBookmarksData(password);
        const blob = new Blob([JSON.stringify(encrypted)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `neon-bookmarks-${new Date().toISOString().slice(0,10)}.neonbk`;
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('Экспорт выполнен', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    });

    modal.querySelector('#import-btn').addEventListener('click', () => {
      const t = (key) => window.I18n?.translate(key) || key;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.neonbk';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
          try {
            const encrypted = JSON.parse(ev.target.result);
            const password = prompt('Введите пароль для расшифровки импортируемого файла:');
            if (!password) return;
            const added = await importBookmarksData(encrypted, password);
            showToast(`Импортировано ${added} закладок`, 'success');
            renderBookmarks(modal);
          } catch (err) {
            showToast('Ошибка импорта: ' + err.message, 'error');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });

    const closeWithCleanup = () => {
      statusElement = null;
      window._StorageUI.currentModal = null;
      closeModal();
    };
    modal.querySelector('.modal-close').addEventListener('click', closeWithCleanup);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeWithCleanup(); });

    return { modal, closeModal: closeWithCleanup };
  }

  // ---- Экспорт публичного API ----
  window._StorageUI = {
    openStorageModal,
    renderBookmarks,
    createBookmarkCardElement,
    addBookmarkCard,
    removeBookmarkCard,
    processFiles,
    updateStatus,
    refreshBookmarksGrid: () => {
      const modal = window._StorageUI.currentModal;
      if (modal) renderBookmarks(modal);
    },
    currentModal: null,
    updateBookmarkCard: (id, updatedBm) => {
      const modal = window._StorageUI.currentModal;
      if (!modal) return;
      const wrapper = modal.querySelector(`.bookmark-card-wrapper[data-id="${id}"]`);
      if (wrapper) {
        const newWrapper = createBookmarkCardElement(updatedBm, modal);
        wrapper.replaceWith(newWrapper);
        bookmarkElements.set(id, newWrapper);
      }
    },
    // Экспортируем вспомогательные функции для использования в менеджере
    getVideoDownloadUrl,
    recordVideoFromIframe,
    detectLinkType,
    parseVideoFromHtml,
    openVideoModal
  };

  window._StorageManager.setStatusCallback(updateStatus);
  window._StorageManager.setRefreshGridCallback(() => {
    const modal = window._StorageUI.currentModal;
    if (modal) renderBookmarks(modal);
  });
})();