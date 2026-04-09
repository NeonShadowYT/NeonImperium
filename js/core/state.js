// js/core/state.js
(function() {
    const state = {
        currentUser: null,
        language: localStorage.getItem('preferredLanguage') || 'ru',
        token: localStorage.getItem('github_token') || null
    };

    const listeners = {};
    const eventTarget = new EventTarget();

    function setState(key, value) {
        if (state[key] === value) return;
        state[key] = value;
        if (listeners[key]) {
            listeners[key].forEach(fn => fn(value));
        }
        eventTarget.dispatchEvent(new CustomEvent(`state:${key}`, { detail: value }));
    }

    function getState(key) {
        return state[key];
    }

    function subscribe(key, callback) {
        if (!listeners[key]) listeners[key] = [];
        listeners[key].push(callback);
    }

    function on(eventName, callback) {
        eventTarget.addEventListener(eventName, callback);
    }

    function off(eventName, callback) {
        eventTarget.removeEventListener(eventName, callback);
    }

    function emit(eventName, detail) {
        eventTarget.dispatchEvent(new CustomEvent(eventName, { detail }));
    }

    // Инициализация пользователя
    (async function initUser() {
        const cachedUser = sessionStorage.getItem('github_user');
        if (cachedUser) {
            try {
                const user = JSON.parse(cachedUser);
                setState('currentUser', user.login);
            } catch (e) {}
        }
        if (state.token) {
            NeonAPI.getCurrentGitHubUser().then(user => {
                if (user && user.login) {
                    setState('currentUser', user.login);
                    sessionStorage.setItem('github_user', JSON.stringify(user));
                }
            }).catch(() => {});
        }
    })();

    window.NeonState = { setState, getState, subscribe, on, off, emit };
})();