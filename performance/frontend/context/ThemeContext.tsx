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
  const [mode, setModeState] = useState<PaletteMode>('dark');
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [mounted, setMounted] = useState(false);

  // Load saved preference on mount
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const savedPreference = readThemePreference();
      setPreferenceState(savedPreference);
      applyThemePreference(savedPreference);
      setModeState(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
      setMounted(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Keep system changes and updates made in another Seemplify app in sync.
  useEffect(() => {
    if (!mounted) return;
    const sync = () => {
      const next = readThemePreference();
      setPreferenceState(next);
      applyThemePreference(next);
      setModeState(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    };
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    media.addEventListener('change', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
      media.removeEventListener('change', sync);
    };
  }, [mounted]);

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

  // Prevent flash of wrong theme
  if (!mounted) {
    return (
      <ThemeContext.Provider value={colorMode}>
        <ThemeProvider theme={createTheme(getDesignTokens('dark'))}>
          <CssBaseline />
          <div style={{ visibility: 'hidden' }}>{children}</div>
        </ThemeProvider>
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}
