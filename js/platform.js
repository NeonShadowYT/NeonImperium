// platform.js – автоматическое скрытие кнопок под платформу + интеграция с GitHub Releases

document.addEventListener('DOMContentLoaded', function() {
    const os = getOS();
    const platformButtons = document.querySelectorAll('.download-button[data-platform]');
    const githubButtons = document.querySelectorAll('.download-button.github');

    // Скрываем обычные кнопки, не соответствующие текущей ОС
    platformButtons.forEach(btn => {
        const btnPlatform = btn.dataset.platform;
        // Приводим к нижнему регистру для сравнения
        const currentOs = os.toLowerCase();
        const btnOs = btnPlatform ? btnPlatform.toLowerCase() : '';
        if (currentOs === btnOs) {
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
 * Ищет asset, подходящий для указанной платформы.
 * Приоритет: для Windows и Android ищем по расширениям файлов.
 * Для остальных платформ (Mac, Linux, iOS) используем поиск по подстроке в имени.
 */
function findAssetByPlatform(assets, platform) {
    const platformLower = platform.toLowerCase();
    
    // Словарь допустимых расширений для каждой платформы
    const extensions = {
        windows: ['.exe', '.zip', '.7z'],        // исполняемые файлы и архивы
        android: ['.apk'],                        // только APK
        mac: ['.dmg', '.app', '.zip'],            // образы DMG, папки .app (в архиве), ZIP
        linux: ['.appimage', '.x86_64', '.tar.gz', '.zip'] //常見 форматы для Linux
    };

    const allowedExts = extensions[platformLower];
    
    if (allowedExts && allowedExts.length > 0) {
        // Ищем файл, имя которого заканчивается на одно из допустимых расширений
        return assets.find(asset => {
            const name = asset.name.toLowerCase();
            return allowedExts.some(ext => name.endsWith(ext));
        });
    } else {
        // Для платформ без явных расширений (например, iOS) ищем по подстроке
        return assets.find(asset => asset.name.toLowerCase().includes(platformLower));
    }
}

/**
 * Инициализация кнопок GitHub: подстановка ссылок на скачивание.
 */
async function initGitHubDownloads(os, buttons) {
    // Используем глобальный объект GithubCore, если он доступен
    const REPO_OWNER = window.GithubCore?.CONFIG?.REPO_OWNER || 'NeonShadowYT';
    const REPO_NAME = window.GithubCore?.CONFIG?.REPO_NAME || 'NeonImperium';

    const release = await getLatestRelease(REPO_OWNER, REPO_NAME);
    if (!release) {
        // Если релиз не найден, деактивируем все кнопки
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

        // Показываем только кнопки для текущей ОС
        if (platform.toLowerCase() === os.toLowerCase()) {
            const asset = findAssetByPlatform(release.assets, platform);
            if (asset) {
                btn.href = asset.browser_download_url;
                btn.target = '_blank'; // можно убрать, если хотим сразу скачивать
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