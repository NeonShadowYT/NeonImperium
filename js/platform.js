// platform.js – автоматическое скрытие кнопок под платформу + интеграция с GitHub Releases + версия Starve Neon

document.addEventListener('DOMContentLoaded', function() {
    const os = getOS();
    const platformButtons = document.querySelectorAll('.download-button[data-platform]');
    const githubButtons = document.querySelectorAll('.download-button.github');

    // Скрываем обычные кнопки, не соответствующие текущей ОС
    platformButtons.forEach(btn => {
        const btnPlatform = btn.dataset.platform;
        const currentOs = os.toLowerCase();
        const btnOs = btnPlatform ? btnPlatform.toLowerCase() : '';
        if (currentOs === btnOs) {
            btn.style.display = '';
        } else {
            btn.style.display = 'none';
        }
    });

    // Если есть GitHub-кнопки, подставляем ссылки из последнего релиза и обновляем версию Starve Neon
    if (githubButtons.length > 0 || document.querySelector('.game-title')?.textContent === 'Starve Neon') {
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
        const response = await fetch(url);
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
    if (allowedExts && allowedExts.length > 0) {
        return assets.find(asset => allowedExts.some(ext => asset.name.toLowerCase().endsWith(ext)));
    } else {
        return assets.find(asset => asset.name.toLowerCase().includes(platformLower));
    }
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

    // Обновляем версию и дату для Starve Neon
    updateStarveNeonVersion(release);

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

function updateStarveNeonVersion(release) {
    const versionBadge = document.querySelector('.version-badge[data-lang="starveVersion"]');
    const downloadNote = document.querySelector('.small-note[data-lang="starveDownloadNote"]');
    if (!versionBadge && !downloadNote) return;

    const tag = release.tag_name;
    const published = new Date(release.published_at);
    const formattedDate = published.toLocaleDateString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\./g, '.');

    if (versionBadge) {
        versionBadge.textContent = tag;
    }
    if (downloadNote) {
        downloadNote.textContent = `Версия ${tag} · Обновление от ${formattedDate}`;
        // Также обновляем английскую версию, если переключится язык
        const enNote = document.querySelector('.small-note[data-lang="starveDownloadNote"][lang="en"]');
        if (enNote) {
            enNote.textContent = `Version ${tag} · Update ${published.toISOString().slice(0,10)}`;
        }
    }
}