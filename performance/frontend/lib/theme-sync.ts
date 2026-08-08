export type ThemePreference = 'light' | 'dark' | 'system';
export const SHARED_THEME_COOKIE = 'seemplify_theme';
export const SHARED_THEME_STORAGE = 'seemplify-theme';
const valid = (value: string | null): value is ThemePreference => value === 'light' || value === 'dark' || value === 'system';
const cookie = (name: string) => {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const value = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : null;
};
export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const value = cookie(SHARED_THEME_COOKIE) || localStorage.getItem(SHARED_THEME_STORAGE) || cookie('theme') || localStorage.getItem('theme') || localStorage.getItem('themeMode');
  return valid(value) ? value : 'system';
}
export function resolveThemePreference(preference: ThemePreference): 'light' | 'dark' {
  return preference === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
}
export function applyThemePreference(preference: ThemePreference) {
  const resolved = resolveThemePreference(preference);
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(resolved);
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
}
export function writeThemePreference(preference: ThemePreference) {
  localStorage.setItem(SHARED_THEME_STORAGE, preference);
  const shared = location.hostname === 'seemplifyai.com' || location.hostname.endsWith('.seemplifyai.com');
  document.cookie = `${SHARED_THEME_COOKIE}=${preference}; Max-Age=31536000; Path=/; SameSite=Lax${shared ? '; Domain=.seemplifyai.com' : ''}${location.protocol === 'https:' ? '; Secure' : ''}`;
  applyThemePreference(preference);
}
export const themeInitScript = `(function(){try{var v=function(x){return x==='light'||x==='dark'||x==='system'};var c=function(n){var p=n+'=',a=document.cookie.split(';');for(var i=0;i<a.length;i++){var s=a[i].trim();if(s.indexOf(p)===0)return decodeURIComponent(s.slice(p.length))}return null};var t=c('seemplify_theme')||localStorage.getItem('seemplify-theme')||c('theme')||localStorage.getItem('theme')||localStorage.getItem('themeMode');if(!v(t))t='system';localStorage.setItem('seemplify-theme',t);var r=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.classList.remove('light','dark');document.documentElement.classList.add(r);document.documentElement.setAttribute('data-theme',r);document.documentElement.style.colorScheme=r}catch(_){}})();`;
