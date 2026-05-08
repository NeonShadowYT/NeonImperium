// platform.js — динамическая версия, выбор платформы/версии, скачивание
(function () {
    const GH_OWNER = 'NeonShadowYT';
    const GH_REPO = 'NeonImperium';
    const RELEASES_CACHE_KEY = 'github_all_releases';
    const CACHE_DURATION = 10 * 60 * 1000;

    // ---------- определение ОС ----------
    function getOS() {
        const ua = navigator.userAgent;
        const platform = navigator.userAgentData?.platform || navigator.platform || '';
        if (/android/i.test(ua)) return 'Android';
        if (/windows/i.test(platform) || /windows/i.test(ua)) return 'Windows';
        if (/linux/i.test(platform)) return 'Linux';
        if (/mac/i.test(platform)) return 'Mac';
        if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
        return 'Windows'; // fallback
    }

    // ---------- кеширование ----------
    function cacheGet(key) {
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const { data, ts } = JSON.parse(raw);
            if (Date.now() - ts < CACHE_DURATION) return data;
        } catch {}
        return null;
    }
    function cacheSet(key, data) {
        try {
            sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
        } catch {}
    }

    // ---------- GitHub API ----------
    async function fetchAllReleases() {
        const cached = cacheGet(RELEASES_CACHE_KEY);
        if (cached) return cached;

        const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases?per_page=100`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Failed to fetch releases');
        const releases = await resp.json();
        // оставляем только опубликованные
        const filtered = releases.filter(r => !r.draft && !r.prerelease);
        cacheSet(RELEASES_CACHE_KEY, filtered);
        return filtered;
    }

    // парсим мета‑метки из тела релиза
    function parseMeta(body) {
        const meta = {};
        if (!body) return meta;
        const lines = body.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('game:')) meta.game = line.slice(5).trim().toLowerCase();
            else if (line.startsWith('version-name:')) meta.versionName = line.slice(13).trim();
            else if (line.startsWith('version-post:')) meta.versionPost = line.slice(14).trim();
        }
        return meta;
    }

    // получаем все релизы для конкретной игры
    async function getGameReleases(gameTag) {
        const all = await fetchAllReleases();
        return all
            .filter(r => {
                const meta = parseMeta(r.body);
                return meta.game === gameTag;
            })
            .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    }

    // ---------- рендеринг интерфейса ----------
    function renderPlatformSwitch(container, currentPlatform, onChange) {
        container.innerHTML = `
            <div class="platform-switch">
                <button class="platform-btn ${currentPlatform === 'Windows' ? 'active' : ''}" data-platform="Windows">
                    <i class="fab fa-windows"></i> Windows
                </button>
                <button class="platform-btn ${currentPlatform === 'Android' ? 'active' : ''}" data-platform="Android">
                    <i class="fab fa-android"></i> Android
                </button>
            </div>
        `;
        container.querySelectorAll('.platform-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const plat = btn.dataset.platform;
                onChange(plat);
                container.querySelectorAll('.platform-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });
    }

    function renderVersionSelector(container, releases, currentTag, onChange) {
        const options = releases.map(r => {
            const meta = parseMeta(r.body);
            const name = meta.versionName ? `${meta.versionName} ${r.tag_name.replace(/^v/, '')}` : r.tag_name;
            return `<option value="${r.tag_name}" ${r.tag_name === currentTag ? 'selected' : ''}>${escapeHtml(name)}</option>`;
        }).join('');
        container.innerHTML = `
            <label class="version-label">Версия:</label>
            <select class="version-select">${options}</select>
        `;
        container.querySelector('.version-select').addEventListener('change', e => {
            onChange(e.target.value);
        });
    }

    function findAsset(release, platform) {
        if (!release || !release.assets) return null;
        const plat = platform.toLowerCase();
        const extensions = {
            windows: ['.exe', '.zip', '.7z'],
            android: ['.apk']
        };
        const exts = extensions[plat] || [];
        return release.assets.find(a => {
            const name = a.name.toLowerCase();
            return exts.some(ext => name.endsWith(ext));
        });
    }

    function updateDownloadButtons({ platform, release, meta }) {
        // GitHub кнопка
        const ghBtn = document.getElementById('github-download-btn');
        if (ghBtn) {
            const asset = findAsset(release, platform);
            if (asset) {
                ghBtn.href = asset.browser_download_url;
                ghBtn.classList.remove('disabled');
                ghBtn.querySelector('.btn-text').textContent = `Скачать с GitHub (${platform})`;
            } else {
                ghBtn.removeAttribute('href');
                ghBtn.classList.add('disabled');
                ghBtn.querySelector('.btn-text').textContent = `Нет сборки для ${platform}`;
            }
        }

        // Кнопки Yandex/Google (с data-platform)
        document.querySelectorAll('.download-button[data-platform]').forEach(btn => {
            const btnPlat = btn.dataset.platform;
            if (btnPlat && btnPlat.toLowerCase() === platform.toLowerCase()) {
                btn.style.display = '';
            } else {
                btn.style.display = 'none';
            }
        });

        // Кнопка "Что нового?"
        const whatsNew = document.getElementById('whats-new-btn');
        if (whatsNew && meta.versionPost) {
            whatsNew.style.display = '';
            whatsNew.dataset.postId = meta.versionPost;
        } else if (whatsNew) {
            whatsNew.style.display = 'none';
        }
    }

    // обновление текстов версии без data-lang (чтобы не перезаписывались переводом)
    function updateVersionTexts(release, meta) {
        const versionStr = release.tag_name.replace(/^v/, '');
        const versionName = meta.versionName ? `${escapeHtml(meta.versionName)} ${versionStr}` : versionStr;

        // Шапка
        const headerBadge = document.querySelector('[data-version-role="version"]');
        if (headerBadge) {
            headerBadge.textContent = versionName;
            headerBadge.removeAttribute('data-lang'); // отключаем локализацию
        }

        // Строка под кнопками
        const dateEl = document.querySelector('[data-version-role="date"]');
        if (dateEl) {
            const pub = new Date(release.published_at);
            const dateStr = pub.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
            dateEl.textContent = `Версия ${versionStr} · Обновление от ${dateStr}`;
            dateEl.removeAttribute('data-lang');
        }

        // Ссылка "Что нового?"
        const whatsNew = document.getElementById('whats-new-btn');
        if (whatsNew && meta.versionPost) {
            whatsNew.style.display = '';
            whatsNew.dataset.postId = meta.versionPost;
        } else if (whatsNew) {
            whatsNew.style.display = 'none';
        }
    }

    // ---------- инициализация ----------
    async function init() {
        const os = getOS();
        let currentPlatform = os === 'Windows' ? 'Windows' : 'Android'; // по умолчанию Win, если не Android
        if (os === 'Android') currentPlatform = 'Android';

        const gameTag = 'starve-neon'; // для этой игры

        const allReleases = await getGameReleases(gameTag);
        if (allReleases.length === 0) {
            console.warn('Нет релизов для игры ' + gameTag);
            return;
        }

        const latestRelease = allReleases[0];
        const latestMeta = parseMeta(latestRelease.body);

        // Строим UI
        const downloadSection = document.getElementById('download-section');
        if (!downloadSection) return;

        // Очищаем и создаём структуру
        downloadSection.innerHTML = `
            <div class="platform-switch-container"></div>
            <div class="version-selector-container"></div>
            <div class="download-buttons-container">
                <div class="store-buttons">
                    <a href="https://gamejolt.com/games/Starve-Neon/797491" target="_blank" class="download-button gamejolt">GameJolt</a>
                    <a href="https://neon-imperium.itch.io/starve-neon" target="_blank" class="download-button itch">Itch.io</a>
                </div>
                <div class="cloud-buttons">
                    <a href="https://t.me/voididea" target="_blank" class="download-button telegram"><i class="fab fa-telegram"></i> Telegram</a>
                    <a href="https://disk.yandex.ru/d/xx3iUMWhh0HRgA" target="_blank" class="download-button yandex" data-platform="Windows"><i class="fab fa-yandex"></i> Yandex</a>
                    <a href="https://disk.yandex.ru/d/exGuuim7NjPFww" target="_blank" class="download-button yandex" data-platform="Android"><i class="fab fa-yandex"></i> Yandex</a>
                    <a href="https://drive.google.com/file/d/1S0DE2mjGXr8eryQTfwz0jjjNCqvJVf-N/view?usp=sharing" target="_blank" class="download-button google" data-platform="Windows"><i class="fab fa-google"></i> Google</a>
                    <a href="https://drive.google.com/file/d/1NeeQ8uysJIfbEaDQgk7Ts5Y9By7_jzmF/view?usp=sharing" target="_blank" class="download-button google" data-platform="Android"><i class="fab fa-google"></i> Google</a>
                </div>
                <div class="github-download-wrap">
                    <a href="#" id="github-download-btn" class="download-button github" target="_blank">
                        <i class="fab fa-github"></i> <span class="btn-text"></span>
                    </a>
                </div>
            </div>
            <div class="whats-new-wrap">
                <button id="whats-new-btn" class="button small" style="display:none;"><i class="fas fa-newspaper"></i> Что нового?</button>
            </div>
            <p class="text-secondary small-note" data-version-role="date"></p>
        `;

        // Подписываемся на смену языка – при событии обновляем только статические переводы,
        // а версионные данные (которые без data-lang) не трогаем.
        window.addEventListener('languageChanged', () => {
            // lang.js сам обновит элементы с data-lang.
            // Наши динамические элементы без data-lang останутся.
        });

        // Заполняем переключатель платформы
        const switchContainer = downloadSection.querySelector('.platform-switch-container');
        renderPlatformSwitch(switchContainer, currentPlatform, (newPlat) => {
            currentPlatform = newPlat;
            const releaseTag = downloadSection.querySelector('.version-select')?.value;
            const release = allReleases.find(r => r.tag_name === releaseTag) || latestRelease;
            const meta = parseMeta(release.body);
            updateDownloadButtons({ platform: currentPlatform, release, meta });
        });

        // Селектор версий
        const versionContainer = downloadSection.querySelector('.version-selector-container');
        renderVersionSelector(versionContainer, allReleases, latestRelease.tag_name, (newTag) => {
            const release = allReleases.find(r => r.tag_name === newTag);
            if (!release) return;
            const meta = parseMeta(release.body);
            updateDownloadButtons({ platform: currentPlatform, release, meta });
            updateVersionTexts(release, meta);
        });

        // Начальное заполнение
        updateDownloadButtons({ platform: currentPlatform, release: latestRelease, meta: latestMeta });
        updateVersionTexts(latestRelease, latestMeta);

        // Обработчик кнопки "Что нового?"
        document.getElementById('whats-new-btn')?.addEventListener('click', () => {
            const postId = document.getElementById('whats-new-btn').dataset.postId;
            if (postId && window.UIFeedback) {
                window.UIFeedback.openFullModal({
                    type: 'post',
                    id: parseInt(postId, 10),
                    title: document.querySelector('[data-version-role="version"]')?.textContent || '',
                    body: '',
                    author: '',
                    date: new Date().toISOString(),
                    labels: ['type:news'],
                    game: gameTag
                });
            }
        });

        // При смене языка перезаполняем только статические метки, версия остаётся
        window.addEventListener('languageChanged', () => {
            // ничего не делаем, динамические данные не имеют data-lang
        });
    }

    // небольшие стили
    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .platform-switch { display: flex; gap: 8px; margin-bottom: 15px; }
            .platform-btn {
                background: var(--bg-inner-gradient); border: 1px solid var(--border);
                color: var(--text-secondary); padding: 6px 14px; border-radius: 20px;
                cursor: pointer; font-family: var(--font-family); transition: 0.2s;
            }
            .platform-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
            .version-selector-container { margin-bottom: 15px; display: flex; align-items: center; gap: 8px; }
            .version-label { color: var(--text-secondary); font-size: 14px; }
            .version-select {
                padding: 6px 12px; border-radius: 20px; background: var(--bg-primary);
                border: 1px solid var(--border); color: var(--text-primary);
                font-family: var(--font-family);
            }
            .download-buttons-container { display: flex; flex-direction: column; gap: 12px; }
            .store-buttons, .cloud-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
            #github-download-btn.disabled { opacity: 0.5; pointer-events: none; }
            .whats-new-wrap { margin-top: 8px; }
        `;
        document.head.appendChild(style);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            injectStyles();
            init().catch(console.error);
        });
    } else {
        injectStyles();
        init().catch(console.error);
    }
})();