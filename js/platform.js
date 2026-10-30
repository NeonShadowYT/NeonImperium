// js/platform.js — выбор платформы, архитектуры, версии ОС и версии релиза.
//
// Поддержка: Windows (7/8/8.1/10/11), Android (7+), Linux, macOS, Web (Скоро).
//
// ── МЕТКИ В ТЕЛЕ РЕЛИЗА ───────────────────────────────────────
// OS-версия (только для своей платформы):
//   os: win7              → только Windows-ассеты, минимум Windows 7
//   os: windows10         → только Windows
//   os: android7          → только Android
//   os: macos10           → только macOS
//   os: win7 / os: android7 одновременно — независимы.
//
// Архитектура (только для совместимых платформ):
//   arch: x64             → Windows / Linux / macOS
//   arch: arm64           → Windows / Android / Linux / macOS
//   arch: universal       → macOS / Windows
//   arch: windows x64     → только Windows
//   arch: android arm64   → только Android
//
// ── ПРИОРИТЕТ МЕТОК ──────────────────────────────────────────
//   Имя файла > тело релиза.
//   ЕСЛИ В ИМЕНИ ФАЙЛА ЕСТЬ ТОЛЬКО СЛОВО «windows» / «android» / «macos»
//   БЕЗ НОМЕРА ВЕРСИИ — ЭТО НЕ СЧИТАЕТСЯ МЕТКОЙ. Версия ОС берётся
//   из описания релиза (os: win7 и т.п.), если там есть.
//   Пример: «StarveNeon_Windows_x64.zip» + «os: win10» → применится win10.
//
// ── СОВМЕСТИМОСТЬ ────────────────────────────────────────────
//   — Метка ОС = минимальная версия (win7 работает на 7–11).
//   — 32-bit запускается на 64-bit (x86 → x64, arm32 → arm64).
//   — 64-bit на 32-bit НЕ запускается.
//   — universal работает везде.
//
// ── КЕШИРОВАНИЕ ──────────────────────────────────────────────
//   1. sessionStorage — TTL 1 час.
//   2. Service Worker — NetworkFirst + TTL 5 мин для api.github.com.
//   3. Stale fallback — при сетевой ошибке возвращается устаревший кеш.

