"use client"

import * as React from "react"
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
  useTheme,
} from "next-themes"
import { readThemePreference, syncThemeToCookie } from "@/lib/theme-sync"

function ThemeSyncWrapper({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();

  React.useEffect(() => {
    // Sync theme to cookie for cross-app sharing
    if (theme && ['light', 'dark', 'system'].includes(theme)) {
      syncThemeToCookie(theme);
    }
  }, [theme]);

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
