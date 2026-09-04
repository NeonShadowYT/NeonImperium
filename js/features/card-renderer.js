// js/features/card-renderer.js – универсальный рендерер карточек для постов, обновлений, новостей
(function() {
    const { createElement, escapeHtml, renderMarkdown, loadModule } = window.GithubCore || window.Utils;
    const { getCurrentUser, hasScope } = window.GithubAuth || {};
    const { showToast } = window.UIUtils || {};

    /**
     * Создаёт карточку для отображения в сетке (пост, обновление, новость).
     * @param {Object} config
     * @param {string} config.type – 'post', 'update', 'news'
     * @param {string|number} config.id – уникальный идентификатор
     * @param {string} config.title – заголовок
     * @param {string} config.body – тело (Markdown)
     * @param {string} config.author – логин автора
     * @param {Date|string} config.date – дата
     * @param {string} [config.thumbnail] – URL превью
     * @param {string} [config.embedUrl] – URL для встраивания (видео)
     * @param {string} [config.game] – метка игры
     * @param {string[]} [config.labels] – массив меток
     * @param {Function} [config.onClick] – обработчик клика по карточке (переопределяет стандартный)
     * @param {Object} [config.actions] – дополнительные кнопки (например, избранное)
     * @param {boolean} [config.isUpdate] – флаг для стилизации обновлений
     * @param {Object} [config.extraData] – любые дополнительные данные для передачи в обработчики
     * @returns {HTMLElement} – обёртка карточки (project-card-link)
     */
    function createCard(config) {
        const {
            type = 'post',
            id,
            title,
            body,
            author,
            date,
            thumbnail = null,
            embedUrl = null,
            game = null,
            labels = [],
            onClick = null,
            actions = {},
            isUpdate = false,
            extraData = {}
        } = config;

        const t = window.I18n?.translate || (k => k);
        const currentUser = getCurrentUser();

        // Формируем классы и обёртку
        const wrapper = createElement('div', 'project-card-link no-tilt tilt-card', { cursor: 'pointer' });
        wrapper.dataset.id = id;
        wrapper.dataset.type = type;

        const card = createElement('div', 'project-card');
        if (isUpdate) card.classList.add('update-card');

        // ---------- Изображение / медиа ----------
        const imgWrapper = createElement('div', 'image-wrapper');
        if (thumbnail) {
            const img = createElement('img', 'project-image', {}, { src: thumbnail, alt: title, loading: 'lazy' });
            img.onerror = () => { img.src = 'images/default-news.webp'; };
            imgWrapper.appendChild(img);
        } else if (embedUrl) {
            // Если есть embedUrl, показываем iframe (для видео)
            const iframe = createElement('iframe', '', {
                width: '100%',
                height: '100%',
                border: 'none',
                borderRadius: '12px'
            });
            iframe.src = embedUrl;
            iframe.setAttribute('allowfullscreen', 'true');
            iframe.allow = 'autoplay; encrypted-media; gyroscope; picture-in-picture';
            iframe.referrerPolicy = 'strict-origin-when-cross-origin';
            imgWrapper.style.position = 'relative';
            imgWrapper.style.paddingBottom = '56.25%';
            imgWrapper.style.background = '#000';
            iframe.style.position = 'absolute';
            iframe.style.top = '0';
            iframe.style.left = '0';
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            imgWrapper.appendChild(iframe);
        } else {
            // Иконка-заглушка
            const icon = createElement('div', 'bookmark-icon', {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '48px',
                padding: '20px 0',
                background: 'var(--bg-primary)',
                height: '100%'
            });
            const icons = { post: 'fa-newspaper', update: 'fa-clock-rotate-left', news: 'fa-newspaper' };
            icon.innerHTML = `<i class="fas ${icons[type] || 'fa-file-alt'}"></i>`;
            imgWrapper.appendChild(icon);
        }
        card.appendChild(imgWrapper);

        // ---------- Заголовок ----------
        const titleEl = createElement('h3');
        titleEl.textContent = title.length > 70 ? title.slice(0, 70) + '…' : title;
        titleEl.title = title;
        card.appendChild(titleEl);

        // ---------- Мета-информация ----------
        const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
        const dateObj = date instanceof Date ? date : new Date(date);
        const dateStr = dateObj.toLocaleDateString();
        meta.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(author)} · <i class="fas fa-calendar-alt"></i> ${dateStr}`;
        if (game) {
            meta.innerHTML += ` · <i class="fas fa-gamepad"></i> ${escapeHtml(game)}`;
        }
        card.appendChild(meta);

        // ---------- Превью текста ----------
        let summary = '';
        if (body) {
            // Используем extractSummary если доступен
            if (window.GithubCore?.extractSummary) {
                summary = window.GithubCore.extractSummary(body);
            }
            if (!summary) {
                // Очищаем от Markdown и HTML
                const plain = window.Utils?.stripMarkdownAndHtml ? window.Utils.stripMarkdownAndHtml(body) : body;
                summary = plain.replace(/\n/g, ' ').substring(0, 120) + (plain.length > 120 ? '…' : '');
            }
        }
        if (summary) {
            const preview = createElement('p', 'text-secondary', {
                fontSize: '13px',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: '2',
                WebkitBoxOrient: 'vertical'
            });
            preview.textContent = summary;
            card.appendChild(preview);
        }

        // ---------- Дополнительные действия (например, кнопка избранного) ----------
        if (currentUser && hasScope('gist') && (type === 'post' || type === 'news')) {
            const favBtn = createElement('div', 'news-bookmark-btn', {}, { title: t('addToFavorites') });
            favBtn.innerHTML = '<i class="far fa-bookmark"></i>';
            favBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                // Динамическая загрузка хранилища
                if (!window.BookmarkStorage) {
                    try {
                        if (window.loadStorageModules) {
                            await window.loadStorageModules();
                        } else {
                            const modules = [
                                'js/features/storage/core.js',
                                'js/features/storage/metadata.js',
                                'js/features/storage/manager.js',
                                'js/features/storage/ui.js',
                                'js/features/storage/index.js'
                            ];
                            for (const src of modules) {
                                await window.Utils.loadModule(src);
                            }
                        }
                    } catch (err) {
                        showToast(t('loadModulesError'), 'error');
                        return;
                    }
                }
                if (!window.BookmarkStorage) {
                    showToast(t('loadModulesError'), 'error');
                    return;
                }
                const bookmark = {
                    url: `${location.origin}${location.pathname}?post=${id}`,
                    title: title,
                    type: 'post',
                    thumbnail: thumbnail || 'images/default-news.webp',
                    author: author,
                    date: dateObj,
                    postData: { id, title, body, author, date: dateObj.toISOString(), labels, game }
                };
                window.BookmarkStorage.addBookmark(bookmark)
                    .then(() => showToast(t('addToFavorites'), 'success'))
                    .catch(err => { if (err.message !== 'duplicate') showToast(t('loadError') + ': ' + err.message, 'error'); });
            });
            card.appendChild(favBtn);
        }

        // ---------- Обработчик клика ----------
        wrapper.appendChild(card);

        if (typeof onClick === 'function') {
            wrapper.addEventListener('click', onClick);
        } else {
            // Стандартное поведение – открыть пост в модалке
            wrapper.addEventListener('click', async (e) => {
                if (e.target.closest('button') || e.target.closest('.news-bookmark-btn')) return;
                if (!window.UIFeedback) {
                    try { await loadModule('js/features/ui-feedback.js'); } catch {}
                }
                if (window.UIFeedback) {
                    window.UIFeedback.openFullModal({
                        type: type,
                        id: id,
                        title: title,
                        body: body,
                        author: author,
                        date: dateObj,
                        game: game,
                        labels: labels,
                        thumbnail: thumbnail,
                        embedUrl: embedUrl,
                        ...extraData
                    });
                } else {
                    showToast(t('viewerNotAvailable'), 'error');
                }
            });
        }

        return wrapper;
    }

    // ---- Экспорт в глобальную область ----
    window.CardRenderer = { createCard };
})();