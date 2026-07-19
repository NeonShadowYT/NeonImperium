// js/platform.js – улучшенная сортировка и стилизованные метки для выбора версий
(function () {
    const GH_OWNER = 'NeonShadowYT';
    const GH_REPO = 'NeonImperium';
    const RELEASES_CACHE_KEY = 'github_all_releases';
    const CACHE_DURATION = 60 * 60 * 1000; // 1 час
    let currentAbortController = null;

    // Определяем игру из пути (starve-neon, alpha-01, gc-adven)
    const gameTag = location.pathname.split('/').pop().replace('.html', '');

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

    // Загружаем все релизы (включая пре-релизы, исключая черновики)
    async function fetchAllReleases() {
        const cached = cacheGet(RELEASES_CACHE_KEY);
        if (cached) return cached;
        if (currentAbortController) {
            currentAbortController.abort();
        }
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
            if (line.startsWith('game:')) meta.game = line.slice(5).trim().toLowerCase();
            else if (line.startsWith('version-name:')) meta.versionName = line.slice(13).trim();
            else if (line.startsWith('version-post:')) meta.versionPost = line.slice(14).trim();
            else if (line.startsWith('sort-order:')) meta.sortOrder = parseInt(line.slice(11).trim(), 10);
            else if (line.startsWith('publish-date:')) {
                const raw = line.slice(13).trim();
                let date = null;
                let parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (parts) {
                    date = new Date(parseInt(parts[1]), parseInt(parts[2])-1, parseInt(parts[3]));
                } else {
                    parts = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
                    if (parts) {
                        date = new Date(parseInt(parts[3]), parseInt(parts[2])-1, parseInt(parts[1]));
                    } else {
                        const d = Date.parse(raw);
                        if (!isNaN(d)) date = new Date(d);
                    }
                }
                if (date && !isNaN(date.getTime())) {
                    meta.publishDate = date;
                }
            }
        }
        return meta;
    }

    // Парсинг версии из тега (v0.14.0, v0.14.0 p2, v0.14.0 b6, v0.14.0 a1)
    function parseVersion(tag) {
        let versionStr = tag.replace(/^v/, '');
        let suffix = '';
        const match = versionStr.match(/(.+?)(?:\s+([pba]\d+))?$/);
        if (match) {
            versionStr = match[1].trim();
            suffix = match[2] || '';
        }
        const parts = versionStr.split('.').map(Number);
        const major = parts[0] || 0;
        const minor = parts[1] || 0;
        const patch = parts[2] || 0;
        const full = versionStr + (suffix ? ' ' + suffix : '');
        return { major, minor, patch, suffix, full, tag };
    }

    // Определяем тип релиза с приоритетом (чем меньше число, тем выше приоритет)
    function getReleaseType(version) {
        const s = version.suffix;
        if (s && s.includes('a')) {
            return { type: 'alpha', label: 'Альфа', priority: 3, emoji: '🔴' };
        }
        if (s && s.includes('b')) {
            return { type: 'beta', label: 'Бета', priority: 2, emoji: '🔵' };
        }
        if (s && s.includes('p')) {
            return { type: 'prerelease', label: 'Пре-релиз', priority: 1, emoji: '🟠' };
        }
        // Без суффикса – стабильный релиз или патч
        if (version.patch === 0) {
            return { type: 'release', label: 'Релиз', priority: 0, emoji: '🟢' };
        }
        return { type: 'patch', label: 'Патч', priority: 0, emoji: '🟡' };
    }

    // Сортировка: сначала с sort-order (убывание), затем по приоритету (возрастание) и дате (убывание)
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
            if (typeA.priority !== typeB.priority) {
                return typeA.priority - typeB.priority;
            }
            return new Date(b.published_at) - new Date(a.published_at);
        });
        return [...withOrder.map(item => item.release), ...withoutOrder];
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

    function formatCustomDate(date) {
        if (!date || isNaN(date.getTime())) return null;
        return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    async function init() {
        const os = getOS();
        let currentPlatform = (os === 'Android') ? 'Android' : 'Windows';

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

            // Группируем по major.minor
            const groups = {};
            filtered.forEach(release => {
                const version = parseVersion(release.tag_name);
                const key = `${version.major}.${version.minor}`;
                if (!groups[key]) groups[key] = [];
                groups[key].push({ release, version });
            });

            // Сортируем группы по убыванию версии
            const sortedKeys = Object.keys(groups).sort((a, b) => {
                const [aMaj, aMin] = a.split('.').map(Number);
                const [bMaj, bMin] = b.split('.').map(Number);
                if (aMaj !== bMaj) return bMaj - aMaj;
                return bMin - aMin;
            });

            sortedKeys.forEach(key => {
                const group = groups[key];
                const optgroup = document.createElement('optgroup');
                optgroup.label = `Версия ${key}`;

                group.forEach(({ release, version }) => {
                    const meta = parseMeta(release.body);
                    const displayName = meta.versionName || version.full;
                    const label = displayName;
                    const option = document.createElement('option');
                    option.value = release.tag_name;
                    option.textContent = label;
                    option.dataset.date = formatDate(release.published_at);
                    option.dataset.post = meta.versionPost || '';
                    option.dataset.versionName = meta.versionName || release.tag_name;
                    if (meta.publishDate) {
                        option.dataset.customDate = meta.publishDate.toISOString();
                    } else {
                        option.dataset.customDate = '';
                    }
                    optgroup.appendChild(option);
                });

                versionSelect.appendChild(optgroup);
            });

            // Выбираем первый (самый приоритетный) релиз по умолчанию
            const firstOption = versionSelect.querySelector('option');
            if (firstOption) {
                versionSelect.value = firstOption.value;
            }
            updateUIForSelectedRelease();
        }

        function updateUIForSelectedRelease() {
            if (!versionSelect.value) return;
            const tag = versionSelect.value;
            const release = allReleases.find(r => r.tag_name === tag);
            if (!release) return;
            const meta = parseMeta(release.body);

            let displayDate;
            if (meta.publishDate) {
                const formatted = formatCustomDate(meta.publishDate);
                if (formatted) {
                    displayDate = formatted;
                } else {
                    displayDate = formatDate(release.published_at);
                }
            } else {
                displayDate = formatDate(release.published_at);
            }
            versionDateEl.textContent = `Обновление от ${displayDate}`;

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
            try {
                if (window.GithubAPI?.loadIssue) {
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
                window.UIUtils?.showToast('Не удалось загрузить пост', 'error');
            }
        });

        populateVersionSelect(currentPlatform);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();