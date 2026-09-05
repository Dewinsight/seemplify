'use client'

import { useEffect, useState } from 'react'

export type MarketingTheme = 'light' | 'dark'

/**
 * Mirrors the `data-theme` attribute that theme-sync writes on <html>, and
 * keeps following it when the header toggle flips it at runtime. Canvas-based
 * visuals can't read CSS variables, so they subscribe to this instead.
 */
export function useMarketingTheme(): MarketingTheme {
  const [theme, setTheme] = useState<MarketingTheme>('light')

  useEffect(() => {
    const root = document.documentElement
    const sync = () => setTheme(root.dataset.theme === 'dark' ? 'dark' : 'light')
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  return theme
}
