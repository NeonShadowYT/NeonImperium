// editor-toolbar.js – панель инструментов Markdown
(function() {
    function createImageServicesMenu() {
        const container = document.createElement('div');
        container.className = 'image-services-menu';
        container.style.position = 'relative';
        container.style.display = 'inline-block';
        
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'editor-btn';
        btn.innerHTML = '<i class="fas fa-image"></i> Изображение';
        btn.style.padding = '6px 12px';
        
        const dropdown = document.createElement('div');
        dropdown.className = 'preview-dropdown';
        dropdown.style.position = 'absolute';
        dropdown.style.top = '100%';
        dropdown.style.left = '0';
        dropdown.style.minWidth = '160px';
        dropdown.style.background = 'var(--bg-card)';
        dropdown.style.border = '1px solid var(--border)';
        dropdown.style.borderRadius = '12px';
        dropdown.style.padding = '5px 0';
        dropdown.style.display = 'none';
        dropdown.style.zIndex = '1000';
        
        const services = [
            { name: 'Загрузить файл', action: 'upload' },
            { name: 'Imgur', url: 'https://imgur.com/upload' },
            { name: 'PostImages', url: 'https://postimages.org/' },
            { name: 'FreeImage.host', url: 'https://freeimage.host/' }
        ];
        
        services.forEach(service => {
            const item = document.createElement('button');
            item.type = 'button';
            item.textContent = service.name;
            item.style.display = 'block';
            item.style.width = '100%';
            item.style.padding = '8px 16px';
            item.style.textAlign = 'left';
            item.style.background = 'none';
            item.style.border = 'none';
            item.style.color = 'var(--text-primary)';
            item.style.cursor = 'pointer';
            if (service.action === 'upload') {
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = 'image/*';
                fileInput.style.display = 'none';
                fileInput.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const url = URL.createObjectURL(file);
                    const textarea = document.activeElement?.closest('.feedback-textarea') || document.querySelector('.feedback-textarea');
                    if (textarea) {
                        const start = textarea.selectionStart;
                        const end = textarea.selectionEnd;
                        const text = textarea.value;
                        const newText = text.substring(0, start) + `![${file.name}](${url})` + text.substring(end);
                        textarea.value = newText;
                        textarea.dispatchEvent(new Event('input'));
                    }
                    dropdown.style.display = 'none';
                });
                document.body.appendChild(fileInput);
                item.addEventListener('click', () => {
                    fileInput.click();
                    dropdown.style.display = 'none';
                });
            } else {
                item.addEventListener('click', () => {
                    window.open(service.url, '_blank');
                    dropdown.style.display = 'none';
                });
            }
            dropdown.appendChild(item);
        });
        
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        });
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) dropdown.style.display = 'none';
        });
        
        container.appendChild(btn);
        container.appendChild(dropdown);
        return container;
    }
    
    function createEditorToolbar(textarea, options = {}) {
        const toolbar = document.createElement('div');
        toolbar.className = 'editor-toolbar';
        toolbar.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; padding: 8px; background: var(--bg-inner-gradient); border-radius: 12px;';
        
        const buttons = [
            { icon: 'fas fa-bold', action: () => wrapText('**', '**'), hint: 'Жирный' },
            { icon: 'fas fa-italic', action: () => wrapText('*', '*'), hint: 'Курсив' },
            { icon: 'fas fa-heading', action: () => wrapText('# ', ''), hint: 'Заголовок' },
            { icon: 'fas fa-link', action: () => insertLink(), hint: 'Ссылка' },
            { icon: 'fas fa-list-ul', action: () => wrapText('- ', ''), hint: 'Список' },
            { icon: 'fas fa-list-ol', action: () => wrapText('1. ', ''), hint: 'Нумерованный список' },
            { icon: 'fas fa-code', action: () => wrapText('`', '`'), hint: 'Код' },
            { icon: 'fas fa-quote-right', action: () => wrapText('> ', ''), hint: 'Цитата' },
            { icon: 'fas fa-image', action: () => insertImage(), hint: 'Изображение' }
        ];
        
        function wrapText(open, close) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const selected = textarea.value.substring(start, end);
            const newText = textarea.value.substring(0, start) + open + selected + close + textarea.value.substring(end);
            textarea.value = newText;
            textarea.focus();
            textarea.setSelectionRange(start + open.length, end + open.length);
            textarea.dispatchEvent(new Event('input'));
        }
        
        function insertLink() {
            const url = prompt('Введите URL:', 'https://');
            if (url) {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const selected = textarea.value.substring(start, end) || 'текст';
                const newText = textarea.value.substring(0, start) + `[${selected}](${url})` + textarea.value.substring(end);
                textarea.value = newText;
                textarea.focus();
                textarea.setSelectionRange(start + selected.length + url.length + 3, start + selected.length + url.length + 3);
                textarea.dispatchEvent(new Event('input'));
            }
        }
        
        function insertImage() {
            const url = prompt('Введите URL изображения:', 'https://');
            if (url) {
                const alt = prompt('Альтернативный текст:', 'изображение');
                const start = textarea.selectionStart;
                const newText = textarea.value.substring(0, start) + `![${alt || ''}](${url})` + textarea.value.substring(start);
                textarea.value = newText;
                textarea.focus();
                textarea.setSelectionRange(start + (alt?.length || 0) + url.length + 5, start + (alt?.length || 0) + url.length + 5);
                textarea.dispatchEvent(new Event('input'));
            }
        }
        
        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'editor-btn';
            button.innerHTML = `<i class="${btn.icon}"></i>`;
            button.title = btn.hint;
            button.style.padding = '6px 12px';
            button.style.borderRadius = '8px';
            button.addEventListener('click', btn.action);
            toolbar.appendChild(button);
        });
        
        if (options.preview !== false) {
            const previewBtn = document.createElement('button');
            previewBtn.type = 'button';
            previewBtn.className = 'editor-btn';
            previewBtn.innerHTML = '<i class="fas fa-eye"></i>';
            previewBtn.title = 'Предпросмотр';
            previewBtn.addEventListener('click', () => {
                if (options.onPreview) options.onPreview();
            });
            toolbar.appendChild(previewBtn);
        }
        
        const imageServices = createImageServicesMenu();
        toolbar.appendChild(imageServices);
        
        return toolbar;
    }
    
    window.EditorToolbar = {
        createEditorToolbar,
        createImageServicesMenu
    };
})();