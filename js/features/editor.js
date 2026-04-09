// js/features/editor.js
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
        progress: { name: 'Прогресс-бар', icon: 'fas fa-chart-bar', action: insertProgressBar },
        card: { name: 'Карточка', icon: 'fas fa-credit-card', action: insertCard },
        icon: { name: 'Иконка', icon: 'fas fa-icons', action: insertIcon },
        color: { name: 'Цвет текста', icon: 'fas fa-palette', action: (ta) => insertColor(ta, 'color') },
        bgcolor: { name: 'Цвет фона', icon: 'fas fa-fill-drip', action: (ta) => insertColor(ta, 'background-color') },
        hr: { name: 'Линия', icon: 'fas fa-minus', action: (ta) => insertAtCursor(ta, '\n---\n') }
    };

    function insertAtCursor(textarea, text) {
        const start = textarea.selectionStart, end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
        textarea.focus();
        textarea.setSelectionRange(start + text.length, start + text.length);
    }

    function insertMarkdown(textarea, tag, placeholder, wrap = false) {
        const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
        insertAtCursor(textarea, wrap ? (selected ? tag + selected + tag : tag + placeholder + tag) : (selected ? tag + selected : tag + placeholder));
    }

    function insertList(textarea, prefix) {
        const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
        if (selected.includes('\n')) {
            const lines = selected.split('\n');
            insertAtCursor(textarea, lines.map(l => l.trim() ? prefix + l : l).join('\n'));
        } else {
            insertAtCursor(textarea, prefix + (selected || 'элемент'));
        }
    }

    function insertLink(textarea) {
        const url = prompt('URL:', 'https://');
        if (!url) return;
        const text = prompt('Текст ссылки:', 'ссылка');
        insertAtCursor(textarea, `[${text || 'ссылка'}](${url})`);
    }

    function insertImage(textarea) {
        const url = prompt('URL изображения:', 'https://');
        if (!url) return;
        const alt = prompt('Описание:', 'image');
        insertAtCursor(textarea, `![${alt || 'image'}](${url})`);
    }

    function insertYouTube(textarea) {
        const url = prompt('Ссылка на YouTube:', 'https://youtu.be/...');
        if (!url) return;
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
        if (match) {
            insertAtCursor(textarea, `\n<div class="youtube-embed"><iframe src="https://www.youtube.com/embed/${match[1]}" frameborder="0" allowfullscreen></iframe></div>\n`);
        } else {
            insertAtCursor(textarea, url);
        }
    }

    function insertSpoiler(textarea) {
        const summary = prompt('Заголовок спойлера:', 'Спойлер');
        if (summary === null) return;
        const content = prompt('Содержимое:', '');
        insertAtCursor(textarea, `\n<details><summary>${summary}</summary>\n\n${content || '...'}\n\n</details>\n`);
    }

    function insertTable(textarea) {
        const rows = prompt('Строк:', '3');
        const cols = prompt('Столбцов:', '2');
        if (!rows || !cols) return;
        let table = '\n';
        for (let i=0; i<parseInt(cols); i++) table += `| Заголовок ${i+1} `;
        table += '|\n';
        for (let i=0; i<parseInt(cols); i++) table += '|-------------';
        table += '|\n';
        for (let r=0; r<parseInt(rows); r++) {
            for (let c=0; c<parseInt(cols); c++) table += `| Ячейка ${r+1}-${c+1} `;
            table += '|\n';
        }
        insertAtCursor(textarea, table);
    }

    function insertCodeBlock(textarea) {
        const lang = prompt('Язык (например, javascript):', '');
        const code = prompt('Код:', '');
        if (code === null) return;
        insertAtCursor(textarea, `\n\`\`\`${lang}\n${code}\n\`\`\`\n`);
    }

    function insertProgressBar(textarea) {
        const percent = prompt('Процент (0-100):', '50');
        if (percent === null) return;
        insertAtCursor(textarea, `\n<div class="progress-bar"><div style="width: ${percent}%;">${percent}%</div></div>\n`);
    }

    function insertCard(textarea) {
        const title = prompt('Заголовок карточки:', 'Карточка');
        if (title === null) return;
        const content = prompt('Содержимое:', '');
        insertAtCursor(textarea, `\n<div class="custom-card"><h4>${title}</h4><p>${content || ''}</p></div>\n`);
    }

    function insertPoll(textarea) {
        const question = prompt('Вопрос:', 'Добавлять ли функцию?');
        if (question === null) return;
        const opts = prompt('Варианты через запятую:', 'Да, Нет, Возможно');
        if (!opts) return;
        const options = opts.split(',').map(s => s.trim()).filter(s => s);
        if (options.length === 0) return;
        if (options.length > 10) { alert('Максимум 10 вариантов'); options.splice(10); }
        insertAtCursor(textarea, `\n<!-- poll: ${JSON.stringify({ question, options })} -->\n`);
    }

    function insertIcon(textarea) {
        const icon = prompt('Название иконки (например, "fa-heart"):', 'fa-heart');
        if (!icon) return;
        insertAtCursor(textarea, `<i class="fas ${icon}"></i>`);
    }

    function insertColor(textarea, styleProp) {
        const color = prompt('Цвет (red, #ff0000):', 'red');
        if (!color) return;
        const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
        insertAtCursor(textarea, selected ? `<span style="${styleProp}: ${color};">${selected}</span>` : `<span style="${styleProp}: ${color};">текст</span>`);
    }

    function createEditorToolbar(textarea, options = {}) {
        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';
        const groups = {
            Форматирование: ['bold', 'italic', 'strikethrough'],
            Заголовки: ['h1', 'h2', 'h3'],
            Списки: ['ul', 'ol', 'quote'],
            Медиа: ['link', 'image', 'youtube'],
            Код: ['code', 'codeblock'],
            Блоки: ['spoiler', 'table', 'poll', 'progress', 'card'],
            Иконки: ['icon'],
            Цвет: ['color', 'bgcolor'],
            Доп: ['hr']
        };
        for (const [_, keys] of Object.entries(groups)) {
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
        return toolbar;
    }

    function createImageServicesMenu() {
        const container = document.createElement('div');
        container.className = 'image-services-menu';
        container.style.position = 'relative';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'image-services-btn';
        btn.innerHTML = '<i class="fas fa-images"></i> Хостинги';
        const dropdown = document.createElement('div');
        dropdown.className = 'preview-dropdown';
        dropdown.style.display = 'none';
        const services = [
            { name: 'Catbox', url: 'https://catbox.moe/', desc: 'До 200 МБ, анонимно' },
            { name: 'ImageBam', url: 'https://www.imagebam.com/upload?multi=1', desc: 'До 100 МБ' },
            { name: 'Postimages', url: 'https://postimages.org/', desc: 'До 32 МБ' },
            { name: 'ImgBB', url: 'https://imgbb.com/', desc: 'До 32 МБ' }
        ];
        services.forEach(s => {
            const item = document.createElement('button');
            item.innerHTML = `<strong>${s.name}</strong><br><small>${s.desc}</small>`;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                window.open(s.url, '_blank');
                dropdown.style.display = 'none';
            });
            dropdown.appendChild(item);
        });
        container.appendChild(btn);
        container.appendChild(dropdown);
        btn.addEventListener('click', (e) => { e.stopPropagation(); dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block'; });
        document.addEventListener('click', () => dropdown.style.display = 'none');
        return container;
    }

    // Ленивая загрузка marked при необходимости
    async function ensureMarked() {
        if (typeof marked !== 'undefined') return;
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    window.Editor = { TEMPLATES, createEditorToolbar, createImageServicesMenu, ensureMarked };
})();