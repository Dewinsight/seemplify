/**
 * Theme Manager for Identity Provider
 * Handles persistence to localStorage/Cookies, system preference syncing,
 * and cross-tab synchronization.
 */
(function () {
    const STORAGE_KEY = 'seemplify-theme';
    const COOKIE_KEY = 'seemplify_theme';
    const VALID_THEMES = ['light', 'dark', 'system'];

    function getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
        }
        return null;
    }

    function setCookie(name, value, days) {
        let expires = "";
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toUTCString();
        }
        const sharedDomain = location.hostname === 'seemplifyai.com' || location.hostname.endsWith('.seemplifyai.com');
        const domain = sharedDomain ? '; Domain=.seemplifyai.com' : '';
        const secure = location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = name + "=" + encodeURIComponent(value || "") + expires + "; path=/; SameSite=Lax" + domain + secure;
    }

    function getTheme() {
        // 1. Check cookie (shared preference)
        const cookieTheme = getCookie(COOKIE_KEY);
        if (cookieTheme && VALID_THEMES.includes(cookieTheme)) {
            return cookieTheme;
        }
        // 2. Check local storage (fallback)
        try {
            const local = localStorage.getItem(STORAGE_KEY);
            if (local && VALID_THEMES.includes(local)) {
                return local;
            }
            const legacy = getCookie('theme') || localStorage.getItem('theme') || localStorage.getItem('themeMode');
            if (legacy && VALID_THEMES.includes(legacy)) return legacy;
        } catch (e) { }
        // 3. Default to system
        return 'system';
    }

    function getSystemTheme() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        const root = document.documentElement;
        const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;

        // Apply data attribute for CSS
        if (root.getAttribute('data-theme') !== resolvedTheme) {
            root.setAttribute('data-theme', resolvedTheme);
        }

        // Also toggle a class if needed (optional, using data-theme mainly)
        if (document.body) {
            if (resolvedTheme === 'light') {
                document.body.classList.add('light');
                document.body.classList.remove('dark');
            } else {
                document.body.classList.add('dark');
                document.body.classList.remove('light');
            }
        }

        // Dispatch event for other listeners
        window.dispatchEvent(new CustomEvent('theme-change', { detail: resolvedTheme }));
    }

    // Run immediately to prevent flash
    const current = getTheme();
    applyTheme(current);

    // Initialize UI when DOM is ready
    function initUI() {
        applyTheme(current); // Ensure body classes are set once DOM is waiting
        updateToggleUI(current);

        // Setup dropdown listeners
        document.addEventListener('click', (e) => {
            const dropdown = document.querySelector('.theme-dropdown');
            if (dropdown && !dropdown.contains(e.target)) {
                const menu = document.getElementById('theme-menu');
                if (menu) menu.classList.remove('show');
            }
        });

        // Listen for View Transitions (smooth nav)
        if (document.startViewTransition) {
            // This is handled by the browser for MPA if we opt-in via CSS or meta
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        initUI();
    }

    // Public API
    window.ThemeManager = {
        setTheme: function (theme) {
            if (!VALID_THEMES.includes(theme)) return;
            setCookie(COOKIE_KEY, theme, 365);
            localStorage.setItem(STORAGE_KEY, theme);
            applyTheme(theme);
            updateToggleUI(theme);
            const menu = document.getElementById('theme-menu');
            if (menu) menu.classList.remove('show');
        },
        toggleDropdown: function (event) {
            if (event) {
                event.stopPropagation();
                event.preventDefault();
            }
            const menu = document.getElementById('theme-menu');
            if (menu) menu.classList.toggle('show');
        },
        getTheme: getTheme
    };

    function updateToggleUI(currentTheme) {
        const activeItems = document.querySelectorAll('.theme-option');
        activeItems.forEach(item => {
            if (item.dataset.value === currentTheme) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        const lightIcon = document.querySelector('.theme-toggle-icon-light');
        const darkIcon = document.querySelector('.theme-toggle-icon-dark');
        const resolved = currentTheme === 'system' ? getSystemTheme() : currentTheme;

        if (lightIcon && darkIcon) {
            if (resolved === 'light') {
                lightIcon.style.display = 'none';
                darkIcon.style.display = 'block';
            } else {
                lightIcon.style.display = 'block';
                darkIcon.style.display = 'none';
            }
        }
    }

    // Re-read the parent-domain preference after returning from another product.
    function syncSharedPreference() {
        const sharedTheme = getTheme();
        applyTheme(sharedTheme);
        updateToggleUI(sharedTheme);
    }
    window.addEventListener('focus', syncSharedPreference);
    document.addEventListener('visibilitychange', syncSharedPreference);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncSharedPreference);
})();
