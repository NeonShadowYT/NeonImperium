// news.js — Автоматическая загрузка последних видео с нескольких YouTube каналов

document.addEventListener('DOMContentLoaded', function() {
    const newsFeed = document.getElementById('news-feed');
    if (!newsFeed) return;

    const channelIds = [
        'UC2pH2qNfh2sEAeYEGs1k_Lg', // Neon Shadow
        'UCxuByf9jKs6ijiJyrMKBzdA', // Оборотень
        'UCQKVSv62dLsK3QnfIke24uQ'  // Golden Creeper
    ];

    const rssUrls = channelIds.map(id => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
    const proxyUrl = 'https://api.allorigins.win/get?url=';

    async function fetchChannelFeed(url) {
        try {
            const response = await fetch(proxyUrl + encodeURIComponent(url));
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const parser = new DOMParser();
            const xml = parser.parseFromString(data.contents, 'text/xml');
            return Array.from(xml.querySelectorAll('entry'));
        } catch (error) {
            console.warn('Ошибка загрузки ленты:', url, error);
            return [];
        }
    }

    async function loadAllFeeds() {
        newsFeed.innerHTML = `<div class="loading-spinner" style="grid-column: 1/-1; text-align: center; padding: 40px;">
            <i class="fas fa-circle-notch fa-spin" style="font-size: 32px; color: var(--accent);"></i>
            <p style="margin-top: 10px;" data-lang="newsLoading">Загрузка новостей...</p>
        </div>`;

        const results = await Promise.all(rssUrls.map(url => fetchChannelFeed(url)));
        const allEntries = results.flat();

        if (allEntries.length === 0) {
            showError('Не удалось загрузить новости. Проверьте подключение к интернету.', true);
            return;
        }

        const videos = allEntries.map(entry => parseEntry(entry));
        videos.sort((a, b) => new Date(b.published) - new Date(a.published));
        const latestVideos = videos.slice(0, 8);

        newsFeed.innerHTML = '';
        latestVideos.forEach(video => {
            const card = createVideoCard(video);
            newsFeed.appendChild(card);
        });
    }

    function parseEntry(entry) {
        const getNS = (tag) => {
            const nsTag = entry.getElementsByTagNameNS('*', tag)[0];
            return nsTag ? nsTag.textContent : '';
        };
        const title = entry.querySelector('title')?.textContent || 'Без названия';
        const videoId = getNS('videoId') || entry.querySelector('videoId')?.textContent || '';
        const published = entry.querySelector('published')?.textContent || '';
        const author = entry.querySelector('author name')?.textContent || 'Неизвестный автор';
        const mediaGroup = entry.getElementsByTagNameNS('*', 'group')[0];
        const thumbnailUrl = mediaGroup?.getElementsByTagNameNS('*', 'thumbnail')[0]?.getAttribute('url') || '';

        return { title, videoId, published, author, thumbnailUrl };
    }

    function createVideoCard(video) {
        const { title, videoId, published, author, thumbnailUrl } = video;

        const publishDate = published ? new Date(published).toLocaleDateString('ru-RU', {
            year: 'numeric', month: 'long', day: 'numeric'
        }) : 'Дата неизвестна';

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

        const card = document.createElement('a');
        card.href = videoUrl;
        card.target = '_blank';
        card.className = 'project-card-link';
        card.style.textDecoration = 'none';

        const cardInner = document.createElement('div');
        cardInner.className = 'project-card tilt-card';

        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'image-wrapper';
        const img = document.createElement('img');
        img.src = thumbnailUrl;
        img.alt = title;
        img.loading = 'lazy';
        img.className = 'project-image';
        imgWrapper.appendChild(img);

        const titleEl = document.createElement('h3');
        titleEl.textContent = title.length > 70 ? title.substring(0, 70) + '…' : title;

        const metaEl = document.createElement('p');
        metaEl.className = 'text-secondary';
        metaEl.style.fontSize = '12px';
        metaEl.style.margin = '4px 0 8px';
        metaEl.innerHTML = `<i class="fas fa-user"></i> ${author} · <i class="fas fa-calendar-alt"></i> ${publishDate}`;

        const button = document.createElement('span');
        button.className = 'button';
        button.innerHTML = '<i class="fas fa-play"></i> Смотреть';

        cardInner.appendChild(imgWrapper);
        cardInner.appendChild(titleEl);
        cardInner.appendChild(metaEl);
        cardInner.appendChild(button);
        card.appendChild(cardInner);

        return card;
    }

    function showError(message, showRetry = false) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'card';
        errorDiv.style.gridColumn = '1/-1';
        errorDiv.style.textAlign = 'center';
        errorDiv.style.padding = '40px';
        errorDiv.innerHTML = `
            <i class="fas fa-exclamation-triangle" style="font-size: 32px; color: #f44336; margin-bottom: 15px;"></i>
            <p>${message}</p>
            ${showRetry ? '<button class="button" id="retry-news" style="margin-top: 15px;"><i class="fas fa-sync-alt"></i> Повторить</button>' : ''}
        `;
        newsFeed.innerHTML = '';
        newsFeed.appendChild(errorDiv);

        if (showRetry) {
            document.getElementById('retry-news')?.addEventListener('click', () => {
                loadAllFeeds();
            });
        }
    }

    loadAllFeeds();
});