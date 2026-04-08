// loader.js – обёртка над Core.loadScript / loadStylesheet
window.ScriptLoader = {
    load: (src, options) => Core.loadScript(src, options),
    loadStylesheet: (href) => Core.loadStylesheet(href),
    scripts: {
        marked: () => Core.loadScript('https://cdn.jsdelivr.net/npm/marked/marked.min.js'),
        itch: () => Core.loadScript('https://static.itch.io/api.js'),
        fontawesome: () => Core.loadStylesheet('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css')
    }
};