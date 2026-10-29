// js/pages/game-updates.js
// Обновления. YouTube — только видео с "starve"/"neon" в названии (кроме Shorts).
// itch.io — единый кеш с news-feed.

(function() {
    'use strict';

    const {
        cacheGet, cacheSet, cacheRemoveByPrefix, escapeHtml, CONFIG,
        createAbortable, stripHtml, extractSummary, loadModule,
        createElement, sanitizeHtml
    } = window.GithubCore;
    const { loadIssues } = window.GithubAPI;
    const { isAdmin, hasScope } = window.GithubAuth;
    const { showToast } = window.UIUtils;

    let currentAbort = null;
    let currentGame = null;
    let backgroundRefreshInFlight = false;

    const ITCH_CACHE_KEY = 'unified_itch_posts_v3';
    const YT_CACHE_KEY = 'unified_yt_videos_v3';

    function t(key) {
        if (window.I18n && typeof window.I18n.translate === 'function') {
            const v = window.I18n.translate(key);
            if (v && v !== key) return v;
        }
        const map = {
            loading: 'Загрузка...', noUpdates: 'Нет обновлений',
            updatesTitle: 'Обновления', addUpdate: 'Добавить обновление',
            updatesLoadError: 'Ошибка загрузки обновлений', readMore: 'Читать далее',
            watch: 'Смотреть'
        };
        return map[key] || key;
    }

    function isAborted(err, signal) {
        if (!err) return false;
        if (signal && signal.aborted) return true;
        if (err.name === 'AbortError') return true;
        return String(err.message || '').includes('Aborted');
    }

    function normalizeDate(d) {
        if (d instanceof Date && !isNaN(d.getTime())) return d;
        const nd = new Date(d);
        return isNaN(nd.getTime()) ? new Date() : nd;
    }

    function normalizePost(p) {
        return { ...p, date: normalizeDate(p.date) };
    }

    function readCache(key, ttl) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !data.timestamp || !Array.isArray(data.items)) return null;
            if (data.items.length === 0) return null;
            if (Date.now() - data.timestamp > ttl) {
                localStorage.removeItem(key);
                return null;
            }
            return data.items.map(normalizePost);
        } catch { return null; }
    }

    // ---------- GitHub Updates ----------

    async function fetchGithubUpdates(game, signal, forceRefresh = false) {
        const cacheKey = `game_issues_${game}`;
        let issues = null;
        if (!forceRefresh) issues = await cacheGet(cacheKey);
        if (!issues || !issues.length) {
            issues = await loadIssues({ labels: `game:${game}`, state: 'open', per_page: 100, signal });
            if (issues && issues.length > 0) await cacheSet(cacheKey, issues);
        }
        return issues.filter(i =>
            i.labels.some(l => l.name === 'type:update') &&
            CONFIG.ALLOWED_AUTHORS.includes(i.user.login)
        ).map(i => normalizePost({
            type: 'gh-update',
            number: i.number,
            id: `gh-${i.number}`,
            title: i.title,
            body: i.body,
            date: new Date(i.created_at),
            author: i.user.login,
            game,
            labels: i.labels.map(l => l.name),
            thumbnail: null
        }));
    }

    // ---------- Агрегация ----------

    async function fetchAllUpdates(game, signal, forceRefresh = false, onItem) {
        const sources = [
            { name: 'GitHub', fn: () => fetchGithubUpdates(game, signal, forceRefresh) },
            { name: 'itch.io', fn: () => window.MediaAggregator.fetchItchPosts(signal, forceRefresh) },
            { name: 'YouTube', fn: () => window.MediaAggregator.fetchYoutubeVideos(signal, { forceRefresh, filterByTitle: true }) }
        ];

        const promises = sources.map(source => {
            return source.fn()
                .then(items => {
                    if (!items || !items.length) return [];
                    console.log(`[GameUpdates] ${source.name}: ${items.length} элементов`);
                    if (typeof onItem === 'function') {
                        for (const item of items) {
                            try { onItem(item); } catch { /* noop */ }
                        }
                    }
                    return items;
                })
                .catch(err => {
                    if (!isAborted(err, signal)) {
                        console.warn(`[GameUpdates] ${source.name} упал:`, err.message || err);
                    }
                    return [];
                });
        });

        const results = await Promise.allSettled(promises);
        let allItems = [];
        for (const r of results) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                allItems = allItems.concat(r.value);
            }
        }
        allItems.sort((a, b) => b.date - a.date);
        return allItems;
    }

    // ---------- Карточка ----------

    function getAuthorIcon(type) {
        if (type === 'itch-post') return 'fab fa-itch-io';
        if (type === 'yt-video' || type === 'video') return 'fab fa-youtube';
        return 'fas fa-user';
    }

    function createUpdateCard(post) {
        const date = normalizeDate(post.date);

        const card = createElement('div', 'project-card-link tilt-card', { cursor: 'pointer' });
        card.dataset.itemId = post.id;
        card.dataset.date = String(date.getTime());
        const inner = createElement('div', 'project-card');

        let imgSrc = post.thumbnail || null;
        if (!imgSrc && post.body) {
            const mdMatch = post.body.match(/!\[.*?\]\((.*?)\)/);
            if (mdMatch) imgSrc = mdMatch[1];
        }
        const imgW = createElement('div', 'image-wrapper');
        const img = createElement('img', 'project-image', {}, {
            src: imgSrc || 'images/default-news.webp',
            alt: post.title, loading: 'lazy'
        });
        img.onerror = () => { img.src = 'images/default-news.webp'; };
        imgW.appendChild(img);

        const title = createElement('h3');
        title.textContent = post.title;

        const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
        const icon = getAuthorIcon(post.type);
        meta.innerHTML = sanitizeHtml(
            `<i class="${icon}"></i> ${escapeHtml(post.author)} <i class="fas fa-calendar-alt"></i> ${date.toLocaleDateString()}`
        );

        const summary = extractSummary(post.body || '') || stripHtml(post.body || '').substring(0, 120);
        const preview = createElement('p', 'text-secondary', {
            fontSize: '13px', overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: '2', WebkitBoxOrient: 'vertical'
        });
        preview.textContent = summary;

        inner.append(imgW, title, meta, preview);

        if (post.type === 'itch-post' && post.itchLink) {
            const a = createElement('a', 'button small', {
                marginTop: '8px', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', width: '100%'
            }, { href: post.itchLink, target: '_blank', rel: 'noopener noreferrer' });
            a.innerHTML = sanitizeHtml(`<i class="fab fa-itch-io"></i> <span>${t('readMore')}</span>`);
            a.addEventListener('click', (e) => e.stopPropagation());
            inner.appendChild(a);
        }

        if ((post.type === 'yt-video' || post.type === 'video') && post.videoId) {
            const a = createElement('a', 'button small', {
                marginTop: '8px', display: 'inline-flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px', width: '100%'
            }, { href: `https://www.youtube.com/watch?v=${post.videoId}`, target: '_blank', rel: 'noopener noreferrer' });
            a.innerHTML = sanitizeHtml(`<i class="fab fa-youtube"></i> <span>${t('watch')}</span>`);
            a.addEventListener('click', (e) => e.stopPropagation());
            inner.appendChild(a);
        }

        card.appendChild(inner);

        card.addEventListener('click', async () => {
            if (post.type === 'itch-post' && post.itchLink) {
                window.open(post.itchLink, '_blank', 'noopener,noreferrer');
                return;
            }
            if ((post.type === 'yt-video' || post.type === 'video') && post.videoId) {
                window.open(`https://www.youtube.com/watch?v=${post.videoId}`, '_blank', 'noopener,noreferrer');
                return;
            }
            if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
            window.UIFeedback.openFullModal({
                type: 'update',
                id: post.number || post.id,
                title: post.title,
                body: post.body,
                author: post.author,
                date: post.date,
                game: post.game,
                labels: post.labels
            });
        });

        return card;
    }

    // ---------- Вставка ----------

    function insertCardSorted(grid, post) {
        if (!post || !post.id) return;
        if (grid.querySelector(`[data-item-id="${CSS.escape(post.id)}"]`)) return;
        const newCard = createUpdateCard(post);
        const newTs = normalizeDate(post.date).getTime();
        let insertBefore = null;
        for (const child of grid.children) {
            const ts = parseInt(child.dataset.date, 10) || 0;
            if (newTs > ts) { insertBefore = child; break; }
        }
        if (insertBefore) grid.insertBefore(newCard, insertBefore);
        else grid.appendChild(newCard);
    }

    function getOrCreateGrid(container) {
        let grid = container.querySelector('.projects-grid');
        if (!grid) {
            container.innerHTML = '';
            grid = createElement('div', 'projects-grid');
            container.appendChild(grid);
        }
        return grid;
    }

    function renderUpdates(container, game, posts, { replace = false } = {}) {
        const parent = container.parentNode;
        let header = parent.querySelector('.updates-header');

        if (!header) {
            header = createElement('div', 'updates-header', {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '20px'
            });
            header.innerHTML = sanitizeHtml(
                `<div style="display:flex;align-items:center;gap:8px;">` +
                `<i class="fas fa-clock-rotate-left" style="font-size:24px;color:var(--accent);"></i>` +
                `<h2 style="margin:0;" data-lang="updatesTitle">${t('updatesTitle')}</h2></div>`
            );
            parent.insertBefore(header, container);
        }

        if (posts.length === 0) {
            if (replace) {
                container.innerHTML = sanitizeHtml(
                    `<p class="text-secondary" data-lang="noUpdates" style="padding:12px 0;">${t('noUpdates')}</p>`
                );
            }
            return;
        }

        const scrollY = window.scrollY;
        const grid = getOrCreateGrid(container);
        if (replace) grid.replaceChildren();
        for (const p of posts) insertCardSorted(grid, p);

        const existing = header.querySelector('.admin-update-btn');
        if (isAdmin() && hasScope('repo')) {
            if (!existing) {
                const btn = createElement('button', 'button admin-update-btn');
                btn.innerHTML = sanitizeHtml(`<i class="fas fa-plus"></i> ${t('addUpdate')}`);
                btn.addEventListener('click', async () => {
                    if (!window.UIFeedback) await loadModule('js/features/ui-feedback.js');
                    window.UIFeedback.openEditorModal('new', { game: currentGame }, 'update');
                });
                header.appendChild(btn);
            } else {
                existing.innerHTML = sanitizeHtml(`<i class="fas fa-plus"></i> ${t('addUpdate')}`);
            }
        } else if (existing) existing.remove();

        window.scrollTo({ top: scrollY, behavior: 'instant' });
    }

    // ---------- Инициализация ----------

    window.initGameUpdates = function() {
        const container = document.getElementById('game-updates');
        if (container?.dataset.game) {
            currentGame = container.dataset.game;
            window.currentGame = currentGame;
            loadGameUpdates(container, currentGame, false);
        }
        window.addEventListener('github-issue-created', e => {
            const issue = e.detail;
            if (!currentGame) return;
            if (!issue.labels.some(l => l.name === 'type:update' && l.name === `game:${currentGame}`)) return;
            if (!CONFIG.ALLOWED_AUTHORS.includes(issue.user.login)) return;
            cacheRemoveByPrefix(`game_issues_${currentGame}`);
            const cont = document.getElementById('game-updates');
            if (!cont) return;
            const newPost = normalizePost({
                type: 'gh-update',
                number: issue.number, id: `gh-${issue.number}`,
                title: issue.title, body: issue.body,
                date: new Date(issue.created_at), author: issue.user.login,
                game: currentGame, labels: issue.labels.map(l => l.name),
                thumbnail: null
            });
            const grid = getOrCreateGrid(cont);
            insertCardSorted(grid, newPost);
        });
        window.addEventListener('github-login-success', () => { if (currentGame) refreshGameUpdates(currentGame); });
        window.addEventListener('github-logout', () => { if (currentGame) refreshGameUpdates(currentGame); });

        window.addEventListener('languageChanged', () => {
            const container = document.getElementById('game-updates');
            if (!container) return;
            const parent = container.parentNode;
            const header = parent?.querySelector('.updates-header');
            if (header) {
                const btn = header.querySelector('.admin-update-btn');
                if (btn) btn.innerHTML = sanitizeHtml(`<i class="fas fa-plus"></i> ${t('addUpdate')}`);
            }
        });
    };

    window.refreshGameUpdates = (game) => {
        const cont = document.getElementById('game-updates');
        if (cont && cont.dataset.game === game) loadGameUpdates(cont, game, true);
    };

    async function loadGameUpdates(container, game, forceRefresh = false) {
        if (currentAbort) { currentAbort.controller.abort(); currentAbort = null; }
        const { controller, timeoutId } = createAbortable(35000);
        currentAbort = { controller };

        try {
            if (!forceRefresh) {
                const [cachedGh, cachedItch, cachedYt] = await Promise.all([
                    cacheGet(`game_issues_${game}`),
                    Promise.resolve(readCache(ITCH_CACHE_KEY, Infinity)),
                    Promise.resolve(readCache(YT_CACHE_KEY, Infinity))
                ]);

                if ((cachedGh && cachedGh.length) || (cachedItch && cachedItch.length) || (cachedYt && cachedYt.length)) {
                    const ghPosts = (cachedGh || []).filter(i =>
                        i.labels.some(l => l.name === 'type:update') &&
                        CONFIG.ALLOWED_AUTHORS.includes(i.user.login)
                    ).map(i => normalizePost({
                        type: 'gh-update',
                        number: i.number, id: `gh-${i.number}`,
                        title: i.title, body: i.body,
                        date: new Date(i.created_at),
                        author: i.user.login, game,
                        labels: i.labels.map(l => l.name),
                        thumbnail: null
                    }));

                    // Кеш YouTube хранит все видео, поэтому фильтруем по названию здесь
                    const ytFiltered = (cachedYt || []).filter(v => {
                        const title = (v.title || '').toLowerCase();
                        return window.MediaAggregator.GAME_KEYWORDS.some(kw => title.includes(kw));
                    }).filter(v => {
                        const dur = typeof v.duration === 'number' ? v.duration : null;
                        return !(dur != null && dur > 0 && dur < 60);
                    });

                    const combined = [...ytFiltered, ...(cachedItch || []), ...ghPosts]
                        .sort((a, b) => b.date - a.date);

                    if (combined.length) {
                        renderUpdates(container, game, combined, { replace: true });

                        if (!backgroundRefreshInFlight) {
                            backgroundRefreshInFlight = true;
                            (async () => {
                                try {
                                    const fresh = await fetchAllUpdates(
                                        game,
                                        null,
                                        true,
                                        (item) => {
                                            const cont = document.getElementById('game-updates');
                                            if (cont && cont.dataset.game === game) {
                                                const grid = getOrCreateGrid(cont);
                                                insertCardSorted(grid, item);
                                            }
                                        }
                                    );
                                    if (fresh.length) {
                                        const cont = document.getElementById('game-updates');
                                        if (cont && cont.dataset.game === game) {
                                            renderUpdates(cont, game, fresh, { replace: true });
                                        }
                                    }
                                } catch { /* noop */ }
                                finally { backgroundRefreshInFlight = false; }
                            })();
                        }
                        return;
                    }
                }
            }

            container.innerHTML = sanitizeHtml(
                `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p data-lang="loading">${t('loading')}</p></div>`
            );

            const posts = await fetchAllUpdates(
                game,
                controller.signal,
                forceRefresh,
                (item) => {
                    const cont = document.getElementById('game-updates');
                    if (cont && cont.dataset.game === game) {
                        const grid = getOrCreateGrid(cont);
                        insertCardSorted(grid, item);
                    }
                }
            );
            renderUpdates(container, game, posts, { replace: true });
        } catch (err) {
            if (controller.signal.aborted) return;
            console.error('[GameUpdates] load error:', err);
            container.innerHTML = sanitizeHtml(
                `<p class="error-message" data-lang="updatesLoadError">${t('updatesLoadError')}</p>`
            );
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
        }
    }
})();