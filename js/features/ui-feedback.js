// js/features/ui-feedback.js
(function() {
  const {
    createElement, escapeHtml, renderMarkdown, loadModule,
    performAction, isActionStillValid, extractAllowed, decryptPrivateBody,
    cacheRemoveByPrefix, CONFIG
  } = window.GithubCore;
  const { getCurrentUser, isAdmin, hasScope, getToken } = window.GithubAuth;
  const { showToast, createModal, saveDraft, loadDraft, clearDraft } = window.UIUtils;

  let reactionsListCache = new Map();
  const CACHE_TTL = 5 * 60 * 1000;

  const LAST_COMMENT_KEY = 'last_comment_time';
  const COMMENT_COOLDOWN = 10000;

  const markdownCache = new Map();

  function canViewPost(body, labels, currentUser) {
    if (!labels || !labels.includes('private')) return true;
    if (isAdmin()) return true;
    const allowed = extractAllowed(body);
    return allowed && allowed.split(',').map(s => s.trim()).includes(currentUser);
  }

  async function renderMarkdownWithEditor(text, targetElement, cacheKey = null) {
    if (!text) { targetElement.innerHTML = ''; return; }
    if (cacheKey && markdownCache.has(cacheKey)) {
      targetElement.innerHTML = markdownCache.get(cacheKey);
      return;
    }
    try {
      let html;
      if (window.marked) {
        if (typeof marked.setOptions === 'function') marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
        if (typeof marked.parse === 'function') html = await marked.parse(text);
        else if (typeof marked === 'function') html = marked(text);
        else throw new Error('marked not callable');
      } else {
        html = text.replace(/\n/g, '<br>');
      }
      if (cacheKey) markdownCache.set(cacheKey, html);
      targetElement.innerHTML = html;
    } catch (e) {
      console.warn('Markdown error:', e);
      targetElement.innerHTML = text.replace(/\n/g, '<br>');
    }
  }

  function renderReactions(container, issueNumber, reactions, currentUser, onAddHeart, onRemoveHeart) {
    if (!container) return;
    const filtered = reactions.filter(r => r.content === 'heart' || r.content === 'eyes');
    const counts = new Map();
    const userReactions = new Set();
    filtered.forEach(r => {
      counts.set(r.content, (counts.get(r.content) || 0) + 1);
      if (r.user && r.user.login === currentUser) userReactions.add(r.content);
    });

    container.innerHTML = '';
    const btnsDiv = createElement('div', 'reactions-buttons', { display: 'flex', gap: '6px', flexWrap: 'wrap' });

    const heartCount = counts.get('heart') || 0;
    const isHeartActive = userReactions.has('heart');
    const heartBtn = createElement('button', 'reaction-button', {
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '4px 10px',
      borderRadius: '30px',
      fontSize: '13px',
      cursor: isHeartActive ? 'default' : 'pointer',
      border: '1px solid var(--border)',
      background: isHeartActive ? 'var(--accent)' : 'var(--bg-primary)',
      color: isHeartActive ? '#fff' : 'var(--text-secondary)',
      transition: 'background 0.15s, border-color 0.15s, color 0.15s, transform 0.1s',
      opacity: isHeartActive ? '1' : '0.8',
      pointerEvents: isHeartActive ? 'none' : 'auto'
    }, { type: 'button', disabled: isHeartActive });
    heartBtn.innerHTML = `<span class="reaction-emoji">❤️</span><span class="reaction-count">${heartCount || ''}</span>`;

    if (!isHeartActive) {
      heartBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!currentUser) { showToast('Войдите в GitHub', 'error'); return; }
        try {
          const result = await performAction('reactions', { issueNumber, content: 'heart' }, () => window.GithubAPI.addReaction(issueNumber, 'heart'));
          if (result.queued) {
            showToast('❤️ будет добавлена при восстановлении лимитов', 'info');
          } else {
            showToast('❤️ добавлена', 'success');
          }
          heartBtn.disabled = true;
          heartBtn.style.pointerEvents = 'none';
          heartBtn.style.background = 'var(--accent)';
          heartBtn.style.color = '#fff';
          const countSpan = heartBtn.querySelector('.reaction-count');
          if (countSpan) {
            const current = parseInt(countSpan.textContent) || 0;
            countSpan.textContent = current + 1;
          }
          window.GithubAPI.loadReactions(issueNumber).then(newReactions => {
            renderReactions(container, issueNumber, newReactions, currentUser, onAddHeart, onRemoveHeart);
          }).catch(() => {});
        } catch (err) {
          showToast('Ошибка: ' + err.message, 'error');
          heartBtn.disabled = false;
          heartBtn.style.pointerEvents = 'auto';
          heartBtn.style.background = 'var(--bg-primary)';
          heartBtn.style.color = 'var(--text-secondary)';
        }
      });
    } else {
      heartBtn.disabled = true;
    }
    btnsDiv.appendChild(heartBtn);

    const eyesCount = counts.get('eyes') || 0;
    const hasEyes = userReactions.has('eyes');
    const eyesSpan = createElement('span', 'reaction-static', {
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '4px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border)',
      borderRadius: '30px', fontSize: '13px', color: 'var(--text-secondary)'
    });
    eyesSpan.innerHTML = `<span class="reaction-emoji">👀</span><span class="reaction-count">${eyesCount || ''}</span>`;
    btnsDiv.appendChild(eyesSpan);

    if (currentUser && !hasEyes) {
      performAction('reactions', { issueNumber, content: 'eyes' }, () => window.GithubAPI.addReaction(issueNumber, 'eyes'))
        .then(result => {
          if (result.queued) {
            console.log('[👀] Реакция поставлена в очередь');
          } else {
            console.log('[👀] Реакция успешно добавлена');
          }
          const countSpan = eyesSpan.querySelector('.reaction-count');
          if (countSpan) {
            const current = parseInt(countSpan.textContent) || 0;
            countSpan.textContent = current + 1;
          }
          window.GithubAPI.loadReactions(issueNumber).then(newReactions => {
            renderReactions(container, issueNumber, newReactions, currentUser, onAddHeart, onRemoveHeart);
          }).catch(() => {});
        })
        .catch(err => console.warn('Ошибка при добавлении 👀:', err));
    }

    container.appendChild(btnsDiv);
  }

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
          editBtn.addEventListener('click', (e) => { e.stopPropagation(); editCommentWithEditor(c.id, c.body, onUpdate); });
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
    } catch (err) {
      console.error(err);
      container.innerHTML = '<p class="error-message">Ошибка загрузки комментариев</p>';
    }
  }

  async function editCommentWithEditor(commentId, oldBody, onUpdate) {
    if (!window.Editor) await loadModule('js/features/editor.js');
    const newBody = prompt('Редактировать комментарий (поддерживается Markdown)', oldBody);
    if (!newBody || newBody === oldBody) return;
    if (newBody.length > 400) {
      showToast('Комментарий не может превышать 400 символов', 'error');
      return;
    }
    try {
      await window.GithubAPI.updateComment(commentId, newBody);
      showToast('Обновлено', 'success');
      onUpdate();
    } catch (err) { showToast('Ошибка', 'error'); }
  }

  async function addComment(issueNumber, body, onUpdate) {
    if (!body.trim()) return showToast('Введите текст', 'error');
    if (body.length > 400) {
      showToast('Комментарий не может превышать 400 символов', 'error');
      return;
    }
    const currentUser = getCurrentUser();
    if (!currentUser) return showToast('Войдите в GitHub', 'error');

    try {
      const result = await performAction('comments', { issueNumber, body }, () => window.GithubAPI.addComment(issueNumber, body));
      if (result.queued) {
        showToast('Комментарий сохранён в очередь', 'info');
        const container = document.getElementById('modal-comments-list');
        if (container) {
          const commentDiv = createElement('div', 'comment', { marginBottom: '8px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '16px', opacity: '0.6' });
          commentDiv.innerHTML = `
            <div class="comment-meta"><span class="comment-author">${escapeHtml(currentUser)}</span><span>сейчас</span></div>
            <div class="comment-body">${escapeHtml(body)} <span style="font-size:11px; color:var(--text-secondary);">(ожидает синхронизации)</span></div>
          `;
          container.prepend(commentDiv);
        }
      } else {
        showToast('Комментарий добавлен', 'success');
        localStorage.setItem(LAST_COMMENT_KEY, Date.now().toString());
        onUpdate();
      }
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
    }
  }

  async function deleteComment(commentId, onUpdate) {
    if (!confirm('Удалить комментарий?')) return;
    try {
      await window.GithubAPI.deleteComment(commentId);
      showToast('Удалено', 'success');
      onUpdate();
    } catch (err) { showToast('Ошибка', 'error'); }
  }

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
    await openEditorModal('edit', { game, title: currentTitle, body: currentBody }, 'post', id);
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

    const isOwner = author === currentUser;
    const canEdit = isOwner || isAdmin();
    const canDelete = isOwner || isAdmin();
    const canBookmark = currentUser && hasScope('gist');

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
        ${currentUser ? `<div class="comment-form" style="display:flex; gap:8px; margin-top:16px; align-items:center;">
          <input type="text" id="new-comment-input" placeholder="Ваш комментарий..." style="flex:1; padding:8px 16px; border-radius:40px; background:var(--bg-primary); border:1px solid var(--border);">
          <button id="submit-comment-btn" class="button small">Отправить</button>
          <span class="rate-indicator-wrapper" style="font-size:12px; color:var(--text-secondary); margin-left:8px;">
            Осталось: <span class="rate-indicator" data-action="comments">${window.RateLimits ? window.RateLimits.getRemaining('comments') : '?'}</span>
          </span>
        </div>` : '<p class="text-secondary">Войдите, чтобы комментировать</p>'}
      </div>
    `;

    const { modal, closeModal } = createModal(title, html, { size: 'full' });

    const headerDiv = modal.querySelector('.modal-header');
    if (headerDiv) {
      const actionsDiv = createElement('div', 'modal-header-actions', { display: 'flex', gap: '8px', marginLeft: 'auto', marginRight: '8px' });
      if (canBookmark) {
        const bookmarkBtn = createElement('button', 'action-btn', {}, { title: 'В закладки' });
        bookmarkBtn.innerHTML = '<i class="fas fa-bookmark"></i>';
        bookmarkBtn.addEventListener('click', () => addToBookmarks({ id, title, author, date, game, labels, thumbnail: null }));
        actionsDiv.appendChild(bookmarkBtn);
      }
      const shareBtn = createElement('button', 'action-btn', {}, { title: 'Поделиться' });
      shareBtn.innerHTML = '<i class="fas fa-share-alt"></i>';
      shareBtn.addEventListener('click', () => sharePost(title, `${location.origin}${location.pathname}?post=${id}`));
      actionsDiv.appendChild(shareBtn);
      if (canEdit) {
        const editBtn = createElement('button', 'action-btn', {}, { title: 'Редактировать' });
        editBtn.innerHTML = '<i class="fas fa-pen"></i>';
        editBtn.addEventListener('click', () => editPost(id, title, body, game, labels));
        actionsDiv.appendChild(editBtn);
      }
      if (canDelete) {
        const deleteBtn = createElement('button', 'action-btn', {}, { title: 'Удалить' });
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        deleteBtn.addEventListener('click', () => deletePost(id));
        actionsDiv.appendChild(deleteBtn);
      }
      const closeBtn = headerDiv.querySelector('.modal-close');
      headerDiv.insertBefore(actionsDiv, closeBtn);
    }

    const contentDiv = modal.querySelector('.post-content');
    const cacheKey = `post_${id}_${currentUser || 'anon'}`;
    await renderMarkdownWithEditor(displayBody, contentDiv, cacheKey);

    const reactionsContainer = modal.querySelector('#modal-reactions');
    const commentsContainer = modal.querySelector('#modal-comments-list');
    async function refreshComments() {
      await loadComments(id, commentsContainer, refreshComments);
    }
    if (currentUser && window.GithubAPI) {
      try {
        let reactions = await window.GithubAPI.loadReactions(id);
        renderReactions(reactionsContainer, id, reactions, currentUser,
          async (num, cont) => { await window.GithubAPI.addReaction(num, cont); },
          async (num, rid) => { await window.GithubAPI.removeReaction(num, rid); }
        );
      } catch(e) { console.warn('Reactions error:', e); }
    }
    await refreshComments();
    const submitBtn = modal.querySelector('#submit-comment-btn');
    const commentInput = modal.querySelector('#new-comment-input');
    if (submitBtn && commentInput) {
      const debouncedSubmit = window.GithubCore.debounce(async () => {
        const text = commentInput.value.trim();
        if (!text) return;
        await addComment(id, text, refreshComments);
        commentInput.value = '';
        const indicator = modal.querySelector('.rate-indicator[data-action="comments"]');
        if (indicator && window.RateLimits) indicator.textContent = window.RateLimits.getRemaining('comments');
      }, 1000);
      submitBtn.addEventListener('click', debouncedSubmit);
    }
  }

  async function openEditorModal(mode, initialData, context, existingId = null) {
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
          <button id="editor-submit" class="button wide">${mode === 'edit' ? 'Обновить' : 'Опубликовать'}</button>
          <span class="rate-indicator-wrapper" style="font-size:12px; color:var(--text-secondary); margin-left:8px;">
            Осталось постов: <span class="rate-indicator" data-action="posts">${window.RateLimits ? window.RateLimits.getRemaining('posts') : '?'}</span>
          </span>
        </div>
      </div>
    `;
    const { modal, closeModal } = createModal(mode === 'new' ? 'Создать пост' : 'Редактировать пост', html, { size: 'full' });

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

    const debouncedSubmit = window.GithubCore.debounce(async () => {
      const title = titleInput.value.trim();
      const body = bodyTextarea.value;
      if (!title) return showToast('Введите заголовок', 'error');
      if (title.length > 100) return showToast('Заголовок не должен превышать 100 символов', 'error');
      if (body.length > 10000) return showToast('Текст поста не должен превышать 10000 символов', 'error');

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

      const actionPayload = mode === 'edit' ? { mode: 'edit', id: existingId, title, body: finalBody } : { title, body: finalBody, labels };
      try {
        const result = await performAction('posts', actionPayload, () => {
          if (mode === 'edit' && existingId) {
            return window.GithubAPI.updateIssue(existingId, { title, body: finalBody });
          } else {
            return window.GithubAPI.createIssue(title, finalBody, labels);
          }
        });
        if (result.queued) {
          showToast('Пост сохранён в очередь', 'info');
        } else {
          showToast(mode === 'edit' ? 'Пост обновлён' : 'Пост создан', 'success');
        }
        clearDraft(draftKey);
        closeModal();
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        showToast('Ошибка: ' + err.message, 'error');
      }
    }, 1000);
    submitBtn.addEventListener('click', debouncedSubmit);
  }

  window.UIFeedback = {
    renderReactions,
    loadComments,
    addComment,
    editComment: editCommentWithEditor,
    deleteComment,
    openFullModal,
    openEditorModal,
    canViewPost,
    invalidateCache: (num) => { cacheRemoveByPrefix(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${num}/reactions`); }
  };
})();