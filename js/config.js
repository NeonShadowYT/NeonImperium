// js/config.js — централизованная конфигурация для всего проекта.
// Доступна как window.NeonConfig (в браузере) и self.NeonConfig (в Service Worker).
// Дополнительно устанавливает window.isMobile — флаг мобильного устройства,
// который используется модулями (background-gifs.js, dust-particles.js и др.)
// ДО загрузки common-init.js.
(function() {
  const NeonConfig = {
    // ---- GitHub репозиторий ----
    REPO_OWNER: 'NeonShadowYT',
    REPO_NAME: 'NeonImperium',

    // ---- TTL кэшей (мс) ----
    CACHE_TTL: 10 * 60 * 1000,          // 10 минут — общий клиентский кэш
    API_CACHE_TTL: 5 * 60 * 1000,       // 5 минут — GitHub API
    IMAGE_CACHE_TTL: 30 * 24 * 60 * 60 * 1000, // 30 дней — изображения
    RELEASES_CACHE_TTL: 60 * 60 * 1000, // 1 час — GitHub Releases

    // ---- Администраторы (доп. права) ----
    ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567'],

    // ---- Background Sync ----
    SYNC_TAG: 'github-queue-sync',

    // ---- Ключи, которые НЕ шифруются и НЕ удаляются при очистке кэша ----
    CACHE_EXCLUDED_KEYS: [
      'rate_limits',
      'rate_history',
      'license_agreed_v1',
      'license_version',
      'license_agreed_timestamp',
      'preferredLanguage',
      'github_token',
      'github_token_local',
      'remember_me',
      'last_cache_clear',
      'cache_encryption_key',
      'storage_token_hash',
      'storage_password'
    ],

    // ---- Имена кэшей Service Worker ----
    SW_CACHE_NAMES: {
      STATIC: 'static-v9',
      DYNAMIC: 'dynamic-v9',
      IMAGES: 'images-v9',
      API: 'github-api-v9',
      RSS: 'rss-v3'
    },

    // ---- TTL для SW-кэшей (мс) ----
    SW_CACHE_MAX_AGE: {
      API: 5 * 60 * 1000,                 // 5 минут
      IMAGES: 30 * 24 * 60 * 60 * 1000,   // 30 дней
      RSS: 30 * 60 * 1000                 // 30 минут
    }
  };

  // ---- Определение мобильного устройства ----
  // Выполняем здесь, чтобы window.isMobile был доступен ДО common-init.js.
  const _isMobile = (() => {
    try {
      const hasTouch = window.matchMedia('(pointer: coarse)').matches ||
                       window.matchMedia('(hover: none)').matches ||
                       ('ontouchstart' in window);
      const isNarrow = window.innerWidth <= 768;
      return hasTouch || isNarrow;
    } catch (e) {
      return false;
    }
  })();
  NeonConfig.IS_MOBILE = _isMobile;

  // Публикуем глобально: в браузере self === window, в Service Worker self — ServiceWorkerGlobalScope.
  self.NeonConfig = NeonConfig;
  if (typeof window !== 'undefined') {
    window.NeonConfig = NeonConfig;
    window.isMobile = _isMobile;
  }
})();