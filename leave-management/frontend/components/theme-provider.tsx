"use client"

import * as React from "react"
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
  useTheme,
} from "next-themes"
import { syncThemeToCookie } from "@/lib/theme-sync"

function ThemeSyncWrapper({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();

  React.useEffect(() => {
    // Sync theme to cookie for cross-app sharing
    if (theme && ['light', 'dark', 'system'].includes(theme)) {
      syncThemeToCookie(theme);
    }
  }, [theme]);

  return <>{children}</>;
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <ThemeSyncWrapper>{children}</ThemeSyncWrapper>
    </NextThemesProvider>
  )
}
