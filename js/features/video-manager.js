// js/features/video-manager.js
(function() {
    const { parseYouTubeUrl } = window.Utils;
    const { createElement, emptyElement } = window.DomUtils;
    const { throttleRAF } = window.Animations;

    /**
     * Показывает fallback-сообщение при ошибке загрузки видео.
     */
    function showVideoFallback(container, videoUrl) {
        const t = window.I18n?.translate || (k => k);
        emptyElement(container);
        container.style.position = 'relative';
        container.style.width = '100%';
        container.style.paddingBottom = '56.25%';
        container.style.background = 'var(--bg-primary)';
        container.style.borderRadius = '12px';
        container.style.overflow = 'hidden';

        const fallbackDiv = createElement('div', null, {
            position: 'absolute',
            top: 0, left: 0,
            width: '100%', height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-primary)',
            borderRadius: '12px',
            padding: '20px',
            textAlign: 'center',
            gap: '12px',
            animation: 'fadeInUp 0.4s ease'
        });
        fallbackDiv.innerHTML = `
            <i class="fab fa-youtube" style="font-size:32px;color:var(--accent);"></i>
            <p style="color:var(--text-secondary);font-size:14px;margin:0;">${t('videoLoadFailed')}</p>
            <button class="button small" onclick="window.open('${videoUrl || '#'}', '_blank')" style="background:var(--accent);color:#fff;">
                <i class="fas fa-external-link-alt"></i> ${t('open')}
            </button>
            <button class="button small retry-video" style="background:var(--bg-inner-gradient);color:var(--text-secondary);">
                <i class="fas fa-redo"></i> ${t('retry') || 'Повторить'}
            </button>
        `;
        container.appendChild(fallbackDiv);
        container.classList.add('loaded');

        const retryBtn = fallbackDiv.querySelector('.retry-video');
        if (retryBtn) {
            retryBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                container.classList.remove('loaded');
                container.dataset.loaded = 'false';
                loadVideo(container);
            });
        }
    }

    /**
     * Загружает видео в контейнер.
     */
    function loadVideo(container) {
        const src = container.dataset.src;
        if (!src) return;

        // Проверяем, не загружено ли уже
        if (container.dataset.loaded === 'true' && container.querySelector('iframe')) return;

        const parsed = window.Utils.parseYouTubeUrl(src);
        let embedUrl = parsed ? parsed.embedUrl : null;

        if (!embedUrl) {
            showVideoFallback(container, src);
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
        iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:12px;';

        let errorOccurred = false;
        let timeoutId = null;

        const onError = () => {
            if (!errorOccurred) {
                errorOccurred = true;
                if (timeoutId) clearTimeout(timeoutId);
                showVideoFallback(container, src);
            }
        };

        iframe.onerror = onError;

        // Таймаут 30 сек
        timeoutId = setTimeout(() => {
            if (!iframe.contentWindow && !errorOccurred) {
                errorOccurred = true;
                showVideoFallback(container, src);
            }
        }, 30000);

        iframe.onload = function() {
            clearTimeout(timeoutId);
            container.classList.add('loaded');
            container.dataset.loaded = 'true';
            iframe.onerror = null;
            iframe.onload = null;
        };

        emptyElement(container);
        container.style.position = 'relative';
        container.style.paddingBottom = '56.25%';
        container.style.background = '#000';
        container.style.borderRadius = '12px';
        container.style.overflow = 'hidden';
        iframe.style.position = 'absolute';
        iframe.style.top = '0';
        iframe.style.left = '0';
        container.appendChild(iframe);
    }

    /**
     * Инициализирует ленивую загрузку для всех .lazy-yt.
     */
    function initLazyVideo() {
        const containers = document.querySelectorAll('.lazy-yt:not([data-loaded="true"])');
        if (!('IntersectionObserver' in window)) {
            // Fallback: загружаем сразу
            containers.forEach(el => loadVideo(el));
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    if (el.dataset.loaded === 'true') return;
                    loadVideo(el);
                    el.dataset.loaded = 'true';
                    observer.unobserve(el);
                }
            });
        }, { rootMargin: '200px' });

        containers.forEach(el => observer.observe(el));
    }

    /**
     * Добавляет обработчик клика для воспроизведения/паузы видео в описании.
     */
    function initDescVideoControls() {
        document.querySelectorAll('.desc-block .desc-image video').forEach(video => {
            const block = video.closest('.desc-block');
            if (block) {
                block.style.cursor = 'pointer';
                block.addEventListener('click', function(e) {
                    if (e.target.closest('.desc-text')) return;
                    const vid = this.querySelector('video');
                    if (vid) {
                        if (vid.paused) {
                            vid.play().catch(() => {});
                        } else {
                            vid.pause();
                        }
                    }
                });
            }
        });
    }

    window.VideoManager = {
        loadVideo,
        showVideoFallback,
        initLazyVideo,
        initDescVideoControls
    };
})();