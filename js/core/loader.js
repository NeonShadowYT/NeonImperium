const loadedScripts = new Set();

function loadScript(src, options = {}) {
    return new Promise((resolve, reject) => {
        if (loadedScripts.has(src)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = options.async !== false;
        script.defer = options.defer !== false;
        if (options.integrity) script.integrity = options.integrity;
        if (options.crossorigin) script.crossOrigin = options.crossorigin;
        script.onload = () => {
            loadedScripts.add(src);
            resolve();
        };
        script.onerror = () => {
            reject(new Error(`Failed to load script: ${src}`));
        };
        document.head.appendChild(script);
    });
}

function loadStylesheet(href) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`link[href="${href}"]`)) {
            resolve();
            return;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = resolve;
        link.onerror = reject;
        document.head.appendChild(link);
    });
}

const SCRIPTS = {
    marked: () => loadScript('https://cdn.jsdelivr.net/npm/marked/marked.min.js'),
    itch: () => loadScript('https://static.itch.io/api.js'),
    fontawesome: () => loadStylesheet('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css')
};

window.ScriptLoader = {
    load: loadScript,
    loadStylesheet,
    scripts: SCRIPTS
};