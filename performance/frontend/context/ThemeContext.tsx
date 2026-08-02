'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { ThemeProvider, createTheme, PaletteMode } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { getDesignTokens } from '@/app/theme';

interface ThemeContextType {
  mode: PaletteMode;
  toggleColorMode: () => void;
  setMode: (mode: PaletteMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: 'dark',
  toggleColorMode: () => {},
  setMode: () => {},
});

export const useThemeMode = () => useContext(ThemeContext);

interface ThemeProviderWrapperProps {
  children: ReactNode;
}

export function ThemeProviderWrapper({ children }: ThemeProviderWrapperProps) {
  const [mode, setMode] = useState<PaletteMode>('dark');
  const [mounted, setMounted] = useState(false);

  // Load saved preference on mount
  useEffect(() => {
    setMounted(true);
    const savedMode = localStorage.getItem('themeMode') as PaletteMode;
    if (savedMode && (savedMode === 'light' || savedMode === 'dark')) {
      setMode(savedMode);
      document.documentElement.setAttribute('data-theme', savedMode);
      document.documentElement.classList.toggle('dark', savedMode === 'dark');
    } else {
      // Check system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const systemMode: PaletteMode = prefersDark ? 'dark' : 'light';
      setMode(systemMode);
      document.documentElement.setAttribute('data-theme', systemMode);
      document.documentElement.classList.toggle('dark', systemMode === 'dark');
    }
  }, []);

  // Save preference when it changes
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('themeMode', mode);
      // Update document attribute for CSS
      document.documentElement.setAttribute('data-theme', mode);
      // Tailwind's dark variant relies on the `dark` class by default.
      // Keep it in sync with our `data-theme` attribute.
      document.documentElement.classList.toggle('dark', mode === 'dark');
    }
  }, [mode, mounted]);

  const colorMode = useMemo(
    () => ({
      mode,
      toggleColorMode: () => {
        setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'));
      },
      setMode,
    }),
    [mode]
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
