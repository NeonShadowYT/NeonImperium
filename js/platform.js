// platform.js – автоматическое скрытие кнопок под платформу + динамическая версия из релиза
(function() {
    const OS_CACHE_KEY = 'detected_os';
    const GH_CACHE_KEY = 'github_latest_release';
    const GH_CACHE_DURATION = 5 * 60 * 1000;

    function getOS() {
        const cached = sessionStorage.getItem(OS_CACHE_KEY);
        if (cached && ['Windows','Android','Mac','Linux','iOS'].includes(cached)) return cached;

        let os = 'Unknown';
        const ua = navigator.userAgent;
        if (/android/i.test(ua)) os = 'Android';
        else if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) os = 'iOS';
        else if (/Mac/.test(ua)) os = 'Mac';
        else if (/Linux/.test(ua)) os = 'Linux';
        else if (/Windows/.test(ua)) os = 'Windows';

        sessionStorage.setItem(OS_CACHE_KEY, os);
        return os;
    }

    async function getLatestRelease(owner, repo) {
        const cacheKey = GH_CACHE_KEY + `_${owner}_${repo}`;
        const cachedRaw = sessionStorage.getItem(cacheKey);
        if (cachedRaw) {
            try {
                const { data, timestamp } = JSON.parse(cachedRaw);
                if (Date.now() - timestamp < GH_CACHE_DURATION) return data;
            } catch {}
        }

        const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Release not found');
            const release = await response.json();
            sessionStorage.setItem(cacheKey, JSON.stringify({ data: release, timestamp: Date.now() }));
            return release;
        } catch (err) {
            console.error('Error fetching latest release:', err);
            return null;
        }
    }

    function findAssetByPlatform(assets, platform) {
        const platformLower = platform.toLowerCase();
        const extensions = {
            windows: ['.exe', '.zip', '.7z'],
            android: ['.apk'],
            mac: ['.dmg', '.app', '.zip'],
            linux: ['.appimage', '.x86_64', '.tar.gz', '.zip']
        };
        const allowedExts = extensions[platformLower];
        if (allowedExts) {
            return assets.find(asset => {
                const name = asset.name.toLowerCase();
                return allowedExts.some(ext => name.endsWith(ext));
            });
        }
        return assets.find(asset => asset.name.toLowerCase().includes(platformLower));
    }

    async function initGitHubDownloads(os, buttons) {
        const REPO_OWNER = window.GithubCore?.CONFIG?.REPO_OWNER || 'NeonShadowYT';
        const REPO_NAME  = window.GithubCore?.CONFIG?.REPO_NAME  || 'NeonImperium';

        const release = await getLatestRelease(REPO_OWNER, REPO_NAME);
        if (!release) return;

        buttons.forEach(btn => {
            const platform = btn.dataset.platform;
            if (!platform) return;
            if (platform.toLowerCase() !== os.toLowerCase()) {
                btn.style.display = 'none';
                return;
            }
            const asset = findAssetByPlatform(release.assets, platform);
            if (asset) {
                btn.href = asset.browser_download_url;
                btn.target = '_blank';
                btn.classList.remove('disabled');
                btn.style.display = '';
            } else {
                btn.style.display = 'none';
            }
        });

        // Обновляем текст версии и даты на странице
        updateVersionDisplay(release);
    }

    /**
     * Обновляет элементы с data-version-role на странице
     * @param {Object} release - объект релиза GitHub
     */
    function updateVersionDisplay(release) {
        // Определяем, для какой игры релиз (ищем в теле строку "game: имя_игры")
        let targetGame = null;
        if (release.body) {
            const match = release.body.match(/game:\s*([\w-]+)/i);
            if (match) targetGame = match[1].toLowerCase();
        }

        // Получаем все контейнеры, которые хотят показывать версию
        const containers = document.querySelectorAll('[data-version-game]');
        if (containers.length === 0) return;   // нет элементов – нечего обновлять

        containers.forEach(container => {
            const containerGame = container.dataset.versionGame.toLowerCase();
            // Если в релизе указана игра, показываем версию только для неё.
            // Если игра не указана (targetGame === null), показываем для всех (старое поведение).
            if (targetGame && targetGame !== containerGame) return;

            // Извлекаем номер версии из тега (убираем ведущую 'v')
            const version = (release.tag_name || '').replace(/^v/, '');
            // Форматируем дату (DD.MM.YYYY)
            const pubDate = new Date(release.published_at);
            const dateStr = pubDate.toLocaleDateString('ru-RU', {
                day: '2-digit', month: '2-digit', year: 'numeric'
            }).replace(/\./g, '.');   // оставляем точки

            // Элемент для отображения версии (обычно span.version-badge)
            const versionEl = container.querySelector('[data-version-role="version"]');
            if (versionEl) {
                // Сохраняем локализованный префикс из data‑атрибута или используем fallback
                const prefix = versionEl.getAttribute('data-version-prefix') || '';
                versionEl.textContent = prefix + version;
            }

            // Элемент для отображения строки с версией и датой (p.small-note)
            const dateEl = container.querySelector('[data-version-role="date"]');
            if (dateEl) {
                // Формируем строку "Версия X · Обновление от Y"
                const prefix = dateEl.getAttribute('data-version-date-prefix') || 'Версия';
                const dateText = `${prefix} ${version} · Обновление от ${dateStr}`;
                dateEl.textContent = dateText;
            }
        });
    }

    function processPlatformButtons() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', processPlatformButtons);
            return;
        }
        const os = getOS();
        const githubButtons = document.querySelectorAll('.download-button.github');
        if (githubButtons.length > 0) {
            initGitHubDownloads(os, githubButtons).catch(console.error);
        }
    }

    processPlatformButtons();
})();