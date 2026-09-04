// js/features/youtube-loader.js
(function() {
  function parseYouTubeUrl(url) {
    try {
      const parsed = new URL(url);
      const isYoutube = parsed.hostname.includes('youtube.com') ||
                        parsed.hostname.includes('youtu.be') ||
                        parsed.hostname.includes('youtube-nocookie.com');
      if (!isYoutube) return null;

      let videoId = null;
      let playlistId = null;
      let start = null;

      if (parsed.hostname.includes('youtu.be')) {
        const pathParts = parsed.pathname.split('/').filter(p => p);
        if (pathParts.length > 0) videoId = pathParts[0];
      }

      const params = new URLSearchParams(parsed.search);
      if (params.has('v')) videoId = params.get('v');
      if (params.has('list')) playlistId = params.get('list');
      if (params.has('t')) start = params.get('t');
      else if (params.has('start')) start = params.get('start');

      if (!videoId && parsed.pathname.includes('/embed/')) {
        const parts = parsed.pathname.split('/embed/');
        if (parts.length > 1) {
          const idPart = parts[1].split('?')[0];
          if (idPart && idPart !== 'videoseries') videoId = idPart;
        }
      }
      if (!videoId && parsed.pathname.includes('/watch/')) {
        const parts = parsed.pathname.split('/watch/');
        if (parts.length > 1) {
          const idPart = parts[1].split('?')[0];
          if (idPart && idPart !== 'videoseries') videoId = idPart;
        }
      }

      if (!videoId && playlistId) {
        let embedUrl = `https://www.youtube-nocookie.com/embed/videoseries?list=${playlistId}`;
        if (start) embedUrl += `&start=${start}`;
        embedUrl += `&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
        return { embedUrl, videoId: null, playlistId, start };
      }

      if (videoId) {
        let embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
        const queryParams = new URLSearchParams();
        queryParams.set('rel', '0');
        queryParams.set('modestbranding', '1');
        queryParams.set('playsinline', '1');
        queryParams.set('origin', location.origin);
        if (playlistId) queryParams.set('list', playlistId);
        if (start) queryParams.set('start', start);
        const qs = queryParams.toString();
        if (qs) embedUrl += '?' + qs;
        return { embedUrl, videoId, playlistId, start };
      }

      if (parsed.pathname.includes('/playlist')) {
        const listParam = params.get('list');
        if (listParam) {
          let embedUrl = `https://www.youtube-nocookie.com/embed/videoseries?list=${listParam}`;
          if (start) embedUrl += `&start=${start}`;
          embedUrl += `&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
          return { embedUrl, videoId: null, playlistId: listParam, start };
        }
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  function showYouTubeFallback(container, videoUrl) {
    const t = window.I18n?.translate || (k => k);
    container.innerHTML = '';
    container.style.position = 'relative';
    container.style.width = '100%';
    container.style.paddingBottom = '56.25%';
    container.style.background = 'var(--bg-primary)';
    container.style.borderRadius = '12px';
    container.style.overflow = 'hidden';

    const fallbackDiv = document.createElement('div');
    fallbackDiv.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: var(--bg-primary);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      gap: 12px;
      animation: fadeInUp 0.4s ease;
    `;
    fallbackDiv.innerHTML = `
      <i class="fab fa-youtube" style="font-size:32px;color:var(--accent);"></i>
      <p style="color:var(--text-secondary);font-size:14px;margin:0;">${t('videoLoadFailed')}</p>
      <button class="button small" onclick="window.open('${videoUrl || '#'}', '_blank')" style="background:var(--accent);color:#fff;">
        <i class="fas fa-external-link-alt"></i> ${t('open')}
      </button>
    `;
    container.appendChild(fallbackDiv);
    container.classList.add('loaded');
  }

  function initLazyYT() {
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const src = el.dataset.src;
          if (!src) return;

          const parsed = parseYouTubeUrl(src);
          let embedUrl = parsed ? parsed.embedUrl : null;

          if (!embedUrl) {
            let videoId = '';
            const patterns = [
              /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
              /youtube\.com\/embed\/([^&\n?#]+)/
            ];
            for (const p of patterns) {
              const match = src.match(p);
              if (match) { videoId = match[1]; break; }
            }
            if (!videoId) {
              const match = src.match(/youtube-nocookie\.com\/embed\/([^&\n?#]+)/);
              if (match) videoId = match[1];
            }
            if (videoId) {
              embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
            } else {
              const listMatch = src.match(/[?&]list=([^&]+)/);
              if (listMatch) {
                const list = listMatch[1];
                embedUrl = `https://www.youtube-nocookie.com/embed/videoseries?list=${list}&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
              }
            }
          }

          if (!embedUrl) {
            showYouTubeFallback(el, src);
            return;
          }

          const iframe = document.createElement('iframe');
          iframe.src = embedUrl;
          iframe.setAttribute('frameborder', '0');
          iframe.setAttribute('allowfullscreen', '');
          iframe.loading = 'lazy';
          iframe.sandbox = 'allow-same-origin allow-scripts allow-popups allow-forms allow-presentation';
          iframe.allow = 'autoplay; encrypted-media; gyroscope; picture-in-picture';
          iframe.referrerPolicy = 'strict-origin-when-cross-origin';
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          iframe.style.border = 'none';
          iframe.style.borderRadius = '12px';

          let errorOccurred = false;
          iframe.onerror = function() {
            if (!errorOccurred) {
              errorOccurred = true;
              showYouTubeFallback(el, src);
            }
          };
          const timeout = setTimeout(() => {
            if (!iframe.contentWindow && !errorOccurred) {
              errorOccurred = true;
              showYouTubeFallback(el, src);
            }
          }, 10000);

          iframe.onload = function() {
            clearTimeout(timeout);
            el.classList.add('loaded');
            obs.unobserve(el);
          };

          el.addEventListener('remove', function() {
            clearTimeout(timeout);
          });

          el.innerHTML = '';
          el.style.position = 'relative';
          el.style.paddingBottom = '56.25%';
          el.style.background = '#000';
          el.style.borderRadius = '12px';
          el.style.overflow = 'hidden';
          iframe.style.position = 'absolute';
          iframe.style.top = '0';
          iframe.style.left = '0';
          iframe.style.width = '100%';
          iframe.style.height = '100%';
          el.appendChild(iframe);
          el.classList.add('loaded');
        });
      }, { rootMargin: '200px' });

      document.querySelectorAll('.lazy-yt').forEach((el) => {
        if (el.querySelector('iframe')) return;
        obs.observe(el);
      });
    } else {
      document.querySelectorAll('.lazy-yt').forEach((el) => {
        if (el.querySelector('iframe')) return;
        const src = el.dataset.src;
        if (!src) return;
        const parsed = parseYouTubeUrl(src);
        let embedUrl = parsed ? parsed.embedUrl : null;
        if (!embedUrl) {
          let videoId = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/)?.[1];
          if (!videoId) {
            const match = src.match(/youtube-nocookie\.com\/embed\/([^&\n?#]+)/);
            if (match) videoId = match[1];
          }
          if (videoId) {
            embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
          } else {
            const listMatch = src.match(/[?&]list=([^&]+)/);
            if (listMatch) {
              embedUrl = `https://www.youtube-nocookie.com/embed/videoseries?list=${listMatch[1]}&rel=0&modestbranding=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
            }
          }
        }
        if (!embedUrl) {
          showYouTubeFallback(el, src);
          return;
        }
        const iframe = document.createElement('iframe');
        iframe.src = embedUrl;
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allowfullscreen', '');
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.borderRadius = '12px';
        el.innerHTML = '';
        el.style.position = 'relative';
        el.style.paddingBottom = '56.25%';
        el.style.background = '#000';
        el.style.borderRadius = '12px';
        el.style.overflow = 'hidden';
        iframe.style.position = 'absolute';
        iframe.style.top = '0';
        iframe.style.left = '0';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        el.appendChild(iframe);
        el.classList.add('loaded');
      });
    }

    document.querySelectorAll('.lazy-yt').forEach(el => {
      el.addEventListener('click', function(e) {
        const iframe = this.querySelector('iframe');
        if (iframe) {
          try {
            iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
          } catch (err) {}
        }
      });
    });

    document.querySelectorAll('.desc-block .desc-image video').forEach(video => {
      const block = video.closest('.desc-block');
      if (block) {
        block.style.cursor = 'pointer';
        block.addEventListener('click', function(e) {
          if (e.target.closest('.desc-text')) return;
          const vid = this.querySelector('video');
          if (vid) {
            if (vid.paused) vid.play().catch(() => {});
            else vid.pause();
          }
        });
      }
    });
  }

  window.YoutubeLoader = {
    parseYouTubeUrl,
    initLazyYT
  };
})();