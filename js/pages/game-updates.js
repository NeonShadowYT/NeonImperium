// js/pages/game-updates.js — обновления игры: GitHub issues + itch.io devlog.
// itch.io: RSS через 20 CORS-прокси, HTML через прокси, rss2json — параллельно.
// Иконка автора:
//   itch-post → fab fa-itch-io
//   остальные (GitHub type:update) → fas fa-user (автор — реальный ник)

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
        (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
        (u) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(u)}`,
        (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
        (u) => `https://cloudflare-cors-anywhere.queakchannel42.workers.dev/?${u}`,
        (u) => `https://cors-anywhere.herokuapp.com/${u}`,
        (u) => `https://proxy.cors.sh/${u}`,
        (u) => `https://cors.bridged.cc/${u}`,
        (u) => `https://test.cors.workers.dev/?${u}`,
        (u) => `https://cors-anywhere.homely8896.workers.dev/${u}`,
        (u) => `https://cors.eu.org/${u}`,
        (u) => `https://cors.x2u.in/${u}`,
        (u) => `https://yacdn.org/proxy/${u}`,
        (u) => `https://cors-proxy.htmldriven.com/?url=${encodeURIComponent(u)}`,
        (u) => `https://corsfix.com/?${u}`,
        (u) => `https://corsproxy.org/?${encodeURIComponent(u)}`,
        (u) => `https://thebugging.com/proxy?url=${encodeURIComponent(u)}`
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

    // ---- Кэш ----
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
            return data.items;
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
            if (descriptionMatch) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = descriptionMatch[1];
                description = (tempDiv.textContent || tempDiv.innerText || '').trim();
            }

            return {
                type: 'itch-post',
                id: `itch-${link}`,
                title, author: source.name, date, body: description,
                itchLink: link, itchSource: source.name,
                labels: ['type:itch-post']
            };
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
                const title = titleEl ? titleEl.textContent.trim() : 'Пост';
                const link = linkEl ? linkEl.href : source.devlogPageUrl;
                let date = new Date();
                if (dateEl) {
                    const parsed = new Date(dateEl.getAttribute('datetime') || dateEl.textContent);
                    if (!isNaN(parsed.getTime())) date = parsed;
                }
                return {
                    type: 'itch-post',
                    id: `itch-html-${link}`,
                    title, author: source.name, date, body: '',
                    itchLink: link, itchSource: source.name,
                    labels: ['type:itch-post']
                };
            });
        } catch { return null; }
    }

    function parseRss2JsonItch(data, source) {
        if (!data || data.status !== 'ok' || !Array.isArray(data.items)) return null;
        return data.items.slice(0, MAX_ITCH_POSTS).map(item => ({
            type: 'itch-post',
            id: `itch-rss2json-${item.link}`,
            title: item.title || 'Пост',
            author: source.name,
            date: new Date(item.pubDate || Date.now()),
            body: (item.description || '').replace(/<[^>]*>/g, ''),
            itchLink: item.link,
            itchSource: source.name,
            labels: ['type:itch-post']
        }));
    }

    // ---- Загрузка itch.io ----
    async function fetchItchPosts(game, signal) {
        const source = ITCH_DEVLOG_SOURCES[game];
        if (!source) return [];

        const cached = readItchCache(game);
        if (cached && cached.length) {
            console.log(`[GameUpdates] itch.io из кеша: ${cached.length}`);
            return cached;
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
            console.warn(`[GameUpdates] itch.io ${source.name}: все стратегии провалились`);
            return [];
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
            loadGameUpdates(container, currentGame);
        }
        window.addEventListener('github-issue-created', e => {
            const issue = e.detail;
            if (!currentGame) return;
            if (!issue.labels.some(l => l.name === 'type:update' && l.name === `game:${currentGame}`)) return;
            if (!CONFIG.ALLOWED_AUTHORS.includes(issue.user.login)) return;
            cacheRemoveByPrefix(`game_issues_${currentGame}`);
            const cont = document.getElementById('game-updates');
            if (!cont) return;
            const newPost = {
                number: issue.number, title: issue.title, body: issue.body,
                date: new Date(issue.created_at), author: issue.user.login,
                game: currentGame, labels: issue.labels.map(l => l.name)
            };
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
        if (cont && cont.dataset.game === game) loadGameUpdates(cont, game);
    };

    async function loadGameUpdates(container, game) {
        container.innerHTML = sanitizeHtml(
            `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p data-lang="loading">${t('loading')}</p></div>`
        );
        if (currentAbort) { currentAbort.controller.abort(); currentAbort = null; }
        const { controller, timeoutId } = createAbortable(15000);
        currentAbort = { controller };

        try {
            const cacheKey = `game_issues_${game}`;
            let issues = await cacheGet(cacheKey);
            if (!issues) {
                issues = await loadIssues({ labels: `game:${game}`, state: 'open', per_page: 100, signal: controller.signal });
                await cacheSet(cacheKey, issues);
            }

            const ghPosts = issues.filter(i =>
                i.labels.some(l => l.name === 'type:update') &&
                CONFIG.ALLOWED_AUTHORS.includes(i.user.login)
            ).map(i => ({
                type: 'gh-update',
                number: i.number,
                id: `gh-${i.number}`,
                title: i.title,
                body: i.body,
                date: new Date(i.created_at),
                author: i.user.login,
                game,
                labels: i.labels.map(l => l.name)
            }));

            const itchPosts = await fetchItchPosts(game, controller.signal);

            const allPosts = [...itchPosts, ...ghPosts].sort((a, b) => b.date - a.date);

            if (allPosts.length === 0) {
                container.innerHTML = sanitizeHtml(`<p class="text-secondary" data-lang="noUpdates">${t('noUpdates')}</p>`);
                return;
            }

            container.innerHTML = '';
            const grid = createElement('div', 'projects-grid');
            const fragment = document.createDocumentFragment();
            allPosts.forEach(p => fragment.appendChild(createUpdateCard(p)));
            grid.appendChild(fragment);
            container.appendChild(grid);

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
        } catch (err) {
            if (controller.signal.aborted) return;
            console.error('Update load error:', err);
            container.innerHTML = sanitizeHtml(
                `<p class="error-message" data-lang="updatesLoadError">${t('updatesLoadError')}</p>`
            );
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
        }
    }

    function getAuthorIcon(type) {
        return type === 'itch-post' ? 'fab fa-itch-io' : 'fas fa-user';
    }

    function createUpdateCard(post) {
        const card = createElement('div', 'project-card-link tilt-card', { cursor: 'pointer' });
        const inner = createElement('div', 'project-card');

        const imgMatch = (post.body || '').match(/!\[.*?\]\((.*?)\)/);
        const imgW = createElement('div', 'image-wrapper');
        const img = createElement('img', 'project-image', {}, {
            src: imgMatch?.[1] || 'images/default-news.webp',
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
            `<i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`
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
})();