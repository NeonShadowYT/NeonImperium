// js/pages/game-updates.js — обновления игры (GitHub issues + itch.io devlog).
//
// Даты принудительно нормализуются при чтении из кэша.
// itch.io использует тот же улучшенный парсер превью, что и news-feed.
// SWR: кэш показывается мгновенно, рефреш в фоне.

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

    const ITCH_CACHE_TTL = 30 * 60 * 1000;
    const REQUEST_TIMEOUT = 12000;
    const MAX_ITCH_POSTS = 3;

    const ITCH_DEVLOG_SOURCES = {
        'starve-neon': {
            name: 'Starve Neon',
            rssUrl: 'https://neon-shadow.itch.io/starve-neon/devlog.rss',
            devlogPageUrl: 'https://neon-shadow.itch.io/starve-neon/devlog'
        }
    };

    const CORS_PROXIES = [
        (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
        (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
        (u) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(u)}`,
        (u) => `https://cors.eu.org/${u}`,
        (u) => `https://cors.x2u.in/${u}`,
        (u) => `https://yacdn.org/proxy/${u}`,
        (u) => `https://corsfix.com/?${u}`,
        (u) => `https://cloudflare-cors-anywhere.queakchannel42.workers.dev/?${u}`,
        (u) => `https://test.cors.workers.dev/?${u}`,
        (u) => `https://corsproxy.org/?${encodeURIComponent(u)}`
    ];

    const RSS2JSON = (rssUrl) =>
        `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;

    function t(key) {
        if (window.I18n && typeof window.I18n.translate === 'function') {
            const v = window.I18n.translate(key);
            if (v && v !== key) return v;
        }
        const map = {
            loading: 'Загрузка...', noUpdates: 'Нет обновлений',
            updatesTitle: 'Обновления', addUpdate: 'Добавить обновление',
            updatesLoadError: 'Ошибка загрузки обновлений', readMore: 'Читать далее'
        };
        return map[key] || key;
    }

    function isAborted(err, signal) {
        if (!err) return false;
        if (signal && signal.aborted) return true;
        if (err.name === 'AbortError') return true;
        return String(err.message || '').includes('Aborted');
    }

    function decodeXmlEntities(s) {
        return String(s || '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
    }

    // КРИТИЧНО: нормализуем дату после JSON.parse
    function normalizeDate(d) {
        if (d instanceof Date && !isNaN(d.getTime())) return d;
        const nd = new Date(d);
        return isNaN(nd.getTime()) ? new Date() : nd;
    }

    function normalizePost(p) {
        return { ...p, date: normalizeDate(p.date) };
    }

    // ---- Кэш itch.io ----
    function itchCacheKey(game) { return `itch_posts_updates_v3_${game}`; }

    function readItchCache(game) {
        try {
            const raw = localStorage.getItem(itchCacheKey(game));
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data || !data.timestamp || !Array.isArray(data.items)) return null;
            if (Date.now() - data.timestamp > ITCH_CACHE_TTL) {
                localStorage.removeItem(itchCacheKey(game));
                return null;
            }
            return data.items.map(normalizePost);
        } catch { return null; }
    }

    function writeItchCache(game, items) {
        try {
            localStorage.setItem(itchCacheKey(game), JSON.stringify({
                timestamp: Date.now(), items
            }));
        } catch { /* noop */ }
    }

    // ---- Сеть ----
    function fetchWithTimeout(url, signal, timeout = REQUEST_TIMEOUT) {
        return new Promise((resolve, reject) => {
            const controller = new AbortController();
            const timer = setTimeout(() => {
                try { controller.abort(new Error('timeout')); } catch { controller.abort(); }
            }, timeout);
            if (signal) {
                if (signal.aborted) {
                    clearTimeout(timer);
                    reject(new DOMException('Aborted', 'AbortError'));
                    return;
                }
                signal.addEventListener('abort', () => {
                    try { controller.abort(); } catch { /* noop */ }
                }, { once: true });
            }
            fetch(url, { signal: controller.signal })
                .then(res => {
                    clearTimeout(timer);
                    if (!res.ok) reject(new Error(`HTTP ${res.status}`));
                    else resolve(res);
                })
                .catch(err => { clearTimeout(timer); reject(err); });
        });
    }

    async function fetchViaProxy(proxyFn, targetUrl, signal) {
        const proxyUrl = proxyFn(targetUrl);
        const res = await fetchWithTimeout(proxyUrl, signal);
        let text = await res.text();
        if (!text || text.length < 200) throw new Error('too short');
        if (text.trim().startsWith('{')) {
            try {
                const json = JSON.parse(text);
                if (typeof json.contents === 'string') text = json.contents;
            } catch { /* не JSON */ }
        }
        return text;
    }

    async function raceProxies(targetUrl, parser, signal) {
        const promises = CORS_PROXIES.map(proxyFn =>
            fetchViaProxy(proxyFn, targetUrl, signal).then(text => {
                const result = parser(text);
                if (!result || (Array.isArray(result) && result.length === 0)) {
                    throw new Error('empty');
                }
                return result;
            })
        );
        return await Promise.any(promises);
    }

    // ---- Парсеры itch.io ----
    function extractItchThumbnail(rawHtml, source) {
        if (!rawHtml) return null;
        const imgMatch = rawHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch) {
            let url = imgMatch[1];
            if (url.startsWith('//')) url = 'https:' + url;
            else if (url.startsWith('/')) url = 'https://img.itch.zone' + url;
            return url;
        }
        return null;
    }

    function parseItchDevlogXml(xmlText, source) {
        if (!xmlText || typeof xmlText !== 'string') return [];
        const itemBlocks = xmlText.split('<item>').slice(1);
        return itemBlocks.map(block => {
            const titleMatch = block.match(/<title>([^<]*)<\/title>/);
            const linkMatch = block.match(/<link>([^<]*)<\/link>/);
            const pubDateMatch = block.match(/<pubDate>([^<]*)<\/pubDate>/);
            const descriptionMatch = block.match(/<description>([\s\S]*?)<\/description>/);

            const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : 'Без названия';
            const link = linkMatch ? linkMatch[1] : (source.devlogPageUrl || '#');
            let date = pubDateMatch ? new Date(pubDateMatch[1]) : new Date();
            if (isNaN(date.getTime())) date = new Date();

            let description = '';
            let thumbnail = null;
            if (descriptionMatch) {
                const rawHtml = descriptionMatch[1];
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = rawHtml;
                description = (tempDiv.textContent || tempDiv.innerText || '').trim();
                thumbnail = extractItchThumbnail(rawHtml, source);
            }

            return normalizePost({
                type: 'itch-post',
                id: `itch-${link}`,
                title, author: source.name, date, body: description,
                thumbnail,
                itchLink: link, itchSource: source.name,
                labels: ['type:itch-post']
            });
        }).filter(Boolean)
          .sort((a, b) => b.date - a.date)
          .slice(0, MAX_ITCH_POSTS);
    }

    function parseItchDevlogHtml(html, source) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const postElements = doc.querySelectorAll('.post, .devlog_post, article');
            if (postElements.length === 0) return null;
            return Array.from(postElements).slice(0, MAX_ITCH_POSTS).map(el => {
                const titleEl = el.querySelector('h2, h3, .post_title');
                const linkEl = el.querySelector('a[href*="/devlog/"]') || el.querySelector('a');
                const dateEl = el.querySelector('time, .post_date, .date');
                const imgEl = el.querySelector('img');

                const title = titleEl ? titleEl.textContent.trim() : 'Пост';
                const link = linkEl ? linkEl.href : source.devlogPageUrl;
                let date = new Date();
                if (dateEl) {
                    const parsed = new Date(dateEl.getAttribute('datetime') || dateEl.textContent);
                    if (!isNaN(parsed.getTime())) date = parsed;
                }
                const thumbnail = imgEl ? imgEl.src : null;

                return normalizePost({
                    type: 'itch-post',
                    id: `itch-html-${link}`,
                    title, author: source.name, date, body: '', thumbnail,
                    itchLink: link, itchSource: source.name,
                    labels: ['type:itch-post']
                });
            });
        } catch { return null; }
    }

    function parseRss2JsonItch(data, source) {
        if (!data || data.status !== 'ok' || !Array.isArray(data.items)) return null;
        return data.items.slice(0, MAX_ITCH_POSTS).map(item => {
            const rawHtml = item.description || '';
            const thumbnail = extractItchThumbnail(rawHtml, source);
            return normalizePost({
                type: 'itch-post',
                id: `itch-rss2json-${item.link}`,
                title: item.title || 'Пост',
                author: source.name,
                date: new Date(item.pubDate || Date.now()),
                body: rawHtml.replace(/<[^>]*>/g, ''),
                thumbnail,
                itchLink: item.link,
                itchSource: source.name,
                labels: ['type:itch-post']
            });
        });
    }

    // ---- Загрузка itch.io ----
    async function fetchItchPosts(game, signal, forceRefresh = false) {
        const source = ITCH_DEVLOG_SOURCES[game];
        if (!source) return [];

        if (!forceRefresh) {
            const cached = readItchCache(game);
            if (cached && cached.length) {
                console.log(`[GameUpdates] itch.io из кеша: ${cached.length}`);
                return cached;
            }
        }

        const strategies = [
            raceProxies(source.rssUrl, (text) => parseItchDevlogXml(text, source), signal),
            raceProxies(source.devlogPageUrl, (html) => parseItchDevlogHtml(html, source), signal),
            fetchWithTimeout(RSS2JSON(source.rssUrl), signal)
                .then(res => res.json())
                .then(data => {
                    const posts = parseRss2JsonItch(data, source);
                    if (!posts || !posts.length) throw new Error('no posts');
                    return posts;
                })
        ];

        try {
            const posts = await Promise.any(strategies);
            if (posts && posts.length) {
                writeItchCache(game, posts);
                console.log(`[GameUpdates] itch.io из сети: ${posts.length}`);
                return posts;
            }
            return [];
        } catch (e) {
            if (isAborted(e, signal)) return [];
            const stale = readItchCache(game);
            if (stale) return stale;
            console.warn(`[GameUpdates] itch.io ${source.name}: все стратегии упали`);
            return [];
        }
    }

    async function fetchItchPostThumbnail(postUrl, signal) {
        if (!postUrl) return null;
        try {
            const html = await raceProxies(postUrl, (text) => text.length > 500 ? text : null, signal);
            if (!html) return null;
            let match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
            if (match) return match[1];
            match = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
            if (match) return match[1];
            return null;
        } catch { return null; }
    }

    async function enrichItchThumbnails(posts, signal, onEnriched) {
        if (!posts || !posts.length) return;
        const without = posts.filter(p => !p.thumbnail && p.itchLink);
        if (!without.length) return;

        let enriched = 0;
        await Promise.allSettled(without.map(async (p) => {
            const thumb = await fetchItchPostThumbnail(p.itchLink, signal);
            if (thumb) {
                p.thumbnail = thumb;
                enriched++;
                if (typeof onEnriched === 'function') {
                    try { onEnriched(p); } catch { /* noop */ }
                }
            }
        }));

        if (enriched > 0 && currentGame) {
            try {
                const cached = readItchCache(currentGame);
                if (cached) {
                    let changed = false;
                    for (const c of cached) {
                        const updated = posts.find(p => p.id === c.id && p.thumbnail);
                        if (updated && !c.thumbnail) {
                            c.thumbnail = updated.thumbnail;
                            changed = true;
                        }
                    }
                    if (changed) writeItchCache(currentGame, cached);
                }
            } catch { /* noop */ }
        }
    }

    // ============================================================
    // GitHub issues
    // ============================================================

    async function fetchGithubUpdates(game, signal, forceRefresh = false) {
        const cacheKey = `game_issues_${game}`;
        let issues = null;
        if (!forceRefresh) issues = await cacheGet(cacheKey);
        if (!issues) {
            issues = await loadIssues({ labels: `game:${game}`, state: 'open', per_page: 100, signal });
            await cacheSet(cacheKey, issues);
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

    async function fetchAllUpdates(game, signal, forceRefresh = false) {
        const results = await Promise.allSettled([
            fetchGithubUpdates(game, signal, forceRefresh),
            fetchItchPosts(game, signal, forceRefresh)
        ]);

        const gh = results[0].status === 'fulfilled' ? results[0].value : [];
        const itch = results[1].status === 'fulfilled' ? results[1].value : [];

        if (results[0].status === 'rejected' && !isAborted(results[0].reason, signal)) {
            console.warn('[GameUpdates] GitHub issues error:', results[0].reason);
        }
        if (results[1].status === 'rejected' && !isAborted(results[1].reason, signal)) {
            console.warn('[GameUpdates] itch.io error:', results[1].reason);
        }

        return [...itch, ...gh].sort((a, b) => b.date - a.date);
    }

    // ============================================================
    // Рендер
    // ============================================================

    function getAuthorIcon(type) {
        return type === 'itch-post' ? 'fab fa-itch-io' : 'fas fa-user';
    }

    function createUpdateCard(post) {
        const date = normalizeDate(post.date);

        const card = createElement('div', 'project-card-link tilt-card', { cursor: 'pointer' });
        card.dataset.itemId = post.id;
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
        title.textContent = post.title.length > 70 ? post.title.slice(0, 70) + '…' : post.title;

        const meta = createElement('p', 'text-secondary', { fontSize: '12px' });
        const icon = getAuthorIcon(post.type);
        meta.innerHTML = sanitizeHtml(
            `<i class="${icon}"></i> ${escapeHtml(post.author)} · ` +
            `<i class="fas fa-calendar-alt"></i> ${date.toLocaleDateString()}`
        );

        const summary = extractSummary(post.body || '') || stripHtml(post.body || '').substring(0, 120) + '…';
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

        card.appendChild(inner);

        card.addEventListener('click', async () => {
            if (post.type === 'itch-post' && post.itchLink) {
                window.open(post.itchLink, '_blank', 'noopener,noreferrer');
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

    function renderUpdates(container, game, posts) {
        const parent = container.parentNode;
        let header = parent.querySelector('.updates-header');

        if (!posts.length) {
            container.innerHTML = sanitizeHtml(
                `<p class="text-secondary" data-lang="noUpdates" style="padding:12px 0;">${t('noUpdates')}</p>`
            );
            if (header) {
                const existing = header.querySelector('.admin-update-btn');
                if (existing) existing.remove();
            }
            return;
        }

        const scrollY = window.scrollY;
        container.innerHTML = '';
        const grid = createElement('div', 'projects-grid');
        const fragment = document.createDocumentFragment();
        posts.forEach(p => fragment.appendChild(createUpdateCard(p)));
        grid.appendChild(fragment);
        container.appendChild(grid);

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

        const withoutThumb = posts.filter(p => p.type === 'itch-post' && !p.thumbnail);
        if (withoutThumb.length) {
            enrichItchThumbnails(withoutThumb, null, (updated) => {
                const img = container.querySelector(`[data-item-id="${updated.id}"] img.project-image`);
                if (img && updated.thumbnail) img.src = updated.thumbnail;
            });
        }
    }

    // ============================================================
    // Публичные точки входа
    // ============================================================

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
            let grid = cont.querySelector('.projects-grid');
            if (!grid) {
                grid = createElement('div', 'projects-grid');
                cont.innerHTML = '';
                cont.appendChild(grid);
            }
            const fragment = document.createDocumentFragment();
            fragment.appendChild(createUpdateCard(newPost));
            grid.insertBefore(fragment, grid.firstChild);
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
        const { controller, timeoutId } = createAbortable(15000);
        currentAbort = { controller };

        try {
            if (!forceRefresh) {
                const [cachedGh, cachedItch] = await Promise.all([
                    cacheGet(`game_issues_${game}`),
                    Promise.resolve(readItchCache(game))
                ]);

                if (cachedGh || cachedItch) {
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
                    const itchPosts = cachedItch || [];
                    const combined = [...itchPosts, ...ghPosts].sort((a, b) => b.date - a.date);

                    if (combined.length) {
                        renderUpdates(container, game, combined);
                        console.log('[GameUpdates] SWR: показан кэш, рефреш в фоне');

                        if (!backgroundRefreshInFlight) {
                            backgroundRefreshInFlight = true;
                            (async () => {
                                try {
                                    const fresh = await fetchAllUpdates(game, null, true);
                                    if (fresh.length) {
                                        const cont = document.getElementById('game-updates');
                                        if (cont && cont.dataset.game === game) {
                                            renderUpdates(cont, game, fresh);
                                        }
                                    }
                                } catch (e) {
                                    console.warn('[GameUpdates] SWR: фон упал:', e);
                                } finally {
                                    backgroundRefreshInFlight = false;
                                }
                            })();
                        }
                        return;
                    }
                }
            }

            container.innerHTML = sanitizeHtml(
                `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p data-lang="loading">${t('loading')}</p></div>`
            );

            const posts = await fetchAllUpdates(game, controller.signal, forceRefresh);
            renderUpdates(container, game, posts);
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