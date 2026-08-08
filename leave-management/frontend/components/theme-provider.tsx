"use client"

import * as React from "react"
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
  useTheme,
} from "next-themes"
import { readThemePreference, syncThemeToCookie } from "@/lib/theme-sync"

function ThemeSyncWrapper({ children }: { children: React.ReactNode }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const readyToPersist = React.useRef(false);

  React.useEffect(() => {
    // next-themes initially exposes defaultTheme before it hydrates storage.
    // Read the shared preference first so that transient default cannot replace it.
    const shared = readThemePreference();
    if (shared !== theme) setTheme(shared);
    const frame = window.requestAnimationFrame(() => {
      readyToPersist.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
    // This must run only once, before persistence is enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (readyToPersist.current && theme && ['light', 'dark', 'system'].includes(theme)) {
      syncThemeToCookie(theme);
    }
  }, [theme]);

  React.useEffect(() => {
    if (!resolvedTheme) return;

    // The server bootstrap also writes data-theme so the first paint has the
    // correct palette. Keep that attribute aligned after next-themes changes
    // its class; otherwise stale dark tokens can leak into light mode.
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  React.useEffect(() => {
    const syncFromSharedPreference = () => {
      const shared = readThemePreference();
      if (shared !== theme) setTheme(shared);
    };
    window.addEventListener('focus', syncFromSharedPreference);
    document.addEventListener('visibilitychange', syncFromSharedPreference);
    return () => {
      window.removeEventListener('focus', syncFromSharedPreference);
      document.removeEventListener('visibilitychange', syncFromSharedPreference);
    };
  }, [setTheme, theme]);

  return <>{children}</>;
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <ThemeSyncWrapper>{children}</ThemeSyncWrapper>
    </NextThemesProvider>
  )
}
