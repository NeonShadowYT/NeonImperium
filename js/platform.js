// platform.js – автоматическое скрытие кнопок под платформу + интеграция с GitHub Releases

document.addEventListener('DOMContentLoaded', function() {
    const os = getOS();
    const platformButtons = document.querySelectorAll('.download-button[data-platform]');
    const githubButtons = document.querySelectorAll('.download-button.github');

    // Скрываем обычные кнопки, не соответствующие текущей ОС
    platformButtons.forEach(btn => {
        const btnPlatform = btn.dataset.platform;
        if ((os === 'Windows' && btnPlatform === 'Windows') ||
            (os === 'Android' && btnPlatform === 'Android') ||
            (os === 'Mac' && btnPlatform === 'Mac') ||
            (os === 'Linux' && btnPlatform === 'Linux') ||
            (os === 'iOS' && btnPlatform === 'iOS')) {
            btn.style.display = ''; // показать
        } else {
            btn.style.display = 'none'; // скрыть
        }
    });

    // Если есть GitHub-кнопки, подставляем ссылки из последнего релиза
    if (githubButtons.length > 0) {
        initGitHubDownloads(os, githubButtons);
    }
});

/**
 * Определяет операционную систему по user-agent.
 * @returns {string} 'Windows', 'Android', 'Mac', 'Linux', 'iOS' или 'Unknown'
 */
function getOS() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'Android';
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return 'iOS';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Linux/.test(ua)) return 'Linux';
    if (/Windows/.test(ua)) return 'Windows';
    return 'Unknown';
}

/**
 * Получает последний релиз из репозитория NeonImperium.
 */
async function getLatestRelease(owner, repo) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch release');
        return await response.json();
    } catch (err) {
        console.error('Error fetching latest release:', err);
        return null;
    }
}

/**
 * Ищет asset, в имени которого содержится название платформы (без учёта регистра).
 */
function findAssetByPlatform(assets, platform) {
    const platformLower = platform.toLowerCase();
    return assets.find(asset => asset.name.toLowerCase().includes(platformLower));
}

/**
 * Инициализация кнопок GitHub: подстановка ссылок на скачивание.
 */
async function initGitHubDownloads(os, buttons) {
    const REPO_OWNER = GithubCore.CONFIG.REPO_OWNER;      // NeonShadowYT
    const REPO_NAME = GithubCore.CONFIG.REPO_NAME;        // NeonImperium

    const release = await getLatestRelease(REPO_OWNER, REPO_NAME);
    if (!release) {
        buttons.forEach(btn => {
            btn.removeAttribute('href');
            btn.classList.add('disabled');
            btn.textContent += ' (недоступно)';
        });
        return;
    }

    buttons.forEach(btn => {
        const platform = btn.dataset.platform;
        if (platform && platform.toLowerCase() === os.toLowerCase()) {
            const asset = findAssetByPlatform(release.assets, platform);
            if (asset) {
                btn.href = asset.browser_download_url;
                btn.target = '_blank'; // или убрать, чтобы скачивалось сразу
                btn.classList.remove('disabled');
            } else {
                btn.classList.add('disabled');
                btn.textContent += ' (файл не найден)';
            }
        } else {
            btn.style.display = 'none'; // скрываем неподходящие кнопки
        }
    });
}