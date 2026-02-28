# Theme Configuration Migration Guide

## Overview

Theme control has been moved from environment variables to a config file for easier management and version control.

## Migration Steps

### 1. Remove Environment Variables (Optional)

If you have these variables in your `.env.local` file, you can remove them:

```env
# Remove these lines from .env.local
NEXT_PUBLIC_THEME_LIGHT_ENABLED=true
NEXT_PUBLIC_THEME_DARK_ENABLED=false
NEXT_PUBLIC_THEME_SYSTEM_ENABLED=false
NEXT_PUBLIC_DEFAULT_THEME=light
```

### 2. Configure Themes

Edit `frontend/config/theme.config.ts`:

```typescript
export const THEME_CONFIG: ThemeSettings = {
  // Enable/disable themes
  lightEnabled: true,     // ← was NEXT_PUBLIC_THEME_LIGHT_ENABLED
  darkEnabled: true,      // ← was NEXT_PUBLIC_THEME_DARK_ENABLED  
  systemEnabled: true,    // ← was NEXT_PUBLIC_THEME_SYSTEM_ENABLED
  
  // Default theme
  defaultTheme: 'system'  // ← was NEXT_PUBLIC_DEFAULT_THEME
};
```

### 3. Restart Development Server

After making changes to `theme.config.ts`, restart your development server:

```bash
# Stop the current server (Ctrl+C)
# Then restart
npm run dev
```

## Benefits of Config File Approach

- ✅ **Version Control**: Theme settings are now tracked in Git
- ✅ **Type Safety**: TypeScript validation for theme configuration
- ✅ **Easy Management**: Single file to manage all theme settings
- ✅ **Auto-Validation**: Automatic validation and correction of invalid configs
- ✅ **Better DX**: No need to restart for every environment variable change during development

## Validation Rules

The system automatically validates your configuration:

1. **At least one theme must be enabled**
   - If all disabled → auto-enables all themes
   
2. **Default theme must be enabled**
   - If disabled → auto-corrects to first available theme
   
3. **Type safety**
   - Only valid theme values accepted: 'light', 'dark', 'system'

## Troubleshooting

### Issue: Themes not showing up
**Solution**: Check `frontend/config/theme.config.ts` and ensure desired themes are set to `true`

### Issue: Wrong default theme
**Solution**: Update `defaultTheme` in the config file and restart server

### Issue: No themes available
**Solution**: The system will auto-correct by enabling all themes
