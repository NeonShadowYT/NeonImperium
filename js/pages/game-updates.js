// game-updates.js
(function() {
    const DEFAULT_IMAGE = 'images/default-news.webp';
    let currentAbort = null;
    let currentGame = null;
    let loadMoreButton = null;
    let currentPage = 1;
    let hasMorePages = true;
    let isLoading = false;
    let allUpdates = [];
    let displayLimit = 6;
    
    document.addEventListener('DOMContentLoaded', () => {
        const container = document.getElementById('game-updates');
        if (container && container.dataset.game) {
            currentGame = container.dataset.game;
            loadGameUpdates(container, currentGame);
        }
        
        window.addEventListener('github-issue-created', (e) => {
            const issue = e.detail;
            if (!currentGame) return;
            const hasUpdateLabel = issue.labels.some(l => l.name === 'type:update');
            const hasGameLabel = issue.labels.some(l => l.name === `game:${currentGame}`);
            if (!hasUpdateLabel || !hasGameLabel) return;
            if (!GithubCore.CONFIG.ALLOWED_AUTHORS.includes(issue.user.login)) return;
            
            if (window.Cache) window.Cache.removeByPrefix(`game_updates_${currentGame}`);
            
            const container = document.getElementById('game-updates');
            if (!container) return;
            
            const newPost = {
                number: issue.number,
                title: issue.title,
                body: issue.body,
                date: new Date(issue.created_at),
                author: issue.user.login,
                game: currentGame,
                labels: issue.labels.map(l => l.name)
            };
            allUpdates = [newPost, ...allUpdates];
            displayLimit = 6;
            renderUpdates(container);
        });
    });
    
    window.refreshGameUpdates = (game) => {
        const container = document.getElementById('game-updates');
        if (container && container.dataset.game === game) {
            currentGame = game;
            allUpdates = [];
            displayLimit = 6;
            loadGameUpdates(container, game);
        }
    };
    
    async function loadGameUpdates(container, game) {
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i> Загрузка...</div>`;
        if (currentAbort) currentAbort.controller.abort();
        const { controller, timeoutId } = GithubCore.createAbortable(10000);
        currentAbort = { controller };
        try {
            const cacheKey = `game_updates_${game}`;
            let posts = null;
            if (window.Cache) posts = window.Cache.get(cacheKey);
            if (!posts) {
                const issues = await GithubAPI.loadIssues({ labels: `type:update,game:${game}`, per_page: 20, signal: controller.signal });
                posts = GithubCore.deduplicateByNumber(issues)
                    .filter(issue => GithubCore.CONFIG.ALLOWED_AUTHORS.includes(issue.user.login))
                    .map(issue => ({ number: issue.number, title: issue.title, body: issue.body, date: new Date(issue.created_at), author: issue.user.login, game, labels: issue.labels.map(l => l.name) }));
                if (window.Cache) window.Cache.set(cacheKey, posts.map(p => ({ ...p, date: p.date.toISOString() })));
            } else posts = posts.map(p => ({ ...p, date: new Date(p.date) }));
            const currentUser = GithubAuth.getCurrentUser();
            allUpdates = posts.filter(post => {
                if (!post.labels.includes('private')) return true;
                if (GithubAuth.isAdmin()) return true;
                const allowed = GithubCore.extractAllowed(post.body);
                if (!allowed) return false;
                const allowedList = allowed.split(',').map(s => s.trim()).filter(Boolean);
                return allowedList.includes(currentUser);
            });
            allUpdates.sort((a, b) => b.date - a.date);
            renderUpdates(container);
        } catch (err) {
            if (err.name === 'AbortError') return;
            container.innerHTML = '<p class="error-message">Ошибка загрузки</p>';
        } finally {
            clearTimeout(timeoutId);
            if (currentAbort?.controller === controller) currentAbort = null;
        }
    }
    
    function renderUpdates(container) {
        if (allUpdates.length === 0) {
            container.innerHTML = '<p class="text-secondary">Нет обновлений</p>';
            return;
        }
        
        const itemsToShow = allUpdates.slice(0, displayLimit);
        const hasMore = allUpdates.length > displayLimit;
        
        container.innerHTML = '';
        const grid = document.createElement('div');
        grid.className = 'projects-grid';
        itemsToShow.forEach(post => grid.appendChild(createUpdateCard(post)));
        container.appendChild(grid);
        
        let loadMoreBtn = container.querySelector('.load-more-btn');
        if (!loadMoreBtn && hasMore) {
            loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'load-more-btn';
            loadMoreBtn.textContent = 'Загрузить ещё';
            loadMoreBtn.setAttribute('aria-label', 'Загрузить следующие обновления');
            loadMoreBtn.addEventListener('click', () => {
                displayLimit += 6;
                renderUpdates(container);
            });
            container.appendChild(loadMoreBtn);
        } else if (loadMoreBtn && !hasMore) {
            loadMoreBtn.remove();
        }
    }
    
    function createUpdateCard(post) {
        const card = document.createElement('div'); card.className = 'project-card-link no-tilt'; card.style.cursor = 'pointer';
        card.setAttribute('aria-label', `Открыть обновление: ${post.title}`);
        const inner = document.createElement('div'); inner.className = 'project-card';
        const imgMatch = post.body.match(/!\[.*?\]\((.*?)\)/);
        const thumbnail = imgMatch ? imgMatch[1] : DEFAULT_IMAGE;
        const imgWrapper = document.createElement('div'); imgWrapper.className = 'image-wrapper';
        const img = document.createElement('img'); img.src = thumbnail; img.alt = post.title; img.loading = 'lazy'; img.className = 'project-image'; img.onerror = () => img.src = DEFAULT_IMAGE;
        imgWrapper.appendChild(img);
        const title = document.createElement('h3'); title.textContent = post.title.length > 70 ? post.title.substring(0,70)+'…' : post.title;
        const meta = document.createElement('p'); meta.className = 'text-secondary'; meta.style.fontSize='12px'; meta.innerHTML = `<i class="fas fa-user"></i> ${GithubCore.escapeHtml(post.author)} · <i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`;
        const summary = GithubCore.extractSummary(post.body) || GithubCore.stripHtml(post.body).substring(0,120)+'…';
        const preview = document.createElement('p'); preview.className = 'text-secondary'; preview.style.fontSize='13px'; preview.style.overflow='hidden'; preview.style.display='-webkit-box'; preview.style.webkitLineClamp='2'; preview.style.webkitBoxOrient='vertical'; preview.textContent = summary;
        inner.append(imgWrapper, title, meta, preview); card.appendChild(inner);
        card.addEventListener('click', (e) => { e.preventDefault(); if (window.UIFeedbackModal && window.UIFeedbackModal.openFullModal) window.UIFeedbackModal.openFullModal({ type: 'update', id: post.number, title: post.title, body: post.body, author: post.author, date: post.date, game: post.game, labels: post.labels }); });
        return card;
    }
})();