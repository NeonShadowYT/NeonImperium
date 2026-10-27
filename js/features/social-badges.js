// js/features/social-badges.js
// Рендер красивых соц-бейджей + загрузка счётчиков.
// Прямой fetch к t.me НЕ используется (CSP). Все запросы к t.me идут через прокси.
// telegram-badge.vercel.app отдаёт 200 без Access-Control-Allow-Origin —
// поэтому напрямую тоже не читается; только через прокси.

(function() {
    'use strict';

    const YT_CHANNEL_ID = 'UC2pH2qNfh2sEAeYEGs1k_Lg';
    const DISCORD_INVITE = '9gv5sRhk9R';
    const TG_USERNAME = 'voididea';
    const TWITCH_CHANNEL = 'neoncyndows';
    const CACHE_TTL = 10 * 60 * 1000;
    const REQUEST_TIMEOUT = 15000;
    const CACHE_PREFIX = 'social-badge-';

    const ICONS = {
        youtube: '<svg viewBox="0 0 24 24"><path d="M23.5 6.2c-.3-1-1.1-1.8-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5c-1 .3-1.8 1.1-2.1 2.1C0 8.1 0 12 0 12s0 3.9.5 5.8c.3 1 1.1 1.8 2.1 2.1 1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5c1-.3 1.8-1.1 2.1-2.1.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.5 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg>',
        discord: '<svg viewBox="0 0 24 24"><path d="M20.3 4.4A19.7 19.7 0 0 0 15.4 3l-.2.5c1.7.4 2.5 1 2.5 1a13.9 13.9 0 0 0-11.4 0s.8-.6 2.5-1L8.6 3a19.7 19.7 0 0 0-4.9 1.4A20.4 20.4 0 0 0 .2 18s3.7 1.9 6.8 1.9c0 0 .5-.6.9-1.1-1.5-.4-2.1-1.3-2.1-1.3l.5.3c1.3.6 2.4 1 3.6 1.3 1.9.4 3.7.4 5.5 0 1.2-.3 2.3-.7 3.6-1.3l.5-.3s-.6.9-2.1 1.3c.4.5.9 1.1.9 1.1 3.1 0 6.8-1.9 6.8-1.9a20.4 20.4 0 0 0-3.4-13.6zM8.7 14.5c-.7 0-1.3-.7-1.3-1.5s.6-1.5 1.3-1.5 1.3.7 1.3 1.5-.6 1.5-1.3 1.5zm6.6 0c-.7 0-1.3-.7-1.3-1.5s.6-1.5 1.3-1.5 1.3.7 1.3 1.5-.6 1.5-1.3 1.5z"/></svg>',
        telegram: '<svg viewBox="0 0 24 24"><path d="M9.8 16.1l-.4 5.5c.6 0 .8-.2 1.1-.5l2.7-2.6 5.6 4.1c1 .6 1.8.3 2.1-.9l3.8-17.8c.3-1.5-.5-2.1-1.6-1.7L1.1 9.9C-.4 10.5-.4 11.5.9 12l5.6 1.7L19.5 5.9c.6-.4 1.2-.2.7.2L9.8 16.1z"/></svg>',
        twitch: '<svg viewBox="0 0 24 24"><path d="M4.3 3L3 6.4v13.1h4.9V22h2.8l2.5-2.5h3.7l5.2-5.2V3H4.3zm14.4 10.4l-3 3h-4.7l-2.5 2.5v-2.5H4.6V4.3h14.1v9.1zM15.5 7v5.4h-1.7V7h1.7zm-4.6 0v5.4H9.2V7h1.7z"/></svg>',
        boosty: '<svg viewBox="0 0 24 24"><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z"/></svg>',
        github: '<svg viewBox="0 0 24 24"><path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2 0 1.9 1.2 1.9 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.1-.4-.6-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3"/></svg>'
    };

    // Порядок важен: сначала те, что точно работают (allorigins — надёжный, хоть и медленный).
    const CORS_PROXIES = [
        (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
        (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
        (u) => `https://everyorigin.jwvbremen.nl/api/get?url=${encodeURIComponent(u)}`,
        (u) => `https://cors.eu.org/${u}`,
        (u) => `https://cors.x2u.in/${u}`,
        (u) => `https://yacdn.org/proxy/${u}`,
        (u) => `https://corsfix.com/?${u}`
    ];

    // ============================================================
    // Утилиты
    // ============================================================

    function normalizeNumber(value) {
        if (value === null || value === undefined) return null;
        if (typeof value === 'number') {
            return (isFinite(value) && value > 0) ? Math.round(value) : null;
        }
        let str = String(value).trim();
        if (!str) return null;
        str = str.replace(/\s+/g, '');
        const suffixMatch = str.match(/^([\d.,]+)([KMBкмб])$/i);
        if (suffixMatch) {
            let numStr = suffixMatch[1];
            if (numStr.includes('.') && numStr.includes(',')) {
                const lastDot = numStr.lastIndexOf('.');
                const lastComma = numStr.lastIndexOf(',');
                if (lastDot > lastComma) numStr = numStr.replace(/\./g, '').replace(',', '.');
                else numStr = numStr.replace(/,/g, '');
            } else if (numStr.includes(',')) {
                numStr = numStr.replace(',', '.');
            } else if ((numStr.match(/\./g) || []).length > 1) {
                numStr = numStr.replace(/\./g, '');
            }
            const n = parseFloat(numStr);
            if (isNaN(n) || n <= 0) return null;
            const unit = suffixMatch[2].toUpperCase();
            let mult = 1;
            if (unit === 'K' || unit === 'К') mult = 1e3;
            else if (unit === 'M' || unit === 'М') mult = 1e6;
            else if (unit === 'B' || unit === 'Б') mult = 1e9;
            const result = Math.round(n * mult);
            return result > 0 ? result : null;
        }
        if (str.includes('.') && str.includes(',')) {
            const lastDot = str.lastIndexOf('.');
            const lastComma = str.lastIndexOf(',');
            if (lastDot > lastComma) str = str.replace(/\./g, '').replace(',', '.');
            else str = str.replace(/,/g, '');
        } else if (str.includes(',')) {
            const commaMatch = str.match(/^(\d+),(\d{3})$/);
            if (commaMatch) str = commaMatch[1] + commaMatch[2];
            else str = str.replace(',', '.');
        } else if ((str.match(/\./g) || []).length > 1) {
            str = str.replace(/\./g, '');
        }
        str = str.replace(/[^\d.]/g, '');
        if (!str) return null;
        const n = parseFloat(str);
        return (isFinite(n) && n > 0) ? Math.round(n) : null;
    }

    function formatCount(n) {
        if (!n || isNaN(n) || n <= 0) return null;
        if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        if (n >= 1e4) return Math.round(n / 1e3) + 'K';
        if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
        return String(n);
    }

    function fetchWithTimeout(url, ms = REQUEST_TIMEOUT) {
        return new Promise((resolve, reject) => {
            const controller = new AbortController();
            const timer = setTimeout(() => {
                try { controller.abort(new Error('timeout')); } catch { controller.abort(); }
            }, ms);
            fetch(url, { signal: controller.signal, cache: 'no-store' })
                .then(res => {
                    clearTimeout(timer);
                    if (!res.ok) reject(new Error(`HTTP ${res.status}`));
                    else resolve(res);
                })
                .catch(err => { clearTimeout(timer); reject(err); });
        });
    }

    function readCache(key) {
        try {
            const raw = localStorage.getItem(CACHE_PREFIX + key);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || (Date.now() - obj.t) > CACHE_TTL) return null;
            return obj.v;
        } catch { return null; }
    }

    function writeCache(key, value) {
        try {
            localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ v: value, t: Date.now() }));
        } catch { /* noop */ }
    }

    // ============================================================
    // Загрузка счётчика с гонкой источников
    // ============================================================

    async function raceSources(sources) {
        const promises = sources.map(async (src) => {
            const res = await fetchWithTimeout(src.url);
            const raw = await src.parse(res);
            const num = normalizeNumber(raw);
            if (!num) throw new Error('no value');
            return num;
        });
        return await Promise.any(promises);
    }

    function applyCount(el, n, tooltip) {
        if (!el) return;
        const formatted = formatCount(n);
        if (!formatted) return;
        el.classList.remove('is-loading');
        el.textContent = formatted;
        if (tooltip) el.title = n.toLocaleString('en-US') + ' ' + tooltip;
    }

    function applyFailed(el) {
        if (!el) return;
        el.classList.remove('is-loading');
        el.textContent = '—';
    }

    async function loadCounter(counterEl, cacheKey, sources, tooltip) {
        if (!counterEl) return;
        const cached = readCache(cacheKey);
        if (cached) {
            applyCount(counterEl, cached, tooltip);
            return;
        }
        try {
            const n = await raceSources(sources);
            applyCount(counterEl, n, tooltip);
            writeCache(cacheKey, n);
        } catch {
            applyFailed(counterEl);
        }
    }

    // ============================================================
    // Источники по платформам
    // ============================================================

    function ytSources() {
        const svgUrl = `https://img.shields.io/youtube/channel/subscribers/${YT_CHANNEL_ID}.svg?style=flat`;
        const parseSvg = async (res) => {
            const text = await res.text();
            const matches = [...text.matchAll(/>([\d][\d.,]*[KMBкмб]?)<\/text>/gi)];
            return matches.length ? matches[matches.length - 1][1] : null;
        };
        // 1. Прямые API с CORS
        const sources = [
            {
                url: `https://api.socialcounts.org/youtube-live-subscriber-count/${YT_CHANNEL_ID}`,
                parse: async (res) => {
                    const d = await res.json();
                    return d.subscriberCount ?? d.est_sub ?? d.API_sub ?? null;
                }
            },
            {
                url: `https://mixerno.space/api/youtube-channel-counter/user/${YT_CHANNEL_ID}`,
                parse: async (res) => {
                    const d = await res.json();
                    const sub = d && d.counts && d.counts.find(c => /sub/i.test(c.type || ''));
                    return sub ? sub.count : null;
                }
            },
            // 2. Shields.io через прокси (shields.io отдаёт CORS, но на всякий случай)
            { url: svgUrl, parse: parseSvg }
        ];
        CORS_PROXIES.forEach(p => sources.push({ url: p(svgUrl), parse: parseSvg }));
        return sources;
    }

    function discordSources() {
        return [
            {
                url: `https://discord.com/api/v10/invites/${DISCORD_INVITE}?with_counts=true`,
                parse: async (res) => {
                    const d = await res.json();
                    return d.approximate_member_count ?? null;
                }
            },
            {
                url: `https://discord.com/api/invites/${DISCORD_INVITE}?with_counts=true`,
                parse: async (res) => {
                    const d = await res.json();
                    return d.approximate_member_count ?? null;
                }
            }
        ];
    }

    function telegramSources() {
        // ТОЛЬКО через прокси — t.me и telegram-badge.vercel.app не отдают CORS
        const badgeUrl = `https://telegram-badge.vercel.app/api/telegram-badge?channelId=@${TG_USERNAME}`;
        const tgPageUrl = `https://t.me/${TG_USERNAME}`;
        const tgPublicUrl = `https://t.me/s/${TG_USERNAME}`;

        const parseSvg = async (res) => {
            const text = await res.text();
            const matches = [...text.matchAll(/>([\d][\d.,]*[KMBкмб]?)<\/text>/gi)];
            return matches.length ? matches[matches.length - 1][1] : null;
        };
        const parseHtml = async (res) => {
            const html = await res.text();
            const m = html.match(/([\d][\d\s.,]*\s*[KMBкмб]?)\s+(?:members?|subscribers?|участник\w*|подписчик\w*)/i);
            return m ? m[1] : null;
        };

        const sources = [];
        // badge.svg через прокси — приоритет
        CORS_PROXIES.forEach(p => sources.push({ url: p(badgeUrl), parse: parseSvg }));
        // t.me HTML через прокси — fallback
        CORS_PROXIES.forEach(p => {
            sources.push({ url: p(tgPageUrl), parse: parseHtml });
            sources.push({ url: p(tgPublicUrl), parse: parseHtml });
        });
        return sources;
    }

    // ============================================================
    // Twitch LIVE / OFFLINE
    // ============================================================

    async function loadTwitchLive(el) {
        if (!el) return;
        const cached = readCache('twitch-live');
        if (cached !== null && cached !== undefined) {
            applyTwitch(el, cached);
            return;
        }
        try {
            const res = await fetchWithTimeout(`https://api.twitchinsights.net/v1/streams?channel=${TWITCH_CHANNEL}`);
            const d = await res.json();
            const live = d.online === 1;
            const viewers = live && d.streams && d.streams[0] ? d.streams[0][1] : 0;
            const payload = { live, viewers };
            applyTwitch(el, payload);
            writeCache('twitch-live', payload);
        } catch {
            el.classList.remove('is-loading');
            el.classList.add('is-offline');
            el.textContent = 'OFFLINE';
        }
    }

    function applyTwitch(el, data) {
        el.classList.remove('is-loading', 'is-live', 'is-offline');
        if (data.live) {
            el.classList.add('is-live');
            el.textContent = data.viewers ? formatCount(data.viewers) || 'LIVE' : 'LIVE';
            el.title = `В эфире${data.viewers ? ': ' + data.viewers + ' зрителей' : ''}`;
        } else {
            el.classList.add('is-offline');
            el.textContent = 'OFFLINE';
            el.title = 'Не в эфире';
        }
    }

    // ============================================================
    // Рендер бейджей
    // ============================================================

    function createBadge({ href, className, label, iconKey, counterId, ariaLabel }) {
        const a = document.createElement('a');
        a.className = 'social-badge ' + className;
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute('aria-label', ariaLabel || label);
        a.innerHTML = (ICONS[iconKey] || '') + '<span>' + label + '</span>';
        if (counterId) {
            const c = document.createElement('span');
            c.className = 'count is-loading';
            c.id = counterId;
            a.appendChild(c);
        }
        return a;
    }

    function buildChannelsRow() {
        const row = document.createElement('div');
        row.className = 'social-badges-row';
        row.appendChild(createBadge({
            href: 'https://www.youtube.com/@NeonShadow-neon',
            className: 'badge-youtube',
            label: 'YouTube',
            iconKey: 'youtube',
            counterId: 'social-yt-count',
            ariaLabel: 'YouTube канал Neon Shadow'
        }));
        row.appendChild(createBadge({
            href: 'https://www.twitch.tv/' + TWITCH_CHANNEL,
            className: 'badge-twitch',
            label: 'Twitch',
            iconKey: 'twitch',
            counterId: 'social-twitch-count',
            ariaLabel: 'Twitch канал Neon Shadow'
        }));
        row.appendChild(createBadge({
            href: 'https://discord.com/invite/' + DISCORD_INVITE,
            className: 'badge-discord',
            label: 'Discord',
            iconKey: 'discord',
            counterId: 'social-discord-count',
            ariaLabel: 'Discord сервер Neon Imperium'
        }));
        row.appendChild(createBadge({
            href: 'https://t.me/' + TG_USERNAME,
            className: 'badge-telegram',
            label: 'Telegram',
            iconKey: 'telegram',
            counterId: 'social-tg-count',
            ariaLabel: 'Telegram канал Neon Imperium'
        }));
        row.appendChild(createBadge({
            href: 'https://boosty.to/neoncyndows',
            className: 'badge-boosty',
            label: 'Boosty',
            iconKey: 'boosty',
            ariaLabel: 'Boosty Neon Shadow'
        }));
        return row;
    }

    function buildDmRow() {
        const row = document.createElement('div');
        row.className = 'social-badges-row';
        row.appendChild(createBadge({
            href: 'https://t.me/NeonCyndows',
            className: 'dm badge-telegram-dm',
            label: 'Telegram DM',
            iconKey: 'telegram',
            ariaLabel: 'Telegram-личка Neon Shadow'
        }));
        row.appendChild(createBadge({
            href: 'https://discord.com/users/857872869949177896',
            className: 'dm badge-discord-dm',
            label: 'Discord DM',
            iconKey: 'discord',
            ariaLabel: 'Discord-личка Neon Shadow'
        }));
        return row;
    }

    function buildInfoRow() {
        const row = document.createElement('div');
        row.className = 'social-badges-row';
        row.appendChild(createBadge({
            href: 'https://github.com/NeonShadowYT',
            className: 'badge-github',
            label: 'GitHub',
            iconKey: 'github',
            ariaLabel: 'GitHub Neon Shadow'
        }));
        return row;
    }

    // ============================================================
    // Точка входа
    // ============================================================

    function renderInto(container) {
        if (!container) return;
        container.classList.add('social-badges-wrap');
        container.innerHTML = '';
        container.appendChild(buildChannelsRow());
        container.appendChild(buildDmRow());
        container.appendChild(buildInfoRow());

        loadCounter(
            document.getElementById('social-yt-count'),
            'youtube', ytSources(), 'subscribers'
        );
        loadTwitchLive(document.getElementById('social-twitch-count'));
        loadCounter(
            document.getElementById('social-discord-count'),
            'discord', discordSources(), 'members'
        );
        loadCounter(
            document.getElementById('social-tg-count'),
            'telegram', telegramSources(), 'members'
        );
    }

    function init() {
        document.querySelectorAll('[data-social-badges]').forEach(renderInto);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    window.SocialBadges = { renderInto, init };
})();