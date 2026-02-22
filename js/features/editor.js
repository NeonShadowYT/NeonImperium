// editor.js — унифицированный Markdown-редактор для форм

(function() {
    // Вставка текста в текстовое поле в позиции курсора
    function insertAtCursor(textarea, text) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;
        textarea.value = value.substring(0, start) + text + value.substring(end);
        textarea.focus();
        textarea.setSelectionRange(start + text.length, start + text.length);
    }

    // Основная функция вставки с тегами
    function insertMarkdown(textarea, tag, placeholder, wrap = false, isLink = false) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.substring(start, end);

        let insertion;
        if (isLink) {
            const url = prompt('Введите URL:', 'https://');
            if (!url) return;
            const text = prompt('Введите текст ссылки:', selected || 'ссылка');
            insertion = `[${text}](${url})`;
        } else if (tag === '![](') {
            const url = prompt('Введите URL изображения:', 'https://');
            if (!url) return;
            const alt = prompt('Введите описание изображения (alt):', 'image');
            insertion = `![${alt}](${url})`;
        } else if (wrap) {
            if (selected) {
                insertion = tag + selected + tag;
            } else {
                insertion = tag + placeholder + tag;
            }
        } else {
            if (selected) {
                insertion = tag + selected;
            } else {
                insertion = tag + placeholder;
            }
        }
        insertAtCursor(textarea, insertion);
    }

    function insertSpoiler(textarea) {
        const summary = prompt('Заголовок спойлера:', 'Спойлер');
        if (summary === null) return;
        const content = prompt('Содержимое спойлера (можно оставить пустым):', '');
        const spoiler = `\n<details><summary>${summary}</summary>\n\n${content || '...'}\n\n</details>\n`;
        insertAtCursor(textarea, spoiler);
    }

    function insertAlert(textarea, type) {
        const text = prompt(`Текст для блока ${type}:`, '');
        if (text === null) return;
        const alertBlock = `\n> [!${type}]\n> ${text}\n`;
        insertAtCursor(textarea, alertBlock);
    }

    function insertTable(textarea) {
        const table = `
| Заголовок 1 | Заголовок 2 |
|-------------|-------------|
| Ячейка 1    | Ячейка 2    |
| Ячейка 3    | Ячейка 4    |
`;
        insertAtCursor(textarea, table);
    }

    function insertCodeBlock(textarea) {
        const lang = prompt('Язык (например, javascript, python, или оставьте пустым):', '');
        const code = prompt('Введите код:', '');
        if (code === null) return;
        const block = `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
        insertAtCursor(textarea, block);
    }

    function insertProgressBar(textarea) {
        const percent = prompt('Введите процент заполнения (0-100):', '50');
        if (percent === null) return;
        const bar = `\n<div class="progress-bar"><div style="width: ${percent}%;">${percent}%</div></div>\n`;
        insertAtCursor(textarea, bar);
    }

    function insertCard(textarea) {
        const title = prompt('Заголовок карточки:', 'Карточка');
        if (title === null) return;
        const content = prompt('Содержимое карточки:', '');
        const card = `\n<div class="custom-card"><h4>${title}</h4><p>${content || ''}</p></div>\n`;
        insertAtCursor(textarea, card);
    }

    function insertYouTube(textarea) {
        const url = prompt('Введите ссылку на YouTube видео:', 'https://youtu.be/...');
        if (url === null) return;
        insertAtCursor(textarea, url);
    }

    // Создаёт панель инструментов и привязывает обработчики
    function createEditorToolbar(textarea, options = {}) {
        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';
        toolbar.style.display = 'flex';
        toolbar.style.gap = '5px';
        toolbar.style.marginBottom = '10px';
        toolbar.style.flexWrap = 'wrap';

        // Группа базового форматирования
        const baseGroup = document.createElement('div');
        baseGroup.className = 'editor-btn-group';
        baseGroup.innerHTML = `
            <button type="button" class="editor-btn" data-tag="**" title="Жирный"><i class="fas fa-bold"></i></button>
            <button type="button" class="editor-btn" data-tag="*" title="Курсив"><i class="fas fa-italic"></i></button>
            <button type="button" class="editor-btn" data-tag="~~" title="Зачёркнутый" data-wrap="true"><i class="fas fa-strikethrough"></i></button>
        `;
        toolbar.appendChild(baseGroup);

        // Группа заголовков
        const headingGroup = document.createElement('div');
        headingGroup.className = 'editor-btn-group';
        headingGroup.innerHTML = `
            <button type="button" class="editor-btn" data-tag="# " title="Заголовок 1"><i class="fas fa-h1"></i></button>
            <button type="button" class="editor-btn" data-tag="## " title="Заголовок 2"><i class="fas fa-h2"></i></button>
            <button type="button" class="editor-btn" data-tag="### " title="Заголовок 3"><i class="fas fa-h3"></i></button>
        `;
        toolbar.appendChild(headingGroup);

        // Группа списков и цитат
        const listGroup = document.createElement('div');
        listGroup.className = 'editor-btn-group';
        listGroup.innerHTML = `
            <button type="button" class="editor-btn" data-tag="- " title="Маркированный список"><i class="fas fa-list-ul"></i></button>
            <button type="button" class="editor-btn" data-tag="1. " title="Нумерованный список"><i class="fas fa-list-ol"></i></button>
            <button type="button" class="editor-btn" data-tag="> " title="Цитата"><i class="fas fa-quote-right"></i></button>
        `;
        toolbar.appendChild(listGroup);

        // Группа ссылок и медиа
        const mediaGroup = document.createElement('div');
        mediaGroup.className = 'editor-btn-group';
        mediaGroup.innerHTML = `
            <button type="button" class="editor-btn" data-link="true" title="Ссылка"><i class="fas fa-link"></i></button>
            <button type="button" class="editor-btn" data-tag="![](" title="Изображение"><i class="fas fa-image"></i></button>
            <button type="button" class="editor-btn" data-youtube="true" title="YouTube"><i class="fab fa-youtube"></i></button>
        `;
        toolbar.appendChild(mediaGroup);

        // Группа кода
        const codeGroup = document.createElement('div');
        codeGroup.className = 'editor-btn-group';
        codeGroup.innerHTML = `
            <button type="button" class="editor-btn" data-tag="\`" data-wrap="true" title="Код"><i class="fas fa-code"></i></button>
            <button type="button" class="editor-btn" data-codeblock="true" title="Блок кода"><i class="fas fa-file-code"></i></button>
        `;
        toolbar.appendChild(codeGroup);

        // Группа специальных блоков
        const specialGroup = document.createElement('div');
        specialGroup.className = 'editor-btn-group';
        specialGroup.innerHTML = `
            <button type="button" class="editor-btn" data-spoiler="true" title="Спойлер"><i class="fas fa-chevron-down"></i></button>
            <button type="button" class="editor-btn" data-table="true" title="Таблица"><i class="fas fa-table"></i></button>
        `;
        toolbar.appendChild(specialGroup);

        // Выпадающее меню для alert-блоков
        const alertDropdown = document.createElement('div');
        alertDropdown.className = 'editor-dropdown';
        alertDropdown.innerHTML = `
            <button type="button" class="editor-btn dropdown-toggle"><i class="fas fa-exclamation-triangle"></i> Alert <i class="fas fa-caret-down"></i></button>
            <div class="dropdown-menu">
                <button type="button" data-alert="NOTE">📝 Note</button>
                <button type="button" data-alert="TIP">💡 Tip</button>
                <button type="button" data-alert="IMPORTANT">❗ Important</button>
                <button type="button" data-alert="WARNING">⚠️ Warning</button>
                <button type="button" data-alert="CAUTION">🔥 Caution</button>
            </div>
        `;
        toolbar.appendChild(alertDropdown);

        // Прогресс-бар и карточка
        const extraGroup = document.createElement('div');
        extraGroup.className = 'editor-btn-group';
        extraGroup.innerHTML = `
            <button type="button" class="editor-btn" data-progress="true" title="Прогресс-бар"><i class="fas fa-chart-bar"></i> Прогресс</button>
            <button type="button" class="editor-btn" data-card="true" title="Карточка"><i class="fas fa-credit-card"></i> Карточка</button>
        `;
        toolbar.appendChild(extraGroup);

        // Кнопка предпросмотра
        if (options.preview !== false) {
            const previewBtn = document.createElement('button');
            previewBtn.type = 'button';
            previewBtn.className = 'editor-btn preview-btn';
            previewBtn.id = options.previewId || 'preview-btn';
            previewBtn.innerHTML = '<i class="fas fa-eye"></i> Предпросмотр';
            previewBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (options.onPreview) {
                    options.onPreview();
                } else {
                    const previewArea = document.getElementById(options.previewAreaId || 'preview-area');
                    if (previewArea) {
                        const body = textarea.value;
                        if (!body.trim()) {
                            previewArea.style.display = 'none';
                            return;
                        }
                        previewArea.innerHTML = window.GithubCore?.renderMarkdown(body) || body;
                        previewArea.style.display = 'block';
                    }
                }
            });
            toolbar.appendChild(previewBtn);
        }

        // Привязываем обработчики
        toolbar.querySelectorAll('[data-tag]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const tag = btn.dataset.tag;
                const placeholder = btn.dataset.placeholder || '';
                const wrap = btn.dataset.wrap === 'true';
                const isLink = btn.dataset.link === 'true';
                insertMarkdown(textarea, tag, placeholder, wrap, isLink);
            });
        });

        toolbar.querySelectorAll('[data-link="true"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                insertMarkdown(textarea, '[', '', false, true);
            });
        });

        toolbar.querySelectorAll('[data-youtube="true"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                insertYouTube(textarea);
            });
        });

        toolbar.querySelectorAll('[data-codeblock="true"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                insertCodeBlock(textarea);
            });
        });

        toolbar.querySelectorAll('[data-spoiler="true"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                insertSpoiler(textarea);
            });
        });

        toolbar.querySelectorAll('[data-table="true"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                insertTable(textarea);
            });
        });

        toolbar.querySelectorAll('[data-progress="true"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                insertProgressBar(textarea);
            });
        });

        toolbar.querySelectorAll('[data-card="true"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                insertCard(textarea);
            });
        });

        // Обработчики для выпадающего меню
        const dropdownToggle = alertDropdown.querySelector('.dropdown-toggle');
        const dropdownMenu = alertDropdown.querySelector('.dropdown-menu');
        dropdownToggle.addEventListener('click', (e) => {
            e.preventDefault();
            dropdownMenu.classList.toggle('show');
        });
        dropdownMenu.querySelectorAll('[data-alert]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const type = btn.dataset.alert;
                insertAlert(textarea, type);
                dropdownMenu.classList.remove('show');
            });
        });
        document.addEventListener('click', (e) => {
            if (!dropdownToggle.contains(e.target) && !dropdownMenu.contains(e.target)) {
                dropdownMenu.classList.remove('show');
            }
        });

        return toolbar;
    }

    window.Editor = {
        insertAtCursor,
        insertMarkdown,
        insertSpoiler,
        insertAlert,
        insertTable,
        insertCodeBlock,
        insertProgressBar,
        insertCard,
        insertYouTube,
        createEditorToolbar
    };
})();