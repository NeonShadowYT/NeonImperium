(function() {
    window.LoadMore = {
        createButton: function(loadCallback, options = {}) {
            const { container, pageSize = 10, totalItems, onLoadStart, onLoadEnd } = options;
            let currentPage = 1;
            let isLoading = false;
            let hasMore = true;
            let button = null;

            function showButton() {
                if (!button) {
                    button = document.createElement('button');
                    button.className = 'load-more-btn';
                    button.textContent = 'Загрузить ещё';
                    button.setAttribute('aria-label', 'Загрузить следующие элементы');
                    if (container && container.parentNode) {
                        container.parentNode.insertBefore(button, container.nextSibling);
                    }
                    button.addEventListener('click', async () => {
                        if (isLoading || !hasMore) return;
                        isLoading = true;
                        button.disabled = true;
                        button.textContent = 'Загрузка...';
                        if (onLoadStart) onLoadStart();
                        try {
                            const newPage = currentPage + 1;
                            const result = await loadCallback(newPage);
                            if (result && result.hasMore === false) {
                                hasMore = false;
                                button.style.display = 'none';
                            } else {
                                currentPage = newPage;
                            }
                        } catch (err) {
                            console.error('Load more error:', err);
                        } finally {
                            isLoading = false;
                            if (hasMore) {
                                button.disabled = false;
                                button.textContent = 'Загрузить ещё';
                            } else {
                                button.style.display = 'none';
                            }
                            if (onLoadEnd) onLoadEnd();
                        }
                    });
                }
                button.style.display = hasMore ? 'block' : 'none';
            }

            function hideButton() {
                if (button) button.style.display = 'none';
            }

            function reset() {
                currentPage = 1;
                hasMore = true;
                if (button) {
                    button.disabled = false;
                    button.textContent = 'Загрузить ещё';
                    button.style.display = 'block';
                }
            }

            return { showButton, hideButton, reset, setHasMore: (value) => { hasMore = value; if (!hasMore && button) button.style.display = 'none'; } };
        },
        
        attachToInfiniteScroll: function(loadCallback, sentinel, options = {}) {
            const observer = new IntersectionObserver(async (entries) => {
                if (entries[0].isIntersecting && !options.isLoading && options.hasMore) {
                    if (options.onLoadStart) options.onLoadStart();
                    try {
                        await loadCallback();
                    } finally {
                        if (options.onLoadEnd) options.onLoadEnd();
                    }
                }
            }, { threshold: 0.1 });
            if (sentinel) observer.observe(sentinel);
            return observer;
        }
    };
})();