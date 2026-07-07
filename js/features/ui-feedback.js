// js/features/ui-feedback.js
(function() {
  const {
    createElement, escapeHtml, renderMarkdown, loadModule,
    performAction, isActionStillValid, extractAllowed, decryptPrivateBody,
    cacheRemoveByPrefix, CONFIG, getPlainTextLength, containsGitHubToken,
    cacheGet, cacheSet
  } = window.GithubCore;
  const { getCurrentUser, isAdmin, hasScope, getToken } = window.GithubAuth;
  const { showToast, createModal, saveDraft, loadDraft, clearDraft } = window.UIUtils;

  // Кеширование
  const REACTIONS_CACHE_TTL = 5 * 60 * 1000;
  const COMMENTS_CACHE_TTL = 10 * 60 * 1000;
  const COMMENTS_ERROR_COOLDOWN = 5 * 60 * 1000;

  const reactionsCache = new Map();
  const commentsCache = new Map();
  const pendingCommentsRequests = new Map();
  const commentsErrorTimestamps = new Map();

  let reactionsListCache = new Map();
  const CACHE_TTL = 5 * 60 * 1000;

  const LAST_COMMENT_KEY = 'last_comment_time';
  const COMMENT_COOLDOWN = 10000;

  const markdownCache = new Map();

  const MIN_COMMENT_LENGTH = 10;
  const MIN_POST_BODY_LENGTH = 20;
  const MIN_POST_TITLE_LENGTH = 3;

  let currentModalAbortController = null;
  let currentModalLoading = null;

  function canViewPost(body, labels, currentUser) {
    if (!labels || !labels.includes('private')) return true;
    if (isAdmin()) return true;
    const allowed = extractAllowed(body);
    return allowed && allowed.split(',').map(s => s.trim()).includes(currentUser);
  }

  function validateTextContent(text, minLength, fieldName = 'Текст') {
    if (containsGitHubToken(text)) {
      showToast('Обнаружен GitHub-токен в тексте. Пожалуйста, удалите его.', 'error');
      return false;
    }
    const plainLength = getPlainTextLength(text);
    if (plainLength < minLength) {
      showToast(`${fieldName} должен содержать не менее ${minLength} значимых символов (сейчас ${plainLength}).`, 'error');
      return false;
    }
    return true;
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
        const valid = await isActionStillValid('reactions', { issueNumber, content: 'heart' });
        if (!valid) {
          showToast('Вы уже поставили ❤️', 'info');
          return;
        }
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
      const eyesKey = `eyes_${issueNumber}`;
      if (!sessionStorage.getItem(eyesKey)) {
        sessionStorage.setItem(eyesKey, '1');
        isActionStillValid('reactions', { issueNumber, content: 'eyes' }).then(valid => {
          if (valid) {
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
        }).catch(() => {});
      }
    }

    container.appendChild(btnsDiv);
  }

  async function loadComments(issueNumber, container, onUpdate, signal) {
    if (!window.GithubAPI) await loadModule('js/core/github-api.js');

    const lastErrorTime = commentsErrorTimestamps.get(issueNumber);
    if (lastErrorTime && (Date.now() - lastErrorTime < COMMENTS_ERROR_COOLDOWN)) {
      container.innerHTML = '<p class="text-secondary" style="text-align:center;">Комментарии временно недоступны</p>';
      return;
    }

    const cacheKey = `comments_${issueNumber}`;
    const cached = cacheGet(cacheKey, COMMENTS_CACHE_TTL);
    if (cached && !signal?.aborted) {
      renderComments(cached, container);
      return;
    }

    if (pendingCommentsRequests.has(issueNumber)) {
      try {
        const comments = await pendingCommentsRequests.get(issueNumber);
        if (!signal?.aborted) renderComments(comments, container);
      } catch (err) {
        if (err.name === 'AbortError') return;
        commentsErrorTimestamps.set(issueNumber, Date.now());
        container.innerHTML = '<p class="error-message">Ошибка загрузки комментариев</p>';
      }
      return;
    }

    let attempts = 0;
    const maxAttempts = 2;
    const promise = (async () => {
      while (attempts < maxAttempts) {
        try {
          const comments = await window.GithubAPI.loadComments(issueNumber, signal);
          if (signal && signal.aborted) throw new Error('Aborted');
          cacheSet(cacheKey, comments);
          commentsErrorTimestamps.delete(issueNumber);
          return comments;
        } catch (err) {
          attempts++;
          if (err.name === 'AbortError' || err.message === 'Aborted') throw err;
          if (attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000 * attempts));
          } else {
            commentsErrorTimestamps.set(issueNumber, Date.now());
            throw err;
          }
        }
      }
    })();

    pendingCommentsRequests.set(issueNumber, promise);

    try {
      const comments = await promise;
      if (!signal?.aborted) {
        renderComments(comments, container);
      }
    } catch (err) {
      if (err.name === 'AbortError' || err.message === 'Aborted') return;
      container.innerHTML = '<p class="error-message">Ошибка загрузки комментариев</p>';
    } finally {
      setTimeout(() => {
        pendingCommentsRequests.delete(issueNumber);
      }, 100);
    }
  }

  function renderComments(comments, container) {
    container.innerHTML = '';
    if (comments.length === 0) {
      container.innerHTML = '<p class="text-secondary" style="text-align:center;">Нет комментариев</p>';
      return;
    }
    const currentUser = getCurrentUser();
    const fragment = document.createDocumentFragment();
    for (const c of comments) {
      const commentDiv = createElement('div', 'comment', { marginBottom: '8px', padding: '12px', background: 'var(--bg-primary)', borderRadius: '16px', position: 'relative' });
      commentDiv.dataset.id = c.id;
      const header = createElement('div', 'comment-meta', { display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' });
      header.innerHTML = `<span class="comment-author">${escapeHtml(c.user.login)}</span><span>${new Date(c.created_at).toLocaleString()}</span>`;
      const body = createElement('div', 'comment-body', { marginTop: '4px' });
      renderMarkdownWithEditor(c.body, body);
      commentDiv.appendChild(header);
      commentDiv.appendChild(body);
      if (currentUser === c.user.login || isAdmin()) {
        const actions = createElement('div', 'comment-actions', { position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '4px', opacity: '0', transition: 'opacity 0.2s' });
        const editBtn = createElement('button', '', {}, { title: 'Редактировать' });
        editBtn.innerHTML = '<i class="fas fa-pen"></i>';
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); editCommentWithEditor(c.id, c.body, () => { /* обновить после редактирования */ }); });
        const delBtn = createElement('button', '', {}, { title: 'Удалить' });
        delBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteComment(c.id, () => { /* обновить после удаления */ }); });
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        commentDiv.appendChild(actions);
        commentDiv.addEventListener('mouseenter', () => actions.style.opacity = '1');
        commentDiv.addEventListener('mouseleave', () => actions.style.opacity = '0');
      }
      fragment.appendChild(commentDiv);
    }
    container.appendChild(fragment);
  }

  async function editCommentWithEditor(commentId, oldBody, onUpdate) {
    if (!window.Editor) await loadModule('js/features/editor.js');
    const newBody = prompt('Редактировать комментарий (поддерживается Markdown)', oldBody);
    if (!newBody || newBody === oldBody) return;
    if (newBody.length > 400) {
      showToast('Комментарий не может превышать 400 символов', 'error');
      return;
    }
    if (!validateTextContent(newBody, MIN_COMMENT_LENGTH, 'Комментарий')) return;

    try {
      await window.GithubAPI.updateComment(commentId, newBody);
      showToast('Обновлено', 'success');
      if (onUpdate) onUpdate();
    } catch (err) { showToast('Ошибка', 'error'); }
  }

  async function addComment(issueNumber, body, onUpdate) {
    if (!body.trim()) return showToast('Введите текст', 'error');
    if (body.length > 400) {
      showToast('Комментарий не может превышать 400 символов', 'error');
      return;
    }
    if (!validateTextContent(body, MIN_COMMENT_LENGTH, 'Комментарий')) return;

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
        if (onUpdate) onUpdate();
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
      if (onUpdate) onUpdate();
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
    if (!window.BookmarkStorage) {
      try {
        await loadModule('js/features/storage.js');
      } catch (e) {
        showToast('Не удалось загрузить хранилище', 'error');
        return;
      }
    }
    if (!window.BookmarkStorage) {
      showToast('Хранилище не загружено', 'error');
      return;
    }
    const currentUser = getCurrentUser();
    if (!currentUser) {
      showToast('Войдите в GitHub', 'error');
      return;
    }
    if (!hasScope('gist')) {
      showToast('Требуется scope gist', 'error');
      return;
    }
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
        ${currentUser ? `<div class="comment-form" style="display:flex; gap:8px; margin-top:16px; align-items:center; flex-wrap:wrap;">
          <input type="text" id="new-comment-input" placeholder="Ваш комментарий..." style="flex:1; padding:8px 16px; border-radius:40px; background:var(--bg-primary); border:1px solid var(--border); min-width:150px;">
          <button id="submit-comment-btn" class="button small">Отправить</button>
          <span style="font-size:12px; color:var(--text-secondary); margin-left:4px;" id="comment-counter">0/400</span>
          <span class="rate-indicator-wrapper" style="font-size:12px; color:var(--text-secondary); margin-left:8px;">
            Осталось: <span class="rate-indicator" data-action="comments">${window.RateLimits ? window.RateLimits.getRemaining('comments') : '?'}</span>
          </span>
        </div>` : '<p class="text-secondary">Войдите, чтобы комментировать</p>'}
      </div>
    `;

    const { modal, closeModal } = createModal(title, html, { size: 'full' });

    if (currentModalAbortController) {
      currentModalAbortController.abort();
      currentModalAbortController = null;
    }
    currentModalAbortController = new AbortController();
    const abortSignal = currentModalAbortController.signal;

    const originalClose = closeModal;
    const newClose = () => {
      if (currentModalAbortController) {
        currentModalAbortController.abort();
        currentModalAbortController = null;
      }
      currentModalLoading = null;
      originalClose();
    };
    modal.querySelector('.modal-close').removeEventListener('click', closeModal);
    modal.querySelector('.modal-close').addEventListener('click', newClose);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) newClose();
    });

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
      if (abortSignal.aborted) return;
      await loadComments(id, commentsContainer, refreshComments, abortSignal);
    }

    if (currentUser && window.GithubAPI) {
      try {
        if (abortSignal.aborted) return;
        const reactionsCacheKey = `reactions_${id}`;
        let reactions = cacheGet(reactionsCacheKey, REACTIONS_CACHE_TTL);
        if (!reactions) {
          reactions = await window.GithubAPI.loadReactions(id, abortSignal);
          if (!abortSignal.aborted) cacheSet(reactionsCacheKey, reactions);
        }
        if (abortSignal.aborted) return;
        renderReactions(reactionsContainer, id, reactions, currentUser,
          async (num, cont) => { await window.GithubAPI.addReaction(num, cont); },
          async (num, rid) => { await window.GithubAPI.removeReaction(num, rid); }
        );
      } catch(e) {
        if (e.name === 'AbortError') return;
        console.warn('Reactions error:', e);
      }
    }

    await refreshComments();

    const submitBtn = modal.querySelector('#submit-comment-btn');
    const commentInput = modal.querySelector('#new-comment-input');
    const counterEl = modal.querySelector('#comment-counter');
    if (submitBtn && commentInput) {
      if (counterEl) {
        commentInput.addEventListener('input', () => {
          const len = commentInput.value.length;
          counterEl.textContent = `${len}/400`;
          counterEl.style.color = len > 400 ? '#f44336' : 'var(--text-secondary)';
        });
      }
      const debouncedSubmit = window.GithubCore.debounce(async () => {
        const text = commentInput.value.trim();
        if (!text) return;
        if (text.length > 400) {
          showToast('Комментарий не может превышать 400 символов', 'error');
          return;
        }
        await addComment(id, text, refreshComments);
        commentInput.value = '';
        if (counterEl) { counterEl.textContent = '0/400'; counterEl.style.color = 'var(--text-secondary)'; }
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

    const modalContent = document.createElement('div');
    modalContent.className = 'editor-unified';

    const previewArea = createElement('div', 'preview-area unified-preview', {
      padding: '20px',
      background: 'var(--bg-primary)',
      borderRadius: '16px',
      border: '1px solid var(--border)',
      minHeight: '200px',
      marginBottom: '12px',
      overflowY: 'auto'
    });
    await renderMarkdownWithEditor(currentBody, previewArea);

    const controlsRow = createElement('div', 'editor-controls', {
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: '12px'
    });

    const titleInput = createElement('input', 'editor-title-input', {
      flex: '1',
      padding: '10px 16px',
      borderRadius: '40px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-family)',
      minWidth: '150px'
    });
    titleInput.type = 'text';
    titleInput.placeholder = 'Заголовок';
    titleInput.value = currentTitle;

    const titleCounter = createElement('span', 'title-counter', {
      fontSize: '12px',
      color: 'var(--text-secondary)',
      marginLeft: '4px'
    });
    titleCounter.textContent = `${currentTitle.length}/100`;

    // ИСПРАВЛЕНИЕ: добавляем класс 'edit-code-btn' к кнопке
    const editCodeBtn = createElement('button', 'button small edit-code-btn', {
      background: 'var(--bg-inner-gradient)',
      border: '1px solid var(--border)',
      color: 'var(--text-secondary)',
      padding: '6px 14px',
      borderRadius: '30px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontFamily: 'var(--font-family)'
    });
    editCodeBtn.innerHTML = '<i class="fas fa-code"></i> Редактировать код';

    controlsRow.appendChild(titleInput);
    controlsRow.appendChild(titleCounter);
    controlsRow.appendChild(editCodeBtn);

    const accessRow = createElement('div', 'access-row', {
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: '12px'
    });

    const accessSwitch = createElement('div', 'access-switch', {
      display: 'inline-flex',
      background: 'var(--bg-primary)',
      borderRadius: '40px',
      border: '1px solid var(--border)',
      padding: '4px'
    });
    const publicBtn = createElement('button', 'access-switch-btn active', {});
    publicBtn.textContent = 'Публичный';
    const privateBtn = createElement('button', 'access-switch-btn', {});
    privateBtn.textContent = 'Приватный';
    accessSwitch.appendChild(publicBtn);
    accessSwitch.appendChild(privateBtn);

    const allowedInput = createElement('input', 'allowed-users-input', {
      display: 'none',
      flex: '1',
      padding: '8px 16px',
      borderRadius: '40px',
      background: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-family)',
      minWidth: '150px'
    });
    allowedInput.placeholder = 'Логины через запятую';
    allowedInput.value = allowedUsers;

    accessRow.appendChild(accessSwitch);
    accessRow.appendChild(allowedInput);

    const submitRow = createElement('div', 'submit-row', {
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginTop: '8px'
    });

    const submitBtn = createElement('button', 'button wide', {
      background: 'var(--accent)',
      color: '#fff',
      padding: '10px 30px',
      borderRadius: '40px',
      border: 'none',
      cursor: 'pointer',
      fontFamily: 'var(--font-family)'
    });
    submitBtn.textContent = mode === 'edit' ? 'Обновить' : 'Опубликовать';

    const rateIndicator = createElement('span', 'rate-indicator-wrapper', {
      fontSize: '12px',
      color: 'var(--text-secondary)',
      marginLeft: '8px'
    });
    rateIndicator.innerHTML = `Осталось постов: <span class="rate-indicator" data-action="posts">${window.RateLimits ? window.RateLimits.getRemaining('posts') : '?'}</span>`;

    submitRow.appendChild(submitBtn);
    submitRow.appendChild(rateIndicator);

    modalContent.appendChild(previewArea);
    modalContent.appendChild(controlsRow);
    modalContent.appendChild(accessRow);
    modalContent.appendChild(submitRow);

    const { modal, closeModal } = createModal(
      mode === 'new' ? 'Создать пост' : 'Редактировать пост',
      modalContent.outerHTML,
      { size: 'full' }
    );

    const container = modal.querySelector('.editor-unified');
    const preview = container.querySelector('.unified-preview');
    const titleEl = container.querySelector('.editor-title-input');
    const titleCounterEl = container.querySelector('.title-counter');
    // Ищем кнопку с классом edit-code-btn
    const editBtn = container.querySelector('.edit-code-btn');
    const publicBtnEl = container.querySelector('.access-switch-btn.active');
    const privateBtnEl = container.querySelector('.access-switch-btn:not(.active)');
    const allowedInputEl = container.querySelector('.allowed-users-input');
    const submitBtnEl = container.querySelector('.submit-row .button');

    let privMode = false;
    publicBtnEl.addEventListener('click', () => {
      privMode = false;
      publicBtnEl.classList.add('active');
      privateBtnEl.classList.remove('active');
      allowedInputEl.style.display = 'none';
    });
    privateBtnEl.addEventListener('click', () => {
      privMode = true;
      privateBtnEl.classList.add('active');
      publicBtnEl.classList.remove('active');
      allowedInputEl.style.display = 'flex';
    });

    function updatePreviewAndDraft() {
      const title = titleEl.value;
      const body = currentBody;
      renderMarkdownWithEditor(body, preview);
      saveDraft(draftKey, { title, body });
      titleCounterEl.textContent = `${title.length}/100`;
      titleCounterEl.style.color = title.length > 100 ? '#f44336' : 'var(--text-secondary)';
    }

    function openCodeEditor() {
      const codeModalHtml = `
        <div style="display:flex; flex-direction:column; gap:12px; height:100%;">
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <button id="code-toolbar-toggle" class="button small" style="background:var(--bg-inner-gradient);"><i class="fas fa-bars"></i> Тулбар</button>
            <span style="font-size:12px; color:var(--text-secondary); margin-left:auto;" id="code-counter">${currentBody.length}/10000</span>
          </div>
          <div id="code-toolbar-container" style="display:none; margin-bottom:8px;"></div>
          <textarea id="code-editor-textarea" style="flex:1; padding:12px; border-radius:16px; background:var(--bg-primary); border:1px solid var(--border); color:var(--text-primary); font-family:monospace; font-size:14px; resize:vertical; min-height:200px;">${escapeHtml(currentBody)}</textarea>
          <div style="display:flex; gap:12px; justify-content:flex-end; margin-top:8px;">
            <button id="code-cancel" class="button" style="background:var(--bg-inner-gradient); color:var(--text-secondary); border:1px solid var(--border);">Отмена</button>
            <button id="code-apply" class="button" style="background:var(--accent);">Применить</button>
          </div>
        </div>
      `;
      const { modal: codeModal, closeModal: closeCodeModal } = createModal('Редактирование Markdown', codeModalHtml, { size: 'full' });

      const textarea = codeModal.querySelector('#code-editor-textarea');
      const counter = codeModal.querySelector('#code-counter');
      const toolbarContainer = codeModal.querySelector('#code-toolbar-container');
      const toggleBtn = codeModal.querySelector('#code-toolbar-toggle');
      const applyBtn = codeModal.querySelector('#code-apply');
      const cancelBtn = codeModal.querySelector('#code-cancel');

      function updateCounter() {
        const len = textarea.value.length;
        counter.textContent = `${len}/10000`;
        counter.style.color = len > 10000 ? '#f44336' : 'var(--text-secondary)';
      }
      textarea.addEventListener('input', updateCounter);
      updateCounter();

      if (window.Editor) {
        const toolbar = window.Editor.createEditorToolbar(textarea);
        toolbarContainer.appendChild(toolbar);
        const hostBtn = window.Editor.createImageServicesMenu();
        toolbarContainer.appendChild(hostBtn);
      } else {
        loadModule('js/features/editor.js').then(() => {
          if (window.Editor) {
            const toolbar = window.Editor.createEditorToolbar(textarea);
            toolbarContainer.appendChild(toolbar);
            const hostBtn = window.Editor.createImageServicesMenu();
            toolbarContainer.appendChild(hostBtn);
          }
        });
      }

      toggleBtn.addEventListener('click', () => {
        const isHidden = toolbarContainer.style.display === 'none';
        toolbarContainer.style.display = isHidden ? 'flex' : 'none';
        toggleBtn.innerHTML = isHidden ? '<i class="fas fa-times"></i> Скрыть тулбар' : '<i class="fas fa-bars"></i> Тулбар';
      });

      applyBtn.addEventListener('click', () => {
        const newBody = textarea.value;
        if (newBody.length > 10000) {
          showToast('Текст не может превышать 10000 символов', 'error');
          return;
        }
        currentBody = newBody;
        updatePreviewAndDraft();
        closeCodeModal();
      });

      cancelBtn.addEventListener('click', closeCodeModal);
      codeModal.addEventListener('click', (e) => { if (e.target === codeModal) closeCodeModal(); });
    }

    // Безопасно добавляем обработчик, если кнопка существует
    if (editBtn) {
      editBtn.addEventListener('click', openCodeEditor);
    } else {
      console.warn('Кнопка редактирования кода не найдена');
    }

    titleEl.addEventListener('input', () => {
      const val = titleEl.value;
      if (val.length > 100) {
        showToast('Заголовок не должен превышать 100 символов', 'error');
        titleEl.value = val.slice(0, 100);
        return;
      }
      saveDraft(draftKey, { title: val, body: currentBody });
      titleCounterEl.textContent = `${val.length}/100`;
      titleCounterEl.style.color = val.length > 100 ? '#f44336' : 'var(--text-secondary)';
    });

    function updatePreviewFromDraft() {
      const draftData = loadDraft(draftKey);
      if (draftData) {
        if (draftData.title !== undefined) titleEl.value = draftData.title;
        if (draftData.body !== undefined) currentBody = draftData.body;
        renderMarkdownWithEditor(currentBody, preview);
        titleCounterEl.textContent = `${titleEl.value.length}/100`;
      }
    }
    updatePreviewFromDraft();

    const debouncedSubmit = window.GithubCore.debounce(async () => {
      const title = titleEl.value.trim();
      const body = currentBody;

      if (!title) return showToast('Введите заголовок', 'error');
      if (title.length > 100) return showToast('Заголовок не должен превышать 100 символов', 'error');
      if (containsGitHubToken(title)) {
        showToast('Обнаружен GitHub-токен в заголовке. Пожалуйста, удалите его.', 'error');
        return;
      }
      if (getPlainTextLength(title) < MIN_POST_TITLE_LENGTH) {
        showToast(`Заголовок должен содержать не менее ${MIN_POST_TITLE_LENGTH} значимых символов.`, 'error');
        return;
      }

      if (body.length > 10000) return showToast('Текст поста не должен превышать 10000 символов', 'error');
      if (!validateTextContent(body, MIN_POST_BODY_LENGTH, 'Текст поста')) return;

      let finalBody = body;
      let labels = [`game:${game}`];
      if (context === 'news') labels.push('type:news');
      else if (context === 'update') labels.push('type:update');
      else labels.push(`type:idea`);
      if (privMode) {
        const allowed = allowedInputEl.value.trim();
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
    submitBtnEl.addEventListener('click', debouncedSubmit);
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
    addToBookmarks,
    invalidateCache: (num) => { cacheRemoveByPrefix(`gh_api_/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/${num}/reactions`); }
  };
})();