// js/features/ui-feedback.js – полный модуль с кнопками в модалке
(function() {
  const { createElement, escapeHtml, renderMarkdown, loadModule, cacheGet, cacheSet, cacheRemoveByPrefix, extractAllowed, extractSummary, decryptPrivateBody, CONFIG } = window.GithubCore;
  const { getCurrentUser, isAdmin, hasScope, getToken } = window.GithubAuth;
  const { showToast, createModal, saveDraft, loadDraft, clearDraft } = window.UIUtils;

  let reactionsListCache = new Map();
  const CACHE_TTL = 5 * 60 * 1000;

  function canViewPost(body, labels, currentUser) {
    if (!labels || !labels.includes('private')) return true;
    if (isAdmin()) return true;
    const allowed = extractAllowed(body);
    return allowed && allowed.split(',').map(s => s.trim()).includes(currentUser);
  }

  async function renderMarkdownWithEditor(text, targetElement) {
    if (!text) { targetElement.innerHTML = ''; return; }
    try {
      if (window.marked) {
        if (typeof marked.setOptions === 'function') marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
        if (typeof marked.parse === 'function') targetElement.innerHTML = await marked.parse(text);
        else if (typeof marked === 'function') targetElement.innerHTML = marked(text);
        else throw new Error('marked not callable');
      } else {
        targetElement.innerHTML = text.replace(/\n/g, '<br>');
      }
    } catch (e) {
      console.warn('Markdown error:', e);
      targetElement.innerHTML = text.replace(/\n/g, '<br>');
    }
  }

  // ---------- Реакции ----------
  async function renderReactions(container, issueNumber, reactions, currentUser, onAdd, onRemove) {
    if (!container) return;
    const counts = new Map();
    const userReactions = new Set();
    reactions.forEach(r => {
      counts.set(r.content, (counts.get(r.content) || 0) + 1);
      if (r.user && r.user.login === currentUser) userReactions.add(r.content);
    });
    const ordered = ['+1', '-1', 'laugh', 'hooray', 'heart', 'rocket', 'eyes'];
    container.innerHTML = '';
    const btnsDiv = createElement('div', 'reactions-buttons', { display: 'flex', gap: '6px', flexWrap: 'wrap' });
    for (const emoji of ordered) {
      const count = counts.get(emoji) || 0;
      const isActive = userReactions.has(emoji);
      const btn = createElement('button', `reaction-button ${isActive ? 'active' : ''}`, {
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '4px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border)',
        borderRadius: '30px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer'
      });
      btn.innerHTML = `<span class="reaction-emoji">${getReactionEmoji(emoji)}</span><span class="reaction-count">${count || ''}</span>`;
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!currentUser) { showToast('Войдите в GitHub', 'error'); return; }
        try {
          if (isActive) {
            const reactionId = reactions.find(r => r.content === emoji && r.user?.login === currentUser)?.id;
            if (reactionId) await onRemove(issueNumber, reactionId);
          } else {
            await onAdd(issueNumber, emoji);
          }
        } catch (err) { showToast('Ошибка', 'error'); }
      });
      btnsDiv.appendChild(btn);
    }
    container.appendChild(btnsDiv);
  }

  function getReactionEmoji(content) {
    const map = { '+1': '👍', '-1': '👎', 'laugh': '😄', 'hooray': '🎉', 'heart': '❤️', 'rocket': '🚀', 'eyes': '👀' };
    return map[content] || content;
  }

  // ---------- Комментарии ----------
  async function loadComments(issueNumber, container, onUpdate) {
    if (!window.GithubAPI) await loadModule('js/core/github-api.js');
    try {
      const comments = await window.GithubAPI.loadComments(issueNumber);
      container.innerHTML = '';
      if (comments.length === 0) {
        container.innerHTML = '<p class="text-secondary" style="text-align:center;">Нет комментариев</p>';
        return;
      }
      for (const c of comments) {
        const commentDiv = createElement('div', 'comment', { marginBottom: '8px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '16px', position: 'relative' });
        commentDiv.dataset.id = c.id;
        const header = createElement('div', 'comment-meta', { display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' });
        header.innerHTML = `<span class="comment-author">${escapeHtml(c.user.login)}</span><span>${new Date(c.created_at).toLocaleString()}</span>`;
        const body = createElement('div', 'comment-body', { marginTop: '4px' });
        await renderMarkdownWithEditor(c.body, body);
        commentDiv.appendChild(header);
        commentDiv.appendChild(body);
        const currentUser = getCurrentUser();
        if (currentUser === c.user.login || isAdmin()) {
          const actions = createElement('div', 'comment-actions', { position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '4px', opacity: '0', transition: 'opacity 0.2s' });
          const editBtn = createElement('button', '', {}, { title: 'Редактировать' });
          editBtn.innerHTML = '<i class="fas fa-pen"></i>';
          editBtn.addEventListener('click', (e) => { e.stopPropagation(); editComment(c.id, c.body, onUpdate); });
          const delBtn = createElement('button', '', {}, { title: 'Удалить' });
          delBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
          delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteComment(c.id, onUpdate); });
          actions.appendChild(editBtn);
          actions.appendChild(delBtn);
          commentDiv.appendChild(actions);
          commentDiv.addEventListener('mouseenter', () => actions.style.opacity = '1');
          commentDiv.addEventListener('mouseleave', () => actions.style.opacity = '0');
        }
        container.appendChild(commentDiv);
      }
    } catch (err) { console.error(err); container.innerHTML = '<p class="error-message">Ошибка загрузки комментариев</p>'; }
  }

  async function addComment(issueNumber, body, onUpdate) {
    if (!body.trim()) return showToast('Введите текст', 'error');
    try {
      await window.GithubAPI.addComment(issueNumber, body);
      showToast('Комментарий добавлен', 'success');
      onUpdate();
    } catch (err) { showToast('Ошибка', 'error'); }
  }

  async function editComment(commentId, oldBody, onUpdate) {
    const newBody = prompt('Редактировать комментарий', oldBody);
    if (!newBody || newBody === oldBody) return;
    try {
      await window.GithubAPI.updateComment(commentId, newBody);
      showToast('Обновлено', 'success');
      onUpdate();
    } catch (err) { showToast('Ошибка', 'error'); }
  }

  async function deleteComment(commentId, onUpdate) {
    if (!confirm('Удалить комментарий?')) return;
    try {
      await window.GithubAPI.deleteComment(commentId);
      showToast('Удалено', 'success');
      onUpdate();
    } catch (err) { showToast('Ошибка', 'error'); }
  }

  // ---------- Вспомогательные функции для модалки ----------
  async function sharePost(title, url) {
    if (navigator.share) {
      try { await navigator.share({ title, url }); } catch(e) {}
    } else {
      navigator.clipboard.writeText(url);
      showToast('Ссылка скопирована', 'success');
    }
  }

  async function addToBookmarks(postData) {
    if (!window.BookmarkStorage) await loadModule('js/features/storage.js');
    if (!window.BookmarkStorage) return showToast('Хранилище не загружено', 'error');
    try {
      await window.BookmarkStorage.addBookmark({
        url: `${location.origin}${location.pathname}?post=${postData.id}`,
        title: postData.title,
        type: 'post',
        thumbnail: postData.thumbnail || 'images/default-news.webp',
        author: postData.author,
        date: postData.date,
        postData: postData
      });
      showToast('Добавлено в закладки', 'success');
    } catch(e) { showToast('Ошибка: ' + e.message, 'error'); }
  }

  async function editPost(id, currentTitle, currentBody, game, labels) {
    if (!hasScope('repo')) return showToast('Нет прав', 'error');
    const newTitle = prompt('Новый заголовок', currentTitle);
    if (!newTitle) return;
    const newBody = prompt('Новый текст (Markdown)', currentBody);
    if (newBody === null) return;
    try {
      await window.GithubAPI.updateIssue(id, { title: newTitle, body: newBody });
      showToast('Пост обновлён', 'success');
      setTimeout(() => location.reload(), 1000);
    } catch(e) { showToast('Ошибка: ' + e.message, 'error'); }
  }

  async function deletePost(id) {
    if (!hasScope('repo')) return showToast('Нет прав', 'error');
    if (!confirm('Удалить пост? Это действие необратимо.')) return;
    try {
      await window.GithubAPI.closeIssue(id);
      showToast('Пост закрыт (удалён)', 'success');
      setTimeout(() => location.reload(), 1000);
    } catch(e) { showToast('Ошибка: ' + e.message, 'error'); }
  }

  // ---------- Полноэкранная модалка с кнопками ----------
  async function openFullModal(item) {
    const { id, title, body, author, date, game, labels, type } = item;
    const currentUser = getCurrentUser();
    let displayBody = body;
    if (labels && labels.includes('private') && !canViewPost(body, labels, currentUser)) {
      showToast('Нет доступа к приватному посту', 'error');
      return;
    }
    if (labels && labels.includes('private') && canViewPost(body, labels, currentUser)) {
      const allowed = extractAllowed(body);
      if (allowed) displayBody = decryptPrivateBody(body, allowed);
    }
    
    // Формируем кнопки действий в шапке
    const isOwner = author === currentUser;
    const canEdit = isOwner || isAdmin();
    const canDelete = isOwner || isAdmin();
    const canBookmark = currentUser && hasScope('gist');
    
    const actionButtons = `
      <div class="modal-header-actions" style="display: flex; gap: 8px; margin-left: auto; margin-right: 8px;">
        ${canBookmark ? `<button class="action-btn" id="modal-bookmark-btn" title="В закладки"><i class="fas fa-bookmark"></i></button>` : ''}
        <button class="action-btn" id="modal-share-btn" title="Поделиться"><i class="fas fa-share-alt"></i></button>
        ${canEdit ? `<button class="action-btn" id="modal-edit-btn" title="Редактировать"><i class="fas fa-pen"></i></button>` : ''}
        ${canDelete ? `<button class="action-btn" id="modal-delete-btn" title="Удалить"><i class="fas fa-trash-alt"></i></button>` : ''}
      </div>
    `;
    
    const html = `
      <div style="margin-bottom: 16px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <span><i class="fas fa-user"></i> ${escapeHtml(author)}</span>
          <span><i class="fas fa-calendar"></i> ${new Date(date).toLocaleDateString()}</span>
        </div>
        ${game ? `<div><i class="fas fa-gamepad"></i> ${escapeHtml(game)}</div>` : ''}
      </div>
      <div class="markdown-body post-content" style="margin-bottom: 24px;"></div>
      <div class="reactions-container" id="modal-reactions"></div>
      <div class="comments-section">
        <h3>Комментарии</h3>
        <div id="modal-comments-list" class="comments-list"></div>
        ${currentUser ? `<div class="comment-form" style="display:flex; gap:8px; margin-top:16px;">
          <input type="text" id="new-comment-input" placeholder="Ваш комментарий..." style="flex:1; padding:8px 16px; border-radius:40px; background:var(--bg-primary); border:1px solid var(--border);">
          <button id="submit-comment-btn" class="button small">Отправить</button>
        </div>` : '<p class="text-secondary">Войдите, чтобы комментировать</p>'}
      </div>
    `;
    
    const { modal, closeModal } = createModal(title, html, { size: 'full' });
    
    // Вставляем кнопки в заголовок (после h2)
    const headerDiv = modal.querySelector('.modal-header');
    const h2 = headerDiv.querySelector('h2');
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = actionButtons;
    const actionsContainer = tempDiv.firstChild;
    headerDiv.insertBefore(actionsContainer, headerDiv.querySelector('.modal-close'));
    
    // Обработчики кнопок
    const bookmarkBtn = modal.querySelector('#modal-bookmark-btn');
    if (bookmarkBtn) {
      bookmarkBtn.addEventListener('click', () => addToBookmarks({ id, title, author, date, game, labels, thumbnail: null }));
    }
    const shareBtn = modal.querySelector('#modal-share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => sharePost(title, `${location.origin}${location.pathname}?post=${id}`));
    }
    const editBtn = modal.querySelector('#modal-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', () => editPost(id, title, body, game, labels));
    }
    const deleteBtn = modal.querySelector('#modal-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => deletePost(id));
    }
    
    const contentDiv = modal.querySelector('.post-content');
    await renderMarkdownWithEditor(displayBody, contentDiv);
    const reactionsContainer = modal.querySelector('#modal-reactions');
    const commentsContainer = modal.querySelector('#modal-comments-list');
    async function refreshComments() {
      await loadComments(id, commentsContainer, refreshComments);
    }
    if (currentUser && window.GithubAPI) {
      try {
        const reactions = await window.GithubAPI.loadReactions(id);
        renderReactions(reactionsContainer, id, reactions, currentUser,
          async (num, cont) => { await window.GithubAPI.addReaction(num, cont); refreshComments(); },
          async (num, rid) => { await window.GithubAPI.removeReaction(num, rid); refreshComments(); });
      } catch(e) {}
    }
    await refreshComments();
    const submitBtn = modal.querySelector('#submit-comment-btn');
    const commentInput = modal.querySelector('#new-comment-input');
    if (submitBtn && commentInput) {
      submitBtn.addEventListener('click', async () => {
        const text = commentInput.value.trim();
        if (!text) return;
        await addComment(id, text, refreshComments);
        commentInput.value = '';
      });
    }
  }

  // ---------- Редактор поста (модалка) ----------
  async function openEditorModal(mode, initialData, context) {
    if (!hasScope('repo')) {
      showToast('Требуется scope repo', 'error');
      return;
    }
    const { game, title: initTitle, body: initBody } = initialData || {};
    const draftKey = `editor_draft_${context}`;
    const draft = loadDraft(draftKey);
    const savedTitle = draft?.title || initTitle || '';
    const savedBody = draft?.body || initBody || '';

    let currentTitle = savedTitle;
    let currentBody = savedBody;
    let allowedUsers = '';

    const html = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        <input type="text" id="editor-title" placeholder="Заголовок" value="${escapeHtml(currentTitle)}" style="padding:12px; border-radius:40px; background:var(--bg-primary); border:1px solid var(--border);">
        <div class="editor-toolbar" id="editor-toolbar"></div>
        <div class="editor-split">
          <div class="editor-split-left">
            <textarea id="editor-body" placeholder="Текст поста (Markdown)">${escapeHtml(currentBody)}</textarea>
          </div>
          <div class="editor-split-right preview-area" id="preview-area"></div>
        </div>
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <div class="access-switch">
            <button id="access-public" class="access-switch-btn active">Публичный</button>
            <button id="access-private" class="access-switch-btn">Приватный</button>
          </div>
          <input type="text" id="allowed-users" placeholder="Логины через запятую" value="${escapeHtml(allowedUsers)}" style="display:none; flex:1; padding:8px 16px; border-radius:40px; background:var(--bg-primary); border:1px solid var(--border);">
          <button id="editor-submit" class="button wide">Опубликовать</button>
        </div>
      </div>
    `;
    const { modal, closeModal } = createModal(mode === 'new' ? 'Создать пост' : 'Редактировать', html, { size: 'full' });

    const titleInput = modal.querySelector('#editor-title');
    const bodyTextarea = modal.querySelector('#editor-body');
    const preview = modal.querySelector('#preview-area');
    const publicBtn = modal.querySelector('#access-public');
    const privateBtn = modal.querySelector('#access-private');
    const allowedInput = modal.querySelector('#allowed-users');
    const submitBtn = modal.querySelector('#editor-submit');

    if (window.Editor && window.Editor.createEditorToolbar) {
      const toolbar = window.Editor.createEditorToolbar(bodyTextarea);
      const toolbarContainer = modal.querySelector('#editor-toolbar');
      toolbarContainer.innerHTML = '';
      toolbarContainer.appendChild(toolbar);
      const hostBtn = window.Editor.createImageServicesMenu();
      toolbarContainer.appendChild(hostBtn);
    } else {
      await loadModule('js/features/editor.js');
      if (window.Editor) {
        const toolbar = window.Editor.createEditorToolbar(bodyTextarea);
        const toolbarContainer = modal.querySelector('#editor-toolbar');
        toolbarContainer.innerHTML = '';
        toolbarContainer.appendChild(toolbar);
        const hostBtn = window.Editor.createImageServicesMenu();
        toolbarContainer.appendChild(hostBtn);
      }
    }

    function updatePreview() {
      const val = bodyTextarea.value;
      renderMarkdownWithEditor(val, preview);
      saveDraft(draftKey, { title: titleInput.value, body: val });
    }
    bodyTextarea.addEventListener('input', updatePreview);
    titleInput.addEventListener('input', () => saveDraft(draftKey, { title: titleInput.value, body: bodyTextarea.value }));
    updatePreview();

    let privMode = false;
    publicBtn.addEventListener('click', () => {
      privMode = false;
      publicBtn.classList.add('active');
      privateBtn.classList.remove('active');
      allowedInput.style.display = 'none';
    });
    privateBtn.addEventListener('click', () => {
      privMode = true;
      privateBtn.classList.add('active');
      publicBtn.classList.remove('active');
      allowedInput.style.display = 'flex';
    });

    submitBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      const body = bodyTextarea.value;
      if (!title) return showToast('Введите заголовок', 'error');
      let finalBody = body;
      let labels = [`game:${game}`];
      if (context === 'news') labels.push('type:news');
      else if (context === 'update') labels.push('type:update');
      else labels.push(`type:idea`);
      if (privMode) {
        const allowed = allowedInput.value.trim();
        if (!allowed) return showToast('Укажите хотя бы одного пользователя', 'error');
        finalBody = `<!-- allowed: ${allowed} -->\n${window.GithubCore.encryptPrivateBody(body, allowed)}`;
        labels.push('private');
      }
      try {
        await window.GithubAPI.createIssue(title, finalBody, labels);
        showToast('Пост создан', 'success');
        clearDraft(draftKey);
        closeModal();
        window.dispatchEvent(new CustomEvent('github-issue-created', { detail: { title, body: finalBody, labels: labels.map(l=> ({name:l})), user: { login: getCurrentUser() } } }));
      } catch (err) { showToast('Ошибка: ' + err.message, 'error'); }
    });
  }

  window.UIFeedback = {
    renderReactions,
    loadComments,
    addComment,
    editComment,
    deleteComment,
    openFullModal,
    openEditorModal,
    canViewPost,
    invalidateCache: (num) => { cacheRemoveByPrefix(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${num}/reactions`); }
  };
})();