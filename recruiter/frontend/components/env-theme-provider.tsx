'use client';

import React, { useEffect, useRef } from 'react';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { readThemePreference, syncThemeToCookie } from '@/lib/theme-sync';
import { getEffectiveTheme } from '@/utils/themeConfig';

interface ConfigThemeProviderProps {
  children: React.ReactNode;
  attribute?: string;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
}

function ThemeEnforcer({ children }: { children: React.ReactNode }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const readyToPersist = useRef(false);

  useEffect(() => {
    const sharedTheme = getEffectiveTheme(readThemePreference());
    // Promote a valid legacy/local preference into the shared cookie immediately.
    // The RAF guard below still prevents next-themes' initial value from overwriting it.
    syncThemeToCookie(sharedTheme);
    if (sharedTheme !== theme) setTheme(sharedTheme);
    const frame = window.requestAnimationFrame(() => {
      readyToPersist.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
    // Read the cross-app preference once before persistence is enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!readyToPersist.current || !theme) return;
    const effectiveTheme = getEffectiveTheme(theme);
    if (effectiveTheme !== theme) {
      setTheme(effectiveTheme);
      return;
    }
    syncThemeToCookie(theme);
  }, [setTheme, theme]);

  useEffect(() => {
    if (!resolvedTheme) return;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    const syncFromSharedPreference = () => {
      const sharedTheme = getEffectiveTheme(readThemePreference());
      if (sharedTheme !== theme) setTheme(sharedTheme);
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

export function ConfigThemeProvider({
  children,
  attribute = 'class',
  enableSystem = true,
  disableTransitionOnChange = true,
}: ConfigThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute={attribute as 'class'}
      defaultTheme="system"
      storageKey="seemplify_theme"
      enableSystem={enableSystem}
      disableTransitionOnChange={disableTransitionOnChange}
    >
      <ThemeEnforcer>{children}</ThemeEnforcer>
    </NextThemesProvider>
  );
}

export { ConfigThemeProvider as EnvThemeProvider };
