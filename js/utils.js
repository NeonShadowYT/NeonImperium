// js/utils.js – централизованные утилиты для всего сайта
(function() {
    const CONFIG = window.GithubCore?.CONFIG || {
        CACHE_TTL: 10 * 60 * 1000,
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium'
    };

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function stripHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    }

    function createElement(tag, className, styles = {}, attrs = {}) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        Object.assign(el.style, styles);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    }

    function formatDate(date, lang = null) {
        const locale = lang || localStorage.getItem('preferredLanguage') || 'ru';
        const d = new Date(date);
        return d.toLocaleDateString(locale === 'en' ? 'en-US' : 'ru-RU', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    function cacheGet(key, ttl = CONFIG.CACHE_TTL) {
        const session = sessionStorage.getItem(key);
        const sessionTime = sessionStorage.getItem(`${key}_time`);
        if (session && sessionTime && (Date.now() - parseInt(sessionTime) < ttl)) {
            return JSON.parse(session);
        }
        try {
            const local = localStorage.getItem(key);
            const localTime = localStorage.getItem(`${key}_time`);
            if (local && localTime && (Date.now() - parseInt(localTime) < ttl)) {
                sessionStorage.setItem(key, local);
                sessionStorage.setItem(`${key}_time`, localTime);
                return JSON.parse(local);
            }
        } catch {}
        return null;
    }

    function cacheSet(key, data) {
        const str = JSON.stringify(data);
        sessionStorage.setItem(key, str);
        sessionStorage.setItem(`${key}_time`, Date.now().toString());
        try {
            localStorage.setItem(key, str);
            localStorage.setItem(`${key}_time`, Date.now().toString());
        } catch {}
    }

    function cacheRemove(key) {
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(`${key}_time`);
        try {
            localStorage.removeItem(key);
            localStorage.removeItem(`${key}_time`);
        } catch {}
    }

    function cacheRemoveByPrefix(prefix) {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith(prefix)) {
                sessionStorage.removeItem(k);
                sessionStorage.removeItem(k + '_time');
            }
        }
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.startsWith(prefix)) {
                    localStorage.removeItem(k);
                    localStorage.removeItem(k + '_time');
                }
            }
        } catch {}
    }

    function deduplicateByNumber(items) {
        const seen = new Set();
        return items.filter(i => {
            if (seen.has(i.number)) return false;
            seen.add(i.number);
            return true;
        });
    }

    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function throttle(fn, delay) {
        let last = 0;
        return function(...args) {
            const now = Date.now();
            if (now - last >= delay) {
                last = now;
                fn.apply(this, args);
            }
        };
    }

    function renderMarkdown(text) {
        if (!text) return '';
        if (window.marked) {
            if (typeof marked.setOptions === 'function') {
                marked.setOptions({ gfm: true, breaks: true, headerIds: false, mangle: false });
            }
            if (typeof marked.parse === 'function') {
                return marked.parse(text);
            } else if (typeof marked === 'function') {
                return marked(text);
            }
        }
        return text.replace(/\n/g, '<br>');
    }

    function createAbortable(timeout = 20000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return { controller, timeoutId };
    }

    const loadedScripts = new Set();
    function loadModule(path) {
        if (loadedScripts.has(path)) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = path;
            script.async = true;
            script.onload = () => { loadedScripts.add(path); resolve(); };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Очищает текст от Markdown-разметки, HTML-тегов, ссылок и изображений,
     * оставляя только "содержательный" текст для подсчёта символов.
     * @param {string} text - Исходный текст (Markdown/HTML)
     * @returns {string} Очищенный текст без разметки
     */
    function stripMarkdownAndHtml(text) {
        if (!text) return '';
        let cleaned = text;

        // Убираем HTML-теги (включая их содержимое для блоков, но оставляем текст внутри)
        // Сначала заменяем <details>...</details> на пустую строку, чтобы убрать спойлеры целиком
        cleaned = cleaned.replace(/<details[\s\S]*?<\/details>/gi, '');
        // Убираем все остальные HTML-теги, оставляя только текст
        cleaned = cleaned.replace(/<[^>]*>/g, ' ');

        // Удаляем Markdown-ссылки [текст](url) – оставляем только текст
        cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
        // Удаляем изображения ![](url) – полностью убираем
        cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
        // Удаляем YouTube-вставки <div class="youtube-embed">...</div>
        cleaned = cleaned.replace(/<div class="youtube-embed">[\s\S]*?<\/div>/gi, '');
        // Удаляем оставшиеся ссылки типа https://
        cleaned = cleaned.replace(/\bhttps?:\/\/[^\s]+/g, '');
        // Удаляем символы Markdown: #, *, _, ~, `, >, -, +, =, | и т.д.
        cleaned = cleaned.replace(/[#*_~`>\-+=|]/g, ' ');
        // Удаляем множественные пробелы и переносы строк
        cleaned = cleaned.replace(/\s+/g, ' ').trim();

        return cleaned;
    }

    /**
     * Возвращает длину содержательного текста после удаления всей разметки.
     * @param {string} text - Исходный текст (Markdown/HTML)
     * @returns {number} Количество значимых символов
     */
    function getPlainTextLength(text) {
        const plain = stripMarkdownAndHtml(text);
        return plain.length;
    }

    /**
     * Проверяет, содержит ли текст потенциальный GitHub-токен.
     * Ищет паттерны: ghp_, github_pat_, gho_, ghu_, ghs_, gpl_, а также "github_token" в контексте.
     * @param {string} text - Проверяемый текст
     * @returns {boolean} true, если найден токен
     */
    function containsGitHubToken(text) {
        if (!text) return false;
        const patterns = [
            /ghp_[a-zA-Z0-9]{36}/,
            /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/,
            /gho_[a-zA-Z0-9]{36}/,
            /ghu_[a-zA-Z0-9]{36}/,
            /ghs_[a-zA-Z0-9]{36}/,
            /gpl_[a-zA-Z0-9]{36}/
        ];
        for (const p of patterns) {
            if (p.test(text)) return true;
        }
        // Дополнительно проверяем наличие строки "github_token" в кавычках или без
        if (/\bgithub_token\b/i.test(text)) return true;
        return false;
    }

    // ----- НОВЫЕ ФУНКЦИИ ШИФРОВАНИЯ -----
    // Простой XOR с ключом (для обфускации, не криптостойкий, но усложняет чтение)
    function xorEncrypt(data, key) {
        let result = '';
        for (let i = 0; i < data.length; i++) {
            result += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return btoa(unescape(encodeURIComponent(result)));
    }

    function xorDecrypt(encrypted, key) {
        try {
            const decoded = decodeURIComponent(escape(atob(encrypted)));
            let result = '';
            for (let i = 0; i < decoded.length; i++) {
                result += String.fromCharCode(decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return result;
        } catch (e) {
            return null;
        }
    }

    function generateRandomKey(length = 32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=';
        let key = '';
        for (let i = 0; i < length; i++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return key;
    }

    // ----- УНИВЕРСАЛЬНЫЙ ПАРСЕР YOUTUBE ССЫЛОК (добавлен) -----
    function parseYouTubeUrl(url) {
        try {
            const parsed = new URL(url);
            const isYoutube = parsed.hostname.includes('youtube.com') || parsed.hostname.includes('youtu.be') || parsed.hostname.includes('youtube-nocookie.com');
            if (!isYoutube) return null;

            let videoId = null;
            let playlistId = null;
            let start = null;

            // 1. Если ссылка уже embed – используем её как есть, добавив параметры
            if (parsed.pathname.includes('/embed/')) {
                // Извлекаем videoId из embed
                const parts = parsed.pathname.split('/embed/');
                if (parts.length > 1) {
                    const idPart = parts[1].split('?')[0];
                    if (idPart && idPart !== 'videoseries') {
                        videoId = idPart;
                    } else {
                        // Может быть плейлист через /embed/videoseries?list=...
                        const params = new URLSearchParams(parsed.search);
                        const list = params.get('list');
                        if (list) {
                            playlistId = list;
                        }
                    }
                }
                // Если есть videoId или playlistId, формируем embedUrl с параметрами
                if (videoId || playlistId) {
                    let embedUrl = `https://www.youtube-nocookie.com/embed/${videoId || 'videoseries'}`;
                    const queryParams = new URLSearchParams();
                    queryParams.set('rel', '0');
                    queryParams.set('modestbranding', '1');
                    queryParams.set('playsinline', '1');
                    queryParams.set('origin', location.origin);
                    if (playlistId) queryParams.set('list', playlistId);
                    if (start) queryParams.set('start', start);
                    // Добавляем все параметры из исходного URL, кроме тех, что уже есть
                    for (const [key, val] of parsed.searchParams) {
                        if (!queryParams.has(key) && key !== 'si') { // игнорируем si
                            queryParams.set(key, val);
                        }
                    }
                    const qs = queryParams.toString();
                    if (qs) embedUrl += '?' + qs;
                    return { embedUrl, videoId, playlistId, start };
                }
                // Если не удалось распознать, возвращаем исходную ссылку с добавлением origin
                let embedUrl = url;
                if (!embedUrl.includes('origin=')) {
                    const separator = embedUrl.includes('?') ? '&' : '?';
                    embedUrl += `${separator}origin=${encodeURIComponent(location.origin)}`;
                }
                return { embedUrl, videoId: null, playlistId: null, start: null };
            }

            // 2. Обработка youtu.be и обычных watch
            if (parsed.hostname.includes('youtu.be')) {
                const pathParts = parsed.pathname.split('/').filter(p => p);
                if (pathParts.length > 0) {
                    videoId = pathParts[0];
                }
            }

            const params = new URLSearchParams(parsed.search);
            if (params.has('v')) {
                videoId = params.get('v');
            }
            if (params.has('list')) {
                playlistId = params.get('list');
            }
            if (params.has('t')) {
                start = params.get('t');
            } else if (params.has('start')) {
                start = params.get('start');
            }

            // 3. Если нет videoId, но есть playlistId – используем плейлист
            if (!videoId && playlistId) {
                let embedUrl = `https://www.youtube-nocookie.com/embed/videoseries?list=${playlistId}`;
                if (start) embedUrl += `&start=${start}`;
                embedUrl += `&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
                return { embedUrl, videoId: null, playlistId, start };
            }

            // 4. Если есть videoId – формируем embed с ним и возможно list
            if (videoId) {
                let embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
                const queryParams = new URLSearchParams();
                queryParams.set('rel', '0');
                queryParams.set('modestbranding', '1');
                queryParams.set('playsinline', '1');
                queryParams.set('origin', location.origin);
                if (playlistId) queryParams.set('list', playlistId);
                if (start) queryParams.set('start', start);
                // Добавляем остальные параметры из исходного URL, кроме уже добавленных
                for (const [key, val] of parsed.searchParams) {
                    if (!queryParams.has(key) && key !== 'v' && key !== 'list' && key !== 't' && key !== 'start') {
                        queryParams.set(key, val);
                    }
                }
                const qs = queryParams.toString();
                if (qs) embedUrl += '?' + qs;
                return { embedUrl, videoId, playlistId, start };
            }

            // 5. Если ничего не найдено – пытаемся использовать как есть (возможно, просто ссылка на плейлист без v)
            if (parsed.pathname.includes('/playlist')) {
                const listParam = params.get('list');
                if (listParam) {
                    let embedUrl = `https://www.youtube-nocookie.com/embed/videoseries?list=${listParam}`;
                    if (start) embedUrl += `&start=${start}`;
                    embedUrl += `&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
                    return { embedUrl, videoId: null, playlistId: listParam, start };
                }
            }

            return null;
        } catch (e) {
            return null;
        }
    }

    window.Utils = {
        escapeHtml, stripHtml, createElement, formatDate,
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
        deduplicateByNumber, debounce, throttle, renderMarkdown,
        createAbortable, loadModule,
        stripMarkdownAndHtml,
        getPlainTextLength,
        containsGitHubToken,
        xorEncrypt,
        xorDecrypt,
        generateRandomKey,
        parseYouTubeUrl   // новая функция
    };
})();