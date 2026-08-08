export type ThemePreference = 'light' | 'dark' | 'system';

export const SHARED_THEME_COOKIE = 'seemplify_theme';
export const SHARED_THEME_STORAGE = 'seemplify-theme';

const isThemePreference = (value: string | null): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const value = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : null;
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const sharedCookie = getCookie(SHARED_THEME_COOKIE);
  if (isThemePreference(sharedCookie)) return sharedCookie;

  const sharedStorage = localStorage.getItem(SHARED_THEME_STORAGE);
  if (isThemePreference(sharedStorage)) return sharedStorage;

  // One-time migration from the keys previously used by the individual apps.
  const legacyCookie = getCookie('theme');
  if (isThemePreference(legacyCookie)) return legacyCookie;
  const legacyStorage = localStorage.getItem('theme') || localStorage.getItem('themeMode');
  return isThemePreference(legacyStorage) ? legacyStorage : 'system';
}

export function writeThemePreference(theme: ThemePreference): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SHARED_THEME_STORAGE, theme);
  const onSharedDomain = location.hostname === 'seemplifyai.com' || location.hostname.endsWith('.seemplifyai.com');
  const domain = onSharedDomain ? '; Domain=.seemplifyai.com' : '';
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${SHARED_THEME_COOKIE}=${theme}; Max-Age=31536000; Path=/; SameSite=Lax${domain}${secure}`;
}

export function syncThemeToCookie(theme: string): void {
  if (isThemePreference(theme)) writeThemePreference(theme);
}

export const themeInitScript = `
(function () {
  try {
    var valid = function (value) { return value === 'light' || value === 'dark' || value === 'system'; };
    var cookie = function (name) {
      var prefix = name + '=';
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        if (part.indexOf(prefix) === 0) return decodeURIComponent(part.slice(prefix.length));
      }
      return null;
    };
    var preference = cookie('seemplify_theme');
    if (!valid(preference)) preference = localStorage.getItem('seemplify-theme');
    if (!valid(preference)) preference = cookie('theme');
    if (!valid(preference)) preference = localStorage.getItem('theme') || localStorage.getItem('themeMode');
    if (!valid(preference)) preference = 'system';
    localStorage.setItem('seemplify-theme', preference);
    var resolved = preference === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : preference;
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(resolved);
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.style.colorScheme = resolved;
  } catch (_) {}
})();`;
