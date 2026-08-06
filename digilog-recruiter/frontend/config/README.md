# Configuration Files

## Theme Configuration (`theme.config.ts`)

Controls which themes are available in the application and the default theme.

### Configuration Options

```typescript
export const THEME_CONFIG: ThemeSettings = {
  // Theme Availability - set to true/false to enable/disable themes
  lightEnabled: true,
  darkEnabled: true,
  systemEnabled: true,
  
  // Default Theme - must be one of the enabled themes above
  defaultTheme: 'system'
};
```

### Rules

1. **At least one theme must be enabled** - if all are disabled, all will be auto-enabled
2. **Default theme must be enabled** - if not, system will auto-correct to first available theme
3. **Changes require restart** - restart the development server after making changes

### Theme Options

- **Light Mode**: Fixed light theme
- **Dark Mode**: Fixed dark theme  
- **System Mode**: Follows user's OS preference (light/dark)

### Migration from Environment Variables

Previously theme settings were controlled via environment variables:
- `NEXT_PUBLIC_THEME_LIGHT_ENABLED`
- `NEXT_PUBLIC_THEME_DARK_ENABLED` 
- `NEXT_PUBLIC_THEME_SYSTEM_ENABLED`
- `NEXT_PUBLIC_DEFAULT_THEME`

These are now replaced by the `theme.config.ts` file for easier management and version control.
