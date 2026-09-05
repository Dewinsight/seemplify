'use client';

import React, { useEffect } from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { applyRecruiterTheme, RECRUITER_THEME } from '@/lib/theme-sync';

interface ConfigThemeProviderProps {
  children: React.ReactNode;
  attribute?: string;
  disableTransitionOnChange?: boolean;
}

function ThemeEnforcer({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const enforceLightTheme = () => {
      const root = document.documentElement;
      if (
        root.classList.contains('dark') ||
        !root.classList.contains(RECRUITER_THEME) ||
        root.dataset.theme !== RECRUITER_THEME ||
        root.dataset.themePreference !== RECRUITER_THEME ||
        root.style.colorScheme !== RECRUITER_THEME
      ) {
        applyRecruiterTheme();
      }
    };

    enforceLightTheme();
    const observer = new MutationObserver(enforceLightTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-theme-preference', 'style'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return <>{children}</>;
}

export function ConfigThemeProvider({
  children,
  attribute = 'class',
  disableTransitionOnChange = true,
}: ConfigThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute={attribute as 'class'}
      defaultTheme={RECRUITER_THEME}
      forcedTheme={RECRUITER_THEME}
      storageKey="seemplify_theme"
      enableSystem={false}
      disableTransitionOnChange={disableTransitionOnChange}
    >
      <ThemeEnforcer>{children}</ThemeEnforcer>
    </NextThemesProvider>
  );
}

export { ConfigThemeProvider as EnvThemeProvider };
