/**
 * Theme Sync Utilities
 * Enables cross-app theme sharing via cookies
 */

const THEME_COOKIE_NAME = 'theme';
const THEME_STORAGE_KEY = 'theme';

/**
 * Get a cookie value by name
 */
export function getCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;

    const nameEQ = name + '=';
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

/**
 * Set a cookie with optional expiry
 */
export function setCookie(name: string, value: string, days: number = 365): void {
    if (typeof document === 'undefined') return;

    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    const expires = '; expires=' + date.toUTCString();
    document.cookie = name + '=' + (value || '') + expires + '; path=/; SameSite=Lax';
}

/**
 * Get the theme from cookie, falling back to localStorage
 */
export function getThemeFromCookie(): string | null {
    // First check cookie (shared across apps)
    const cookieTheme = getCookie(THEME_COOKIE_NAME);
    if (cookieTheme && ['light', 'dark', 'system'].includes(cookieTheme)) {
        return cookieTheme;
    }

    // Fallback to localStorage
    if (typeof localStorage !== 'undefined') {
        const localTheme = localStorage.getItem(THEME_STORAGE_KEY);
        if (localTheme && ['light', 'dark', 'system'].includes(localTheme)) {
            return localTheme;
        }
    }

    return null;
}

/**
 * Sync theme to cookie (call this when theme changes)
 */
export function syncThemeToCookie(theme: string): void {
    setCookie(THEME_COOKIE_NAME, theme, 365);
}

/**
 * Sync cookie theme to localStorage (for next-themes compatibility)
 */
export function syncCookieToLocalStorage(): void {
    const cookieTheme = getCookie(THEME_COOKIE_NAME);
    if (cookieTheme && typeof localStorage !== 'undefined') {
        const currentLocal = localStorage.getItem(THEME_STORAGE_KEY);
        if (currentLocal !== cookieTheme) {
            localStorage.setItem(THEME_STORAGE_KEY, cookieTheme);
        }
    }
}

/**
 * Blocking script content to inject in <head>
 * This runs before React hydration to prevent FOUC
 */
export const themeInitScript = `
(function() {
  try {
    var COOKIE_NAME = 'theme';
    var STORAGE_KEY = 'theme';
    
    function getCookie(name) {
      var nameEQ = name + '=';
      var ca = document.cookie.split(';');
      for (var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
      }
      return null;
    }
    
    function getSystemTheme() {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    
    // Get theme from cookie or localStorage
    var theme = getCookie(COOKIE_NAME);
    if (!theme || !['light', 'dark', 'system'].includes(theme)) {
      theme = localStorage.getItem(STORAGE_KEY);
    }
    if (!theme || !['light', 'dark', 'system'].includes(theme)) {
      theme = 'system';
    }
    
    // Sync cookie to localStorage for next-themes
    if (theme) {
      localStorage.setItem(STORAGE_KEY, theme);
    }
    
    // Resolve system theme
    var resolved = theme === 'system' ? getSystemTheme() : theme;
    
    // Apply theme immediately
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(resolved);
    document.documentElement.style.colorScheme = resolved;
  } catch (e) {}
})();
`;
