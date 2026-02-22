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

    // Создаёт панель инструментов и привязывает обработчики
    function createEditorToolbar(textarea, options = {}) {
        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';
        toolbar.style.display = 'flex';
        toolbar.style.gap = '5px';
        toolbar.style.marginBottom = '10px';
        toolbar.style.flexWrap = 'wrap';

        // Базовые кнопки
        const buttons = [
            { tag: '**', placeholder: 'жирный текст', icon: 'bold', title: 'Жирный' },
            { tag: '*', placeholder: 'курсив', icon: 'italic', title: 'Курсив' },
            { tag: '### ', placeholder: 'Заголовок', icon: 'heading', title: 'Заголовок' },
            { tag: '> ', placeholder: 'цитата', icon: 'quote-right', title: 'Цитата' },
            { tag: '`', placeholder: 'код', wrap: true, icon: 'code', title: 'Код' },
            { tag: '[', placeholder: 'ссылка', link: true, icon: 'link', title: 'Ссылка' },
            { tag: '- ', placeholder: 'элемент списка', icon: 'list-ul', title: 'Маркированный список' },
            { tag: '1. ', placeholder: 'элемент списка', icon: 'list-ol', title: 'Нумерованный список' },
            { tag: '![](', placeholder: 'url картинки)', icon: 'image', title: 'Изображение' },
            { spoiler: true, icon: 'chevron-down', text: 'Спойлер', title: 'Спойлер' }
        ];

        // Alert-блоки (если включены)
        if (options.alerts !== false) {
            buttons.push(
                { alert: 'NOTE', icon: 'info-circle', text: 'Note', title: 'Примечание' },
                { alert: 'TIP', icon: 'lightbulb', text: 'Tip', title: 'Совет' },
                { alert: 'IMPORTANT', icon: 'exclamation-circle', text: 'Important', title: 'Важно' },
                { alert: 'WARNING', icon: 'exclamation-triangle', text: 'Warning', title: 'Предупреждение' },
                { alert: 'CAUTION', icon: 'fire', text: 'Caution', title: 'Осторожно' }
            );
        }

        // Таблица и блок кода
        if (options.table !== false) {
            buttons.push({ table: true, icon: 'table', text: 'Таблица', title: 'Таблица' });
        }
        if (options.codeblock !== false) {
            buttons.push({ codeblock: true, icon: 'code', text: 'Блок кода', title: 'Блок кода' });
        }

        // Кнопка предпросмотра
        if (options.preview !== false) {
            buttons.push({ preview: true, icon: 'eye', text: 'Предпросмотр', title: 'Предпросмотр' });
        }

        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'editor-btn';
            button.title = btn.title || '';

            if (btn.icon) {
                button.innerHTML = `<i class="fas fa-${btn.icon}"></i> ${btn.text || ''}`;
            } else {
                button.textContent = btn.text || '';
            }

            if (btn.tag !== undefined) {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    insertMarkdown(textarea, btn.tag, btn.placeholder || '', btn.wrap || false, btn.link || false);
                });
            } else if (btn.spoiler) {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    insertSpoiler(textarea);
                });
            } else if (btn.alert) {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    insertAlert(textarea, btn.alert);
                });
            } else if (btn.table) {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    insertTable(textarea);
                });
            } else if (btn.codeblock) {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    insertCodeBlock(textarea);
                });
            } else if (btn.preview) {
                button.id = options.previewId || 'preview-btn';
                button.addEventListener('click', (e) => {
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
            }

            toolbar.appendChild(button);
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
        createEditorToolbar
    };
})();