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

export function syncThemeToCookie(preference: string): void {
  if (isThemePreference(preference)) writeThemePreference(preference);
}

export const themeInitScript = `(function(){try{var valid=function(v){return v==='light'||v==='dark'||v==='system'};var readCookie=function(n){try{var p=n+'=',a=document.cookie.split(';');for(var i=0;i<a.length;i++){var s=a[i].trim();if(s.indexOf(p)===0)return decodeURIComponent(s.slice(p.length))}}catch(_){}return null};var readStore=function(k){try{return localStorage.getItem(k)}catch(_){return null}};var preference=readCookie('seemplify_theme');if(!valid(preference)){var candidates=[readStore('seemplify_theme'),readStore('seemplify-theme'),readCookie('theme'),readStore('theme'),readStore('themeMode')];preference='system';for(var i=0;i<candidates.length;i++){if(valid(candidates[i])){preference=candidates[i];break}}try{localStorage.setItem('seemplify_theme',preference)}catch(_){}try{var h=location.hostname,shared=h==='seemplifyai.com'||h.endsWith('.seemplifyai.com');document.cookie='seemplify_theme='+encodeURIComponent(preference)+'; Max-Age=31536000; Path=/; SameSite=Lax'+(shared?'; Domain=.seemplifyai.com':'')+(location.protocol==='https:'?'; Secure':'')}catch(_){}}else{try{localStorage.setItem('seemplify_theme',preference)}catch(_){}}var resolved=preference==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):preference;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);root.setAttribute('data-theme-preference',preference);root.setAttribute('data-theme',resolved);root.style.colorScheme=resolved}catch(_){var root=document.documentElement;root.setAttribute('data-theme-preference','system');root.setAttribute('data-theme',matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}})();`;
