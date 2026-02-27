(function() {
    const TEMPLATES = {
        bold: { name: 'Жирный', icon: 'fas fa-bold', action: (textarea) => insertMarkdown(textarea, '**', 'текст', true) },
        italic: { name: 'Курсив', icon: 'fas fa-italic', action: (textarea) => insertMarkdown(textarea, '*', 'текст', true) },
        strikethrough: { name: 'Зачёркнутый', icon: 'fas fa-strikethrough', action: (textarea) => insertMarkdown(textarea, '~~', 'текст', true) },
        h1: { name: 'Заголовок 1', icon: 'H1', action: (textarea) => insertMarkdown(textarea, '# ', 'Заголовок') },
        h2: { name: 'Заголовок 2', icon: 'H2', action: (textarea) => insertMarkdown(textarea, '## ', 'Заголовок') },
        h3: { name: 'Заголовок 3', icon: 'H3', action: (textarea) => insertMarkdown(textarea, '### ', 'Заголовок') },
        ul: { name: 'Маркированный список', icon: 'fas fa-list-ul', action: (textarea) => insertList(textarea, '- ') },
        ol: { name: 'Нумерованный список', icon: 'fas fa-list-ol', action: (textarea) => insertList(textarea, '1. ') },
        quote: { name: 'Цитата', icon: 'fas fa-quote-right', action: (textarea) => insertMarkdown(textarea, '> ', 'цитата') },
        link: { name: 'Ссылка', icon: 'fas fa-link', action: (textarea) => insertLink(textarea) },
        image: { name: 'Изображение', icon: 'fas fa-image', action: (textarea) => insertImage(textarea) },
        youtube: { name: 'YouTube', icon: 'fab fa-youtube', action: (textarea) => insertYouTube(textarea) },
        code: { name: 'Код', icon: 'fas fa-code', action: (textarea) => insertMarkdown(textarea, '`', 'код', true) },
        codeblock: { name: 'Блок кода', icon: 'fas fa-file-code', action: (textarea) => insertCodeBlock(textarea) },
        spoiler: { name: 'Спойлер', icon: 'fas fa-chevron-down', action: (textarea) => insertSpoiler(textarea) },
        table: { name: 'Таблица', icon: 'fas fa-table', action: (textarea) => insertTable(textarea) },
        poll: { name: 'Опрос', icon: 'fas fa-chart-pie', action: (textarea) => insertPoll(textarea) },
        progress: { name: 'Прогресс-бар', icon: 'fas fa-chart-bar', action: (textarea) => insertProgressBar(textarea) },
        card: { name: 'Карточка', icon: 'fas fa-credit-card', action: (textarea) => insertCard(textarea) },
        icon: { name: 'Иконка', icon: 'fas fa-icons', action: (textarea) => insertIcon(textarea) },
        color: { name: 'Цвет текста', icon: 'fas fa-palette', action: (textarea) => insertColor(textarea, 'color') },
        bgcolor: { name: 'Цвет фона', icon: 'fas fa-fill-drip', action: (textarea) => insertColor(textarea, 'background-color') },
        hr: { name: 'Горизонтальная линия', icon: 'fas fa-minus', action: (textarea) => insertAtCursor(textarea, '\n---\n') }
    };

    function insertAtCursor(textarea, text) {
        const start = textarea.selectionStart, end = textarea.selectionEnd, value = textarea.value;
        textarea.value = value.substring(0, start) + text + value.substring(end);
        textarea.focus();
        textarea.setSelectionRange(start + text.length, start + text.length);
    }

    function insertMarkdown(textarea, tag, placeholder, wrap = false) {
        const start = textarea.selectionStart, end = textarea.selectionEnd, selected = textarea.value.substring(start, end);
        insertAtCursor(textarea, wrap ? (selected ? tag + selected + tag : tag + placeholder + tag) : (selected ? tag + selected : tag + placeholder));
    }

    function insertList(textarea, prefix) {
        const start = textarea.selectionStart, end = textarea.selectionEnd, selected = textarea.value.substring(start, end);
        if (selected.includes('\n')) {
            const lines = selected.split('\n');
            insertAtCursor(textarea, lines.map(line => line.trim() ? prefix + line : line).join('\n'));
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
        let videoId = '';
        const patterns = [/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/, /youtube\.com\/embed\/([^&\n?#]+)/];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) { videoId = match[1]; break; }
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
        insertAtCursor(textarea, `\n<details><summary>${summary}</summary>\n\n${content || '...'}\n\n</details>\n`);
    }

    function insertTable(textarea) {
        const rows = prompt('Количество строк:', '3');
        const cols = prompt('Количество столбцов:', '2');
        if (!rows || !cols) return;
        let table = '\n';
        for (let i = 0; i < parseInt(cols); i++) table += `| Заголовок ${i+1} `;
        table += '|\n';
        for (let i = 0; i < parseInt(cols); i++) table += '|-------------';
        table += '|\n';
        for (let r = 0; r < parseInt(rows); r++) {
            for (let c = 0; c < parseInt(cols); c++) table += `| Ячейка ${r+1}-${c+1} `;
            table += '|\n';
        }
        insertAtCursor(textarea, table);
    }

    function insertCodeBlock(textarea) {
        const lang = prompt('Язык (например, javascript, python):', '');
        const code = prompt('Введите код:', '');
        if (code === null) return;
        insertAtCursor(textarea, `\n\`\`\`${lang}\n${code}\n\`\`\`\n`);
    }

    function insertProgressBar(textarea) {
        const percent = prompt('Введите процент заполнения (0-100):', '50');
        if (percent === null) return;
        insertAtCursor(textarea, `\n<div class="progress-bar"><div style="width: ${percent}%; text-align: center; line-height: 24px;">${percent}%</div></div>\n`);
    }

    function insertCard(textarea) {
        const title = prompt('Заголовок карточки:', 'Карточка');
        if (title === null) return;
        const content = prompt('Содержимое карточки:', '');
        insertAtCursor(textarea, `\n<div class="custom-card"><h4>${title}</h4><p>${content || ''}</p></div>\n`);
    }

    function insertPoll(textarea) {
        const question = prompt('Вопрос опроса:', 'Добавлять ли новую функцию?');
        if (question === null) return;
        const optionsInput = prompt('Введите варианты через запятую (макс. 10):', 'Да, Нет, Возможно');
        if (!optionsInput) return;
        const options = optionsInput.split(',').map(s => s.trim()).filter(s => s);
        if (options.length === 0) return;
        if (options.length > 10) { alert('Слишком много вариантов. Будет использовано только первые 10.'); options.splice(10); }
        insertAtCursor(textarea, `\n<!-- poll: ${JSON.stringify({ question, options })} -->\n`);
    }

    function insertIcon(textarea) {
        const icon = prompt('Введите название иконки Font Awesome (например, "fa-heart"):', 'fa-heart');
        if (!icon) return;
        insertAtCursor(textarea, `<i class="fas ${icon}"></i>`);
    }

    function insertColor(textarea, styleProp) {
        const color = prompt(`Введите цвет (например, red, #ff0000):`, 'red');
        if (!color) return;
        const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
        insertAtCursor(textarea, selected ? `<span style="${styleProp}: ${color};">${selected}</span>` : `<span style="${styleProp}: ${color};">текст</span>`);
    }

    function debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function createImageServicesMenu() {
        const services = [
            { name: 'ImageBam', url: 'https://www.imagebam.com/upload?multi=1', description: 'До 100 МБ, массовая загрузка' },
            { name: 'Postimages', url: 'https://postimages.org/', description: 'До 32 МБ, прямые ссылки' },
            { name: 'ImgBB', url: 'https://imgbb.com/', description: 'До 32 МБ, удобный интерфейс' },
            { name: 'Catbox', url: 'https://catbox.moe/', description: 'До 200 МБ, анонимно' }
        ];
        const container = document.createElement('div');
        container.className = 'preview-split';
        container.style.marginLeft = '0';
        const mainBtn = document.createElement('button');
        mainBtn.type = 'button';
        mainBtn.className = 'image-services-btn';
        mainBtn.innerHTML = '<i class="fas fa-images"></i> Хостинги';
        const dropdownBtn = document.createElement('button');
        dropdownBtn.type = 'button';
        dropdownBtn.className = 'editor-btn dropdown-toggle';
        dropdownBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
        const dropdownMenu = document.createElement('div');
        dropdownMenu.className = 'preview-dropdown';
        dropdownMenu.style.minWidth = '280px';
        services.forEach(service => {
            const item = document.createElement('button');
            item.innerHTML = `<strong>${service.name}</strong><br><small>${service.description}</small>`;
            item.style.whiteSpace = 'normal';
            item.style.lineHeight = '1.4';
            item.style.padding = '10px 16px';
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                window.open(service.url, '_blank');
                dropdownMenu.classList.remove('show');
            });
            dropdownMenu.appendChild(item);
        });
        container.appendChild(mainBtn);
        container.appendChild(dropdownBtn);
        container.appendChild(dropdownMenu);
        dropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle('show');
        });
        mainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle('show');
        });
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) dropdownMenu.classList.remove('show');
        });
        return container;
    }

    function createEditorToolbar(textarea, options = {}) {
        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';
        toolbar.style.cssText = 'display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap;padding:8px;background:var(--bg-card);border-radius:12px;border:1px solid var(--border);';
        const groups = {
            Форматирование: ['bold', 'italic', 'strikethrough'],
            Заголовки: ['h1', 'h2', 'h3'],
            Списки: ['ul', 'ol', 'quote'],
            Медиа: ['link', 'image', 'youtube'],
            Код: ['code', 'codeblock'],
            Блоки: ['spoiler', 'table', 'poll', 'progress', 'card'],
            Иконки: ['icon'],
            Цвет: ['color', 'bgcolor'],
            Дополнительно: ['hr']
        };
        for (const [groupName, templateKeys] of Object.entries(groups)) {
            const group = document.createElement('div');
            group.className = 'editor-btn-group';
            group.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;padding:0 5px;border-right:1px solid var(--border);';
            templateKeys.forEach(key => {
                const template = TEMPLATES[key];
                if (!template) return;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'editor-btn';
                btn.title = template.name;
                btn.innerHTML = template.icon.startsWith('fas') || template.icon.startsWith('fab') ? `<i class="${template.icon}"></i>` : template.icon;
                btn.addEventListener('click', (e) => { e.preventDefault(); template.action(textarea); });
                group.appendChild(btn);
            });
            toolbar.appendChild(group);
        }
        if (options.preview !== false) {
            const previewWrapper = document.createElement('div');
            previewWrapper.className = 'preview-split';
            previewWrapper.style.marginLeft = 'auto';
            const previewBtn = document.createElement('button');
            previewBtn.type = 'button';
            previewBtn.className = 'editor-btn preview-btn';
            previewBtn.textContent = 'Предпросмотр';
            const dropdownBtn = document.createElement('button');
            dropdownBtn.type = 'button';
            dropdownBtn.className = 'editor-btn dropdown-toggle';
            dropdownBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
            const dropdownMenu = document.createElement('div');
            dropdownMenu.className = 'preview-dropdown';
            dropdownMenu.innerHTML = '<button data-mode="preview" class="active">Предпросмотр</button><button data-mode="live">Живой предпросмотр</button>';
            previewWrapper.appendChild(previewBtn);
            previewWrapper.appendChild(dropdownBtn);
            previewWrapper.appendChild(dropdownMenu);
            let liveMode = false, inputHandler = null;
            const showPreview = () => { if (options.onPreview) options.onPreview(); };
            previewBtn.addEventListener('click', showPreview);
            dropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdownMenu.classList.toggle('show');
            });
            dropdownMenu.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const mode = btn.dataset.mode;
                    dropdownMenu.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    if (mode === 'live') {
                        previewBtn.textContent = 'Живой предпросмотр';
                        if (!liveMode) {
                            liveMode = true;
                            if (inputHandler) textarea.removeEventListener('input', inputHandler);
                            inputHandler = debounce(showPreview, 300);
                            textarea.addEventListener('input', inputHandler);
                            if (textarea.value.trim()) showPreview();
                        }
                    } else {
                        previewBtn.textContent = 'Предпросмотр';
                        if (liveMode) {
                            liveMode = false;
                            if (inputHandler) {
                                textarea.removeEventListener('input', inputHandler);
                                inputHandler = null;
                            }
                        }
                    }
                    dropdownMenu.classList.remove('show');
                });
            });
            document.addEventListener('click', (e) => {
                if (!previewWrapper.contains(e.target)) dropdownMenu.classList.remove('show');
            });
            toolbar.appendChild(previewWrapper);
        }
        return toolbar;
    }

    window.Editor = {
        TEMPLATES,
        createEditorToolbar,
        createImageServicesMenu,
        insertAtCursor,
        insertMarkdown,
        insertList,
        insertLink,
        insertImage,
        insertYouTube,
        insertSpoiler,
        insertTable,
        insertCodeBlock,
        insertProgressBar,
        insertCard,
        insertPoll,
        insertIcon,
        insertColor
    };
})();