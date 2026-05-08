// platform.js — динамическая версия, выбор платформы/версии, скачивание (исправлено)
(function () {
    const GH_OWNER = 'NeonShadowYT';
    const GH_REPO = 'NeonImperium';
    const RELEASES_CACHE_KEY = 'github_all_releases';
    const CACHE_DURATION = 10 * 60 * 1000;

    function getOS() {
        const ua = navigator.userAgent;
        if (/android/i.test(ua)) return 'Android';
        const platform = navigator.userAgentData?.platform || navigator.platform || '';
        if (/windows/i.test(platform) || /windows/i.test(ua)) return 'Windows';
        if (/linux/i.test(platform)) return 'Linux';
        if (/mac/i.test(platform)) return 'Mac';
        if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
        return 'Windows';
    }

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
        try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
    }

    async function fetchAllReleases() {
        const cached = cacheGet(RELEASES_CACHE_KEY);
        if (cached) return cached;

        const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases?per_page=100`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('Failed to fetch releases');
        const releases = await resp.json();
        const filtered = releases.filter(r => !r.draft && !r.prerelease);
        cacheSet(RELEASES_CACHE_KEY, filtered);
        return filtered;
    }

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

    async function getGameReleases(gameTag) {
        const all = await fetchAllReleases();
        return all
            .filter(r => {
                const meta = parseMeta(r.body);
                return meta.game === gameTag;
            })
            .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    }

    function findAsset(release, platform) {
        if (!release || !release.assets) return null;
        const plat = platform.toLowerCase();
        const extensions = { windows: ['.exe', '.zip', '.7z'], android: ['.apk'] };
        const exts = extensions[plat] || [];
        return release.assets.find(a => {
            const name = a.name.toLowerCase();
            return exts.some(ext => name.endsWith(ext));
        });
    }

    function formatDate(dateStr) {
        const d = new Date(dateStr);
        return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    // Основная функция построения UI
    async function init() {
        const os = getOS();
        let currentPlatform = (os === 'Android') ? 'Android' : 'Windows';
        const gameTag = 'starve-neon';

        const allReleases = await getGameReleases(gameTag);
        if (allReleases.length === 0) return;

        const section = document.getElementById('download-section');
        if (!section) return;

        // Строим структуру
        section.innerHTML = `
            <div class="download-panel">
                <div class="platform-version-row">
                    <div class="platform-switch">
                        <button class="platform-btn active" data-platform="Windows"><i class="fab fa-windows"></i> Windows</button>
                        <button class="platform-btn" data-platform="Android"><i class="fab fa-android"></i> Android</button>
                    </div>
                    <div class="version-selector">
                        <label class="version-label">Версия:</label>
                        <select class="version-select"></select>
                        <span class="whats-new-wrap">
                            <button id="whats-new-btn" class="button small" style="display:none;"><i class="fas fa-newspaper"></i> Что нового?</button>
                        </span>
                    </div>
                </div>
                <p class="release-date" id="release-date"></p>
                <div class="store-buttons">
                    <a href="https://gamejolt.com/games/Starve-Neon/797491" target="_blank" class="download-button gamejolt">GameJolt</a>
                    <a href="https://neon-imperium.itch.io/starve-neon" target="_blank" class="download-button itch">Itch.io</a>
                    <a href="https://t.me/voididea" target="_blank" class="download-button telegram"><i class="fab fa-telegram"></i> Telegram</a>
                </div>
                <div class="cloud-buttons">
                    <a href="https://disk.yandex.ru/d/xx3iUMWhh0HRgA" target="_blank" class="download-button yandex" data-platform="Windows"><i class="fab fa-yandex"></i> Yandex</a>
                    <a href="https://disk.yandex.ru/d/exGuuim7NjPFww" target="_blank" class="download-button yandex" data-platform="Android"><i class="fab fa-yandex"></i> Yandex</a>
                    <a href="https://drive.google.com/file/d/1S0DE2mjGXr8eryQTfwz0jjjNCqvJVf-N/view?usp=sharing" target="_blank" class="download-button google" data-platform="Windows"><i class="fab fa-google"></i> Google</a>
                    <a href="https://drive.google.com/file/d/1NeeQ8uysJIfbEaDQgk7Ts5Y9By7_jzmF/view?usp=sharing" target="_blank" class="download-button google" data-platform="Android"><i class="fab fa-google"></i> Google</a>
                </div>
                <p class="platform-cloud-note">(отображаются для выбранной платформы)</p>
                <div class="github-download-wrap">
                    <a href="#" id="github-download-btn" class="download-button github" target="_blank">
                        <i class="fab fa-github"></i> <span class="btn-text"></span>
                    </a>
                </div>
            </div>
        `;

        // Заполняем селектор версий
        const versionSelect = section.querySelector('.version-select');
        allReleases.forEach(r => {
            const meta = parseMeta(r.body);
            const label = meta.versionName 
                ? `${meta.versionName} ${r.tag_name.replace(/^v/, '')}` 
                : r.tag_name;
            const option = document.createElement('option');
            option.value = r.tag_name;
            option.textContent = label;
            versionSelect.appendChild(option);
        });

        // Сохраняем ссылки на элементы
        const platformBtns = section.querySelectorAll('.platform-btn');
        const whatsNewBtn = section.querySelector('#whats-new-btn');
        const releaseDateEl = section.querySelector('#release-date');
        const githubBtn = section.querySelector('#github-download-btn');
        const btnText = githubBtn.querySelector('.btn-text');
        const cloudButtons = section.querySelectorAll('.download-button[data-platform]');

        // Функция обновления всего UI при смене версии/платформы
        function refreshUI() {
            const tag = versionSelect.value;
            const release = allReleases.find(r => r.tag_name === tag);
            if (!release) return;
            const meta = parseMeta(release.body);

            // Дата релиза
            releaseDateEl.textContent = `Обновление от ${formatDate(release.published_at)}`;

            // Кнопка "Что нового?"
            if (meta.versionPost) {
                whatsNewBtn.style.display = '';
                whatsNewBtn.dataset.postId = meta.versionPost;
            } else {
                whatsNewBtn.style.display = 'none';
            }

            // Облачные кнопки
            cloudButtons.forEach(btn => {
                btn.style.display = btn.dataset.platform === currentPlatform ? '' : 'none';
            });

            // GitHub кнопка
            const asset = findAsset(release, currentPlatform);
            if (asset) {
                githubBtn.href = asset.browser_download_url;
                githubBtn.classList.remove('disabled');
                btnText.textContent = `Скачать с GitHub (${currentPlatform})`;
            } else {
                githubBtn.removeAttribute('href');
                githubBtn.classList.add('disabled');
                btnText.textContent = `Нет сборки для ${currentPlatform}`;
            }

            // Версия в шапке (если есть)
            const headerBadge = document.querySelector('[data-version-role="version"]');
            if (headerBadge) {
                const ver = release.tag_name.replace(/^v/, '');
                const name = meta.versionName ? `${meta.versionName} ${ver}` : ver;
                headerBadge.textContent = name;
                headerBadge.removeAttribute('data-lang');
            }
        }

        // Устанавливаем активную платформу
        platformBtns.forEach(b => {
            b.classList.toggle('active', b.dataset.platform === currentPlatform);
            b.addEventListener('click', () => {
                currentPlatform = b.dataset.platform;
                platformBtns.forEach(p => p.classList.remove('active'));
                b.classList.add('active');
                refreshUI();
            });
        });

        // Слушаем смену версии
        versionSelect.addEventListener('change', refreshUI);

        // Начальное заполнение
        refreshUI();

        // Кнопка "Что нового?"
        whatsNewBtn.addEventListener('click', () => {
            const postId = whatsNewBtn.dataset.postId;
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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();