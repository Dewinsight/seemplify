'use client';

import React, { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { getThemeConfig, getEffectiveTheme } from '@/utils/themeConfig';
import { syncThemeToCookie } from '@/lib/theme-sync';

interface ConfigThemeProviderProps {
  children: React.ReactNode;
  attribute?: string;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
}

function ThemeEnforcer({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    // Enforce theme settings on mount and when theme changes
    const themeConfig = getThemeConfig();
    const effectiveTheme = getEffectiveTheme(theme);

    // If current theme is not the effective theme, switch to it
    if (theme && theme !== effectiveTheme) {
      console.log(`🎨 Theme "${theme}" not available, switching to "${effectiveTheme}"`);
      setTheme(effectiveTheme);
    }

    // Sync theme to cookie for cross-app sharing
    if (theme && ['light', 'dark', 'system'].includes(theme)) {
      syncThemeToCookie(theme);
    }
  }, [theme, setTheme]);

  return <>{children}</>;
}

export function ConfigThemeProvider({
  children,
  attribute = 'class',
  enableSystem = true,
  disableTransitionOnChange = true
}: ConfigThemeProviderProps) {
  const themeConfig = getThemeConfig();

  return (
    <NextThemesProvider
      attribute={attribute as any}
      defaultTheme={themeConfig.defaultTheme}
      enableSystem={enableSystem}
      disableTransitionOnChange={disableTransitionOnChange}
    >
      <ThemeEnforcer>
        {children}
      </ThemeEnforcer>
    </NextThemesProvider>
  );
}

// Backward compatibility export
export { ConfigThemeProvider as EnvThemeProvider };
