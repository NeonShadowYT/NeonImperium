// js/core/github-core.js – ядро GitHub, общие утилиты и система действий
(function() {
    const CONFIG = {
        REPO_OWNER: 'NeonShadowYT',
        REPO_NAME: 'NeonImperium',
        CACHE_TTL: 10 * 60 * 1000,
        API_CACHE_TTL: 5 * 60 * 1000,
        IMAGE_CACHE_TTL: 30 * 24 * 60 * 60 * 1000,
        RELEASES_CACHE_TTL: 60 * 60 * 1000,
        ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567']
    };

    // Утилиты из Utils (предполагается, что они уже загружены)
    const {
        escapeHtml, stripHtml, createElement, formatDate,
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
        deduplicateByNumber, debounce, throttle, renderMarkdown,
        createAbortable, loadModule
    } = window.Utils;

    // Функции для приватных постов
    function extractMeta(body, tag) {
        const re = new RegExp(`<!--\\s*${tag}:\\s*(.*?)\\s*-->`, 'i');
        const match = body?.match(re);
        return match ? match[1].trim() : null;
    }
    const extractAllowed = body => extractMeta(body, 'allowed');
    const extractSummary = body => extractMeta(body, 'summary');

    function deriveKey(allowedStr) {
        if (!allowedStr) return 'default-key';
        let hash = 0;
        for (let i = 0; i < allowedStr.length; i++) {
            hash = ((hash << 5) - hash) + allowedStr.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(16);
    }

    function encryptPrivateBody(body, allowedStr) {
        if (!allowedStr) return body;
        const key = deriveKey(allowedStr);
        let result = '';
        for (let i = 0; i < body.length; i++) {
            result += String.fromCharCode(body.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return btoa(unescape(encodeURIComponent(result)));
    }

    function decryptPrivateBody(encBase64, allowedStr) {
        if (!allowedStr) return encBase64;
        try {
            const encrypted = decodeURIComponent(escape(atob(encBase64)));
            const key = deriveKey(allowedStr);
            let result = '';
            for (let i = 0; i < encrypted.length; i++) {
                result += String.fromCharCode(encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return result;
        } catch (e) {
            console.warn('Decrypt failed', e);
            return encBase64;
        }
    }

    // ---------- Единая система выполнения действий с лимитами и очередью ----------
    // Типы действий: 'posts', 'comments', 'storageAdds', 'cacheClears', 'reactions'
    // payload содержит все необходимые данные для выполнения и проверки дубликатов

    async function performAction(actionType, payload, asyncFn) {
        // Проверяем, что RateLimits загружен
        if (!window.RateLimits) {
            await loadModule('js/features/rate-limits.js');
        }

        // Проверяем лимит
        if (!window.RateLimits.checkLimit(actionType)) {
            // Лимит исчерпан – ставим в очередь
            const enqueued = await window.RateLimits.enqueueAction(actionType, payload);
            // Возвращаем статус "в очереди"
            return { queued: true, actionId: enqueued };
        }

        // Пытаемся выполнить действие
        try {
            const result = await asyncFn();
            // Успешно – инкрементим счётчик
            window.RateLimits.increment(actionType);
            // Возвращаем результат
            return { queued: false, result };
        } catch (err) {
            // Если ошибка связана с сетью, авторизацией или лимитами GitHub – ставим в очередь
            if (isRetryableError(err)) {
                const enqueued = await window.RateLimits.enqueueAction(actionType, payload);
                return { queued: true, actionId: enqueued };
            }
            // Иначе пробрасываем ошибку
            throw err;
        }
    }

    function isRetryableError(err) {
        // Сетевые ошибки (TypeError, AbortError) и ошибки HTTP 429, 5xx, 401? 401 обычно не retry, но можно повторить
        if (err instanceof TypeError || err.name === 'AbortError') return true;
        if (err.status && (err.status === 429 || err.status >= 500)) return true;
        if (err.message && (err.message.includes('rate limit') || err.message.includes('secondary'))) return true;
        return false;
    }

    // Функция для проверки актуальности действия перед выполнением из очереди
    // Возвращает true, если действие ещё актуально и должно быть выполнено
    async function isActionStillValid(actionType, payload) {
        // Для реакций: проверяем, не установлена ли уже реакция пользователем
        if (actionType === 'reactions') {
            const { issueNumber, content } = payload;
            const currentUser = window.GithubAuth?.getCurrentUser();
            if (!currentUser) return false; // если пользователь вышел, действие не нужно
            try {
                const reactions = await window.GithubAPI.loadReactions(issueNumber);
                // Проверяем, есть ли уже реакция от этого пользователя с таким контентом
                const exists = reactions.some(r => r.user.login === currentUser && r.content === content);
                // Если реакция уже существует, действие не нужно
                return !exists;
            } catch (e) {
                // Если не удалось проверить, считаем, что действие всё ещё актуально (будет выполнено, а ошибка обработается)
                return true;
            }
        }

        // Для комментариев: проверяем, не был ли уже отправлен такой же комментарий пользователем
        if (actionType === 'comments') {
            const { issueNumber, body } = payload;
            const currentUser = window.GithubAuth?.getCurrentUser();
            if (!currentUser) return false;
            try {
                const comments = await window.GithubAPI.loadComments(issueNumber);
                // Ищем комментарий от пользователя с таким же текстом (игнорируем пробелы)
                const exists = comments.some(c => c.user.login === currentUser && c.body.trim() === body.trim());
                return !exists;
            } catch (e) {
                return true;
            }
        }

        // Для постов (создание/обновление): проверяем, не закрыт ли уже issue (если есть id)
        if (actionType === 'posts') {
            const { id, mode } = payload;
            if (mode === 'edit' && id) {
                try {
                    const issue = await window.GithubAPI.loadIssue(id);
                    // Если issue закрыт или удалён (state === 'closed'), то редактирование не нужно
                    return issue.state !== 'closed';
                } catch (e) {
                    // Если не удалось загрузить, возможно, его уже нет – считаем неактуальным
                    return false;
                }
            }
            // Для новых постов всегда актуально (если не дублируется)
            return true;
        }

        // Для закладок (storageAdds): проверяем, не добавлена ли уже такая закладка
        if (actionType === 'storageAdds') {
            const { bookmark } = payload;
            // Если есть url, проверяем по url
            if (bookmark.url) {
                const currentUser = window.GithubAuth?.getCurrentUser();
                if (!currentUser) return false;
                try {
                    const res = await window.BookmarkStorage.loadBookmarks();
                    const exists = res.bookmarks.some(b => b.url === bookmark.url);
                    return !exists;
                } catch (e) {
                    return true;
                }
            }
            // Для файлов проверяем по хешу (если есть)
            if (bookmark.saveData && bookmark.saveData.hash) {
                try {
                    const res = await window.BookmarkStorage.loadBookmarks();
                    const exists = res.bookmarks.some(b => b.saveData && b.saveData.hash === bookmark.saveData.hash);
                    return !exists;
                } catch (e) {
                    return true;
                }
            }
            return true;
        }

        // Для очистки кеша – всегда актуально (можно выполнять повторно)
        if (actionType === 'cacheClears') {
            return true;
        }

        // По умолчанию считаем актуальным
        return true;
    }

    // Экспорт
    window.GithubCore = {
        CONFIG,
        escapeHtml, stripHtml, createElement, formatDate,
        cacheGet, cacheSet, cacheRemove, cacheRemoveByPrefix,
        deduplicateByNumber, debounce, throttle, renderMarkdown,
        createAbortable, loadModule,
        extractMeta, extractAllowed, extractSummary,
        encryptPrivateBody, decryptPrivateBody,
        performAction,
        isActionStillValid,
        isRetryableError
    };
})();