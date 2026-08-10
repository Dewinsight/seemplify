export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export const SHARED_THEME_COOKIE = 'seemplify_theme';
export const SHARED_THEME_STORAGE = 'seemplify_theme';
export const LEGACY_THEME_STORAGE = 'seemplify-theme';

const isThemePreference = (value: string | null): value is ThemePreference =>
  value === 'light' || value === 'dark' || value === 'system';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const prefix = `${name}=`;
    const entry = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix));
    return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
  } catch {
    return null;
  }
}

function cookieAttributes(maxAge = 31_536_000): string {
  const sharedDomain =
    location.hostname === 'seemplifyai.com' || location.hostname.endsWith('.seemplifyai.com');
  return `Max-Age=${maxAge}; Path=/; SameSite=Lax${
    sharedDomain ? '; Domain=.seemplifyai.com' : ''
  }${location.protocol === 'https:' ? '; Secure' : ''}`;
}

function persistCookie(preference: ThemePreference): void {
  try {
    document.cookie = `${SHARED_THEME_COOKIE}=${encodeURIComponent(preference)}; ${cookieAttributes()}`;
  } catch {
    // Storage remains a same-origin fallback when cookies are unavailable.
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persistStorage(preference: ThemePreference): void {
  try {
    localStorage.setItem(SHARED_THEME_STORAGE, preference);
  } catch {
    // The shared first-party cookie remains the cross-subdomain source of truth.
  }
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';

  const cookiePreference = readCookie(SHARED_THEME_COOKIE);
  if (isThemePreference(cookiePreference)) {
    persistStorage(cookiePreference);
    return cookiePreference;
  }

  const candidates = [
    readStorage(SHARED_THEME_STORAGE),
    readStorage(LEGACY_THEME_STORAGE),
    readCookie('theme'),
    readStorage('theme'),
    readStorage('themeMode'),
  ];
  const migrated = candidates.find(isThemePreference) ?? 'system';
  persistStorage(migrated);
  persistCookie(migrated);
  return migrated;
}

export function resolveThemePreference(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveThemePreference(preference);
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
  root.dataset.themePreference = preference;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  window.dispatchEvent(new CustomEvent('seemplify-theme-change', {
    detail: { preference, resolved },
  }));
  window.dispatchEvent(new CustomEvent('theme-change', { detail: resolved }));
  return resolved;
}

export function writeThemePreference(preference: ThemePreference): ResolvedTheme {
  if (typeof window === 'undefined') return preference === 'dark' ? 'dark' : 'light';
  persistStorage(preference);
  persistCookie(preference);
  return applyThemePreference(preference);
}
