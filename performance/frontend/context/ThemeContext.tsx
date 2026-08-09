'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { ThemeProvider, createTheme, PaletteMode } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { getDesignTokens } from '@/app/theme';
import { applyThemePreference, readThemePreference, ThemePreference, writeThemePreference } from '@/lib/theme-sync';

interface ThemeContextType {
  mode: PaletteMode;
  preference: ThemePreference;
  toggleColorMode: () => void;
  setMode: (mode: PaletteMode) => void;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: 'dark',
  preference: 'system',
  toggleColorMode: () => {},
  setMode: () => {},
  setPreference: () => {},
});

export const useThemeMode = () => useContext(ThemeContext);

interface ThemeProviderWrapperProps {
  children: ReactNode;
}

export function ThemeProviderWrapper({ children }: ThemeProviderWrapperProps) {
  const [mode, setModeState] = useState<PaletteMode>('light');
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // The inline head bootstrap sets the root palette before this provider hydrates.
  useEffect(() => {
    const savedPreference = readThemePreference();
    setPreferenceState(savedPreference);
    applyThemePreference(savedPreference);
    setModeState(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  // Keep system changes and updates made in another Seemplify app in sync.
  useEffect(() => {
    const sync = () => {
      const next = readThemePreference();
      setPreferenceState(next);
      applyThemePreference(next);
      setModeState(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    };
    const syncResolvedMode = () => {
      setModeState(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    };
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const observer = new MutationObserver(syncResolvedMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    window.addEventListener('focus', sync);
    window.addEventListener('storage', sync);
    document.addEventListener('visibilitychange', sync);
    const syncSystem = () => {
      if (readThemePreference() === 'system') sync();
    };
    media.addEventListener('change', syncSystem);
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', sync);
      window.removeEventListener('storage', sync);
      document.removeEventListener('visibilitychange', sync);
      media.removeEventListener('change', syncSystem);
    };
  }, []);

  const updatePreference = (next: ThemePreference) => {
    writeThemePreference(next);
    setPreferenceState(next);
    setModeState(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  };

  const colorMode = useMemo(
    () => ({
      mode,
      preference,
      toggleColorMode: () => updatePreference(mode === 'light' ? 'dark' : 'light'),
      setMode: (nextMode: PaletteMode) => updatePreference(nextMode),
      setPreference: updatePreference,
    }),
    [mode, preference]
  );

  const theme = useMemo(() => createTheme(getDesignTokens(mode)), [mode]);

  return (
    <ThemeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}
