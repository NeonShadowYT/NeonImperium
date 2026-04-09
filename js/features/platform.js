// js/features/platform.js
(function() {
    function getOS() {
        const ua = navigator.userAgent;
        if (/android/i.test(ua)) return 'Android';
        if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
        if (/Mac/.test(ua)) return 'Mac';
        if (/Linux/.test(ua)) return 'Linux';
        if (/Windows/.test(ua)) return 'Windows';
        return 'Unknown';
    }

    async function initGitHubDownloads(os, buttons) {
        const release = await NeonAPI.githubFetch(`https://api.github.com/repos/${NeonConfig.REPO_OWNER}/${NeonConfig.REPO_NAME}/releases/latest`).then(r => r.json()).catch(() => null);
        if (!release) return;
        const badge = document.querySelector('[data-lang="starveVersion"]');
        if (badge) badge.textContent = release.tag_name;
        const note = document.querySelector('[data-lang="starveDownloadNote"]');
        if (note) note.textContent = `Версия ${release.tag_name} · Обновление ${new Date(release.published_at).toLocaleDateString()}`;

        buttons.forEach(btn => {
            const platform = btn.dataset.platform;
            if (!platform || platform.toLowerCase() !== os.toLowerCase()) {
                btn.style.display = 'none';
                return;
            }
            const exts = { windows: ['.exe','.zip'], android: ['.apk'] }[platform.toLowerCase()] || [];
            const asset = release.assets.find(a => exts.some(ext => a.name.toLowerCase().endsWith(ext)));
            if (asset) {
                btn.href = asset.browser_download_url;
                btn.classList.remove('disabled');
            } else {
                btn.classList.add('disabled');
                btn.textContent += ' (нет файла)';
            }
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const os = getOS();
        document.querySelectorAll('.download-button[data-platform]').forEach(btn => {
            if (btn.dataset.platform.toLowerCase() !== os.toLowerCase()) btn.style.display = 'none';
        });
        const ghBtns = document.querySelectorAll('.download-button.github');
        if (ghBtns.length) initGitHubDownloads(os, ghBtns);
    });
})();