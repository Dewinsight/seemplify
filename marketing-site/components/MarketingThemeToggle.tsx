'use client'

import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  applyThemePreference,
  readThemePreference,
  SHARED_THEME_STORAGE,
  type ThemePreference,
  writeThemePreference,
} from '@/lib/theme-sync'

const options = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] satisfies Array<{ value: ThemePreference; label: string; icon: typeof Sun }>

export default function MarketingThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>('system')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  const syncTheme = useCallback(() => {
    const next = readThemePreference()
    setPreference(next)
    applyThemePreference(next)
  }, [])

  useEffect(() => {
    syncTheme()

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemChange = () => {
      if (readThemePreference() === 'system') applyThemePreference('system')
    }
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === SHARED_THEME_STORAGE ||
        event.key === 'seemplify-theme' ||
        event.key === 'theme' ||
        event.key === 'themeMode'
      ) {
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

  useEffect(() => {
    if (!open) return
    selectedRef.current?.focus()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        containerRef.current?.querySelector<HTMLButtonElement>('[data-theme-trigger]')?.focus()
      }
    }
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOutside)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOutside)
    }
  }, [open])

  const CurrentIcon = options.find((option) => option.value === preference)?.icon ?? Monitor

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    )
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = current

    if (event.key === 'ArrowDown') next = (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return

    items[next]?.focus()
    event.preventDefault()
  }

  return (
    <div className="marketing-theme-picker" ref={containerRef}>
      <button
        type="button"
        className="marketing-theme-toggle"
        data-theme-trigger
        aria-label={`Appearance: ${preference}. Choose a theme`}
        aria-haspopup="menu"
        aria-controls="marketing-theme-menu"
        aria-expanded={open}
        title={`Appearance: ${preference}`}
        onClick={() => setOpen((value) => !value)}
      >
        <CurrentIcon className="marketing-theme-toggle__icon" aria-hidden="true" />
      </button>

      {open ? (
        <div
          id="marketing-theme-menu"
          className="marketing-theme-menu"
          role="menu"
          aria-label="Appearance"
          onKeyDown={handleMenuKeyDown}
        >
          {options.map(({ value, label, icon: Icon }) => {
            const selected = preference === value
            return (
              <button
                key={value}
                ref={selected ? selectedRef : undefined}
                type="button"
                className="marketing-theme-menu__option"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  writeThemePreference(value)
                  setPreference(value)
                  setOpen(false)
                  window.requestAnimationFrame(() => {
                    containerRef.current
                      ?.querySelector<HTMLButtonElement>('[data-theme-trigger]')
                      ?.focus()
                  })
                }}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
                {selected ? <Check className="marketing-theme-menu__check" aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
