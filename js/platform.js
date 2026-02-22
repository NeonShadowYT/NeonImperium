// platform.js – автоматическое скрытие кнопок под платформу пользователя
document.addEventListener('DOMContentLoaded', function() {
    const os = getOS();
    const platformButtons = document.querySelectorAll('.download-button[data-platform]');

    platformButtons.forEach(btn => {
        const btnPlatform = btn.dataset.platform;
        // Показываем кнопку, только если она предназначена для текущей ОС
        if ((os === 'Windows' && btnPlatform === 'Windows') ||
            (os === 'Android' && btnPlatform === 'Android')) {
            btn.style.display = ''; // показать (по умолчанию)
        } else {
            btn.style.display = 'none'; // скрыть
        }
    });
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