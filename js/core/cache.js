// cache.js — единый модуль кеширования с поддержкой версий
const CACHE_VERSION = 'v3';
const CACHE_TTL = 10 * 60 * 1000; // 10 минут

function getCacheKey(key) {
    return `${CACHE_VERSION}_${key}`;
}

function cacheGet(key) {
    const fullKey = getCacheKey(key);
    const cached = sessionStorage.getItem(fullKey);
    const time = sessionStorage.getItem(`${fullKey}_time`);
    if (cached && time && (Date.now() - parseInt(time) < CACHE_TTL)) {
        try {
            return JSON.parse(cached);
        } catch (e) {
            return null;
        }
    }
    return null;
}

function cacheSet(key, data) {
    const fullKey = getCacheKey(key);
    sessionStorage.setItem(fullKey, JSON.stringify(data));
    sessionStorage.setItem(`${fullKey}_time`, Date.now().toString());
}

function cacheRemove(key) {
    const fullKey = getCacheKey(key);
    sessionStorage.removeItem(fullKey);
    sessionStorage.removeItem(`${fullKey}_time`);
}

function cacheRemoveByPrefix(prefix) {
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.includes(prefix)) {
            keysToRemove.push(key);
            const timeKey = key + '_time';
            if (sessionStorage.getItem(timeKey)) keysToRemove.push(timeKey);
        }
    }
    keysToRemove.forEach(key => sessionStorage.removeItem(key));
}

function clearAllCache() {
    const keysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.startsWith(CACHE_VERSION) || key.includes('_time'))) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => sessionStorage.removeItem(key));
}

window.Cache = {
    get: cacheGet,
    set: cacheSet,
    remove: cacheRemove,
    removeByPrefix: cacheRemoveByPrefix,
    clearAll: clearAllCache,
    VERSION: CACHE_VERSION
};