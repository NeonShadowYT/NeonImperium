// js/lazy-load.js – ленивая загрузка YouTube и других медиа
document.addEventListener('DOMContentLoaded', () => {
  if ('IntersectionObserver' in window) {
    const lazyVideos = document.querySelectorAll('.lazy-yt');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const src = el.dataset.src;
          if (src) {
            const iframe = document.createElement('iframe');
            iframe.src = src;
            iframe.setAttribute('frameborder', '0');
            iframe.setAttribute('allowfullscreen', '');
            iframe.setAttribute('loading', 'lazy');
            el.appendChild(iframe);
            el.classList.remove('lazy-yt');
          }
          observer.unobserve(el);
        }
      });
    }, { rootMargin: '200px' });

    lazyVideos.forEach(el => observer.observe(el));
  } else {
    // Фолбэк: загружаем сразу
    document.querySelectorAll('.lazy-yt').forEach(el => {
      const src = el.dataset.src;
      if (src) {
        const iframe = document.createElement('iframe');
        iframe.src = src;
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allowfullscreen', '');
        el.appendChild(iframe);
      }
    });
  }
});