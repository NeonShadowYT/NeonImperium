// js/features/editor.js — улучшенный редактор с тулбаром и ленивой инициализацией
(function() {
    const TEMPLATES = {
        bold:       { name: 'Жирный', icon: 'fas fa-bold', action: (ta) => insertMarkdown(ta, '**', 'текст', true) },
        italic:     { name: 'Курсив', icon: 'fas fa-italic', action: (ta) => insertMarkdown(ta, '*', 'текст', true) },
        strikethrough: { name: 'Зачёркнутый', icon: 'fas fa-strikethrough', action: (ta) => insertMarkdown(ta, '~~', 'текст', true) },
        h1:         { name: 'Заголовок 1', icon: 'H1', action: (ta) => insertMarkdown(ta, '# ', 'Заголовок') },
        h2:         { name: 'Заголовок 2', icon: 'H2', action: (ta) => insertMarkdown(ta, '## ', 'Заголовок') },
        h3:         { name: 'Заголовок 3', icon: 'H3', action: (ta) => insertMarkdown(ta, '### ', 'Заголовок') },
        ul:         { name: 'Маркированный список', icon: 'fas fa-list-ul', action: insertList('- ') },
        ol:         { name: 'Нумерованный список', icon: 'fas fa-list-ol', action: insertList('1. ') },
        quote:      { name: 'Цитата', icon: 'fas fa-quote-right', action: (ta) => insertMarkdown(ta, '> ', 'цитата') },
        link:       { name: 'Ссылка', icon: 'fas fa-link', action: insertLink },
        image:      { name: 'Изображение', icon: 'fas fa-image', action: insertImage },
        youtube:    { name: 'YouTube', icon: 'fab fa-youtube', action: insertYouTube },
        code:       { name: 'Код', icon: 'fas fa-code', action: (ta) => insertMarkdown(ta, '`', 'код', true) },
        codeblock:  { name: 'Блок кода', icon: 'fas fa-file-code', action: insertCodeBlock },
        spoiler:    { name: 'Спойлер', icon: 'fas fa-chevron-down', action: insertSpoiler },
        table:      { name: 'Таблица', icon: 'fas fa-table', action: insertTable },
        poll:       { name: 'Опрос', icon: 'fas fa-chart-pie', action: insertPoll },
        progress:   { name: 'Прогресс-бар', icon: 'fas fa-chart-bar', action: insertProgressBar },
        card:       { name: 'Карточка', icon: 'fas fa-credit-card', action: insertCard },
        icon:       { name: 'Иконка', icon: 'fas fa-icons', action: insertIcon },
        color:      { name: 'Цвет текста', icon: 'fas fa-palette', action: (ta) => insertColor(ta, 'color') },
        bgcolor:    { name: 'Цвет фона', icon: 'fas fa-fill-drip', action: (ta) => insertColor(ta, 'background-color') },
        hr:         { name: 'Горизонтальная линия', icon: 'fas fa-minus', action: (ta) => insertAtCursor(ta, '\n---\n') }
    };

    const { createElement, escapeHtml } = GithubCore;

    function insertAtCursor(textarea, text) {
        const start = textarea.selectionStart, end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
        textarea.focus();
        textarea.setSelectionRange(start + text.length, start + text.length);
    }

    function insertMarkdown(textarea, tag, placeholder, wrap = false) {
        const start = textarea.selectionStart, end = textarea.selectionEnd;
        const selected = textarea.value.substring(start, end);
        const replacement = wrap ? (selected ? tag + selected + tag : tag + placeholder + tag)
                                 : (selected ? tag + selected : tag + placeholder);
        insertAtCursor(textarea, replacement);
    }

    function insertList(prefix) {
        return (textarea) => {
            const start = textarea.selectionStart, end = textarea.selectionEnd;
            const selected = textarea.value.substring(start, end);
            if (selected.includes('\n')) {
                const lines = selected.split('\n');
                insertAtCursor(textarea, lines.map(line => line.trim() ? prefix + line : line).join('\n'));
            } else {
                insertAtCursor(textarea, prefix + (selected || 'элемент списка'));
            }
        };
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
        for (const p of patterns) {
            const match = url.match(p);
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
        insertAtCursor(textarea, `\n<details><summary>${escapeHtml(summary)}</summary>\n\n${escapeHtml(content) || '...'}\n\n</details>\n`);
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
        const lang = prompt('Язык (например, javascript):', '');
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
        insertAtCursor(textarea, `\n<div class="custom-card"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(content) || ''}</p></div>\n`);
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
        insertAtCursor(textarea, selected ? `<span style="${styleProp}: ${color};">${escapeHtml(selected)}</span>` : `<span style="${styleProp}: ${color};">текст</span>`);
    }

    function createImageServicesMenu() {
        const services = [
            { name: 'Catbox', url: 'https://catbox.moe/', description: 'До 200 МБ, анонимно' },
            { name: 'ImageBam', url: 'https://www.imagebam.com/upload?multi=1', description: 'До 100 МБ' },
            { name: 'Postimages', url: 'https://postimages.org/', description: 'До 32 МБ' },
            { name: 'ImgBB', url: 'https://imgbb.com/', description: 'До 32 МБ' }
        ];
        const container = createElement('div', 'image-services-menu', { position: 'relative', display: 'inline-block' });
        const mainBtn = createElement('button', 'image-services-btn', {}, { type: 'button' });
        mainBtn.innerHTML = '<i class="fas fa-images"></i> Хостинги';
        const dropdown = createElement('div', 'preview-dropdown', {
            position: 'absolute', top: '100%', right: '0', zIndex: '1000', minWidth: '280px',
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px',
            padding: '5px 0', boxShadow: 'var(--shadow)', display: 'none'
        });
        services.forEach(s => {
            const item = createElement('button', '', {
                whiteSpace: 'normal', lineHeight: '1.4', padding: '10px 16px', width: '100%',
                textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                cursor: 'pointer', fontFamily: "'Russo One', sans-serif", fontSize: '13px'
            }, { type: 'button' });
            item.innerHTML = `<strong>${s.name}</strong><br><small>${s.description}</small>`;
            item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg-inner-gradient)'; item.style.color = 'var(--text-primary)'; });
            item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; item.style.color = 'var(--text-secondary)'; });
            item.addEventListener('click', (e) => { e.stopPropagation(); window.open(s.url, '_blank'); dropdown.style.display = 'none'; });
            dropdown.appendChild(item);
        });
        container.appendChild(mainBtn);
        container.appendChild(dropdown);
        mainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        });
        document.addEventListener('click', (e) => { if (!container.contains(e.target)) dropdown.style.display = 'none'; });
        return container;
    }

    function createEditorToolbar(textarea) {
        const toolbar = createElement('div', 'editor-toolbar', {
            display: 'flex', gap: '5px', marginBottom: '10px', flexWrap: 'wrap',
            padding: '8px', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border)'
        });
        const groups = {
            'Форматирование': ['bold', 'italic', 'strikethrough'],
            'Заголовки': ['h1', 'h2', 'h3'],
            'Списки': ['ul', 'ol', 'quote'],
            'Медиа': ['link', 'image', 'youtube'],
            'Код': ['code', 'codeblock'],
            'Блоки': ['spoiler', 'table', 'poll', 'progress', 'card'],
            'Иконки': ['icon'],
            'Цвет': ['color', 'bgcolor'],
            'Доп.': ['hr']
        };
        for (const [groupName, keys] of Object.entries(groups)) {
            const group = createElement('div', 'editor-btn-group', {
                display: 'flex', gap: '3px', flexWrap: 'wrap', padding: '0 5px', borderRight: '1px solid var(--border)'
            });
            keys.forEach(key => {
                const tpl = TEMPLATES[key];
                if (!tpl) return;
                const btn = createElement('button', 'editor-btn', {
                    background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                    padding: '6px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
                    transition: 'all 0.2s', fontFamily: "'Russo One', sans-serif"
                }, { type: 'button', title: tpl.name });
                btn.innerHTML = tpl.icon.startsWith('fa') ? `<i class="${tpl.icon}"></i>` : tpl.icon;
                btn.addEventListener('click', (e) => { e.preventDefault(); tpl.action(textarea); });
                group.appendChild(btn);
            });
            toolbar.appendChild(group);
        }
        return toolbar;
    }

    // Публичное API
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