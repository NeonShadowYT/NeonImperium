// news-feed.js — загрузка видео с YouTube и постов из Issues, смешивание по дате
// Теперь также предоставляет функции для принудительного обновления блоков

(function() {
    const ALLOWED_AUTHORS = ['NeonShadowYT'];
    const REPO_OWNER = 'NeonShadowYT';
    const REPO_NAME = 'NeonImperium';
    const CACHE_TTL = 10 * 60 * 1000; // 10 минут

    const YT_CHANNELS = [
        { id: 'UC2pH2qNfh2sEAeYEGs1k_Lg', name: 'Neon Shadow' },
        { id: 'UCxuByf9jKs6ijiJyrMKBzdA', name: 'Оборотень' },
        { id: 'UCQKVSv62dLsK3QnfIke24uQ', name: 'Golden Creeper' }
    ];

    const PROXY_URL = 'https://api.allorigins.win/get?url=';

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        const newsFeed = document.getElementById('news-feed');
        if (newsFeed) {
            loadNewsFeed(newsFeed);
        }

        const updatesContainer = document.getElementById('game-updates');
        if (updatesContainer && updatesContainer.dataset.game) {
            loadGameUpdates(updatesContainer, updatesContainer.dataset.game);
        }
    }

    // Публичные методы для обновления блоков извне (например, после создания поста)
    window.refreshNewsFeed = function() {
        const newsFeed = document.getElementById('news-feed');
        if (newsFeed) loadNewsFeed(newsFeed);
    };

    window.refreshGameUpdates = function(game) {
        const container = document.getElementById('game-updates');
        if (container && container.dataset.game === game) {
            loadGameUpdates(container, game);
        }
    };

    async function loadNewsFeed(container) {
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i><p>Загрузка...</p></div>`;

        const [videos, posts] = await Promise.all([
            loadYouTubeVideos(),
            loadPosts('news')
        ]);

        const mixed = [...videos, ...posts].sort((a, b) => b.date - a.date);
        const latest = mixed.slice(0, 6);

        if (latest.length === 0) {
            container.innerHTML = `<p class="text-secondary">Нет новостей.</p>`;
            return;
        }

        container.innerHTML = '';
        latest.forEach(item => {
            if (item.type === 'video') {
                container.appendChild(createVideoCard(item));
            } else {
                container.appendChild(createPostCard(item));
            }
        });
    }

    async function loadYouTubeVideos() {
        const cacheKey = 'youtube_videos';
        const cached = sessionStorage.getItem(cacheKey);
        const cachedTime = sessionStorage.getItem(`${cacheKey}_time`);

        if (cached && cachedTime && (Date.now() - parseInt(cachedTime) < CACHE_TTL)) {
            return JSON.parse(cached).map(v => ({ ...v, date: new Date(v.date) }));
        }

        const promises = YT_CHANNELS.map(channel => fetchChannelFeed(channel));
        const results = await Promise.allSettled(promises);
        const videos = results
            .filter(r => r.status === 'fulfilled')
            .flatMap(r => r.value)
            .sort((a, b) => b.published - a.published)
            .slice(0, 10);

        const serialized = videos.map(v => ({
            ...v,
            date: v.published.toISOString()
        }));

        sessionStorage.setItem(cacheKey, JSON.stringify(serialized));
        sessionStorage.setItem(`${cacheKey}_time`, Date.now().toString());

        return videos;
    }

    async function fetchChannelFeed(channel) {
        try {
            const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;
            const response = await fetch(PROXY_URL + encodeURIComponent(url));
            if (!response.ok) throw new Error('Network error');
            const data = await response.json();
            const parser = new DOMParser();
            const xml = parser.parseFromString(data.contents, 'text/xml');
            const entries = Array.from(xml.querySelectorAll('entry'));
            return entries.map(entry => {
                const title = entry.querySelector('title')?.textContent || 'Без названия';
                const videoId = entry.getElementsByTagNameNS('*', 'videoId')[0]?.textContent || '';
                const published = new Date(entry.querySelector('published')?.textContent || Date.now());
                const author = entry.querySelector('author name')?.textContent || channel.name;
                const mediaGroup = entry.getElementsByTagNameNS('*', 'group')[0];
                const thumbnail = mediaGroup?.getElementsByTagNameNS('*', 'thumbnail')[0]?.getAttribute('url') || '';
                return {
                    type: 'video',
                    id: videoId,
                    title,
                    author,
                    date: published,
                    thumbnail,
                    channel: channel.name
                };
            });
        } catch (err) {
            console.warn('Ошибка загрузки канала', channel.id, err);
            return [];
        }
    }

    async function loadPosts(label, game = null) {
        const token = localStorage.getItem('github_token');
        let labels = label;
        if (game) labels += `,game:${game}`;

        const cacheKey = `posts_${label}${game ? '_' + game : ''}`;
        const cached = sessionStorage.getItem(cacheKey);
        const cachedTime = sessionStorage.getItem(`${cacheKey}_time`);

        if (cached && cachedTime && (Date.now() - parseInt(cachedTime) < CACHE_TTL)) {
            return JSON.parse(cached).map(p => ({ ...p, date: new Date(p.date) }));
        }

        try {
            const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues?labels=${encodeURIComponent(labels)}&state=open&sort=created&direction=desc&per_page=20`;
            const response = await fetch(url, token ? { headers: { 'Authorization': `Bearer ${token}` } } : {});
            if (!response.ok) throw new Error('Ошибка загрузки');
            const issues = await response.json();

            const posts = issues
                .map(issue => ({
                    type: 'post',
                    id: issue.number,
                    title: issue.title,
                    body: issue.body,
                    author: issue.user.login,
                    date: new Date(issue.created_at),
                    labels: issue.labels.map(l => l.name)
                }))
                .filter(post => ALLOWED_AUTHORS.includes(post.author));

            const serialized = posts.map(p => ({ ...p, date: p.date.toISOString() }));
            sessionStorage.setItem(cacheKey, JSON.stringify(serialized));
            sessionStorage.setItem(`${cacheKey}_time`, Date.now().toString());
            return posts;
        } catch (err) {
            console.error('Ошибка загрузки постов:', err);
            return [];
        }
    }

    async function loadGameUpdates(container, game) {
        container.innerHTML = `<div class="loading-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>`;
        const posts = await loadPosts('update', game);
        if (posts.length === 0) {
            container.innerHTML = `<p class="text-secondary">Нет обновлений.</p>`;
            return;
        }
        container.innerHTML = '';
        posts.forEach(post => {
            container.appendChild(createUpdateCard(post));
        });
    }

    function createVideoCard(video) {
        const card = document.createElement('a');
        card.href = `https://www.youtube.com/watch?v=${video.id}`;
        card.target = '_blank';
        card.className = 'project-card-link';

        const inner = document.createElement('div');
        inner.className = 'project-card tilt-card';

        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'image-wrapper';
        const img = document.createElement('img');
        img.src = video.thumbnail;
        img.alt = video.title;
        img.loading = 'lazy';
        img.className = 'project-image';
        imgWrapper.appendChild(img);

        const title = document.createElement('h3');
        title.textContent = video.title.length > 70 ? video.title.substring(0, 70) + '…' : video.title;

        const meta = document.createElement('p');
        meta.className = 'text-secondary';
        meta.style.fontSize = '12px';
        meta.innerHTML = `<i class="fas fa-user"></i> ${video.author} · <i class="fas fa-calendar-alt"></i> ${video.date.toLocaleDateString()}`;

        const button = document.createElement('span');
        button.className = 'button';
        button.innerHTML = '<i class="fas fa-play"></i> Смотреть';

        inner.appendChild(imgWrapper);
        inner.appendChild(title);
        inner.appendChild(meta);
        inner.appendChild(button);
        card.appendChild(inner);
        return card;
    }

    function createPostCard(post) {
        const card = document.createElement('a');
        card.href = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/${post.id}`;
        card.target = '_blank';
        card.className = 'project-card-link';

        const inner = document.createElement('div');
        inner.className = 'project-card tilt-card';

        const title = document.createElement('h3');
        title.textContent = post.title;

        const meta = document.createElement('p');
        meta.className = 'text-secondary';
        meta.style.fontSize = '12px';
        meta.innerHTML = `<i class="fas fa-calendar-alt"></i> ${post.date.toLocaleDateString()}`;

        const preview = document.createElement('p');
        preview.className = 'text-secondary';
        preview.style.fontSize = '13px';
        preview.style.overflow = 'hidden';
        preview.style.display = '-webkit-box';
        preview.style.webkitLineClamp = '3';
        preview.style.webkitBoxOrient = 'vertical';
        preview.textContent = stripHtml(post.body).substring(0, 150) + (post.body.length > 150 ? '…' : '');

        const button = document.createElement('span');
        button.className = 'button';
        button.innerHTML = '<i class="fas fa-newspaper"></i> Читать';

        inner.appendChild(title);
        inner.appendChild(meta);
        inner.appendChild(preview);
        inner.appendChild(button);
        card.appendChild(inner);
        return card;
    }

    function createUpdateCard(post) {
        const card = document.createElement('div');
        card.className = 'update-card';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '10px';

        const title = document.createElement('h3');
        title.style.margin = '0';
        title.textContent = post.title;

        const date = document.createElement('span');
        date.className = 'text-secondary';
        date.style.fontSize = '12px';
        date.textContent = post.date.toLocaleDateString();

        header.appendChild(title);
        header.appendChild(date);

        const body = document.createElement('div');
        body.className = 'spoiler-content';
        // Если есть библиотека marked, используем её
        if (window.marked) {
            body.innerHTML = marked.parse(post.body);
        } else {
            // Простая обработка ссылок и переносов
            body.innerHTML = post.body.replace(/\n/g, '<br>');
        }

        card.appendChild(header);
        card.appendChild(body);
        return card;
    }

    function stripHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }
})();