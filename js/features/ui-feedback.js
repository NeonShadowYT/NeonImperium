// js/features/ui-feedback.js – с локализацией, обновление при смене языка
(function() {
  const {
    createElement, escapeHtml, renderMarkdown, loadModule,
    performAction, isActionStillValid, extractAllowed, decryptPrivateBody,
    cacheRemoveByPrefix, CONFIG, getPlainTextLength, containsGitHubToken,
    cacheGet, cacheSet
  } = window.GithubCore;
  const { getCurrentUser, isAdmin, hasScope, getToken } = window.GithubAuth;
  const { showToast, createModal, saveDraft, loadDraft, clearDraft } = window.UIUtils;

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

  const t = window.I18n?.translate || (k => k);

  // ---- вспомогательные функции ----

  function canViewPost(body, labels, currentUser) {
    if (!labels || !labels.includes('private')) return true;
    if (isAdmin()) return true;
    const allowed = extractAllowed(body);
    return allowed && allowed.split(',').map(s => s.trim()).includes(currentUser);
  }

  function validateTextContent(text, minLength, fieldName = 'Текст') {
    if (containsGitHubToken(text)) {
      showToast(t('githubTokenDetected'), 'error');
      return false;
    }
    const plainLength = getPlainTextLength(text);
    if (plainLength < minLength) {
      showToast(`${fieldName} ${t('commentTooShort')}`, 'error');
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
        if (!currentUser) { showToast(t('loginToGitHub'), 'error'); return; }
        const valid = await isActionStillValid('reactions', { issueNumber, content: 'heart' });
        if (!valid) {
          showToast(t('alreadyHearted'), 'info');
          return;
        }
        try {
          const result = await performAction('reactions', { issueNumber, content: 'heart' }, () => window.GithubAPI.addReaction(issueNumber, 'heart'));
          if (result.queued) {
            showToast(t('heartQueued'), 'info');
          } else {
            showToast(t('heartAdded'), 'success');
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
          showToast(t('loadError') + ': ' + err.message, 'error');
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
      container.innerHTML = `<p class="text-secondary" style="text-align:center;">${t('noComments') || 'Нет комментариев'}</p>`;
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
        const editBtn = createElement('button', '', {}, { title: t('edit') });
        editBtn.innerHTML = '<i class="fas fa-pen"></i>';
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); editCommentWithEditor(c.id, c.body, () => { /* обновить после редактирования */ }); });
        const delBtn = createElement('button', '', {}, { title: t('delete') });
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
    const newBody = prompt(t('edit'), oldBody);
    if (!newBody || newBody === oldBody) return;
    if (newBody.length > 400) {
      showToast(t('commentTooLong'), 'error');
      return;
    }
    if (!validateTextContent(newBody, MIN_COMMENT_LENGTH, t('comment'))) return;

    try {
      await window.GithubAPI.updateComment(commentId, newBody);
      showToast(t('updated'), 'success');
      if (onUpdate) onUpdate();
    } catch (err) { showToast(t('loadError'), 'error'); }
  }

  async function addComment(issueNumber, body, onUpdate) {
    if (!body.trim()) return showToast(t('enterText'), 'error');
    if (body.length > 400) {
      showToast(t('commentTooLong'), 'error');
      return;
    }
    if (!validateTextContent(body, MIN_COMMENT_LENGTH, t('comment'))) return;

    const currentUser = getCurrentUser();
    if (!currentUser) return showToast(t('loginToGitHub'), 'error');

    try {
      const result = await performAction('comments', { issueNumber, body }, () => window.GithubAPI.addComment(issueNumber, body));
      if (result.queued) {
        showToast(t('commentQueued'), 'info');
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
        showToast(t('commentAdded'), 'success');
        localStorage.setItem(LAST_COMMENT_KEY, Date.now().toString());
        if (onUpdate) onUpdate();
      }
    } catch (err) {
      showToast(t('loadError') + ': ' + err.message, 'error');
    }
  }

  async function deleteComment(commentId, onUpdate) {
    if (!confirm(t('deletePostConfirm'))) return;
    try {
      await window.GithubAPI.deleteComment(commentId);
      showToast(t('deleted'), 'success');
      if (onUpdate) onUpdate();
    } catch (err) { showToast(t('loadError'), 'error'); }
  }

  async function sharePost(title, url) {
    if (navigator.share) {
      try { await navigator.share({ title, url }); } catch(e) {}
    } else {
      navigator.clipboard.writeText(url);
      showToast(t('share') + ' ' + t('updated'), 'success');
    }
  }

  async function addToBookmarks(postData) {
    if (!window.BookmarkStorage) {
      try {
        await loadModule('js/features/storage.js');
      } catch (e) {
        showToast(t('loadModulesError'), 'error');
        return;
      }
    }
    if (!window.BookmarkStorage) {
      showToast(t('loadModulesError'), 'error');
      return;
    }
    const currentUser = getCurrentUser();
    if (!currentUser) {
      showToast(t('loginToGitHub'), 'error');
      return;
    }
    if (!hasScope('gist')) {
      showToast(t('needGistScope'), 'error');
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
      showToast(t('addToFavorites'), 'success');
    } catch(e) { showToast(t('loadError') + ': ' + e.message, 'error'); }
  }

  async function editPost(id, currentTitle, currentBody, game, labels) {
    if (!hasScope('repo')) return showToast(t('noPermission'), 'error');
    await openEditorModal('edit', { game, title: currentTitle, body: currentBody }, 'post', id);
  }

  async function deletePost(id) {
    if (!hasScope('repo')) return showToast(t('noPermission'), 'error');
    if (!confirm(t('deletePostConfirm'))) return;
    try {
      await window.GithubAPI.closeIssue(id);
      showToast(t('postDeleted'), 'success');
      setTimeout(() => location.reload(), 1000);
    } catch(e) { showToast(t('loadError') + ': ' + e.message, 'error'); }
  }

  // ---- открытие полной модалки (пост) ----

  let activeFullModal = null; // ссылка на текущую модалку

  async function openFullModal(item) {
    const { id, title, body, author, date, game, labels, type } = item;
    const currentUser = getCurrentUser();
    let displayBody = body;
    if (labels && labels.includes('private') && !canViewPost(body, labels, currentUser)) {
      showToast(t('noAccess'), 'error');
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
        <h3>${t('comments') || 'Комментарии'}</h3>
        <div id="modal-comments-list" class="comments-list"></div>
        ${currentUser ? `<div class="comment-form" style="display:flex; gap:8px; margin-top:16px; align-items:center; flex-wrap:wrap;">
          <input type="text" id="new-comment-input" placeholder="${t('enterText')}" class="comment-input-field" style="flex:1; padding:8px 16px; border-radius:40px; background:var(--bg-primary); border:1px solid var(--border); min-width:150px;">
          <button id="submit-comment-btn" class="button small">${t('send')}</button>
          <span style="font-size:12px; color:var(--text-secondary); margin-left:4px;" id="comment-counter">0/400</span>
          <span class="rate-indicator-wrapper" style="font-size:12px; color:var(--text-secondary); margin-left:8px;">
            ${t('postsRemaining')}: <span class="rate-indicator" data-action="comments">${window.RateLimits ? window.RateLimits.getRemaining('comments') : '?'}</span>
          </span>
        </div>` : `<p class="text-secondary">${t('loginToComment')}</p>`}
      </div>
    `;

    const { modal, closeModal } = createModal(title, html, { size: 'full' });
    activeFullModal = { modal, closeModal, item };

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
      activeFullModal = null;
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
        const bookmarkBtn = createElement('button', 'action-btn', {}, { title: t('bookmark') });
        bookmarkBtn.innerHTML = '<i class="fas fa-bookmark"></i>';
        bookmarkBtn.addEventListener('click', () => addToBookmarks({ id, title, author, date, game, labels, thumbnail: null }));
        actionsDiv.appendChild(bookmarkBtn);
      }
      const shareBtn = createElement('button', 'action-btn', {}, { title: t('share') });
      shareBtn.innerHTML = '<i class="fas fa-share-alt"></i>';
      shareBtn.addEventListener('click', () => sharePost(title, `${location.origin}${location.pathname}?post=${id}`));
      actionsDiv.appendChild(shareBtn);
      if (canEdit) {
        const editBtn = createElement('button', 'action-btn', {}, { title: t('edit') });
        editBtn.innerHTML = '<i class="fas fa-pen"></i>';
        editBtn.addEventListener('click', () => editPost(id, title, body, game, labels));
        actionsDiv.appendChild(editBtn);
      }
      if (canDelete) {
        const deleteBtn = createElement('button', 'action-btn', {}, { title: t('delete') });
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
          showToast(t('commentTooLong'), 'error');
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

    // ---- обновление при смене языка (без перерисовки) ----
    const langHandler = () => {
      if (!activeFullModal || activeFullModal.modal !== modal) return;
      const t = window.I18n?.translate || (k => k);
      // Заголовок
      const headerTitle = modal.querySelector('.modal-header h2');
      if (headerTitle) headerTitle.textContent = title; // title не переводится, это название поста
      // Заголовок раздела комментариев
      const commentsHeader = modal.querySelector('.comments-section h3');
      if (commentsHeader) commentsHeader.textContent = t('comments') || 'Комментарии';
      // Поле ввода
      const inputField = modal.querySelector('#new-comment-input');
      if (inputField) inputField.placeholder = t('enterText');
      // Кнопка отправки
      const sendBtn = modal.querySelector('#submit-comment-btn');
      if (sendBtn) sendBtn.textContent = t('send');
      // Индикатор лимитов
      const indicator = modal.querySelector('.rate-indicator-wrapper');
      if (indicator) {
        const span = indicator.querySelector('.rate-indicator');
        if (span && window.RateLimits) span.textContent = window.RateLimits.getRemaining('comments');
      }
    };
    window.addEventListener('languageChanged', langHandler);
    const closeWithCleanup = () => {
      window.removeEventListener('languageChanged', langHandler);
      newClose();
    };
    modal.querySelector('.modal-close').removeEventListener('click', newClose);
    modal.querySelector('.modal-close').addEventListener('click', closeWithCleanup);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeWithCleanup();
    });
  }

  // ---- редактор (создание/редактирование поста) ----

  let activeEditorModal = null;

  async function openEditorModal(mode, initialData, context, existingId = null) {
    if (!hasScope('repo')) {
      showToast(t('noPermission'), 'error');
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

    const { modal, closeModal } = createModal(
      mode === 'new' ? t('createPost') : t('editPost'),
      '<div class="editor-container"></div>',
      { size: 'full' }
    );
    activeEditorModal = { modal, closeModal, mode, context, existingId };

    const container = modal.querySelector('.editor-container');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '12px';

    const titleRow = createElement('div', 'editor-title-row', {
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      flexWrap: 'wrap'
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
    titleInput.placeholder = t('title');
    titleInput.value = currentTitle;
    const titleCounter = createElement('span', 'title-counter', {
      fontSize: '12px',
      color: 'var(--text-secondary)',
      marginLeft: '4px'
    });
    titleCounter.textContent = `${currentTitle.length}/100`;
    titleRow.appendChild(titleInput);
    titleRow.appendChild(titleCounter);
    container.appendChild(titleRow);

    const accessRow = createElement('div', 'access-row', {
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: '4px'
    });
    const accessSwitch = createElement('div', 'access-switch', {
      display: 'inline-flex',
      background: 'var(--bg-primary)',
      borderRadius: '40px',
      border: '1px solid var(--border)',
      padding: '4px'
    });
    const publicBtn = createElement('button', 'access-switch-btn active', {});
    publicBtn.textContent = t('public');
    const privateBtn = createElement('button', 'access-switch-btn', {});
    privateBtn.textContent = t('private');
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
    allowedInput.placeholder = t('loginsComma');
    allowedInput.value = allowedUsers;
    accessRow.appendChild(accessSwitch);
    accessRow.appendChild(allowedInput);
    container.appendChild(accessRow);

    const textarea = createElement('textarea', 'editor-textarea', {
      width: '100%',
      height: '100%',
      resize: 'vertical',
      border: 'none',
      background: 'transparent',
      color: 'var(--text-primary)',
      fontFamily: 'monospace',
      fontSize: '14px',
      lineHeight: '1.5',
      padding: '12px',
      boxSizing: 'border-box',
      outline: 'none'
    });
    textarea.value = currentBody;

    const preview = createElement('div', 'editor-preview markdown-body', {
      padding: '16px',
      wordWrap: 'break-word',
      overflowY: 'auto',
      height: '100%',
      boxSizing: 'border-box'
    });
    await renderMarkdownWithEditor(currentBody, preview);

    const splitContainer = createElement('div', 'editor-split', {
      display: 'flex',
      gap: '16px',
      alignItems: 'stretch',
      flex: '1',
      minHeight: '300px',
      marginTop: '4px'
    });
    const leftCol = createElement('div', 'editor-split-left', {
      flex: '1',
      display: 'flex',
      flexDirection: 'column',
      borderRadius: '16px',
      border: '1px solid var(--border)',
      background: 'var(--bg-primary)',
      overflow: 'hidden'
    });
    leftCol.appendChild(textarea);
    const rightCol = createElement('div', 'editor-split-right', {
      flex: '1',
      borderRadius: '16px',
      border: '1px solid var(--border)',
      background: 'var(--bg-primary)',
      overflow: 'auto',
      padding: '0'
    });
    rightCol.appendChild(preview);
    splitContainer.appendChild(leftCol);
    splitContainer.appendChild(rightCol);

    let toolbar = null;
    if (window.Editor) {
      toolbar = window.Editor.createEditorToolbar(textarea);
    } else {
      await loadModule('js/features/editor.js');
      if (window.Editor) {
        toolbar = window.Editor.createEditorToolbar(textarea);
      }
    }
    if (toolbar) {
      const hostBtn = window.Editor.createImageServicesMenu ? window.Editor.createImageServicesMenu() : null;
      if (hostBtn) {
        toolbar.appendChild(hostBtn);
      }
      container.appendChild(toolbar);
    }
    container.appendChild(splitContainer);

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
    submitBtn.textContent = mode === 'edit' ? t('update') : t('publish');
    const rateIndicator = createElement('span', 'rate-indicator-wrapper', {
      fontSize: '12px',
      color: 'var(--text-secondary)',
      marginLeft: '8px'
    });
    rateIndicator.innerHTML = `${t('postsRemaining')}: <span class="rate-indicator" data-action="posts">${window.RateLimits ? window.RateLimits.getRemaining('posts') : '?'}</span>`;
    submitRow.appendChild(submitBtn);
    submitRow.appendChild(rateIndicator);
    container.appendChild(submitRow);

    textarea.addEventListener('input', async () => {
      currentBody = textarea.value;
      await renderMarkdownWithEditor(currentBody, preview);
      saveDraft(draftKey, { title: titleInput.value, body: currentBody });
    });

    titleInput.addEventListener('input', () => {
      const val = titleInput.value;
      if (val.length > 100) {
        showToast(t('title') + ' ' + t('commentTooLong'), 'error');
        titleInput.value = val.slice(0, 100);
        return;
      }
      currentTitle = titleInput.value;
      titleCounter.textContent = `${currentTitle.length}/100`;
      titleCounter.style.color = currentTitle.length > 100 ? '#f44336' : 'var(--text-secondary)';
      saveDraft(draftKey, { title: currentTitle, body: currentBody });
    });

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
      const body = currentBody;

      if (!title) return showToast(t('enterTitle'), 'error');
      if (title.length > 100) return showToast(t('title') + ' ' + t('commentTooLong'), 'error');
      if (containsGitHubToken(title)) {
        showToast(t('githubTokenDetected'), 'error');
        return;
      }
      if (getPlainTextLength(title) < MIN_POST_TITLE_LENGTH) {
        showToast(`${t('title')} ${t('commentTooShort')}`, 'error');
        return;
      }

      if (body.length > 10000) return showToast(t('postTooLong'), 'error');
      if (!validateTextContent(body, MIN_POST_BODY_LENGTH, t('postBody'))) return;

      let finalBody = body;
      let labels = [`game:${game}`];
      if (context === 'news') labels.push('type:news');
      else if (context === 'update') labels.push('type:update');
      else labels.push('type:idea');
      if (privMode) {
        const allowed = allowedInput.value.trim();
        if (!allowed) return showToast(t('specifyUser'), 'error');
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
          showToast(t('postQueued'), 'info');
        } else {
          showToast(mode === 'edit' ? t('postUpdated') : t('postCreated'), 'success');
        }
        clearDraft(draftKey);
        closeModal();
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        showToast(t('loadError') + ': ' + err.message, 'error');
      }
    }, 1000);
    submitBtn.addEventListener('click', debouncedSubmit);

    if (draft && draft.body !== undefined) {
      await renderMarkdownWithEditor(draft.body, preview);
      textarea.value = draft.body;
      currentBody = draft.body;
    }

    // ---- обновление при смене языка (без перерисовки) ----
    const langHandler = () => {
      if (!activeEditorModal || activeEditorModal.modal !== modal) return;
      const t = window.I18n?.translate || (k => k);
      const headerTitle = modal.querySelector('.modal-header h2');
      if (headerTitle) headerTitle.textContent = mode === 'new' ? t('createPost') : t('editPost');
      titleInput.placeholder = t('title');
      publicBtn.textContent = t('public');
      privateBtn.textContent = t('private');
      allowedInput.placeholder = t('loginsComma');
      submitBtn.textContent = mode === 'edit' ? t('update') : t('publish');
      const indicator = modal.querySelector('.rate-indicator-wrapper');
      if (indicator) {
        const span = indicator.querySelector('.rate-indicator');
        if (span && window.RateLimits) span.textContent = window.RateLimits.getRemaining('posts');
      }
    };
    window.addEventListener('languageChanged', langHandler);
    const closeWithCleanup = () => {
      window.removeEventListener('languageChanged', langHandler);
      activeEditorModal = null;
      closeModal();
    };
    modal.querySelector('.modal-close').removeEventListener('click', closeModal);
    modal.querySelector('.modal-close').addEventListener('click', closeWithCleanup);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeWithCleanup();
    });
  }

  // ---- экспорт ----
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