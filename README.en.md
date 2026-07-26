<!-- README.en.md -->
<div align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/🇷🇺%20Русский-2d2f48?style=for-the-badge&logoColor=white" alt="Русский"></a>
  <a href="README.en.md"><img src="https://img.shields.io/badge/🇬🇧%20English-2d2f48?style=for-the-badge&logoColor=white" alt="English"></a>
</div>

# 🌌 Neon Imperium · Game Portal

<div align="center">
   
[![GitHub last commit](https://img.shields.io/github/last-commit/NeonShadowYT/NeonImperium?style=for-the-badge&label=Updated&color=2d2f48)](https://github.com/NeonShadowYT/NeonImperium)
[![GitHub repo size](https://img.shields.io/github/repo-size/NeonShadowYT/NeonImperium?style=for-the-badge&label=Size&color=2d2f48)](https://github.com/NeonShadowYT/NeonImperium)
[![JavaScript](https://img.shields.io/badge/Vanilla-JS-2d2f48?style=for-the-badge&logo=javascript&logoColor=white)](https://github.com/NeonShadowYT/NeonImperium)
[![GitHub issues](https://img.shields.io/github/issues/NeonShadowYT/NeonImperium?style=for-the-badge&label=Posts&color=2d2f48)](https://github.com/NeonShadowYT/NeonImperium/issues)

</div>

<div align="center">
  <img src="https://raw.githubusercontent.com/NeonShadowYT/NeonImperium/main/images/banner-status.gif" alt="Neon Imperium Banner" width="100%">
</div>

**Neon Imperium** is a web portal for games: **Starve Neon**, **Alpha 01**, **GC Adven** and other projects.  
The site is fully integrated with the **GitHub API**, supports **offline mode**, and gives the community a complete set of tools for communication, feedback, and bookmark storage.

> [!IMPORTANT]
> **The project is under active development.** You can not only play, but also participate in the community — create posts, leave reactions, comment, and save content to your personal cloud storage.

## 📋 Table of Contents
<div align="center">
   
  <a href="#-key-features"><img src="https://img.shields.io/badge/🔥%20Key%20Features-2d2f48?style=for-the-badge" alt="Key Features"></a>
  <a href="#-tech-stack"><img src="https://img.shields.io/badge/🛠%20Tech%20Stack-2d2f48?style=for-the-badge" alt="Tech Stack"></a>
  <a href="#-project-structure"><img src="https://img.shields.io/badge/📁%20Project%20Structure-2d2f48?style=for-the-badge" alt="Project Structure"></a>
  
  <a href="#-github-integration"><img src="https://img.shields.io/badge/🔌%20GitHub%20Integration-2d2f48?style=for-the-badge" alt="GitHub Integration"></a>
  <a href="#-community-features"><img src="https://img.shields.io/badge/💬%20Community%20Features-2d2f48?style=for-the-badge" alt="Community Features"></a>
  <a href="#-offline--background-sync"><img src="https://img.shields.io/badge/📴%20Offline%20%26%20Sync-2d2f48?style=for-the-badge" alt="Offline & Sync"></a>
  
  <a href="#-contributing"><img src="https://img.shields.io/badge/🤝%20Contributing-2d2f48?style=for-the-badge" alt="Contributing"></a>
  <a href="#-license"><img src="https://img.shields.io/badge/📄%20License-2d2f48?style=for-the-badge" alt="License"></a>
  <a href="#-contacts"><img src="https://img.shields.io/badge/📸%20Community-2d2f48?style=for-the-badge" alt="Community"></a>
</div>

## 🔥 Key Features

### For Players
- **Home page** – cards of all projects with descriptions and a "Details" button.
- **Dedicated game pages** – trailers (YouTube playlists), descriptions, system requirements, community videos.
- **Download** – links to GameJolt, Itch.io, Yandex.Disk, Google Drive, and **GitHub Releases** (auto‑fetch versions for Windows/Android).
- **Language switching** – Russian and English, translations stored in JSON and loaded on the fly.
- **Responsive design** – looks great on both mobile and desktop.
- **3D effects** – card tilt and header parallax (desktop only).

### For the Community (requires a GitHub token)
- **GitHub login** – classic token with `repo` and `gist` scopes.
- **Feedback** – create ideas, bug reports, reviews directly via GitHub Issues.
- **Reactions** – ❤️, 👀 and more on posts and comments.
- **Comments** – edit, delete, Markdown support.
- **News & updates** – published via Issues with labels `type:news` and `type:update`.
- **Private posts** – visible only to specified users, body encrypted with XOR.
- **Polls** – embedded directly into the post body via special syntax.
- **Bookmark storage** – each user can save posts and videos to their private Gist.
- **Admin panel** – add/edit/close posts, buttons "Add news" and "Add update".

### Technical Highlights
- **Service Worker** – caches static assets, enables offline browsing.
- **Background Sync** – reactions and comments are queued and sent when the network is back.
- **Lazy loading videos** – YouTube players load only when visible.
- **GIF/WebM banners** – background animations in feature cards (loaded via Intersection Observer).
- **Live preview** – Markdown renders in real‑time when creating a post.
- **Custom tags** – spoilers, tables, progress bars, colored text, Font Awesome icons.

## 🛠 Tech Stack

| Category | Technologies |
|----------|--------------|
| Frontend | HTML5, CSS3 (Flexbox, Grid, CSS Variables), Vanilla JS (ES6+) |
| PWA | Service Worker, manifest.json, stale‑while‑revalidate strategy |
| API | GitHub REST API (Issues, Comments, Reactions, Gists, Releases, User) |
| Authentication | Personal Access Token (classic) with `repo` and `gist` scopes |
| Encryption | XOR with a key derived from `allowed` (light obfuscation) |
| Markdown | [`marked`](https://marked.js.org/) + custom extensions (spoilers, polls, progress) |
| Fonts & Icons | Google Fonts (`Russo One`), Font Awesome 6 (Free CDN) |
| Video | YouTube Embed API (lazy loading) |
| Animations | CSS `transform`, `transition`, `requestAnimationFrame` + throttle |
| Storage | `sessionStorage`, `localStorage`, `IndexedDB` (sync queue) |

## 📁 Project Structure

<details>
<summary><strong>📜 Expand structure</strong></summary>

```bash
NeonImperium/
├── index.html              # Home (catalog, news feed)
├── starve-neon.html        # Starve Neon page
├── alpha-01.html           # Alpha 01 page
├── gc-adven.html           # GC Adven page
├── license.html            # License agreement
├── 404.html                # Not found page
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker (cache, background sync)
├── style.css               # CSS entry point (imports modules)
├── css/                    # Modular styles
│   ├── variables.css       # CSS variables
│   ├── base.css            # Reset & base
│   ├── typography.css      # Fonts, headings
│   ├── buttons.css         # Buttons
│   ├── navigation.css      # Navbar, profile
│   ├── cards.css           # Cards
│   ├── layout.css          # Grids
│   ├── responsive.css      # Responsiveness
│   └── feedback.css        # Feedback & modal styles
├── images/                 # Static: logos, avatars, banners, WebM
├── locales/                # Translations
│   ├── ru.json             # Russian
│   └── en.json             # English
├── js/                     # All logic
│   ├── core/               # Core (GitHub, cache, encryption)
│   │   ├── github-core.js  # Shared utilities
│   │   ├── github-api.js   # REST API requests
│   │   └── github-auth.js  # Login & token management
│   ├── features/           # UI components
│   │   ├── ui-utils.js     # Toasts, modals, drafts
│   │   ├── ui-feedback.js  # Render posts, reactions, comments
│   │   ├── editor.js       # Markdown editor toolbar
│   │   ├── storage.js      # Bookmark storage on Gist
│   │   └── background-gifs.js # Lazy‑load GIF/WebM
│   ├── pages/              # Page‑specific scripts
│   │   ├── news-feed.js    # News feed (YouTube + posts)
│   │   ├── feedback.js     # Feedback
│   │   └── game-updates.js # Game updates
│   ├── lang.js             # Localization core
│   ├── effects.js          # 3D tilt & parallax
│   ├── platform.js         # GitHub Releases + platform selection
│   └── common-init.js      # Lazy YouTube, donate, SW
└── README.md               # This file
```
</details>

## 🔌 GitHub Integration

The site **does not need its own backend** – all data is stored in GitHub:

| What | Stored in |
|------|-----------|
| Games & updates | Issues with labels `type:update` + `game:...` |
| News | Issues with label `type:news` |
| Feedback | Issues with labels `type:idea`, `type:bug`, `type:review` + `game:...` |
| Comments | Comments on Issues |
| Reactions | GitHub reactions (`+1`, `heart`, etc.) |
| Private posts | Issue body encrypted with XOR, access via `allowed` |
| Bookmarks | User's personal Gist (private) |

### Required scopes

| Scope | Needed for |
|-------|------------|
| `repo` | Create/edit Issues, comments, reactions, close Issues, polls |
| `gist` | Bookmark storage (save posts and videos) |

### Administrators
Users from the `ALLOWED_AUTHORS` list in `github-core.js` (by default `NeonShadowYT`, `GoldenCreeper567`) get extra buttons:
- “Add news” in the feed
- “Add update” on the game page
- Ability to edit and close any Issue
- Access to all private posts

## 💬 Community Features

### Feedback
- Each game has its own section (filtered by label `game:...`).
- Users can create **ideas**, **bug reports**, and **reviews**.
- The creation form supports **Markdown** with a visual editor and live preview.
- Posts have **reactions** and **comments** (Markdown + editing support).

### Private posts
- When creating, you can choose “Private”.
- Specify a comma‑separated list of GitHub logins.
- The post body is encrypted (simple XOR, not cryptographically strong, but enough to hide from prying eyes).
- Decrypted only for the author, admins, and specified users.

### Polls
- Insert `<!-- poll: {"question":"...","options":["..."]} -->` into the Issue body.
- Renders as an interactive block.
- Users vote via comment `!vote <index>`.
- Results shown as percentages.

### Bookmark storage
- Requires authorization with `gist` scope.
- Allows saving posts and YouTube videos to your personal Gist.
- Bookmarks sync across devices (via Gist).
- Supports offline mode and background sync.
- In the modal window, you can sort, filter by type, delete, and edit titles.

### Markdown Editor
- Full toolbar: bold, italic, headings, lists, links, images, YouTube embeds, code, spoilers, tables, polls, progress bars, cards, icons, text/background color.
- “Hosting” button – quick access to Catbox, ImageBam, Postimages, ImgBB.
- Split into input and live preview tabs.
- Automatic draft saving in `sessionStorage`.

## 📴 Offline & Background Sync

- **Service Worker** caches all static assets (HTML, CSS, JS, images, fonts).
- Game pages and the home page are available even offline (stale‑while‑revalidate).
- On revisit, updated files are loaded from the network and replace the cache.
- **Background Sync**:
  - If a user leaves a reaction or comment while offline, the request is saved in IndexedDB.
  - When the connection is restored, sync is registered and all queued mutations are sent to GitHub.
  - The token is also saved in IndexedDB so the SW can make requests.

### Update notification
- When a new Service Worker (new version of the site) is detected, a floating “Update” button appears.
- The notification is shown only once per session (stored in `sessionStorage`).

## 🤝 Contributing

We welcome any contributions!

**How to help:**
- Report a bug or suggest an idea via [Issues](https://github.com/NeonShadowYT/NeonImperium/issues).
- Fork the repo, make changes, and submit a Pull Request.
- Improve translations (add a new language or fix existing ones).
- Help with performance optimization or accessibility.

**PR requirements:**
- Code must be vanilla JavaScript (no frameworks).
- Styles should be placed in the corresponding CSS modules (not in `style.css`).
- Maintain backward compatibility with modern browsers (Chrome, Firefox, Edge, Safari).
- Ensure the site works offline and with JavaScript disabled (basic navigation).

## 📄 License

**Source code** is distributed under the [MIT](LICENSE) license.  
**Game content** (texts, images, logos, executables) is the intellectual property of Neon Imperium.  
Detailed terms of use for the games are described on the [License Agreement](https://neonshadowyt.github.io/NeonImperium/license) page.

<div align="center">

[![Starve Neon](https://raw.githubusercontent.com/NeonShadowYT/NeonShadowYT/main/images/banner-development.gif)](https://neonshadowyt.github.io/NeonImperium/starve-neon)

### 📸 Join the Community
   
[![Neon Shadow](https://img.shields.io/badge/Neon%20Shadow-2d2f48?style=for-the-badge&logo=github&logoColor=white)](https://github.com/NeonShadowYT)
[![YouTube](https://img.shields.io/youtube/channel/subscribers/UC2pH2qNfh2sEAeYEGs1k_Lg?style=for-the-badge&logo=youtube&logoColor=white&label=YouTube&labelColor=FF0000&color=282c34)](https://www.youtube.com/@NeonShadow-neon)
[![Discord](https://img.shields.io/discord/1033727594467704842?style=for-the-badge&logo=discord&logoColor=white&label=Discord&labelColor=5865F2&color=282c34)](https://discord.com/invite/9gv5sRhk9R)
[![Telegram](https://telegram-badge.vercel.app/api/telegram-badge?channelId=@voididea&style=for-the-badge&logo=telegram&logoColor=white&label=Telegram&labelColor=26A5E4&color=282c34)](https://t.me/voididea)

⭐ **If you like the project, give it a star on GitHub – it helps me keep developing!**
   
[![GitHub stars](https://img.shields.io/github/stars/NeonShadowYT/HobbitStarverEdition?style=for-the-badge&logo=github&color=FFC107)](https://github.com/NeonShadowYT/HobbitStarverEdition/stargazers)
[![GitHub followers](https://img.shields.io/github/followers/NeonShadowYT?style=for-the-badge&logo=github&label=Follow&color=282c34)](https://github.com/NeonShadowYT)

</div>
