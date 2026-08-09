import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  applyThemePreference,
  readThemePreference,
  SHARED_THEME_STORAGE,
  type ThemePreference,
  writeThemePreference
} from '@/lib/theme'

const options = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon }
] satisfies Array<{ value: ThemePreference; label: string; icon: typeof Sun }>

export function ThemePreferenceMenu() {
  const [preference, setPreference] = useState<ThemePreference>('system')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  const sync = useCallback(() => {
    const next = readThemePreference()
    setPreference(next)
    applyThemePreference(next)
  }, [])

  useEffect(() => {
    sync()
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemChange = () => {
      if (readThemePreference() === 'system') applyThemePreference('system')
    }
    const onStorage = (event: StorageEvent) => {
      if ([SHARED_THEME_STORAGE, 'seemplify-theme', 'theme', 'themeMode'].includes(event.key || '')) sync()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sync()
    }
    media.addEventListener('change', onSystemChange)
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      media.removeEventListener('change', onSystemChange)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [sync])

  useEffect(() => {
    if (!open) return
    selectedRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = current
    if (event.key === 'ArrowDown') next = (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'Escape') {
      setOpen(false)
      rootRef.current?.querySelector<HTMLButtonElement>('[data-theme-trigger]')?.focus()
      event.preventDefault()
      return
    } else return
    items[next]?.focus()
    event.preventDefault()
  }

  const CurrentIcon = options.find((option) => option.value === preference)?.icon || Monitor

  return <div className="relative" ref={rootRef}>
    <button
      type="button"
      data-theme-trigger
      aria-label={`Appearance: ${preference}. Choose a theme`}
      aria-haspopup="menu"
      aria-expanded={open}
      className="grid h-11 w-11 place-items-center rounded-md border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setOpen((value) => !value)}
    >
      <CurrentIcon className="h-4 w-4" aria-hidden="true" />
    </button>
    {open ? <div
      role="menu"
      aria-label="Appearance"
      onKeyDown={onMenuKeyDown}
      className="absolute right-0 top-[52px] z-50 w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-panel"
    >
      {options.map(({ value, label, icon: Icon }) => {
        const selected = value === preference
        return <button
          key={value}
          ref={selected ? selectedRef : undefined}
          type="button"
          role="menuitemradio"
          aria-checked={selected}
          className="flex h-11 w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => {
            writeThemePreference(value)
            setPreference(value)
            setOpen(false)
            window.requestAnimationFrame(() => {
              rootRef.current?.querySelector<HTMLButtonElement>('[data-theme-trigger]')?.focus()
            })
          }}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span className="flex-1 text-left">{label}</span>
          {selected ? <Check className="h-4 w-4 text-primary" aria-hidden="true" /> : null}
        </button>
      })}
    </div> : null}
  </div>
}
