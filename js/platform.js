// platform.js – автоматическое скрытие кнопок под платформу + интеграция с GitHub Releases (кеширование)
document.addEventListener('DOMContentLoaded', function() {
    const os = getOS();
    const platformButtons = document.querySelectorAll('.download-button[data-platform]');
    const githubButtons = document.querySelectorAll('.download-button.github');

    platformButtons.forEach(btn => {
        const currentOs = os.toLowerCase();
        const btnOs = (btn.dataset.platform || '').toLowerCase();
        btn.style.display = currentOs === btnOs ? '' : 'none';
    });

    if (githubButtons.length > 0) {
        initGitHubDownloads(os, githubButtons);
    }
});

function getOS() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'Android';
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return 'iOS';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Linux/.test(ua)) return 'Linux';
    if (/Windows/.test(ua)) return 'Windows';
    return 'Unknown';
}

async function getLatestRelease(owner, repo) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    try {
        const fetcher = window.GithubCore?.fetchCached || fetch;
        const response = await fetcher(url, {}, { cacheKey: `release_${owner}_${repo}`, ttl: 600000 });
        if (!response.ok) throw new Error('Failed to fetch release');
        return await response.json();
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
    const REPO_NAME = window.GithubCore?.CONFIG?.REPO_NAME || 'NeonImperium';
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
        if (!platform) return;
        if (platform.toLowerCase() === os.toLowerCase()) {
            const asset = findAssetByPlatform(release.assets, platform);
            if (asset) {
                btn.href = asset.browser_download_url;
                btn.target = '_blank';
                btn.classList.remove('disabled');
            } else {
                btn.classList.add('disabled');
                btn.textContent += ' (файл не найден)';
            }
        } else {
            btn.style.display = 'none';
        }
    });
}