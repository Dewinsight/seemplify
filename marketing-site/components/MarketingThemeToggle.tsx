'use client'

import { Moon, Sun } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type ThemePreference = 'light' | 'dark' | 'system'
type ResolvedTheme = Exclude<ThemePreference, 'system'>

const SHARED_THEME_STORAGE = 'seemplify-theme'
const SHARED_THEME_COOKIE = 'seemplify_theme'

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function readCookie(name: string) {
  const prefix = `${name}=`
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))

  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null
}

function readThemePreference(): ThemePreference {
  const sharedCookie = readCookie(SHARED_THEME_COOKIE)
  if (isThemePreference(sharedCookie)) return sharedCookie

  try {
    const sharedStorage = window.localStorage.getItem(SHARED_THEME_STORAGE)
    if (isThemePreference(sharedStorage)) return sharedStorage

    const legacyPreference =
      readCookie('theme') ||
      window.localStorage.getItem('theme') ||
      window.localStorage.getItem('themeMode')

    if (isThemePreference(legacyPreference)) return legacyPreference
  } catch {
    // Browsers can block storage in restricted contexts; the system theme remains safe.
  }

  return 'system'
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(preference: ThemePreference) {
  const resolved = resolveTheme(preference)
  const root = document.documentElement

  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.setAttribute('data-theme', resolved)
  root.style.colorScheme = resolved
  window.dispatchEvent(new CustomEvent('theme-change', { detail: resolved }))

  return resolved
}

function persistTheme(preference: ThemePreference) {
  try {
    window.localStorage.setItem(SHARED_THEME_STORAGE, preference)
  } catch {
    // The parent-domain cookie still carries the preference when storage is unavailable.
  }

  const sharedDomain =
    window.location.hostname === 'seemplifyai.com' ||
    window.location.hostname.endsWith('.seemplifyai.com')
  const domain = sharedDomain ? '; Domain=.seemplifyai.com' : ''
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''

  document.cookie = `${SHARED_THEME_COOKIE}=${encodeURIComponent(preference)}; Max-Age=31536000; Path=/; SameSite=Lax${domain}${secure}`
}

export default function MarketingThemeToggle() {
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')

  const syncTheme = useCallback(() => {
    setResolvedTheme(applyTheme(readThemePreference()))
  }, [])

  useEffect(() => {
    syncTheme()

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemChange = () => {
      if (readThemePreference() === 'system') syncTheme()
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SHARED_THEME_STORAGE || event.key === 'theme' || event.key === 'themeMode') {
        syncTheme()
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') syncTheme()
    }

    mediaQuery.addEventListener('change', handleSystemChange)
    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', syncTheme)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      mediaQuery.removeEventListener('change', handleSystemChange)
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('focus', syncTheme)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [syncTheme])

  const nextTheme: ResolvedTheme = resolvedTheme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      className="marketing-theme-toggle"
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      onClick={() => {
        persistTheme(nextTheme)
        setResolvedTheme(applyTheme(nextTheme))
      }}
    >
      {resolvedTheme === 'dark' ? (
        <Sun className="marketing-theme-toggle__icon" aria-hidden="true" />
      ) : (
        <Moon className="marketing-theme-toggle__icon" aria-hidden="true" />
      )}
      <span className="marketing-theme-toggle__label">{nextTheme} mode</span>
    </button>
  )
}
