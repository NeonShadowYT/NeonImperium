// editor.js — унифицированный Markdown-редактор с шаблонами

(function() {
    // База шаблонов
    const TEMPLATES = {
        // Базовое форматирование
        bold: { 
            name: 'Жирный', 
            icon: 'fas fa-bold',
            action: (textarea) => insertMarkdown(textarea, '**', 'текст', true)
        },
        italic: { 
            name: 'Курсив', 
            icon: 'fas fa-italic',
            action: (textarea) => insertMarkdown(textarea, '*', 'текст', true)
        },
        strikethrough: { 
            name: 'Зачёркнутый', 
            icon: 'fas fa-strikethrough',
            action: (textarea) => insertMarkdown(textarea, '~~', 'текст', true)
        },
        
        // Заголовки
        h1: { 
            name: 'Заголовок 1', 
            icon: 'H1',
            action: (textarea) => insertMarkdown(textarea, '# ', 'Заголовок')
        },
        h2: { 
            name: 'Заголовок 2', 
            icon: 'H2',
            action: (textarea) => insertMarkdown(textarea, '## ', 'Заголовок')
        },
        h3: { 
            name: 'Заголовок 3', 
            icon: 'H3',
            action: (textarea) => insertMarkdown(textarea, '### ', 'Заголовок')
        },
        
        // Списки
        ul: { 
            name: 'Маркированный список', 
            icon: 'fas fa-list-ul',
            action: (textarea) => insertList(textarea, '- ')
        },
        ol: { 
            name: 'Нумерованный список', 
            icon: 'fas fa-list-ol',
            action: (textarea) => insertList(textarea, '1. ')
        },
        quote: { 
            name: 'Цитата', 
            icon: 'fas fa-quote-right',
            action: (textarea) => insertMarkdown(textarea, '> ', 'цитата')
        },
        
        // Ссылки и медиа
        link: { 
            name: 'Ссылка', 
            icon: 'fas fa-link',
            action: (textarea) => insertLink(textarea)
        },
        image: { 
            name: 'Изображение', 
            icon: 'fas fa-image',
            action: (textarea) => insertImage(textarea)
        },
        youtube: { 
            name: 'YouTube', 
            icon: 'fab fa-youtube',
            action: (textarea) => insertYouTube(textarea)
        },
        
        // Код
        code: { 
            name: 'Код', 
            icon: 'fas fa-code',
            action: (textarea) => insertMarkdown(textarea, '`', 'код', true)
        },
        codeblock: { 
            name: 'Блок кода', 
            icon: 'fas fa-file-code',
            action: (textarea) => insertCodeBlock(textarea)
        },
        
        // Специальные блоки
        spoiler: { 
            name: 'Спойлер', 
            icon: 'fas fa-chevron-down',
            action: (textarea) => insertSpoiler(textarea)
        },
        table: { 
            name: 'Таблица', 
            icon: 'fas fa-table',
            action: (textarea) => insertTable(textarea)
        },
        poll: { 
            name: 'Опрос', 
            icon: 'fas fa-chart-pie',
            action: (textarea) => insertPoll(textarea)
        },
        progress: { 
            name: 'Прогресс-бар', 
            icon: 'fas fa-chart-bar',
            action: (textarea) => insertProgressBar(textarea)
        },
        card: { 
            name: 'Карточка', 
            icon: 'fas fa-credit-card',
            action: (textarea) => insertCard(textarea)
        },
        
        // Alert блоки
        alertNote: { 
            name: 'Note', 
            icon: 'fas fa-info-circle',
            action: (textarea) => insertAlert(textarea, 'NOTE')
        },
        alertTip: { 
            name: 'Tip', 
            icon: 'fas fa-lightbulb',
            action: (textarea) => insertAlert(textarea, 'TIP')
        },
        alertImportant: { 
            name: 'Important', 
            icon: 'fas fa-exclamation',
            action: (textarea) => insertAlert(textarea, 'IMPORTANT')
        },
        alertWarning: { 
            name: 'Warning', 
            icon: 'fas fa-exclamation-triangle',
            action: (textarea) => insertAlert(textarea, 'WARNING')
        },
        alertCaution: { 
            name: 'Caution', 
            icon: 'fas fa-bolt',
            action: (textarea) => insertAlert(textarea, 'CAUTION')
        }
    };

    // Вспомогательные функции
    function insertAtCursor(textarea, text) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;
        textarea.value = value.substring(0, start) + text + value.substring(end);
        textarea.focus();
        textarea.setSelectionRange(start + text.length, start + text.length);
    }

    function insertMarkdown(textarea, tag, placeholder, wrap = false) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.substring(start, end);

        let insertion;
        if (wrap) {
            insertion = selected ? tag + selected + tag : tag + placeholder + tag;
        } else {
            insertion = selected ? tag + selected : tag + placeholder;
        }
        insertAtCursor(textarea, insertion);
    }

    function insertList(textarea, prefix) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selected = textarea.value.substring(start, end);
        
        if (selected.includes('\n')) {
            const lines = selected.split('\n');
            const newLines = lines.map(line => line.trim() ? prefix + line : line).join('\n');
            insertAtCursor(textarea, newLines);
        } else {
            insertAtCursor(textarea, prefix + (selected || 'элемент списка'));
        }
    }

    function insertLink(textarea) {
        const url = prompt('Введите URL:', 'https://');
        if (!url) return;
        const text = prompt('Введите текст ссылки:', 'ссылка');
        insertAtCursor(textarea, `[${text || 'ссылка'}](${url})`);
    }

    function insertImage(textarea) {
        const url = prompt('Введите URL изображения:', 'https://');
        if (!url) return;
        const alt = prompt('Введите описание изображения:', 'image');
        insertAtCursor(textarea, `![${alt || 'image'}](${url})`);
    }

    function insertYouTube(textarea) {
        const url = prompt('Введите ссылку на YouTube видео:', 'https://youtu.be/...');
        if (!url) return;
        
        // Пытаемся извлечь ID видео
        let videoId = '';
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
            /youtube\.com\/embed\/([^&\n?#]+)/
        ];
        
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) {
                videoId = match[1];
                break;
            }
        }
        
        if (videoId) {
            insertAtCursor(textarea, `\n<div class="youtube-embed"><iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe></div>\n`);
        } else {
            insertAtCursor(textarea, url);
        }
    }

    function insertSpoiler(textarea) {
        const summary = prompt('Заголовок спойлера:', 'Спойлер');
        if (summary === null) return;
        const content = prompt('Содержимое спойлера:', '');
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
        const rows = prompt('Количество строк:', '3');
        const cols = prompt('Количество столбцов:', '2');
        if (!rows || !cols) return;
        
        let table = '\n';
        // Заголовок
        for (let i = 0; i < parseInt(cols); i++) {
            table += `| Заголовок ${i+1} `;
        }
        table += '|\n';
        
        // Разделитель
        for (let i = 0; i < parseInt(cols); i++) {
            table += '|-------------';
        }
        table += '|\n';
        
        // Ячейки
        for (let r = 0; r < parseInt(rows); r++) {
            for (let c = 0; c < parseInt(cols); c++) {
                table += `| Ячейка ${r+1}-${c+1} `;
            }
            table += '|\n';
        }
        insertAtCursor(textarea, table);
    }

    function insertCodeBlock(textarea) {
        const lang = prompt('Язык (например, javascript, python):', '');
        const code = prompt('Введите код:', '');
        if (code === null) return;
        const block = `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
        insertAtCursor(textarea, block);
    }

    function insertProgressBar(textarea) {
        const percent = prompt('Введите процент заполнения (0-100):', '50');
        if (percent === null) return;
        const bar = `\n<div class="progress-bar"><div style="width: ${percent}%; text-align: center; line-height: 24px;">${percent}%</div></div>\n`;
        insertAtCursor(textarea, bar);
    }

    function insertCard(textarea) {
        const title = prompt('Заголовок карточки:', 'Карточка');
        if (title === null) return;
        const content = prompt('Содержимое карточки:', '');
        const card = `\n<div class="custom-card"><h4>${title}</h4><p>${content || ''}</p></div>\n`;
        insertAtCursor(textarea, card);
    }

    function insertPoll(textarea) {
        const question = prompt('Вопрос опроса:', 'Добавлять ли новую функцию?');
        if (question === null) return;
        const optionsInput = prompt('Введите варианты через запятую (макс. 10):', 'Да, Нет, Возможно');
        if (!optionsInput) return;
        
        const options = optionsInput.split(',').map(s => s.trim()).filter(s => s.length > 0);
        if (options.length === 0) return;
        if (options.length > 10) {
            alert('Слишком много вариантов. Будет использовано только первые 10.');
            options.splice(10);
        }
        
        const pollData = { question, options };
        const pollComment = `\n<!-- poll: ${JSON.stringify(pollData)} -->\n`;
        insertAtCursor(textarea, pollComment);
    }

    // Создание панели инструментов
    function createEditorToolbar(textarea, options = {}) {
        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';
        toolbar.style.cssText = `
            display: flex;
            gap: 5px;
            margin-bottom: 10px;
            flex-wrap: wrap;
            padding: 8px;
            background: var(--bg-card);
            border-radius: 12px;
            border: 1px solid var(--border);
        `;

        // Группировка шаблонов
        const groups = {
            'Форматирование': ['bold', 'italic', 'strikethrough'],
            'Заголовки': ['h1', 'h2', 'h3'],
            'Списки': ['ul', 'ol', 'quote'],
            'Медиа': ['link', 'image', 'youtube'],
            'Код': ['code', 'codeblock'],
            'Блоки': ['spoiler', 'table', 'poll', 'progress', 'card'],
            'Alert': ['alertNote', 'alertTip', 'alertImportant', 'alertWarning', 'alertCaution']
        };

        for (const [groupName, templateKeys] of Object.entries(groups)) {
            const group = document.createElement('div');
            group.className = 'editor-btn-group';
            group.style.cssText = `
                display: flex;
                gap: 3px;
                flex-wrap: wrap;
                padding: 0 5px;
                border-right: 1px solid var(--border);
            `;

            templateKeys.forEach(key => {
                const template = TEMPLATES[key];
                if (!template) return;

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'editor-btn';
                btn.title = template.name;
                btn.innerHTML = template.icon.startsWith('fas') || template.icon.startsWith('fab') 
                    ? `<i class="${template.icon}"></i>` 
                    : template.icon;
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    template.action(textarea);
                });
                group.appendChild(btn);
            });

            toolbar.appendChild(group);
        }

        // Кнопка предпросмотра
        if (options.preview !== false) {
            const previewBtn = document.createElement('button');
            previewBtn.type = 'button';
            previewBtn.className = 'editor-btn preview-btn';
            previewBtn.innerHTML = '<i class="fas fa-eye"></i> Предпросмотр';
            previewBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (options.onPreview) {
                    options.onPreview();
                }
            });
            toolbar.appendChild(previewBtn);
        }

        return toolbar;
    }

    // Экспорт
    window.Editor = {
        TEMPLATES,
        createEditorToolbar,
        insertAtCursor,
        insertMarkdown,
        insertList,
        insertLink,
        insertImage,
        insertYouTube,
        insertSpoiler,
        insertAlert,
        insertTable,
        insertCodeBlock,
        insertProgressBar,
        insertCard,
        insertPoll
    };
})();