/**
 * Theme Configuration
 * 
 * Configure which themes are available and the default theme for the application.
 * This replaces environment variable-based theme control.
 */

export interface ThemeSettings {
  // Available theme modes
  lightEnabled: boolean;
  darkEnabled: boolean;
  systemEnabled: boolean;
  
  // Default theme (must be one of the enabled themes)
  defaultTheme: 'light' | 'dark' | 'system';
}

/**
 * Theme Configuration
 * 
 * Modify these values to control theme availability:
 * - Set enabled themes to true/false
 * - At least one theme must be enabled
 * - Default theme must be one of the enabled themes
 */
// Temporary product boundary: Recruiter is light-only until its internal
// surfaces have complete dark-theme coverage. Keep the suite-wide preference
// untouched so other Seemplify products can continue to honour it.
export const THEME_CONFIG: ThemeSettings = {
  // Theme Availability
  lightEnabled: true,
  darkEnabled: false,
  systemEnabled: false,
  
  // Default Theme (must be enabled above)
  defaultTheme: 'light'
};

/**
 * Validation function to ensure config is valid
 */
export function validateThemeConfig(config: ThemeSettings): {
  isValid: boolean;
  errors: string[];
  correctedConfig?: ThemeSettings;
} {
  const errors: string[] = [];
  let correctedConfig = { ...config };

  // Check if at least one theme is enabled
  const hasEnabledTheme = config.lightEnabled || config.darkEnabled || config.systemEnabled;
  if (!hasEnabledTheme) {
    errors.push('At least one theme must be enabled');
    // Auto-correct: enable all themes
    correctedConfig = {
      ...correctedConfig,
      lightEnabled: true,
      darkEnabled: true,
      systemEnabled: true
    };
  }

  // Check if default theme is enabled
  const isDefaultEnabled = 
    (config.defaultTheme === 'light' && correctedConfig.lightEnabled) ||
    (config.defaultTheme === 'dark' && correctedConfig.darkEnabled) ||
    (config.defaultTheme === 'system' && correctedConfig.systemEnabled);

  if (!isDefaultEnabled) {
    errors.push(`Default theme "${config.defaultTheme}" is not enabled`);
    // Auto-correct: set to first available theme
    if (correctedConfig.systemEnabled) correctedConfig.defaultTheme = 'system';
    else if (correctedConfig.lightEnabled) correctedConfig.defaultTheme = 'light';
    else if (correctedConfig.darkEnabled) correctedConfig.defaultTheme = 'dark';
  }

  return {
    isValid: errors.length === 0,
    errors,
    correctedConfig: errors.length > 0 ? correctedConfig : undefined
  };
}

/**
 * Get validated theme configuration
 */
export function getValidatedThemeConfig(): ThemeSettings {
  const validation = validateThemeConfig(THEME_CONFIG);
  
  if (!validation.isValid) {
    console.warn('⚠️ Theme configuration has issues:', validation.errors);
    if (validation.correctedConfig) {
      console.warn('🔧 Using auto-corrected theme configuration:', validation.correctedConfig);
      return validation.correctedConfig;
    }
  }
  
  return THEME_CONFIG;
}

/**
 * Get available themes as options for UI components
 */
export function getAvailableThemes(): Array<{value: string; label: string; enabled: boolean}> {
  const config = getValidatedThemeConfig();
  
  return [
    { value: 'light', label: 'Light', enabled: config.lightEnabled },
    { value: 'dark', label: 'Dark', enabled: config.darkEnabled },
    { value: 'system', label: 'System', enabled: config.systemEnabled }
  ].filter(theme => theme.enabled);
}

/**
 * Get enabled theme values (for next-themes)
 */
export function getEnabledThemeValues(): string[] {
  return getAvailableThemes().map(theme => theme.value);
}