(function () {
    'use strict';

    const NeonConfig = (typeof window !== 'undefined' && window.NeonConfig) || {};
    const GH_OWNER = NeonConfig.REPO_OWNER || 'NeonShadowYT';
    const GH_REPO = NeonConfig.REPO_NAME || 'NeonImperium';
    const RELEASES_CACHE_KEY = 'github_all_releases';
    const CACHE_DURATION = NeonConfig.RELEASES_CACHE_TTL || 60 * 60 * 1000;

    let currentAbortController = null;
    let platformInitialized = false;

    const gameTag = location.pathname.split('/').pop().replace('.html', '') || 'starve-neon';

    // ============================================================
    // Локализация
    // ============================================================

    function t(key, params) {
        let text = (window.I18n && typeof window.I18n.translate === 'function')
            ? window.I18n.translate(key)
            : key;

        if (params && typeof text === 'string') {
            for (const [k, v] of Object.entries(params)) {
                text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
            }
        }
        return text;
    }

    function escapeHtml(text) {
        if (text == null) return '';
        return String(text).replace(/[&<>"']/g, c => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c]));
    }

    // ============================================================
    // Константы
    // ============================================================

    const PLATFORMS = [
        { id: 'Windows', label: 'Win',     icon: 'fab fa-windows' },
        { id: 'Android', label: 'Android', icon: 'fab fa-android' },
        { id: 'Linux',   label: 'Linux',   icon: 'fab fa-linux' },
        { id: 'macOS',   label: 'macOS',   icon: 'fab fa-apple' },
        { id: 'Web',     label: 'Web',     icon: 'fas fa-globe', soon: true }
    ];

    const ARCH_LABEL_KEYS = {
        x64:       'archX64',
        x86:       'archX86',
        arm64:     'archArm64',
        arm32:     'archArm32',
        universal: 'archUniversal',
        unknown:   'archUnknown'
    };

    const TYPE_LABEL_KEYS = {
        installer: 'typeInstaller',
        archive:   'typeArchive',
        package:   'typePackage',
        app:       'typeApp'
    };

    const ARCH_ORDER = ['x64', 'x86', 'arm64', 'arm32', 'universal', 'unknown'];

    const PLATFORM_ARCH_MATRIX = {
        x64:       ['Windows', 'Linux', 'macOS'],
        x86:       ['Windows', 'Linux'],
        arm64:     ['Windows', 'Android', 'Linux', 'macOS'],
        arm32:     ['Android', 'Linux'],
        universal: ['macOS', 'Windows'],
        unknown:   []
    };

    function getArchLabel(arch) {
        const key = ARCH_LABEL_KEYS[arch];
        return key ? t(key) : arch;
    }

    function getTypeLabel(type) {
        const key = TYPE_LABEL_KEYS[type];
        return key ? t(key) : type;
    }

    function isArchRelevantForPlatform(arch, platform) {
        if (!arch || arch === 'unknown') return false;
        const list = PLATFORM_ARCH_MATRIX[arch];
        if (!list) return false;
        return list.includes(platform);
    }

    // ============================================================
    // Совместимость
    // ============================================================

    function isArchCompatible(userArch, fileArch) {
        if (!fileArch || fileArch === 'unknown' || fileArch === 'universal') return true;
        if (!userArch || userArch === 'unknown') return true;
        if (userArch === fileArch) return true;
        if (userArch === 'x64' && fileArch === 'x86') return true;
        if (userArch === 'arm64' && fileArch === 'arm32') return true;
        return false;
    }

    function preferArch(userArch, available) {
        if (!available || available.length === 0) return 'unknown';
        if (userArch && available.includes(userArch)) return userArch;
        if (userArch === 'x64' && available.includes('x86')) return 'x86';
        if (userArch === 'arm64' && available.includes('arm32')) return 'arm32';
        if (available.includes('universal')) return 'universal';
        if (available.includes('unknown')) return 'unknown';
        return available[0];
    }

    function isOSCompatible(userOS, fileMinMajor) {
        if (fileMinMajor === null || fileMinMajor === undefined) return true;
        if (!userOS || userOS.major === null || userOS.major === undefined) return true;
        return userOS.major >= fileMinMajor;
    }

    // ============================================================
    // Кеширование
    // ============================================================

    function cacheGet(key) {
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const { data, ts } = JSON.parse(raw);
            if (Date.now() - ts < CACHE_DURATION) return data;
        } catch { /* noop */ }
        return null;
    }

    function cacheGetStale(key) {
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const { data } = JSON.parse(raw);
            return data || null;
        } catch { return null; }
    }

    function cacheSet(key, data) {
        try {
            sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
        } catch { /* noop */ }
    }

    // ============================================================
    // Форматирование
    // ============================================================

    function formatSize(bytes) {
        if (!bytes || isNaN(bytes) || bytes <= 0) return '';
        if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
        return (bytes / 1e6).toFixed(1) + ' MB';
    }

    function formatDate(dateStr) {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function formatCustomDate(date) {
        if (!date || isNaN(date.getTime())) return null;
        return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    // ============================================================
    // Определение ОС и архитектуры пользователя
    // ============================================================

    function getOS() {
        const ua = navigator.userAgent;
        const platform = (navigator.userAgentData && navigator.userAgentData.platform)
            || navigator.platform
            || '';

        if (/android/i.test(ua)) return 'Android';
        if (/iphone|ipad|ipod/i.test(ua)) return 'Web';
        if (/mac/i.test(platform) || /Macintosh/i.test(ua)) return 'macOS';
        if (/win/i.test(platform) || /Windows/i.test(ua)) return 'Windows';
        if (/linux/i.test(platform) || /Linux/i.test(ua)) return 'Linux';
        return 'Windows';
    }

    async function detectUserArchitecture() {
        if (navigator.userAgentData &&
            typeof navigator.userAgentData.getHighEntropyValues === 'function') {
            try {
                const ua = await navigator.userAgentData.getHighEntropyValues([
                    'architecture', 'bitness'
                ]);
                const arch = String(ua.architecture || '').toLowerCase();
                const bits = String(ua.bitness || '');
                if (arch.includes('arm')) return bits === '64' ? 'arm64' : 'arm32';
                if (arch.includes('x86')) return bits === '64' ? 'x64' : 'x86';
            } catch { /* noop */ }
        }

        const ua = navigator.userAgent;
        if (/arm64|aarch64/i.test(ua)) return 'arm64';
        if (/armv7|armhf|arm32/i.test(ua)) return 'arm32';
        if (/WOW64/i.test(ua)) return 'x64';
        if (/x86_64|amd64|win64|x64|intel64/i.test(ua)) return 'x64';
        if (/i386|i686|ia32/i.test(ua)) return 'x86';
        return 'unknown';
    }

    async function detectUserOSVersion() {
        const platform = getOS();

        if (platform === 'Windows') {
            if (navigator.userAgentData &&
                typeof navigator.userAgentData.getHighEntropyValues === 'function') {
                try {
                    const ua = await navigator.userAgentData.getHighEntropyValues([
                        'platformVersion'
                    ]);
                    const raw = String(ua.platformVersion || '');
                    if (raw) {
                        const major = parseInt(raw.split('.')[0], 10);
                        if (!isNaN(major)) {
                            let version = '10';
                            if (major >= 13) version = '11';
                            else if (major > 0) version = '10';
                            return { platform: 'Windows', version, major };
                        }
                    }
                } catch { /* noop */ }
            }

            const ua = navigator.userAgent;
            if (/Windows NT 10\.0/.test(ua)) return { platform: 'Windows', version: '10', major: 10 };
            if (/Windows NT 6\.3/.test(ua)) return { platform: 'Windows', version: '8.1', major: 8.1 };
            if (/Windows NT 6\.2/.test(ua)) return { platform: 'Windows', version: '8', major: 8 };
            if (/Windows NT 6\.1/.test(ua)) return { platform: 'Windows', version: '7', major: 7 };
            return null;
        }

        if (platform === 'Android') {
            const match = navigator.userAgent.match(/Android\s+([\d.]+)/i);
            if (match) {
                const full = match[1];
                const major = parseInt(full.split('.')[0], 10);
                if (!isNaN(major)) return { platform: 'Android', version: full, major };
            }
            return null;
        }

        if (platform === 'macOS') {
            if (navigator.userAgentData &&
                typeof navigator.userAgentData.getHighEntropyValues === 'function') {
                try {
                    const ua = await navigator.userAgentData.getHighEntropyValues([
                        'platformVersion'
                    ]);
                    const raw = String(ua.platformVersion || '');
                    if (raw) {
                        const major = parseInt(raw.split('.')[0], 10);
                        if (!isNaN(major)) return { platform: 'macOS', version: raw, major };
                    }
                } catch { /* noop */ }
            }
            return null;
        }

        return null;
    }

    // ============================================================
    // Парсинг имён файлов
    // ============================================================

    function normalizeArch(name) {
        const s = String(name || '').toLowerCase().replace(/[^a-z0-9._-]/g, ' ');

        if (/(arm64|aarch64|apple[\s-]?silicon|m1|m2|armv8|arm64-v8a)/.test(s)) return 'arm64';
        if (/(armv7|armhf|arm32|armeabi-v7a|arm(?!64))/.test(s)) return 'arm32';
        if (/(x86_64|x86-64|amd64|win64|x64|intel64)/.test(s)) return 'x64';
        if (/(i386|i686|ia32|win32|x86(?!_64)|32bit|32-bit|x32)/.test(s)) return 'x86';
        if (/(universal|fat)/.test(s)) return 'universal';
        return 'unknown';
    }

    /**
     * Возвращает { version, major } ТОЛЬКО если в строке есть номер версии.
     * Слово платформы без числа (windows / android / macos / osx) — не метка.
     * Возвращает null, если версии нет.
     */
    function normalizeOSVersion(name, platform) {
        const s = String(name || '').toLowerCase().replace(/[^a-z0-9._-]/g, ' ');

        if (platform === 'Windows') {
            const m = s.match(/(?:win|windows)\s*(\d{1,2})/);
            if (m) {
                const major = parseInt(m[1], 10);
                if (!isNaN(major) && major >= 7 && major <= 11) {
                    return { version: String(major), major };
                }
            }
            return null;
        }

        if (platform === 'Android') {
            const m = s.match(/android\s*(\d{1,2})/);
            if (m) {
                const major = parseInt(m[1], 10);
                if (!isNaN(major) && major >= 4) return { version: String(major), major };
            }
            return null;
        }

        if (platform === 'macOS') {
            const m = s.match(/macos\s*(\d{1,2})/);
            if (m) {
                const major = parseInt(m[1], 10);
                if (!isNaN(major) && major >= 10) return { version: String(major), major };
            }
            const m2 = s.match(/osx\s*(\d{1,2})/);
            if (m2) {
                const major = parseInt(m2[1], 10);
                if (!isNaN(major) && major >= 10) return { version: String(major), major };
            }
            return null;
        }

        return null;
    }

    function parseArchTag(tag, platform) {
        const s = String(tag || '')
            .toLowerCase()
            .replace(/[_:]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!s) return null;

        const platformMap = {
            'windows': 'Windows',
            'win':     'Windows',
            'android': 'Android',
            'linux':   'Linux',
            'macos':   'macOS',
            'mac':     'macOS',
            'osx':     'macOS'
        };

        for (const [prefix, targetPlatform] of Object.entries(platformMap)) {
            if (s === prefix || s.startsWith(prefix + ' ')) {
                const rest = s.slice(prefix.length).trim();
                if (!rest) return null;
                if (targetPlatform !== platform) return null;
                const arch = normalizeArch(rest);
                return arch === 'unknown' ? null : arch;
            }
        }

        const arch = normalizeArch(s);
        if (arch === 'unknown') return null;
        if (!isArchRelevantForPlatform(arch, platform)) return null;
        return arch;
    }

    function detectPlatformFromName(name) {
        const n = String(name || '').toLowerCase();

        if (/\.apk$/.test(n)) return 'Android';
        if (/\.(exe|msi)$/.test(n)) return 'Windows';
        if (/\.(dmg|pkg)$/.test(n)) return 'macOS';
        if (/\.app$/.test(n)) return 'macOS';
        if (/\.(appimage|deb|rpm|snap|flatpak)$/.test(n)) return 'Linux';

        if (/\.(tar\.gz|tar\.xz|tgz)$/.test(n)) {
            if (/(linux|ubuntu|debian)/.test(n)) return 'Linux';
            if (/(mac|macos|osx|darwin)/.test(n)) return 'macOS';
            return 'Windows';
        }

        if (/\.zip$/.test(n)) {
            if (/(android)/.test(n)) return 'Android';
            if (/(linux|ubuntu|debian)/.test(n)) return 'Linux';
            if (/(mac|macos|osx|darwin)/.test(n)) return 'macOS';
            return 'Windows';
        }

        if (/\.(7z|rar)$/.test(n)) {
            if (/(linux)/.test(n)) return 'Linux';
            if (/(mac)/.test(n)) return 'macOS';
            return 'Windows';
        }

        return null;
    }

    function getAssetType(name) {
        const n = String(name || '').toLowerCase();
        if (/\.(exe|msi|dmg|pkg|apk)$/.test(n)) return 'installer';
        if (/\.(appimage|deb|rpm|snap|flatpak)$/.test(n)) return 'package';
        if (/\.app$/.test(n)) return 'app';
        return 'archive';
    }

    // ============================================================
    // GitHub Releases
    // ============================================================

    async function fetchAllReleases() {
        const cached = cacheGet(RELEASES_CACHE_KEY);
        if (cached) return cached;

        if (currentAbortController) currentAbortController.abort();
        currentAbortController = new AbortController();
        const signal = currentAbortController.signal;

        try {
            const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases?per_page=100`;
            const resp = await fetch(url, { signal });
            if (!resp.ok) throw new Error('Failed to fetch releases');

            const releases = await resp.json();
            const filtered = releases.filter(r => !r.draft);
            cacheSet(RELEASES_CACHE_KEY, filtered);
            return filtered;
        } catch (e) {
            if (e.name === 'AbortError') return [];

            const stale = cacheGetStale(RELEASES_CACHE_KEY);
            if (stale) {
                console.warn('[Platform] Сеть недоступна, используем устаревший кеш');
                return stale;
            }
            throw e;
        } finally {
            currentAbortController = null;
        }
    }

    function parseMeta(body) {
        const meta = {};
        if (!body) return meta;

        const lines = body.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('game:')) {
                meta.game = line.slice(5).trim().toLowerCase();
            } else if (line.startsWith('version-name:')) {
                meta.versionName = line.slice(13).trim();
            } else if (line.startsWith('version-post:')) {
                meta.versionPost = line.slice(14).trim();
            } else if (line.startsWith('sort-order:')) {
                meta.sortOrder = parseInt(line.slice(11).trim(), 10);
            } else if (line.startsWith('arch:')) {
                const val = line.slice(5).trim();
                if (val) {
                    if (!meta.archTags) meta.archTags = [];
                    meta.archTags.push(val);
                }
            } else if (line.startsWith('os:')) {
                const val = line.slice(3).trim();
                if (val) {
                    if (!meta.osTags) meta.osTags = [];
                    meta.osTags.push(val);
                }
            } else if (line.startsWith('publish-date:')) {
                const raw = line.slice(13).trim();
                let date = null;
                let parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (parts) {
                    date = new Date(parseInt(parts[1]), parseInt(parts[2]) - 1, parseInt(parts[3]));
                } else {
                    parts = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
                    if (parts) {
                        date = new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]));
                    } else {
                        const d = Date.parse(raw);
                        if (!isNaN(d)) date = new Date(d);
                    }
                }
                if (date && !isNaN(date.getTime())) meta.publishDate = date;
            }
        }
        return meta;
    }

    function parseVersion(tag) {
        let versionStr = tag.replace(/^v/, '');
        let suffix = '';
        const match = versionStr.match(/(.+?)(?:\s+([pba]\d+))?$/);
        if (match) {
            versionStr = match[1].trim();
            suffix = match[2] || '';
        }
        const parts = versionStr.split('.').map(Number);
        return {
            major: parts[0] || 0,
            minor: parts[1] || 0,
            patch: parts[2] || 0,
            suffix,
            full: versionStr + (suffix ? ' ' + suffix : ''),
            tag
        };
    }

    function getReleaseType(version) {
        const s = version.suffix;
        if (s && s.includes('a')) return { type: 'alpha', priority: 3 };
        if (s && s.includes('b')) return { type: 'beta', priority: 2 };
        if (s && s.includes('p')) return { type: 'prerelease', priority: 1 };
        if (version.patch === 0) return { type: 'release', priority: 0 };
        return { type: 'patch', priority: 0 };
    }

    function sortReleasesByOrder(releases) {
        const withOrder = [];
        const withoutOrder = [];

        for (const release of releases) {
            const meta = parseMeta(release.body);
            if (meta.sortOrder !== undefined && !isNaN(meta.sortOrder)) {
                withOrder.push({ release, order: meta.sortOrder });
            } else {
                withoutOrder.push(release);
            }
        }

        withOrder.sort((a, b) => b.order - a.order);
        withoutOrder.sort((a, b) => {
            const vA = parseVersion(a.tag_name);
            const vB = parseVersion(b.tag_name);
            const typeA = getReleaseType(vA);
            const typeB = getReleaseType(vB);
            if (typeA.priority !== typeB.priority) return typeA.priority - typeB.priority;
            return new Date(b.published_at) - new Date(a.published_at);
        });

        return [...withOrder.map(item => item.release), ...withoutOrder];
    }

    async function getGameReleases() {
        const all = await fetchAllReleases();
        const filtered = all.filter(r => {
            const meta = parseMeta(r.body);
            return meta.game === gameTag;
        });
        return sortReleasesByOrder(filtered);
    }

    // ============================================================
    // Ассеты
    // ============================================================

    function parseAssets(release) {
        if (!release || !Array.isArray(release.assets)) return [];

        const meta = parseMeta(release.body);
        const bodyOsTags = meta.osTags || [];
        const bodyArchTags = meta.archTags || [];

        return release.assets.map(asset => {
            const platform = detectPlatformFromName(asset.name);
            if (!platform) return null;

            // ---- OS-версия ----
            // 1) Конкретная метка из имени файла (win7 / android7 / macos10)
            // 2) Fallback: метка из тела релиза
            // Слово платформы без номера (windows/android/macos) не считается меткой.
            let osMeta = normalizeOSVersion(asset.name, platform);
            if (!osMeta && bodyOsTags.length) {
                for (const tag of bodyOsTags) {
                    const parsed = normalizeOSVersion(tag, platform);
                    if (parsed) { osMeta = parsed; break; }
                }
            }

            // ---- Архитектура ----
            let arch = normalizeArch(asset.name);
            if (arch === 'unknown' && bodyArchTags.length) {
                for (const tag of bodyArchTags) {
                    const parsed = parseArchTag(tag, platform);
                    if (parsed) { arch = parsed; break; }
                }
            }

            return {
                name: asset.name,
                size: asset.size,
                url: asset.browser_download_url,
                platform,
                arch,
                type: getAssetType(asset.name),
                osVersion: osMeta ? osMeta.version : null,
                osMajor: osMeta ? osMeta.major : null
            };
        }).filter(Boolean);
    }

    function findAssetsFor(release, platform, arch) {
        const all = parseAssets(release).filter(a => a.platform === platform);
        if (arch === 'unknown') return all;
        return all.filter(a => {
            if (a.arch === 'unknown' || a.arch === 'universal') return true;
            return a.arch === arch;
        });
    }

    function getAvailableArchitectures(platform) {
        const set = new Set();
        allReleases.forEach(release => {
            parseAssets(release).forEach(a => {
                if (a.platform === platform) set.add(a.arch);
            });
        });
        return Array.from(set).sort(
            (a, b) => ARCH_ORDER.indexOf(a) - ARCH_ORDER.indexOf(b)
        );
    }

    // ============================================================
    // Состояние
    // ============================================================

    let allReleases = [];
    let currentPlatform = getOS();
    let currentArch = 'unknown';
    let currentRelease = null;
    let currentVariant = null;
    let userArch = 'unknown';
    let userOS = null;

    // ============================================================
    // DOM
    // ============================================================

    let githubContainer = null;
    let platformSelector = null;
    let archSelector = null;
    let archNote = null;
    let versionSelect = null;
    let versionDateEl = null;
    let variantTabs = null;
    let downloadBtn = null;
    let downloadLabel = null;
    let downloadFileInfo = null;
    let archWarning = null;
    let osWarning = null;
    let whatsNewBtn = null;

    // ============================================================
    // Платформы
    // ============================================================

    function renderPlatformSelector() {
        platformSelector.innerHTML = '';

        PLATFORMS.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'platform-btn' + (p.id === currentPlatform ? ' active' : '');
            if (p.soon) btn.classList.add('disabled');
            btn.dataset.platform = p.id;
            btn.setAttribute('aria-label', p.label + (p.soon ? ' — ' + t('platformSoon') : ''));
            btn.innerHTML =
                `<i class="${p.icon}" aria-hidden="true"></i>` +
                `<span class="platform-label">${escapeHtml(p.label)}</span>`;

            if (p.soon) {
                const badge = document.createElement('span');
                badge.className = 'badge-soon';
                badge.textContent = t('platformSoon');
                btn.appendChild(badge);
            }

            if (!p.soon) {
                btn.addEventListener('click', () => selectPlatform(p.id));
            }

            platformSelector.appendChild(btn);
        });
    }

    function selectPlatform(platformId) {
        if (platformId === 'Web') return;
        currentPlatform = platformId;
        currentVariant = null;
        currentArch = 'unknown';

        platformSelector.querySelectorAll('.platform-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.platform === platformId);
        });

        updateCloudVisibility(platformId);
        renderArchSelector(platformId);
        renderVersionSelect();
        updateDownloadUI();
    }

    function updateCloudVisibility(platform) {
        const cloudBlock = document.querySelector('.cloud-buttons')
            ?.closest('.download-subsection');

        if (cloudBlock) {
            cloudBlock.style.display =
                (platform === 'Windows' || platform === 'Android') ? '' : 'none';
        }

        document.querySelectorAll('.cloud-buttons .download-button[data-platform]')
            .forEach(cb => {
                cb.style.display = cb.dataset.platform === platform ? '' : 'none';
            });
    }

    // ============================================================
    // Архитектуры
    // ============================================================

    function renderArchSelector(platform) {
        const prevArch = currentArch;
        const available = getAvailableArchitectures(platform);
        archSelector.innerHTML = '';
        archNote.textContent = '';

        if (available.length === 0) {
            currentArch = 'unknown';
            return;
        }

        if (prevArch && prevArch !== 'unknown' && available.includes(prevArch)) {
            currentArch = prevArch;
        } else {
            currentArch = preferArch(userArch, available);
        }

        if (available.length === 1) {
            currentArch = available[0];
            return;
        }

        available.forEach(arch => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'arch-btn' + (arch === currentArch ? ' active' : '');
            btn.textContent = getArchLabel(arch);
            btn.dataset.arch = arch;
            btn.addEventListener('click', () => {
                currentArch = arch;
                currentVariant = null;
                archSelector.querySelectorAll('.arch-btn').forEach(b => {
                    b.classList.toggle('active', b === btn);
                });
                renderVersionSelect();
                updateDownloadUI();
            });
            archSelector.appendChild(btn);
        });

        if (currentArch === 'x86' && userArch === 'x64' && !available.includes('x64')) {
            archNote.textContent = t('archCompat32On64');
        } else if (currentArch === 'arm32' && userArch === 'arm64' && !available.includes('arm64')) {
            archNote.textContent = t('archCompatArm32On64');
        }
    }

    // ============================================================
    // Версии
    // ============================================================

    function getReleasesForCurrentSelection() {
        return allReleases.filter(release => {
            const assets = findAssetsFor(release, currentPlatform, currentArch);
            return assets.length > 0;
        });
    }

    function renderVersionSelect() {
        const prevValue = versionSelect.value;
        versionSelect.innerHTML = '';
        const releases = getReleasesForCurrentSelection();

        if (releases.length === 0) {
            versionDateEl.textContent = t('noVersions');
            currentRelease = null;
            return;
        }

        const groups = {};
        releases.forEach(release => {
            const version = parseVersion(release.tag_name);
            const key = `${version.major}.${version.minor}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push({ release, version });
        });

        const sortedKeys = Object.keys(groups).sort((a, b) => {
            const [aMaj, aMin] = a.split('.').map(Number);
            const [bMaj, bMin] = b.split('.').map(Number);
            if (aMaj !== bMaj) return bMaj - aMaj;
            return bMin - aMin;
        });

        sortedKeys.forEach(key => {
            const group = groups[key];
            const optgroup = document.createElement('optgroup');
            optgroup.label = t('versionGroupLabel', { version: key });

            group.forEach(({ release, version }) => {
                const meta = parseMeta(release.body);
                const displayName = meta.versionName || version.full;

                const option = document.createElement('option');
                option.value = release.tag_name;
                option.textContent = displayName;
                option.dataset.date = formatDate(release.published_at);
                option.dataset.post = meta.versionPost || '';
                option.dataset.versionName = meta.versionName || release.tag_name;
                option.dataset.customDate = meta.publishDate
                    ? meta.publishDate.toISOString() : '';
                optgroup.appendChild(option);
            });

            versionSelect.appendChild(optgroup);
        });

        if (prevValue) {
            const exists = Array.from(versionSelect.options).some(o => o.value === prevValue);
            if (exists) versionSelect.value = prevValue;
        }
        if (!versionSelect.value) {
            const firstOption = versionSelect.querySelector('option');
            if (firstOption) versionSelect.value = firstOption.value;
        }

        syncCurrentRelease(true);
    }

    function syncCurrentRelease(resetVariant) {
        if (!versionSelect.value) {
            currentRelease = null;
            return;
        }

        const tag = versionSelect.value;
        currentRelease = allReleases.find(r => r.tag_name === tag) || null;
        if (!currentRelease) return;

        updateVersionDateText();
        if (resetVariant) currentVariant = null;
    }

    function updateVersionDateText() {
        if (!currentRelease) {
            versionDateEl.textContent = t('noVersions');
            return;
        }

        const meta = parseMeta(currentRelease.body);
        let displayDate;
        if (meta.publishDate) {
            const formatted = formatCustomDate(meta.publishDate);
            displayDate = formatted || formatDate(currentRelease.published_at);
        } else {
            displayDate = formatDate(currentRelease.published_at);
        }
        versionDateEl.textContent = t('updateFrom') + ' ' + displayDate;
        versionDateEl.removeAttribute('data-lang');

        if (meta.versionPost) {
            whatsNewBtn.style.display = '';
            whatsNewBtn.dataset.postId = meta.versionPost;
        } else {
            whatsNewBtn.style.display = 'none';
        }

        const headerBadge = document.querySelector('[data-version-role="version"]');
        if (headerBadge) {
            headerBadge.textContent = meta.versionName
                || currentRelease.tag_name.replace(/^v/, '');
            headerBadge.removeAttribute('data-lang');
        }
    }

    // ============================================================
    // Выбор лучшего ассета
    // ============================================================

    function pickBestAsset(assets) {
        if (!assets || assets.length === 0) return null;
        if (assets.length === 1) return assets[0];

        if (!userOS || userOS.major === null) {
            const sorted = [...assets].sort(
                (a, b) => (b.osMajor || 0) - (a.osMajor || 0)
            );
            return sorted[0];
        }

        const compatible = assets.filter(a => isOSCompatible(userOS, a.osMajor));
        if (compatible.length > 0) {
            compatible.sort((a, b) => (b.osMajor || 0) - (a.osMajor || 0));
            return compatible[0];
        }

        const sorted = [...assets].sort(
            (a, b) => (a.osMajor || 0) - (b.osMajor || 0)
        );
        return sorted[0];
    }

    // ============================================================
    // Кнопка скачивания
    // ============================================================

    function updateDownloadUI() {
        osWarning.style.display = 'none';
        archWarning.style.display = 'none';
        downloadFileInfo.textContent = '';

        if (!currentRelease) {
            downloadBtn.classList.add('disabled');
            downloadBtn.removeAttribute('href');
            downloadLabel.textContent = t('downloadBtn');
            variantTabs.innerHTML = '';
            return;
        }

        const assets = findAssetsFor(currentRelease, currentPlatform, currentArch);

        if (assets.length === 0) {
            downloadBtn.classList.add('disabled');
            downloadBtn.removeAttribute('href');
            downloadLabel.textContent = t('downloadNoFileForPlatform');
            variantTabs.innerHTML = '';
            return;
        }

        const byType = new Map();
        assets.forEach(a => {
            if (!byType.has(a.type)) byType.set(a.type, []);
            byType.get(a.type).push(a);
        });

        variantTabs.innerHTML = '';

        if (byType.size > 1) {
            const types = Array.from(byType.keys());
            const compatTypes = types.filter(type =>
                byType.get(type).some(a => isOSCompatible(userOS, a.osMajor))
            );

            if (!currentVariant || !byType.has(currentVariant)) {
                if (compatTypes.includes('installer')) currentVariant = 'installer';
                else if (compatTypes.includes('package')) currentVariant = 'package';
                else if (compatTypes.length > 0) currentVariant = compatTypes[0];
                else if (byType.has('installer')) currentVariant = 'installer';
                else currentVariant = types[0];
            }

            types.forEach(type => {
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.className = 'variant-tab' + (type === currentVariant ? ' active' : '');
                tab.textContent = getTypeLabel(type);
                tab.dataset.type = type;
                tab.addEventListener('click', () => {
                    currentVariant = type;
                    variantTabs.querySelectorAll('.variant-tab').forEach(tEl => {
                        tEl.classList.toggle('active', tEl === tab);
                    });
                    updateDownloadUI();
                });
                variantTabs.appendChild(tab);
            });
        } else {
            currentVariant = byType.keys().next().value;
        }

        const variantAssets = byType.get(currentVariant) || assets;
        const asset = pickBestAsset(variantAssets);

        if (!asset) {
            downloadBtn.classList.add('disabled');
            downloadBtn.removeAttribute('href');
            downloadLabel.textContent = t('downloadNoFile');
            return;
        }

        downloadBtn.classList.remove('disabled');
        downloadBtn.href = asset.url;

        const sizeStr = formatSize(asset.size);
        const btnText = t('downloadBtn');
        if (sizeStr) {
            downloadLabel.innerHTML = `${escapeHtml(btnText)} · <span class="file-size">${escapeHtml(sizeStr)}</span>`;
        } else {
            downloadLabel.textContent = btnText;
        }

        const infoParts = [];
        if (asset.osMajor !== null && asset.osVersion) {
            infoParts.push(t('osMinVersion', {
                platform: currentPlatform,
                version: asset.osVersion
            }));
        }
        if (asset.arch && asset.arch !== 'unknown') {
            infoParts.push(getArchLabel(asset.arch));
        }
        downloadFileInfo.textContent = infoParts.join(' · ');

        if (!isArchCompatible(userArch, currentArch) &&
            currentArch !== 'unknown' && userArch !== 'unknown') {
            archWarning.style.display = '';
            archWarning.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                <span>${escapeHtml(t('archWarning', {
                    userArch: getArchLabel(userArch),
                    fileArch: getArchLabel(currentArch)
                }))}</span>
            `;
        }

        if (userOS && userOS.major !== null &&
            asset.osMajor !== null && asset.osVersion) {
            if (!isOSCompatible(userOS, asset.osMajor)) {
                osWarning.style.display = '';
                osWarning.innerHTML = `
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>${escapeHtml(t('osWarningVersionMismatch', {
                        fileOs: asset.osVersion,
                        userOs: userOS.version
                    }))}</span>
                `;
            }
        }
    }

    // ============================================================
    // Fallback
    // ============================================================

    function setReleasesPageFallback() {
        downloadBtn.classList.remove('disabled');
        downloadBtn.href = `https://github.com/${GH_OWNER}/${GH_REPO}/releases`;
        downloadBtn.target = '_blank';
        downloadBtn.rel = 'noopener noreferrer';
        downloadLabel.textContent = t('openReleasesPage');
        downloadFileInfo.textContent = '';
        variantTabs.innerHTML = '';
        archSelector.innerHTML = '';
        archWarning.style.display = 'none';
        osWarning.style.display = 'none';
    }

    // ============================================================
    // Инициализация
    // ============================================================

    async function initPlatform() {
        if (platformInitialized) return;
        platformInitialized = true;

        githubContainer = document.getElementById('github-block-container');
        if (!githubContainer) return;

        githubContainer.innerHTML = `
            <h3><i class="fab fa-github"></i> GitHub</h3>
            <div class="github-block">
                <div class="platform-selector" id="platform-selector"></div>
                <div class="arch-selector" id="arch-selector"></div>
                <div class="arch-note" id="arch-note"></div>
                <div class="version-row">
                    <select class="version-select"></select>
                    <p class="version-date" id="version-date">${escapeHtml(t('loadingVersions'))}</p>
                </div>
                <div class="download-variant-tabs" id="download-variant-tabs"></div>
                <a href="#" id="github-download-btn" class="download-button github" target="_blank" rel="noopener noreferrer">
                    <i class="fab fa-github"></i> <span id="download-label">${escapeHtml(t('downloadBtn'))}</span>
                </a>
                <div class="download-file-info" id="download-file-info"></div>
                <div class="arch-warning" id="arch-warning" style="display:none;"></div>
                <div class="os-warning" id="os-warning" style="display:none;"></div>
                <button id="whats-new-btn" class="button small" style="display:none;">
                    <i class="fas fa-newspaper"></i> ${escapeHtml(t('whatsNew'))}
                </button>
            </div>
        `;

        platformSelector = githubContainer.querySelector('#platform-selector');
        archSelector = githubContainer.querySelector('#arch-selector');
        archNote = githubContainer.querySelector('#arch-note');
        versionSelect = githubContainer.querySelector('.version-select');
        versionDateEl = githubContainer.querySelector('#version-date');
        variantTabs = githubContainer.querySelector('#download-variant-tabs');
        downloadBtn = githubContainer.querySelector('#github-download-btn');
        downloadLabel = githubContainer.querySelector('#download-label');
        downloadFileInfo = githubContainer.querySelector('#download-file-info');
        archWarning = githubContainer.querySelector('#arch-warning');
        osWarning = githubContainer.querySelector('#os-warning');
        whatsNewBtn = githubContainer.querySelector('#whats-new-btn');

        try {
            [allReleases, userArch, userOS] = await Promise.all([
                getGameReleases(),
                detectUserArchitecture(),
                detectUserOSVersion()
            ]);
        } catch (e) {
            versionDateEl.textContent = t('loadError');
            renderPlatformSelector();
            setReleasesPageFallback();
            return;
        }

        renderPlatformSelector();

        if (!allReleases.length) {
            versionDateEl.textContent = t('noVersions');
            setReleasesPageFallback();
            return;
        }

        if (currentPlatform === 'Web') currentPlatform = 'Windows';

        platformSelector.querySelectorAll('.platform-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.platform === currentPlatform);
        });

        updateCloudVisibility(currentPlatform);
        renderArchSelector(currentPlatform);
        renderVersionSelect();
        updateDownloadUI();

        versionSelect.addEventListener('change', () => {
            syncCurrentRelease(true);
            updateDownloadUI();
        });

        whatsNewBtn.addEventListener('click', async () => {
            const postId = whatsNewBtn.dataset.postId;
            if (!postId || !window.UIFeedback) return;
            try {
                if (window.GithubAPI && window.GithubAPI.loadIssue) {
                    const issue = await window.GithubAPI.loadIssue(parseInt(postId, 10));
                    const { openFullModal } = window.UIFeedback;
                    openFullModal({
                        type: 'post',
                        id: issue.number,
                        title: issue.title,
                        body: issue.body,
                        author: issue.user.login,
                        date: issue.created_at,
                        labels: issue.labels.map(l => l.name),
                        game: gameTag
                    });
                }
            } catch (err) {
                if (window.UIUtils && window.UIUtils.showToast) {
                    window.UIUtils.showToast(t('failedLoadPost'), 'error');
                }
            }
        });

        window.addEventListener('languageChanged', () => {
            if (!platformInitialized || !githubContainer) return;

            renderPlatformSelector();
            platformSelector.querySelectorAll('.platform-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.platform === currentPlatform);
            });

            archSelector.querySelectorAll('.arch-btn').forEach(btn => {
                const arch = btn.dataset.arch;
                if (arch) btn.textContent = getArchLabel(arch);
            });

            const available = getAvailableArchitectures(currentPlatform);
            archNote.textContent = '';
            if (available.length > 1) {
                if (currentArch === 'x86' && userArch === 'x64' && !available.includes('x64')) {
                    archNote.textContent = t('archCompat32On64');
                } else if (currentArch === 'arm32' && userArch === 'arm64' && !available.includes('arm64')) {
                    archNote.textContent = t('archCompatArm32On64');
                }
            }

            versionSelect.querySelectorAll('optgroup').forEach(group => {
                const match = group.label.match(/(?:Версия|Version)\s+(.+)/i);
                if (match) group.label = t('versionGroupLabel', { version: match[1] });
            });

            updateVersionDateText();
            whatsNewBtn.innerHTML = `<i class="fas fa-newspaper"></i> ${escapeHtml(t('whatsNew'))}`;
            updateDownloadUI();
        });
    }

    window.initPlatform = initPlatform;
})();