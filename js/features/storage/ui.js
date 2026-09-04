// js/features/storage/ui.js
// UI-рендеринг закладок — использует preview.js и download.js через _StorageEnsure
(function() {
  const { escapeHtml, formatDate, loadModule, createElement, debounce } = window.GithubCore || {};
  const { getCurrentUser, hasScope } = window.GithubAuth || {};
  const { showToast, createModal } = window.UIUtils || {};

  let statusElement = null;
  const bookmarkElements = new Map();

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

  // ---- Вспомогательные функции с динамическим получением менеджера ----
  function getManager() {
    if (!window._StorageManager) {
      throw new Error('Storage manager not loaded');
    }
    return window._StorageManager;
  }

  function getPreview() {
    if (!window._StoragePreview) {
      throw new Error('Storage preview not loaded');
    }
    return window._StoragePreview;
  }

  function getDownload() {
    if (!window._StorageDownload) {
      throw new Error('Storage download not loaded');
    }
    return window._StorageDownload;
  }

  // ---- Проверка и обновление downloadUrl в закладке ----
  async function ensureDownloadUrl(bm) {
    await window._StorageEnsure();
    if (!bm || bm.type !== 'video' || !bm.url) return null;
    const manager = getManager();
    const download = getDownload();
    if (bm.downloadUrl && bm.downloadUrlExpires && Date.now() < bm.downloadUrlExpires) {
      return bm.downloadUrl;
    }
    try {
      const url = await download.fetchVideoDownloadUrl(bm.url);
      if (url) {
        const expires = Date.now() + 24 * 60 * 60 * 1000;
        await manager.updateBookmark(bm.id, { downloadUrl: url, downloadUrlExpires: expires });
        return url;
      }
    } catch (e) {
      console.warn('Ошибка получения ссылки:', e);
    }
    return null;
  }

  // ---- Проверка и обновление превью в закладке ----
  async function ensurePreview(bm) {
    await window._StorageEnsure();
    if (!bm || bm.type !== 'video' || !bm.url) return bm;
    const preview = getPreview();
    const manager = getManager();
    if (bm.thumbnail && bm.embedUrl) return bm;
    try {
      const data = await preview.fetchVideoPreview(bm.url);
      if (data && (data.thumbnail || data.embedUrl)) {
        const updates = {};
        if (data.thumbnail && !bm.thumbnail) updates.thumbnail = data.thumbnail;
        if (data.embedUrl && !bm.embedUrl) updates.embedUrl = data.embedUrl;
        if (data.title && !bm.title) updates.title = data.title;
        if (Object.keys(updates).length > 0) {
          await manager.updateBookmark(bm.id, updates);
          return { ...bm, ...updates };
        }
      }
    } catch (e) {
      console.warn('Ошибка получения превью:', e);
    }
    return bm;
  }

  // ---- Загрузка плеера в карточку по клику ----
  function loadVideoPlayerInCard(mediaContainer, bm) {
    if (mediaContainer.querySelector('iframe')) return;

    let embedUrl = bm.embedUrl;
    if (!embedUrl) {
      if (bm.url) {
        const match = bm.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
        if (match) {
          embedUrl = `https://www.youtube-nocookie.com/embed/${match[1]}?rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
        }
      }
    }
    if (!embedUrl) {
      showToast('Не удалось определить ссылку для плеера', 'error');
      return;
    }

    mediaContainer.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.src = embedUrl;
    iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:none;border-radius:12px;';
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.allow = 'autoplay; encrypted-media; gyroscope; picture-in-picture';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    mediaContainer.appendChild(iframe);
    mediaContainer.style.position = 'relative';
    mediaContainer.style.paddingBottom = '56.25%';
    mediaContainer.style.background = '#000';
    const overlay = mediaContainer.querySelector('.play-overlay');
    if (overlay) overlay.remove();
  }

  // ---- Создание DOM-элемента карточки ----
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

    const isVideo = bm.type === 'video' && (bm.embedUrl || bm.url);
    const isPost = bm.type === 'post';
    const isSave = bm.type === 'save';

    if (isVideo) {
      const img = document.createElement('img');
      img.src = bm.thumbnail || 'images/default-news.webp';
      img.alt = bm.title;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      img.onerror = () => { img.src = 'images/default-news.webp'; };
      media.appendChild(img);

      const overlay = document.createElement('div');
      overlay.className = 'play-overlay';
      overlay.innerHTML = '<i class="fas fa-play" style="font-size:30px;color:#fff;"></i>';
      overlay.style.cssText = `
        position: absolute; top: 0; left: 0;
        width: 100%; height: 100%;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.3);
        pointer-events: none;
        transition: background 0.3s;
        border-radius: 12px;
      `;
      media.appendChild(overlay);

      card.addEventListener('mouseenter', () => {
        overlay.style.background = 'rgba(0,0,0,0.5)';
      });
      card.addEventListener('mouseleave', () => {
        overlay.style.background = 'rgba(0,0,0,0.3)';
      });

      card.addEventListener('click', (e) => {
        if (e.target.closest('.bookmark-delete-btn') || e.target.closest('.download-btn')) return;
        if (media.querySelector('iframe')) return;
        loadVideoPlayerInCard(media, bm);
      });

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

    const downloadContainer = document.createElement('div');
    downloadContainer.style.cssText = 'margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;';
    if (isVideo) {
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'button small download-btn';
      downloadBtn.textContent = '⬇ ' + (t('downloadBtn') || 'Скачать');
      downloadBtn.style.cssText = 'background:var(--accent);color:#fff;border:none;padding:4px 12px;border-radius:20px;cursor:pointer;font-size:12px;font-family:var(--font-family);transition:0.2s;';

      const hasValidDownload = bm.downloadUrl && bm.downloadUrlExpires && Date.now() < bm.downloadUrlExpires;
      if (hasValidDownload) {
        downloadBtn.onclick = (e) => {
          e.stopPropagation();
          const a = document.createElement('a');
          a.href = bm.downloadUrl;
          a.download = bm.title + '.mp4';
          a.target = '_blank';
          a.click();
        };
      } else {
        downloadBtn.onclick = async (e) => {
          e.stopPropagation();
          if (downloadBtn.disabled) return;
          downloadBtn.disabled = true;
          downloadBtn.textContent = '⏳ ...';
          try {
            const url = await ensureDownloadUrl(bm);
            if (url) {
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
              }, 3000);
            }
          } catch (err) {
            showToast('Ошибка: ' + err.message, 'error');
            downloadBtn.textContent = '❌ Ошибка';
            setTimeout(() => {
              downloadBtn.textContent = '⬇ ' + (t('downloadBtn') || 'Скачать');
              downloadBtn.disabled = false;
            }, 3000);
          }
        };
      }
      downloadContainer.appendChild(downloadBtn);
    }

    if (isSave && bm.saveData) {
      const saveDownloadBtn = document.createElement('button');
      saveDownloadBtn.className = 'button small';
      saveDownloadBtn.textContent = '⬇ ' + (t('downloadBtn') || 'Скачать');
      saveDownloadBtn.style.cssText = 'background:var(--accent);color:#fff;border:none;padding:4px 12px;border-radius:20px;cursor:pointer;font-size:12px;font-family:var(--font-family);transition:0.2s;';
      saveDownloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
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
      });
      downloadContainer.appendChild(saveDownloadBtn);
    }

    if (downloadContainer.children.length > 0) {
      content.appendChild(downloadContainer);
    }

    card.appendChild(content);

    if (!isVideo) {
      card.addEventListener('click', async (e) => {
        if (e.target.closest('button')) return;

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
    }

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

  // ---- Добавление карточки в сетку ----
  function addBookmarkCard(bm, modal) {
    const grid = modal?.querySelector('#bookmarks-grid');
    if (!grid) return;
    const existing = grid.querySelector(`.bookmark-card-wrapper[data-id="${bm.id}"]`);
    if (existing) existing.remove();
    const wrapper = createBookmarkCardElement(bm, modal);
    grid.prepend(wrapper);
    bookmarkElements.set(bm.id, wrapper);
  }

  // ---- Удаление карточки из сетки ----
  function removeBookmarkCard(id, modal) {
    const grid = modal?.querySelector('#bookmarks-grid');
    if (!grid) return;
    const el = grid.querySelector(`.bookmark-card-wrapper[data-id="${id}"]`);
    if (el) el.remove();
    bookmarkElements.delete(id);
  }

  // ---- Рендеринг закладок ----
  function renderBookmarks(modal) {
    const grid = modal?.querySelector('#bookmarks-grid');
    if (!grid) return;
    const t = (key) => window.I18n?.translate(key) || key;

    const manager = window._StorageManager;
    if (!manager) {
      grid.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Загрузка...</p></div>`;
      return;
    }

    let bookmarks = manager.getBookmarks() || [];
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

    // Фоновое обновление превью для видео без превью
    const videoWithoutPreview = filtered.filter(b => b.type === 'video' && !b.thumbnail);
    if (videoWithoutPreview.length > 0) {
      setTimeout(async () => {
        for (const bm of videoWithoutPreview) {
          const updated = await ensurePreview(bm);
          if (updated && updated.thumbnail) {
            const wrapper = grid.querySelector(`.bookmark-card-wrapper[data-id="${bm.id}"]`);
            if (wrapper) {
              const newWrapper = createBookmarkCardElement(updated, modal);
              wrapper.replaceWith(newWrapper);
              bookmarkElements.set(bm.id, newWrapper);
            }
          }
        }
      }, 1000);
    }
  }

  // ---- Обработка файлов ----
  async function processFiles(files, modal) {
    const t = (key) => window.I18n?.translate(key) || key;
    const manager = getManager();
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
        await manager.addBookmark({
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

  // ---- Групповые действия ----
  function addBatchActions(modal) {
    const t = (key) => window.I18n?.translate(key) || key;
    const container = modal.querySelector('.storage-actions');
    if (!container) return;

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'storage-btn';
    refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> ' + (t('refreshVideos') || 'Обновить видео');
    refreshBtn.title = 'Обновить ссылки на скачивание для всех видео';
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ...';
      try {
        const manager = getManager();
        const result = await manager.batchUpdateVideoLinks();
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
    // Убеждаемся, что все модули хранилища загружены
    if (typeof window._StorageEnsure === 'function') {
      await window._StorageEnsure();
    } else {
      console.warn('[StorageUI] _StorageEnsure не определён, ожидаем...');
      await new Promise(r => setTimeout(r, 500));
      if (typeof window._StorageEnsure !== 'function') {
        showToast('Модули хранилища не загружены', 'error');
        return;
      }
      await window._StorageEnsure();
    }

    const t = (key) => window.I18n?.translate(key) || key;
    const user = getCurrentUser();
    if (!user) { showToast(t('loginToGitHub'), 'error'); return; }
    if (!hasScope('gist')) { showToast(t('needGistScope'), 'error'); return; }

    const manager = getManager();
    try {
      await manager.ensureStorage();
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
            <input type="url" id="new-url" placeholder="${t('addLinkPlaceholder')}" autocomplete="off" class="storage-url-input">
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

    manager.setStatusCallback(updateStatus);
    manager.setRefreshGridCallback(() => renderBookmarks(modal));

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
        .play-overlay{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.3);border-radius:50%;width:60px;height:60px;display:flex;align-items:center;justify-content:center;color:white;font-size:30px;pointer-events:none;transition:background 0.3s}
        .bookmark-icon{display:flex;align-items:center;justify-content:center;font-size:48px;padding:20px 0;background:var(--bg-primary);border-bottom:1px solid var(--border);height:100%}
        .bookmark-content{padding:12px;flex:1;display:flex;flex-direction:column}
        .bookmark-content h4{margin:0 0 4px;font-size:16px;color:var(--text-primary);word-break:break-word}
        .bookmark-content .button.small{padding:4px 12px;font-size:12px;background:var(--accent);color:#fff;border:none;border-radius:30px;cursor:pointer;font-family:var(--font-family);transition:0.2s}
        .bookmark-content .button.small:hover{background:var(--accent-light);transform:translateY(-2px)}
        #modal-status-mini{font-size:12px;color:var(--text-secondary);margin-left:16px;opacity:0.7;font-weight:normal}
      `;
      document.head.appendChild(style);
    }

    addBatchActions(modal);
    renderBookmarks(modal);

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
      await window._StorageEnsure();
      const url = urlInput.value.trim();
      if (!url) { showToast(t('enterText'), 'error'); return; }
      try {
        const preview = getPreview();
        const data = await preview.fetchVideoPreview(url);
        const manager = getManager();
        await manager.addBookmark({
          url: url,
          title: data?.title || url,
          thumbnail: data?.thumbnail || null,
          embedUrl: data?.embedUrl || null,
          type: data?.type === 'video' ? 'video' : 'link',
          videoData: data?.type === 'video' ? { service: 'preview' } : null
        });
        urlInput.value = '';
        showToast('Закладка добавлена', 'success');
      } catch (e) {
        if (e.message !== 'duplicate') showToast(e.message, 'error');
      }
    });

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

    modal.querySelector('#password-btn').addEventListener('click', async () => {
      const newPass = prompt('Введите новый пароль для хранилища (оставьте пустым, чтобы отключить):\n\nВНИМАНИЕ: пароль становится обязательным для доступа, даже при наличии логина и токена.');
      if (newPass === null) return;
      try {
        const manager = getManager();
        await manager.setStoragePassword(newPass || null);
        showToast('Пароль обновлён', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    });

    modal.querySelector('#export-btn').addEventListener('click', async () => {
      const password = prompt('Введите пароль для шифрования экспортируемого файла (минимум 4 символа):');
      if (!password || password.length < 4) {
        showToast('Пароль должен быть не менее 4 символов', 'error');
        return;
      }
      try {
        const manager = getManager();
        const encrypted = await manager.exportBookmarksData(password);
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
            const manager = getManager();
            const added = await manager.importBookmarksData(encrypted, password);
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
    }
  };

  if (window._StorageManager) {
    window._StorageManager.setStatusCallback(updateStatus);
    window._StorageManager.setRefreshGridCallback(() => {
      const modal = window._StorageUI.currentModal;
      if (modal) renderBookmarks(modal);
    });
  }
})();