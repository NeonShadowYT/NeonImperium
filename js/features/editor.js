// editor.js — унифицированный Markdown-редактор

(function() {
    const TEMPLATES = {
        bold: { name: 'Жирный', icon: 'fas fa-bold', action: (ta) => insertMarkdown(ta, '**', 'текст', true) },
        italic: { name: 'Курсив', icon: 'fas fa-italic', action: (ta) => insertMarkdown(ta, '*', 'текст', true) },
        strikethrough: { name: 'Зачёркнутый', icon: 'fas fa-strikethrough', action: (ta) => insertMarkdown(ta, '~~', 'текст', true) },
        h1: { name: 'Заголовок 1', icon: 'H1', action: (ta) => insertMarkdown(ta, '# ', 'Заголовок') },
        h2: { name: 'Заголовок 2', icon: 'H2', action: (ta) => insertMarkdown(ta, '## ', 'Заголовок') },
        h3: { name: 'Заголовок 3', icon: 'H3', action: (ta) => insertMarkdown(ta, '### ', 'Заголовок') },
        ul: { name: 'Список', icon: 'fas fa-list-ul', action: (ta) => insertList(ta, '- ') },
        ol: { name: 'Нумерованный', icon: 'fas fa-list-ol', action: (ta) => insertList(ta, '1. ') },
        quote: { name: 'Цитата', icon: 'fas fa-quote-right', action: (ta) => insertMarkdown(ta, '> ', 'цитата') },
        link: { name: 'Ссылка', icon: 'fas fa-link', action: insertLink },
        image: { name: 'Изображение', icon: 'fas fa-image', action: insertImage },
        youtube: { name: 'YouTube', icon: 'fab fa-youtube', action: insertYouTube },
        code: { name: 'Код', icon: 'fas fa-code', action: (ta) => insertMarkdown(ta, '`', 'код', true) },
        codeblock: { name: 'Блок кода', icon: 'fas fa-file-code', action: insertCodeBlock },
        spoiler: { name: 'Спойлер', icon: 'fas fa-chevron-down', action: insertSpoiler },
        table: { name: 'Таблица', icon: 'fas fa-table', action: insertTable },
        poll: { name: 'Опрос', icon: 'fas fa-chart-pie', action: insertPoll },
        progress: { name: 'Прогресс', icon: 'fas fa-chart-bar', action: insertProgressBar },
        card: { name: 'Карточка', icon: 'fas fa-credit-card', action: insertCard },
        icon: { name: 'Иконка', icon: 'fas fa-icons', action: insertIcon },
        color: { name: 'Цвет текста', icon: 'fas fa-palette', action: (ta) => insertColor(ta, 'color') },
        bgcolor: { name: 'Цвет фона', icon: 'fas fa-fill-drip', action: (ta) => insertColor(ta, 'background-color') },
        hr: { name: 'Линия', icon: 'fas fa-minus', action: (ta) => insertAtCursor(ta, '\n---\n') }
    };

    // Вставка текста в позицию курсора
    function insertAtCursor(ta, text) {
        const start = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
        ta.focus();
        ta.setSelectionRange(start + text.length, start + text.length);
    }

    function insertMarkdown(ta, tag, placeholder, wrap = false) {
        const selected = ta.value.substring(ta.selectionStart, ta.selectionEnd);
        const ins = selected ? (wrap ? tag + selected + tag : tag + selected) : (wrap ? tag + placeholder + tag : tag + placeholder);
        insertAtCursor(ta, ins);
    }

    function insertList(ta, prefix) {
        const selected = ta.value.substring(ta.selectionStart, ta.selectionEnd);
        if (selected.includes('\n')) {
            const lines = selected.split('\n').map(l => l.trim() ? prefix + l : l).join('\n');
            insertAtCursor(ta, lines);
        } else insertAtCursor(ta, prefix + (selected || 'элемент'));
    }

    function insertLink(ta) {
        const url = prompt('URL:', 'https://');
        if (!url) return;
        const text = prompt('Текст ссылки:', 'ссылка');
        insertAtCursor(ta, `[${text || 'ссылка'}](${url})`);
    }

    function insertImage(ta) {
        const url = prompt('URL изображения:', 'https://');
        if (!url) return;
        const alt = prompt('Описание:', 'image');
        insertAtCursor(ta, `![${alt || 'image'}](${url})`);
    }

    function insertYouTube(ta) {
        const url = prompt('YouTube ссылка:', 'https://youtu.be/...');
        if (!url) return;
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
        if (match) insertAtCursor(ta, `\n<div class="youtube-embed"><iframe src="https://www.youtube.com/embed/${match[1]}" frameborder="0" allowfullscreen></iframe></div>\n`);
        else insertAtCursor(ta, url);
    }

    function insertCodeBlock(ta) {
        const lang = prompt('Язык (js, python...):', '');
        const code = prompt('Код:', '');
        if (code === null) return;
        insertAtCursor(ta, `\n\`\`\`${lang}\n${code}\n\`\`\`\n`);
    }

    function insertSpoiler(ta) {
        const summary = prompt('Заголовок спойлера:', 'Спойлер');
        if (summary === null) return;
        const content = prompt('Содержимое:', '');
        insertAtCursor(ta, `\n<details><summary>${summary}</summary>\n\n${content || '...'}\n\n</details>\n`);
    }

    function insertTable(ta) {
        const rows = parseInt(prompt('Строк:', '3')), cols = parseInt(prompt('Столбцов:', '2'));
        if (!rows || !cols) return;
        let table = '\n';
        for (let c = 0; c < cols; c++) table += `| Заголовок ${c+1} `;
        table += '|\n' + '|' + '-------------|'.repeat(cols) + '\n';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) table += `| Ячейка ${r+1}-${c+1} `;
            table += '|\n';
        }
        insertAtCursor(ta, table);
    }

    function insertProgressBar(ta) {
        const p = prompt('Процент (0-100):', '50');
        if (p === null) return;
        insertAtCursor(ta, `\n<div class="progress-bar"><div style="width: ${p}%;">${p}%</div></div>\n`);
    }

    function insertCard(ta) {
        const title = prompt('Заголовок карточки:', 'Карточка');
        if (title === null) return;
        const content = prompt('Содержимое:', '');
        insertAtCursor(ta, `\n<div class="custom-card"><h4>${title}</h4><p>${content || ''}</p></div>\n`);
    }

    function insertPoll(ta) {
        const q = prompt('Вопрос:', 'Добавлять функцию?');
        if (q === null) return;
        const opts = prompt('Варианты через запятую (до 10):', 'Да, Нет, Возможно');
        if (!opts) return;
        const options = opts.split(',').map(s => s.trim()).filter(Boolean).slice(0,10);
        if (!options.length) return;
        insertAtCursor(ta, `\n<!-- poll: ${JSON.stringify({ question: q, options })} -->\n`);
    }

    function insertIcon(ta) {
        const icon = prompt('Название иконки (fa-heart):', 'fa-heart');
        if (icon) insertAtCursor(ta, `<i class="fas ${icon}"></i>`);
    }

    function insertColor(ta, prop) {
        const color = prompt('Цвет (red, #ff0000):', 'red');
        if (!color) return;
        const selected = ta.value.substring(ta.selectionStart, ta.selectionEnd);
        if (selected) insertAtCursor(ta, `<span style="${prop}: ${color};">${selected}</span>`);
        else insertAtCursor(ta, `<span style="${prop}: ${color};">текст</span>`);
    }

    function debounce(fn, delay) {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
    }

    // Меню с хостингами изображений
    function createImageServicesMenu() {
        const services = [
            { name: 'ImageBam', url: 'https://www.imagebam.com/upload?multi=1', desc: 'До 100 МБ, массовая загрузка' },
            { name: 'Postimages', url: 'https://postimages.org/', desc: 'До 32 МБ, прямые ссылки' },
            { name: 'ImgBB', url: 'https://imgbb.com/', desc: 'До 32 МБ, удобно' },
            { name: 'Catbox', url: 'https://catbox.moe/', desc: 'До 200 МБ, анонимно' }
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

        const dropdown = document.createElement('div');
        dropdown.className = 'preview-dropdown';
        dropdown.style.minWidth = '280px';
        services.forEach(s => {
            const btn = document.createElement('button');
            btn.innerHTML = `<strong>${s.name}</strong><br><small>${s.desc}</small>`;
            btn.style.whiteSpace = 'normal';
            btn.onclick = (e) => { e.stopPropagation(); window.open(s.url, '_blank'); dropdown.classList.remove('show'); };
            dropdown.appendChild(btn);
        });

        container.append(mainBtn, dropdownBtn, dropdown);

        const toggle = (e) => { e.stopPropagation(); dropdown.classList.toggle('show'); };
        mainBtn.addEventListener('click', toggle);
        dropdownBtn.addEventListener('click', toggle);
        document.addEventListener('click', (e) => { if (!container.contains(e.target)) dropdown.classList.remove('show'); });

        return container;
    }

    // Создание тулбара редактора
    function createEditorToolbar(textarea, options = {}) {
        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';

        const groups = {
            'Форматирование': ['bold','italic','strikethrough'],
            'Заголовки': ['h1','h2','h3'],
            'Списки': ['ul','ol','quote'],
            'Медиа': ['link','image','youtube'],
            'Код': ['code','codeblock'],
            'Блоки': ['spoiler','table','poll','progress','card'],
            'Иконки': ['icon'],
            'Цвет': ['color','bgcolor'],
            'Доп': ['hr']
        };

        for (let [name, keys] of Object.entries(groups)) {
            const group = document.createElement('div');
            group.className = 'editor-btn-group';
            keys.forEach(key => {
                const t = TEMPLATES[key];
                if (!t) return;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'editor-btn';
                btn.title = t.name;
                btn.innerHTML = t.icon.startsWith('fa') ? `<i class="${t.icon}"></i>` : t.icon;
                btn.addEventListener('click', (e) => { e.preventDefault(); t.action(textarea); });
                group.appendChild(btn);
            });
            toolbar.appendChild(group);
        }

        toolbar.appendChild(createImageServicesMenu());

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

            const dropdown = document.createElement('div');
            dropdown.className = 'preview-dropdown';
            dropdown.innerHTML = '<button data-mode="preview" class="active">Предпросмотр</button><button data-mode="live">Живой</button>';

            previewWrapper.append(previewBtn, dropdownBtn, dropdown);

            let liveMode = false, inputHandler = null;
            const showPreview = () => options.onPreview?.();

            previewBtn.addEventListener('click', showPreview);
            dropdownBtn.addEventListener('click', (e) => { e.stopPropagation(); dropdown.classList.toggle('show'); });

            dropdown.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    dropdown.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    if (btn.dataset.mode === 'live') {
                        previewBtn.textContent = 'Живой';
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
                            textarea.removeEventListener('input', inputHandler);
                            inputHandler = null;
                        }
                    }
                    dropdown.classList.remove('show');
                });
            });

            document.addEventListener('click', (e) => { if (!previewWrapper.contains(e.target)) dropdown.classList.remove('show'); });
            toolbar.appendChild(previewWrapper);
        }

        return toolbar;
    }

    window.Editor = { TEMPLATES, createEditorToolbar, createImageServicesMenu, insertAtCursor, insertMarkdown, insertList, insertLink, insertImage, insertYouTube, insertSpoiler, insertTable, insertCodeBlock, insertProgressBar, insertCard, insertPoll, insertIcon, insertColor };
})();