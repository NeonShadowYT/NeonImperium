// js/core/config.js
window.NeonConfig = {
    REPO_OWNER: 'NeonShadowYT',
    REPO_NAME: 'NeonImperium',
    CACHE_TTL: 10 * 60 * 1000,          // 10 минут
    CACHE_VERSION: 'v2',                // для сброса кеша при обновлении структуры
    ALLOWED_AUTHORS: ['NeonShadowYT', 'GoldenCreeper567'],
    YOUTUBE_CHANNELS: [
        { id: 'UC2pH2qNfh2sEAeYEGs1k_Lg', name: 'Neon Shadow' },
        { id: 'UCxuByf9jKs6ijiJyrMKBzdA', name: 'Оборотень' },
        { id: 'UCQKVSv62dLsK3QnfIke24uQ', name: 'Golden Creeper' },
        { id: 'UCcuqf3fNtZ2UP5MO89kVKLw', name: 'Mitmi' }
    ],
    REACTION_TYPES: [
        { content: '+1', emoji: '👍' },
        { content: '-1', emoji: '👎' },
        { content: 'laugh', emoji: '😄' },
        { content: 'confused', emoji: '😕' },
        { content: 'heart', emoji: '❤️' },
        { content: 'hooray', emoji: '🎉' },
        { content: 'rocket', emoji: '🚀' },
        { content: 'eyes', emoji: '👀' }
    ],
    DEFAULT_IMAGE: 'images/default-news.webp'
};