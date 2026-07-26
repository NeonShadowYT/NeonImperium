<!-- README.md -->
<div align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/🇷🇺%20Русский-2d2f48?style=for-the-badge&logoColor=white" alt="Русский"></a>
  <a href="README.en.md"><img src="https://img.shields.io/badge/🇬🇧%20English-2d2f48?style=for-the-badge&logoColor=white" alt="English"></a>
</div>

# 🌌 Neon Imperium · Портал игр

<div align="center">
   
[![GitHub last commit](https://img.shields.io/github/last-commit/NeonShadowYT/NeonImperium?style=for-the-badge&label=Обновлён&color=2d2f48)](https://github.com/NeonShadowYT/NeonImperium)
[![GitHub repo size](https://img.shields.io/github/repo-size/NeonShadowYT/NeonImperium?style=for-the-badge&label=Размер&color=2d2f48)](https://github.com/NeonShadowYT/NeonImperium)
[![JavaScript](https://img.shields.io/badge/Vanilla-JS-2d2f48?style=for-the-badge&logo=javascript&logoColor=white)](https://github.com/NeonShadowYT/NeonImperium)
[![GitHub issues](https://img.shields.io/github/issues/NeonShadowYT/NeonImperium?style=for-the-badge&label=Posts&color=2d2f48)](https://github.com/NeonShadowYT/NeonImperium/issues)

</div>

<div align="center">
  <img src="https://raw.githubusercontent.com/NeonShadowYT/NeonImperium/main/images/banner-status.gif" alt="Neon Imperium Banner" width="100%">
</div>

**Neon Imperium** - это веб-портал для игр: **Starve Neon**, **Alpha 01**, **ГК Адвенчур** и других проектов.  
Сайт полностью интегрирован с **GitHub API**, поддерживает **офлайн-режим** и даёт сообществу полный набор инструментов для общения, фидбека и хранения закладок.

> [!IMPORTANT]
> **Проект в активной разработке.** Ты можешь не только играть, но и участвовать в жизни комьюнити - создавать посты, оставлять реакции, комментировать и сохранять контент в личное облачное хранилище.

## 📋 Содержание
<div align="center">
   
  <a href="#-ключевые-возможности"><img src="https://img.shields.io/badge/🔥%20Ключевые%20возможности-2d2f48?style=for-the-badge" alt="Ключевые возможности"></a>
  <a href="#-технологический-стек"><img src="https://img.shields.io/badge/🛠%20Технологический%20стек-2d2f48?style=for-the-badge" alt="Технологический стек"></a>
  <a href="#-структура-проекта"><img src="https://img.shields.io/badge/📁%20Структура%20проекта-2d2f48?style=for-the-badge" alt="Структура проекта"></a>
  
  <a href="#-интеграция-с-github"><img src="https://img.shields.io/badge/🔌%20Интеграция%20с%20GitHub-2d2f48?style=for-the-badge" alt="Интеграция с GitHub"></a>
  <a href="#-возможности-сообщества"><img src="https://img.shields.io/badge/💬%20Возможности%20сообщества-2d2f48?style=for-the-badge" alt="Возможности сообщества"></a>
  <a href="#-офлайн-и-фоновая-синхронизация"><img src="https://img.shields.io/badge/📴%20Офлайн%20и%20синхронизация-2d2f48?style=for-the-badge" alt="Офлайн и синхронизация"></a>
  
  <a href="#-участие-в-разработке"><img src="https://img.shields.io/badge/🤝%20Участие%20в%20разработке-2d2f48?style=for-the-badge" alt="Участие в разработке"></a>
  <a href="#-лицензия"><img src="https://img.shields.io/badge/📄%20Лицензия-2d2f48?style=for-the-badge" alt="Лицензия"></a>
  <a href="#-контакты"><img src="https://img.shields.io/badge/📫%20Контакты-2d2f48?style=for-the-badge" alt="Контакты"></a>
</div>

## 🔥 Ключевые возможности

### Для игроков
- **Главная страница** - карточки всех проектов с описанием и кнопкой «Подробнее».
- **Отдельные страницы игр** - трейлеры (YouTube-плейлисты), описание, системные требования, видео от сообщества.
- **Скачивание** - ссылки на GameJolt, Itch.io, Яндекс.Диск, Google Drive и **GitHub Releases** (автоматическая подгрузка версий для Windows/Android).
- **Переключение языков** - русский и английский, переводы хранятся в JSON и подгружаются на лету.
- **Адаптивный дизайн** - всё красиво и на телефоне, и на десктопе.
- **3D-эффекты** - наклон карточек (tilt) и параллакс для шапок (только на десктопе).

### Для сообщества (требуется GitHub-токен)
- **Вход через GitHub** - классический токен с правами `repo` и `gist`.
- **Обратная связь** - создание идей, багрепортов, отзывов прямо через GitHub Issues.
- **Реакции** - ❤️, 👀 и другие на постах и комментариях.
- **Комментарии** - редактирование, удаление, поддержка Markdown.
- **Новости и обновления** - публикуются через Issues с лейблами `type:news` и `type:update`.
- **Приватные посты** - видны только указанным пользователям, тело шифруется XOR.
- **Опросы** - встраиваются прямо в тело поста через специальный синтаксис.
- **Хранилище закладок** - каждый пользователь может сохранять посты и видео в свой приватный Gist.
- **Админ-панель** - добавление/редактирование/закрытие постов, кнопки «Добавить новость» и «Добавить обновление».

### Технические фишки
- **Service Worker** - кеширует статику, открывает страницы офлайн.
- **Background Sync** - реакции и комментарии уходят в очередь и отправляются при восстановлении сети.
- **Ленивая загрузка видео** - YouTube-плееры подгружаются только когда видны.
- **GIF/WebM-баннеры** - фоновые анимации в карточках (загружаются через Intersection Observer).
- **Живой предпросмотр** - при создании поста Markdown рендерится в реальном времени.
- **Кастомные теги** - спойлеры, таблицы, прогресс-бары, цветной текст, иконки Font Awesome.

## 🛠 Технологический стек

| Категория | Используемые технологии |
|-----------|--------------------------|
| Frontend | HTML5, CSS3 (Flexbox, Grid, CSS Variables), Vanilla JS (ES6+) |
| PWA | Service Worker, manifest.json, стратегия stale-while-revalidate |
| API | GitHub REST API (Issues, Comments, Reactions, Gists, Releases, User) |
| Аутентификация | Personal Access Token (classic) с правами `repo` и `gist` |
| Шифрование | XOR с производным от `allowed` ключом (лёгкая обфускация) |
| Markdown | [`marked`](https://marked.js.org/) + кастомные расширения (спойлеры, опросы, прогресс) |
| Шрифты и иконки | Google Fonts (`Russo One`), Font Awesome 6 (Free CDN) |
| Видео | YouTube Embed API (ленивая загрузка) |
| Анимации | CSS `transform`, `transition`, `requestAnimationFrame` + throttle |
| Хранилище | `sessionStorage`, `localStorage`, `IndexedDB` (очередь синхронизации) |

## 📁 Структура проекта 
<details>
   <summary><strong>📜 Развернуть структуру</strong></summary>
   
```bash
NeonImperium/
├── index.html              # Главная (каталог, новостная лента)
├── starve-neon.html        # Страница Starve Neon
├── alpha-01.html           # Страница Alpha 01
├── gc-adven.html           # Страница ГК Адвенчур
├── license.html            # Лицензионное соглашение
├── 404.html                # Страница не найдена
├── manifest.json           # PWA манифест
├── sw.js                   # Service Worker (кеш, фоновая синхронизация)
├── style.css               # Точка входа для CSS (импортирует модули)
├── css/                    # Все стили по модулям
│   ├── variables.css       # CSS-переменные
│   ├── base.css            # Сброс и база
│   ├── typography.css      # Шрифты, заголовки
│   ├── buttons.css         # Кнопки
│   ├── navigation.css      # Навбар, профиль
│   ├── cards.css           # Карточки
│   ├── layout.css          # Сетки
│   ├── responsive.css      # Адаптивность
│   └── feedback.css        # Стили обратной связи и модалок
├── images/                 # Статика: логотипы, аватарки, баннеры, WebM
├── locales/                # Переводы
│   ├── ru.json             # Русский
│   └── en.json             # Английский
├── js/                     # Вся логика
│   ├── core/               # Ядро (работа с GitHub, кеш, шифрование)
│   │   ├── github-core.js  # Общие утилиты
│   │   ├── github-api.js   # Запросы к REST API
│   │   └── github-auth.js  # Вход и управление токеном
│   ├── features/           # UI-компоненты
│   │   ├── ui-utils.js     # Тосты, модалки, черновики
│   │   ├── ui-feedback.js  # Рендер постов, реакций, комментариев
│   │   ├── editor.js       # Тулбар редактора Markdown
│   │   ├── storage.js      # Хранилище закладок на Gist
│   │   └── background-gifs.js # Ленивая загрузка GIF/WebM
│   ├── pages/              # Скрипты для конкретных страниц
│   │   ├── news-feed.js    # Лента новостей (YouTube + посты)
│   │   ├── feedback.js     # Обратная связь
│   │   └── game-updates.js # Обновления игр
│   ├── lang.js             # Ядро локализации
│   ├── effects.js          # 3D tilt и параллакс
│   ├── platform.js         # GitHub Releases + выбор платформы
│   └── common-init.js      # Ленивые YouTube, донат, SW
└── README.md               # Этот файл
```

</details>

## 🔌 Интеграция с GitHub

Сайт **не требует своего бэкенда** – все данные хранятся в GitHub:

| Что               | Где хранится                                    |
|-------------------|-------------------------------------------------|
| Игры и обновления | Issues с лейблами `type:update` + `game:...`   |
| Новости           | Issues с лейблом `type:news`                   |
| Обратная связь    | Issues с лейблами `type:idea`, `type:bug`, `type:review` + `game:...` |
| Комментарии       | Комментарии к Issue                             |
| Реакции           | Реакции GitHub (`+1`, `heart` и т.д.)          |
| Приватные посты   | Тело Issue шифруется XOR, доступ по `allowed`  |
| Закладки          | Персональный Gist пользователя (private)       |

### Требуемые scopes

| Scope | Необходимо для |
|-------|----------------|
| `repo` | Создание/редактирование Issue, комментариев, реакций, закрытие Issue, опросы |
| `gist` | Хранилище закладок (сохранение постов и видео) |

### Администраторы
Пользователи из списка `ALLOWED_AUTHORS` в `github-core.js` (по умолчанию `NeonShadowYT`, `GoldenCreeper567`) получают дополнительные кнопки:
- «Добавить новость» в ленте
- «Добавить обновление» на странице игры
- Возможность редактировать и закрывать любые Issue
- Доступ ко всем приватным постам

## 💬 Возможности сообщества

### Обратная связь
- Каждая игра имеет свой раздел (фильтр по лейблу `game:...`)
- Пользователи могут создавать **идеи**, **багрепорты** и **отзывы**
- Форма создания поддерживает **Markdown** с визуальным редактором и живым превью
- У постов есть **реакции** и **комментарии** (с поддержкой Markdown и редактированием)

### Приватные посты
- При создании можно выбрать «Приватный»
- Указать список логинов GitHub через запятую
- Тело поста шифруется (простой XOR, не криптостойкий, но достаточный для сокрытия от посторонних глаз)
- Расшифровывается только для автора, админов и указанных пользователей

### Опросы (polls)
- В теле Issue вставляется `<!-- poll: {"question":"...","options":["..."]} -->`
- При рендере создаётся интерактивный блок
- Пользователи голосуют через комментарий `!vote <индекс>`
- Результаты отображаются в процентах

### Хранилище закладок
- Требует авторизации с scope `gist`
- Позволяет сохранять посты и YouTube‑видео в личный Gist
- Закладки синхронизируются между устройствами (через Gist)
- Поддерживает офлайн‑режим и фоновую синхронизацию
- В модальном окне можно сортировать, фильтровать по типу, удалять, редактировать название

### Редактор Markdown
- Полноценная тулбар: жирный, курсив, заголовки, списки, ссылки, изображения, YouTube‑вставка, код, спойлеры, таблицы, опросы, прогресс‑бары, карточки, иконки, цвет текста/фона
- Кнопка «Хостинги» – быстрый доступ к Catbox, ImageBam, Postimages, ImgBB
- Разделение на вкладку ввода и живой предпросмотр
- Автоматическое сохранение черновиков в `sessionStorage`

## 📴 Офлайн и фоновая синхронизация

- **Service Worker** кеширует все статические ресурсы (HTML, CSS, JS, изображения, шрифты)
- Страницы игр и главная доступны даже без интернета (stale‑while‑revalidate)
- При повторном посещении обновлённые файлы загружаются из сети и заменяют кеш
- **Background Sync**:
  - Если пользователь оставил реакцию или комментарий при потере сети, запрос сохраняется в IndexedDB
  - При восстановлении соединения регистрируется синхронизация, и все накопленные мутации отправляются на GitHub
  - Токен также сохраняется в IndexedDB, чтобы SW мог выполнять запросы

### Уведомление об обновлении
- При обнаружении нового Service Worker (новая версия сайта) появляется плавающая кнопка «Обновить»
- Уведомление показывается только один раз за сессию (хранится в `sessionStorage`)

## 🤝 Участие в разработке

Мы приветствуем любые вклады!

**Как помочь:**
- Сообщить об ошибке или предложить идею через [Issues](https://github.com/NeonShadowYT/NeonImperium/issues)
- Сделать форк, внести изменения и отправить Pull Request
- Улучшить переводы (добавить новый язык или поправить существующие)
- Помочь с оптимизацией производительности или доступности

**Требования к PR:**
- Код должен быть ванильным JavaScript (без фреймворков)
- Стили пишутся в соответствующих CSS‑модулях (не в `style.css`)
- Сохранять обратную совместимость с современными браузерами (Chrome, Firefox, Edge, Safari)
- Проверить, что сайт работает в офлайн‑режиме и с отключённым JavaScript (базовая навигация)

## 📄 Лицензия

**Исходный код сайта** распространяется под лицензией [MIT](LICENSE).  
**Контент игр** (тексты, изображения, логотипы, исполняемые файлы) является интеллектуальной собственностью Neon Imperium.  
Подробные условия использования самих игр описаны на странице [Лицензионное соглашение](https://neonshadowyt.github.io/NeonImperium/license).

## 📫 Контакты

<div align="center"> 
   
[![Neon Shadow](https://img.shields.io/badge/Neon%20Shadow-2d2f48?style=for-the-badge&logo=github&logoColor=white)](https://github.com/NeonShadowYT)
[![YouTube](https://img.shields.io/youtube/channel/subscribers/UC2pH2qNfh2sEAeYEGs1k_Lg?style=for-the-badge&logo=youtube&logoColor=white&label=YouTube&labelColor=FF0000&color=282c34)](https://www.youtube.com/@NeonShadow-neon)
[![Discord](https://img.shields.io/discord/1033727594467704842?style=for-the-badge&logo=discord&logoColor=white&label=Discord&labelColor=5865F2&color=282c34)](https://discord.com/invite/9gv5sRhk9R)
[![Telegram](https://telegram-badge.vercel.app/api/telegram-badge?channelId=@voididea&style=for-the-badge&logo=telegram&logoColor=white&label=Telegram&labelColor=26A5E4&color=282c34)](https://t.me/voididea)
   
</div>

⭐ **Если тебе нравится проект, поставьте звезду на GitHub - это помогает продолжать разработку!**

<div align="center"> 
   
[![GitHub stars](https://img.shields.io/github/stars/NeonShadowYT/HobbitStarverEdition?style=for-the-badge&logo=github&color=FFC107)](https://github.com/NeonShadowYT/HobbitStarverEdition/stargazers)
[![GitHub followers](https://img.shields.io/github/followers/NeonShadowYT?style=for-the-badge&logo=github&label=Follow&color=282c34)](https://github.com/NeonShadowYT)

</div>
