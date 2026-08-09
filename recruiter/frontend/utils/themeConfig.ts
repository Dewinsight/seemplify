// Theme configuration based on environment variables

export interface ThemeConfig {
  availableThemes: {
    light: boolean;
    dark: boolean;
    system: boolean;
  };
  defaultTheme: 'light' | 'dark' | 'system';
}

/**
 * Get theme configuration from config file
 */
export function getThemeConfig(): ThemeConfig {
  const { getValidatedThemeConfig } = require('@/config/theme.config');
  const config = getValidatedThemeConfig();

  return {
    availableThemes: {
      light: config.lightEnabled,
      dark: config.darkEnabled,
      system: config.systemEnabled
    },
    defaultTheme: config.defaultTheme
  };
}

/**
 * Get available theme options for dropdowns/selectors
 */
export function getAvailableThemeOptions(): Array<{value: string; label: string}> {
  const config = getThemeConfig();
  const allThemes = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];

  return allThemes.filter(theme => 
    config.availableThemes[theme.value as keyof typeof config.availableThemes]
  );
}

/**
 * Check if a specific theme is available
 */
export function isThemeAvailable(theme: 'light' | 'dark' | 'system'): boolean {
  const config = getThemeConfig();
  return config.availableThemes[theme];
}

/**
 * Get the effective theme that should be used
 * If requested theme is not available, fall back to default or first available
 */
export function getEffectiveTheme(requestedTheme?: string): 'light' | 'dark' | 'system' {
  const config = getThemeConfig();
  
  // If requested theme is available, use it
  if (requestedTheme && isThemeAvailable(requestedTheme as 'light' | 'dark' | 'system')) {
    return requestedTheme as 'light' | 'dark' | 'system';
  }

  // Fall back to default theme
  return config.defaultTheme;
}
