/**
 * Theme Manager for Identity Provider
 * Handles persistence to localStorage, system preference syncing,
 * and cross-tab synchronization.
 */
(function () {
    console.log("Theme Manager script starting...");
    const STORAGE_KEY = 'theme'; // Matches Next.js next-themes key

    function getTheme() {
        // 1. Check local storage
        const local = localStorage.getItem(STORAGE_KEY);
        if (local && ['light', 'dark', 'system'].includes(local)) {
            return local;
        }
        // 2. Default to system
        return 'system';
    }

    function getSystemTheme() {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function applyTheme(theme) {
        const root = document.documentElement;
        const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;

        // Apply data attribute for CSS
        root.setAttribute('data-theme', resolvedTheme);

        // Also toggle a class if needed (optional, using data-theme mainly)
        if (resolvedTheme === 'light') {
            document.body.classList.add('light');
            document.body.classList.remove('dark');
        } else {
            document.body.classList.add('dark');
            document.body.classList.remove('light');
        }

        // Update active state in UI if it exists
        updateToggleUI(theme);
    }

    function setTheme(theme) {
        localStorage.setItem(STORAGE_KEY, theme);
        applyTheme(theme);
        closeDropdown();
    }

    function updateToggleUI(currentTheme) {
        // Update active state in dropdown
        const activeItems = document.querySelectorAll('.theme-option');
        activeItems.forEach(item => {
            if (item.dataset.value === currentTheme) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Update toggle icon visibility (Sun/Moon)
        const lightIcon = document.querySelector('.theme-toggle-icon-light');
        const darkIcon = document.querySelector('.theme-toggle-icon-dark');

        // Resolve system to actual preference for the icon
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

    function toggleDropdown(event) {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        console.log('Theme toggle clicked');

        // Use relative lookup to avoid ID issues
        const button = event.currentTarget;
        const dropdown = button.closest('.theme-dropdown');
        const menu = dropdown ? dropdown.querySelector('.theme-menu') : document.getElementById('theme-menu');

        if (menu) {
            console.log('Menu found, toggling show class');
            menu.classList.toggle('show');
        } else {
            console.error('Theme menu not found');
        }
    }

    function closeDropdown() {
        const menu = document.getElementById('theme-menu');
        if (menu) {
            menu.classList.remove('show');
        }
    }

    // Initial load
    const current = getTheme();
    applyTheme(current);

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const dropdown = document.querySelector('.theme-dropdown');
        if (dropdown && !dropdown.contains(e.target)) {
            closeDropdown();
        }
    });

    // Expose to window for UI interactions
    window.ThemeManager = {
        setTheme,
        getTheme,
        toggleDropdown,
        closeDropdown,
        toggle: () => {
            const now = getTheme();
            const next = now === 'dark' ? 'light' : 'dark';
            setTheme(next);
        }
    };

    // Listen for system changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (getTheme() === 'system') {
            applyTheme('system');
        }
    });

    // Listen for storage changes (other tabs/apps)
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) {
            applyTheme(getTheme());
        }
    });
})();
