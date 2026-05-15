// platform.js – GitHub-блок с выбором версии и платформы
(function () {
    const GH_OWNER = 'NeonShadowYT';
    const GH_REPO = 'NeonImperium';
    const RELEASES_CACHE_KEY = 'github_all_releases';
    const CACHE_DURATION = 10 * 60 * 1000;

    function getOS() {
        const ua = navigator.userAgent;
        const platform = navigator.userAgentData?.platform || navigator.platform || '';
        if (/android/i.test(ua)) return 'Android';
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        try {
            const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/releases?per_page=100`;
            const resp = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!resp.ok) throw new Error('Failed to fetch releases');
            const releases = await resp.json();
            const filtered = releases.filter(r => !r.draft && !r.prerelease);
            cacheSet(RELEASES_CACHE_KEY, filtered);
            return filtered;
        } catch (e) {
            clearTimeout(timeoutId);
            throw e;
        }
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
            else if (line.startsWith('sort-order:')) meta.sortOrder = parseInt(line.slice(11).trim(), 10);
        }
        return meta;
    }

    // Универсальная сортировка:
    // 1. Если у релиза есть sort-order, используем его (по убыванию: больше → выше в списке)
    // 2. Если sort-order одинаковый или отсутствует – сортируем по дате (новые сверху)
    function sortReleasesByOrder(releases) {
        return [...releases].sort((a, b) => {
            const metaA = parseMeta(a.body);
            const metaB = parseMeta(b.body);
            const orderA = metaA.sortOrder;
            const orderB = metaB.sortOrder;

            if (orderA !== undefined && orderB !== undefined) {
                if (orderA !== orderB) return orderB - orderA;
            } else if (orderA !== undefined) return -1; // A с порядком выше
            else if (orderB !== undefined) return 1;  // B с порядком выше

            // Сортировка по дате (новые сверху)
            return new Date(b.published_at) - new Date(a.published_at);
        });
    }

    async function getGameReleases(gameTag) {
        const all = await fetchAllReleases();
        const filtered = all.filter(r => {
            const meta = parseMeta(r.body);
            return meta.game === gameTag;
        });
        return sortReleasesByOrder(filtered);
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

    async function init() {
        const os = getOS();
        let currentPlatform = (os === 'Android') ? 'Android' : 'Windows';
        const gameTag = 'starve-neon';

        const cloudButtons = document.querySelectorAll('.cloud-buttons .download-button[data-platform]');
        function updateCloudVisibility() {
            cloudButtons.forEach(cb => {
                cb.style.display = cb.dataset.platform === currentPlatform ? '' : 'none';
            });
        }
        updateCloudVisibility();

        const githubContainer = document.getElementById('github-block-container');
        if (!githubContainer) return;

        githubContainer.innerHTML = `
            <h3><i class="fab fa-github"></i> GitHub</h3>
            <div class="github-block">
                <div class="platform-selector">
                    <button class="platform-btn ${currentPlatform === 'Windows' ? 'active' : ''}" data-platform="Windows"><i class="fab fa-windows"></i> Windows</button>
                    <button class="platform-btn ${currentPlatform === 'Android' ? 'active' : ''}" data-platform="Android"><i class="fab fa-android"></i> Android</button>
                </div>
                <div class="version-row">
                    <select class="version-select"></select>
                    <p class="version-date" id="version-date"></p>
                </div>
                <a href="#" id="github-download-btn" class="download-button github" target="_blank">
                    <i class="fab fa-github"></i> Скачать с GitHub
                </a>
                <button id="whats-new-btn" class="button small" style="display:none;"><i class="fas fa-newspaper"></i> Что нового?</button>
            </div>
        `;

        const platformBtns = githubContainer.querySelectorAll('.platform-btn');
        const versionSelect = githubContainer.querySelector('.version-select');
        const versionDateEl = githubContainer.querySelector('#version-date');
        const githubBtn = githubContainer.querySelector('#github-download-btn');
        const whatsNewBtn = githubContainer.querySelector('#whats-new-btn');

        let allReleases = [];
        try {
            allReleases = await getGameReleases(gameTag);
        } catch (e) {
            versionDateEl.textContent = 'Ошибка загрузки';
            githubBtn.classList.add('disabled');
            return;
        }

        function getFilteredReleases(platform) {
            return allReleases.filter(r => findAsset(r, platform));
        }

        function populateVersionSelect(platform) {
            const filtered = getFilteredReleases(platform);
            versionSelect.innerHTML = '';
            if (filtered.length === 0) {
                versionDateEl.textContent = 'Нет доступных версий';
                githubBtn.classList.add('disabled');
                githubBtn.removeAttribute('href');
                return;
            }
            filtered.forEach(release => {
                const meta = parseMeta(release.body);
                const label = meta.versionName || release.tag_name.replace(/^v/, '');
                const option = document.createElement('option');
                option.value = release.tag_name;
                option.textContent = label;
                option.dataset.date = formatDate(release.published_at);
                option.dataset.post = meta.versionPost || '';
                option.dataset.versionName = meta.versionName || release.tag_name;
                versionSelect.appendChild(option);
            });
            updateUIForSelectedRelease();
        }

        function updateUIForSelectedRelease() {
            if (!versionSelect.value) return;
            const tag = versionSelect.value;
            const release = allReleases.find(r => r.tag_name === tag);
            if (!release) return;
            const meta = parseMeta(release.body);
            const dateStr = formatDate(release.published_at);
            versionDateEl.textContent = `Обновление от ${dateStr}`;

            const asset = findAsset(release, currentPlatform);
            if (asset) {
                githubBtn.href = asset.browser_download_url;
                githubBtn.classList.remove('disabled');
            } else {
                githubBtn.removeAttribute('href');
                githubBtn.classList.add('disabled');
            }

            if (meta.versionPost) {
                whatsNewBtn.style.display = '';
                whatsNewBtn.dataset.postId = meta.versionPost;
            } else {
                whatsNewBtn.style.display = 'none';
            }

            const headerBadge = document.querySelector('[data-version-role="version"]');
            if (headerBadge) {
                const name = meta.versionName || release.tag_name.replace(/^v/, '');
                headerBadge.textContent = name;
                headerBadge.removeAttribute('data-lang');
            }
        }

        platformBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                currentPlatform = btn.dataset.platform;
                platformBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                updateCloudVisibility();
                populateVersionSelect(currentPlatform);
            });
        });

        versionSelect.addEventListener('change', updateUIForSelectedRelease);

        whatsNewBtn.addEventListener('click', async () => {
            const postId = whatsNewBtn.dataset.postId;
            if (!postId || !window.UIFeedback) return;
            const { openFullModal } = window.UIFeedback;
            openFullModal({
                type: 'post',
                id: parseInt(postId, 10),
                title: 'Загрузка...',
                body: '',
                author: '',
                date: new Date().toISOString(),
                labels: ['type:news'],
                game: gameTag
            });
            try {
                if (window.GithubAPI?.loadIssue) {
                    const issue = await window.GithubAPI.loadIssue(parseInt(postId, 10));
                    const modalTitle = document.getElementById('modal-header-title');
                    if (modalTitle) modalTitle.textContent = issue.title;
                }
            } catch {}
        });

        populateVersionSelect(currentPlatform);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();