// news.js — Автоматическая загрузка последних видео с YouTube канала

document.addEventListener('DOMContentLoaded', function() {
    const newsFeed = document.getElementById('news-feed');
    // ID канала Neon Shadow
    const channelId = 'UC2pH2qNfh2sEAeYEGs1k_Lg';
    // RSS ссылка на видео канала (не требует API ключа!)
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

    // Используем прокси, чтобы обойти CORS-ограничения браузера.
    // Это бесплатный публичный сервис для разработки.
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(rssUrl)}`;

    fetch(proxyUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Ошибка сети: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            // Парсим XML из ответа прокси
            const parser = new DOMParser();
            const xml = parser.parseFromString(data.contents, 'text/xml');

            // Находим все элементы <entry> (это и есть видео)
            const entries = xml.querySelectorAll('entry');
            if (!entries.length) {
                showError('Нет видео для отображения.');
                return;
            }

            // Очищаем контейнер и строим новости
            newsFeed.innerHTML = '';
            entries.forEach((entry, index) => {
                // Показываем только последние 6 видео, чтобы не загромождать страницу
                if (index < 6) {
                    const videoCard = createVideoCard(entry);
                    newsFeed.appendChild(videoCard);
                }
            });
        })
        .catch(error => {
            console.error('Ошибка загрузки новостей:', error);
            showError('Не удалось загрузить новости. Пожалуйста, попробуйте позже.');
        });

    // Функция для создания одной карточки видео из XML-элемента <entry>
    function createVideoCard(entry) {
        const title = entry.querySelector('title')?.textContent || 'Без названия';
        const videoId = entry.querySelector('yt\\:videoId, videoId')?.textContent || '';
        const published = entry.querySelector('published')?.textContent;
        const author = entry.querySelector('author name')?.textContent || 'Neon Shadow';
        // Правильный неймспейс для media:group может отличаться, поэтому используем универсальный поиск
        const mediaGroup = entry.getElementsByTagNameNS('*', 'group')[0];
        const thumbnailUrl = mediaGroup?.getElementsByTagNameNS('*', 'thumbnail')[0]?.getAttribute('url') || '';

        // Форматируем дату для читабельности
        const publishDate = published ? new Date(published).toLocaleDateString('ru-RU', {
            year: 'numeric', month: 'long', day: 'numeric'
        }) : 'Дата неизвестна';

        // Ссылка на видео
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

        // Создаем DOM-элементы
        const card = document.createElement('a');
        card.href = videoUrl;
        card.target = '_blank';
        card.className = 'project-card-link'; // Используем существующий стиль для карточек-ссылок
        card.style.textDecoration = 'none';

        const cardInner = document.createElement('div');
        cardInner.className = 'project-card tilt-card'; // Добавляем tilt-card для красивого эффекта

        // Изображение (обложка видео)
        const imgWrapper = document.createElement('div');
        imgWrapper.className = 'image-wrapper';
        const img = document.createElement('img');
        img.src = thumbnailUrl;
        img.alt = title;
        img.loading = 'lazy'; // Ленивая загрузка для производительности
        img.className = 'project-image';
        imgWrapper.appendChild(img);

        // Заголовок
        const titleEl = document.createElement('h3');
        titleEl.textContent = title.length > 70 ? title.substring(0, 70) + '…' : title;

        // Мета-информация: автор и дата
        const metaEl = document.createElement('p');
        metaEl.className = 'text-secondary';
        metaEl.style.fontSize = '12px';
        metaEl.style.margin = '4px 0 8px';
        metaEl.innerHTML = `<i class="fas fa-user"></i> ${author} · <i class="fas fa-calendar-alt"></i> ${publishDate}`;

        // Кнопка "Смотреть"
        const button = document.createElement('span');
        button.className = 'button';
        button.innerHTML = '<i class="fas fa-play"></i> Смотреть';

        // Собираем карточку
        cardInner.appendChild(imgWrapper);
        cardInner.appendChild(titleEl);
        cardInner.appendChild(metaEl);
        cardInner.appendChild(button);
        card.appendChild(cardInner);

        return card;
    }

    // Функция для отображения ошибки, если загрузка не удалась
    function showError(message) {
        newsFeed.innerHTML = `<div class="card" style="grid-column: 1/-1; text-align: center; padding: 40px;">
            <i class="fas fa-exclamation-triangle" style="font-size: 32px; color: #f44336; margin-bottom: 15px;"></i>
            <p>${message}</p>
        </div>`;
    }
});