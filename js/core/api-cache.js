// js/core/api-cache.js
// Асинхронный кэш с шифрованием через CacheCrypto (AES-GCM).
// TTL, инвалидация по префиксу, защита от повреждённых записей.
// Ключи из EXCLUDED_KEYS хранятся без шифрования.
//
// БЕЗОПАСНОСТЬ — fail-open в isExcludedKey:
//   Если CacheCrypto не загружен (ошибка порядка скриптов, сетевой сбой),
//   isExcludedKey возвращает true → ключ НЕ шифруется, но сохраняется.
//   Это осознанный выбор: устойчивость к сбоям важнее, чем принцип
//   fail-closed, потому что полная потеря кэша ломает UX.
//   Однако при отсутствии CacheCrypto:
//     — значения, помеченные как НЕ-excluded, попадут в storage в открытом виде;
//     — при повторном запуске с загруженным CacheCrypto они не расшифруются.
//   В Промпте 4 (безопасность) будет рассмотрен вариант fail-closed:
//   «не сохраняем значения, требующие шифрования, если шифратор недоступен».
//
// СЕМАНТИКА cacheGet:
//   — undefined — ключа нет ни в sessionStorage, ни в localStorage
//     (или ключ небезопасен).
//   — null      — ключ существует, но значение было JSON null.
//   — <value>   — распарсенное значение.
//
// Публикует window.ApiCache и расширяет window.Utils для обратной совместимости.

(function() {
    'use strict';

    const NC = (typeof window !== 'undefined' && window.NeonConfig) || {};
    const DEFAULT_TTL = NC.CACHE_TTL || 10 * 60 * 1000;
    const MAX_KEY_LENGTH = 256;

    const DANGEROUS_KEYS = Object.freeze(new Set([
        '__proto__',
        'constructor',
        'prototype',
        'toString',
        'valueOf',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        'toLocaleString'
    ]));

    function isSafeKey(key) {
        return typeof key === 'string'
            && key.length > 0
            && key.length <= MAX_KEY_LENGTH
            && !DANGEROUS_KEYS.has(key);
    }

    // ВНИМАНИЕ: fail-open (см. доккоментарий выше).
    function isExcludedKey(key) {
        if (!key) return true;
        if (window.CacheCrypto && typeof window.CacheCrypto.isExcludedKey === 'function') {
            try { return window.CacheCrypto.isExcludedKey(key); }
            catch { return true; }
        }
        return true;
    }

    async function decryptIfNeeded(raw, key) {
        if (raw === null || raw === undefined) return undefined;

        if (isExcludedKey(key)) {
            try { return JSON.parse(raw); }
            catch { return undefined; }
        }

        if (!window.CacheCrypto || typeof window.CacheCrypto.decryptCacheValue !== 'function') {
            try { return JSON.parse(raw); }
            catch { return undefined; }
        }

        let decrypted;
        try { decrypted = await window.CacheCrypto.decryptCacheValue(raw); }
        catch { return undefined; }

        if (decrypted === null) return undefined;
        try { return JSON.parse(decrypted); }
        catch { return undefined; }
    }

    async function encryptIfNeeded(data, key) {
        const str = JSON.stringify(data);
        if (isExcludedKey(key)) return str;
        if (!window.CacheCrypto || typeof window.CacheCrypto.encryptCacheValue !== 'function') {
            return str;
        }
        try {
            return await window.CacheCrypto.encryptCacheValue(str);
        } catch (e) {
            console.warn('[ApiCache] Ошибка шифрования, сохраняем как есть:', e);
            return str;
        }
    }

    async function cacheGet(key, ttl = DEFAULT_TTL) {
        if (!isSafeKey(key)) return undefined;

        const now = Date.now();

        try {
            const rawSession = sessionStorage.getItem(key);
            if (rawSession !== null) {
                const sessionTime = sessionStorage.getItem(key + '_time');
                const time = sessionTime ? parseInt(sessionTime, 10) : NaN;
                if (!isNaN(time) && (now - time < ttl)) {
                    const value = await decryptIfNeeded(rawSession, key);
                    if (value !== undefined) return value;
                    sessionStorage.removeItem(key);
                    sessionStorage.removeItem(key + '_time');
                }
            }
        } catch (e) { /* noop */ }

        try {
            const rawLocal = localStorage.getItem(key);
            if (rawLocal !== null) {
                const localTime = localStorage.getItem(key + '_time');
                const time = localTime ? parseInt(localTime, 10) : NaN;
                if (!isNaN(time) && (now - time < ttl)) {
                    const value = await decryptIfNeeded(rawLocal, key);
                    if (value !== undefined) {
                        try {
                            sessionStorage.setItem(key, rawLocal);
                            sessionStorage.setItem(key + '_time', localTime);
                        } catch (e) { /* noop */ }
                        return value;
                    }
                    localStorage.removeItem(key);
                    localStorage.removeItem(key + '_time');
                }
            }
        } catch (e) { /* noop */ }

        return undefined;
    }

    async function cacheSet(key, data) {
        if (!isSafeKey(key)) return;

        const stored = await encryptIfNeeded(data, key);
        const now = String(Date.now());

        try {
            sessionStorage.setItem(key, stored);
            sessionStorage.setItem(key + '_time', now);
        } catch (e) { /* noop */ }

        try {
            localStorage.setItem(key, stored);
            localStorage.setItem(key + '_time', now);
        } catch (e) { /* noop */ }
    }

    function cacheRemove(key) {
        if (!isSafeKey(key)) return;
        try {
            sessionStorage.removeItem(key);
            sessionStorage.removeItem(key + '_time');
        } catch (e) { /* noop */ }
        try {
            localStorage.removeItem(key);
            localStorage.removeItem(key + '_time');
        } catch (e) { /* noop */ }
    }

    function cacheRemoveByPrefix(prefix) {
        if (typeof prefix !== 'string' || prefix.length === 0) return;
        if (prefix.length > MAX_KEY_LENGTH) return;

        try {
            for (let i = sessionStorage.length - 1; i >= 0; i--) {
                const k = sessionStorage.key(i);
                if (k && k.startsWith(prefix)) {
                    sessionStorage.removeItem(k);
                    sessionStorage.removeItem(k + '_time');
                }
            }
        } catch (e) { /* noop */ }

        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.startsWith(prefix)) {
                    localStorage.removeItem(k);
                    localStorage.removeItem(k + '_time');
                }
            }
        } catch (e) { /* noop */ }
    }

    const api = {
        cacheGet,
        cacheSet,
        cacheRemove,
        cacheRemoveByPrefix,
        isSafeKey,
        DEFAULT_TTL
    };

    window.ApiCache = api;
    window.Utils = Object.assign(window.Utils || {}, {
        cacheGet,
        cacheSet,
        cacheRemove,
        cacheRemoveByPrefix
    });
})();