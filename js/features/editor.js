// js/features/editor.js – тулбар редактора с интеграцией в UIFeedback
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

    const { createElement, escapeHtml } = window.GithubCore;

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

    async function insertLink(textarea) {
        const url = await window.Dialog.showPrompt({
            title: 'Ссылка',
            message: 'Введите URL:',
            defaultValue: 'https://',
            placeholder: 'https://example.com',
            validate: (v) => v.trim().length > 0 || 'URL не может быть пустым'
        });
        if (url === null) return;
        const text = await window.Dialog.showPrompt({
            title: 'Ссылка',
            message: 'Введите текст ссылки:',
            defaultValue: 'ссылка'
        });
        if (text === null) return;
        insertAtCursor(textarea, `[${text || 'ссылка'}](${url})`);
    }

    async function insertImage(textarea) {
        const url = await window.Dialog.showPrompt({
            title: 'Изображение',
            message: 'Введите URL изображения:',
            defaultValue: 'https://',
            placeholder: 'https://example.com/image.png',
            validate: (v) => v.trim().length > 0 || 'URL не может быть пустым'
        });
        if (url === null) return;
        const alt = await window.Dialog.showPrompt({
            title: 'Изображение',
            message: 'Введите описание изображения:',
            defaultValue: 'image'
        });
        if (alt === null) return;
        insertAtCursor(textarea, `![${alt || 'image'}](${url})`);
    }

    async function insertYouTube(textarea) {
        const url = await window.Dialog.showPrompt({
            title: 'YouTube',
            message: 'Введите ссылку на YouTube видео:',
            defaultValue: 'https://www.youtube.com/watch?v=',
            placeholder: 'https://youtu.be/...'
        });
        if (!url) return;
        let videoId = '';
        const patterns = [/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/, /youtube\.com\/embed\/([^&\n?#]+)/];
        for (const p of patterns) {
            const match = url.match(p);
            if (match) { videoId = match[1]; break; }
        }
        if (videoId) {
            const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?origin=${encodeURIComponent(location.origin)}`;
            insertAtCursor(textarea, `\n<div class="youtube-embed"><iframe src="${embedUrl}" frameborder="0" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>\n`);
        } else {
            insertAtCursor(textarea, url);
        }
    }

    async function insertSpoiler(textarea) {
        const summary = await window.Dialog.showPrompt({
            title: 'Спойлер',
            message: 'Заголовок спойлера:',
            defaultValue: 'Спойлер'
        });
        if (summary === null) return;
        const content = await window.Dialog.showPrompt({
            title: 'Спойлер',
            message: 'Содержимое спойлера:',
            multiline: true,
            placeholder: '...'
        });
        if (content === null) return;
        insertAtCursor(textarea, `\n<details><summary>${escapeHtml(summary)}</summary>\n\n${escapeHtml(content) || '...'}\n\n</details>\n`);
    }

    async function insertTable(textarea) {
        const rowsStr = await window.Dialog.showPrompt({
            title: 'Таблица',
            message: 'Количество строк:',
            defaultValue: '3',
            validate: (v) => /^\d+$/.test(v.trim()) && parseInt(v, 10) > 0 || 'Введите положительное число'
        });
        if (rowsStr === null) return;
        const colsStr = await window.Dialog.showPrompt({
            title: 'Таблица',
            message: 'Количество столбцов:',
            defaultValue: '2',
            validate: (v) => /^\d+$/.test(v.trim()) && parseInt(v, 10) > 0 || 'Введите положительное число'
        });
        if (colsStr === null) return;
        const rows = parseInt(rowsStr, 10);
        const cols = parseInt(colsStr, 10);
        let table = '\n';
        for (let i = 0; i < cols; i++) table += `| Заголовок ${i+1} `;
        table += '|\n';
        for (let i = 0; i < cols; i++) table += '|-------------';
        table += '|\n';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) table += `| Ячейка ${r+1}-${c+1} `;
            table += '|\n';
        }
        insertAtCursor(textarea, table);
    }

    async function insertCodeBlock(textarea) {
        const lang = await window.Dialog.showPrompt({
            title: 'Блок кода',
            message: 'Язык (например, javascript):',
            defaultValue: '',
            placeholder: 'javascript'
        });
        if (lang === null) return;
        const code = await window.Dialog.showPrompt({
            title: 'Блок кода',
            message: 'Введите код:',
            multiline: true,
            placeholder: '...'
        });
        if (code === null) return;
        insertAtCursor(textarea, `\n\`\`\`${lang}\n${code}\n\`\`\`\n`);
    }

    async function insertProgressBar(textarea) {
        const percent = await window.Dialog.showPrompt({
            title: 'Прогресс-бар',
            message: 'Введите процент заполнения (0-100):',
            defaultValue: '50',
            validate: (v) => {
                const n = parseInt(v, 10);
                return (!isNaN(n) && n >= 0 && n <= 100) || 'Введите число от 0 до 100';
            }
        });
        if (percent === null) return;
        insertAtCursor(textarea, `\n<div class="progress-bar"><div style="width: ${percent}%; text-align: center; line-height: 24px;">${percent}%</div></div>\n`);
    }

    async function insertCard(textarea) {
        const title = await window.Dialog.showPrompt({
            title: 'Карточка',
            message: 'Заголовок карточки:',
            defaultValue: 'Карточка'
        });
        if (title === null) return;
        const content = await window.Dialog.showPrompt({
            title: 'Карточка',
            message: 'Содержимое карточки:',
            multiline: true
        });
        if (content === null) return;
        insertAtCursor(textarea, `\n<div class="custom-card"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(content) || ''}</p></div>\n`);
    }

    async function insertPoll(textarea) {
        const question = await window.Dialog.showPrompt({
            title: 'Опрос',
            message: 'Вопрос опроса:',
            defaultValue: 'Добавлять ли новую функцию?'
        });
        if (question === null) return;
        const optionsInput = await window.Dialog.showPrompt({
            title: 'Опрос',
            message: 'Введите варианты через запятую (макс. 10):',
            defaultValue: 'Да, Нет, Возможно',
            multiline: true
        });
        if (!optionsInput) return;
        const options = optionsInput.split(',').map(s => s.trim()).filter(s => s);
        if (options.length === 0) return;
        if (options.length > 10) {
            await window.Dialog.showAlert({
                title: 'Опрос',
                message: 'Слишком много вариантов. Будет использовано только первые 10.',
                type: 'info'
            });
            options.splice(10);
        }
        insertAtCursor(textarea, `\n<!-- poll: ${JSON.stringify({ question, options })} -->\n`);
    }

    async function insertIcon(textarea) {
        const icon = await window.Dialog.showPrompt({
            title: 'Иконка',
            message: 'Введите название иконки Font Awesome (например, "fa-heart"):',
            defaultValue: 'fa-heart'
        });
        if (!icon) return;
        insertAtCursor(textarea, `<i class="fas ${icon}"></i>`);
    }

    async function insertColor(textarea, styleProp) {
        const color = await window.Dialog.showPrompt({
            title: 'Цвет',
            message: 'Введите цвет (например, red, #ff0000):',
            defaultValue: 'red'
        });
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
                btn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    try {
                        await tpl.action(textarea);
                    } catch (err) {
                        console.warn('[Editor] action error:', err);
                    }
                });
                group.appendChild(btn);
            });
            toolbar.appendChild(group);
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