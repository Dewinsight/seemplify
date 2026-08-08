'use client';

import { createTheme, alpha, PaletteMode, ThemeOptions } from '@mui/material/styles';

// Extend MUI palette tokens used across the app (e.g., `primary.lighter`).
declare module '@mui/material/styles' {
  interface PaletteColor {
    lighter?: string;
  }

  interface SimplePaletteColorOptions {
    lighter?: string;
  }
}

// Premium color palette
const colors = {
  primary: {
    main: '#0f766e',
    light: '#14b8a6',
    dark: '#115e59',
    50: '#f0fdfa',
    100: '#ccfbf1',
    200: '#99f6e4',
    500: '#0f766e',
    600: '#0d9488',
    700: '#115e59',
  },
  secondary: {
    main: '#ea580c',
    light: '#fb923c',
    dark: '#c2410c',
  },
  success: {
    main: '#10b981',
    light: '#34d399',
    dark: '#059669',
  },
  warning: {
    main: '#f59e0b',
    light: '#fbbf24',
    dark: '#d97706',
  },
  error: {
    main: '#ef4444',
    light: '#f87171',
    dark: '#dc2626',
  },
  info: {
    main: '#0284c7',
    light: '#38bdf8',
    dark: '#0369a1',
  },
  grey: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
    950: '#020617',
  },
};

// Gradient definitions as CSS strings
export const gradients = {
  primary: 'linear-gradient(135deg, #0f766e 0%, #0284c7 55%, #06b6d4 100%)',
  secondary: 'linear-gradient(135deg, #ea580c 0%, #fb923c 100%)',
  success: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
  warning: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
  error: 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)',
  info: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
  purple: 'linear-gradient(135deg, #0f766e 0%, #0891b2 100%)',
  sunset: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  ocean: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  dark: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
  glass: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
  cardHover: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(139, 92, 246, 0.08) 100%)',
};

// Custom shadows with colored variants
const shadows = {
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  primary: '0 10px 40px -10px rgba(15, 118, 110, 0.42)',
  primaryHover: '0 20px 60px -15px rgba(15, 118, 110, 0.52)',
  success: '0 10px 40px -10px rgba(16, 185, 129, 0.4)',
  warning: '0 10px 40px -10px rgba(245, 158, 11, 0.4)',
  error: '0 10px 40px -10px rgba(239, 68, 68, 0.4)',
  card: '0 4px 20px -4px rgba(0, 0, 0, 0.1)',
  cardHover: '0 20px 40px -12px rgba(0, 0, 0, 0.15)',
  glow: '0 0 40px rgba(2, 132, 199, 0.28)',
};

// Dark mode shadows
const darkShadows = {
  ...shadows,
  card: '0 4px 20px -4px rgba(0, 0, 0, 0.4)',
  cardHover: '0 20px 40px -12px rgba(0, 0, 0, 0.5)',
};

// Get design tokens based on mode
export const getDesignTokens = (mode: PaletteMode): ThemeOptions => {
  const isDark = mode === 'dark';
  const currentShadows = isDark ? darkShadows : shadows;
  const lighterOpacity = isDark ? 0.15 : 0.08;
  const tint = (main: string) => alpha(main, lighterOpacity);

  return {
    palette: {
      mode,
      primary: {
        main: colors.primary.main,
        light: colors.primary.light,
        dark: colors.primary.dark,
        lighter: tint(colors.primary.main),
        contrastText: '#ffffff',
      },
      secondary: {
        main: colors.secondary.main,
        light: colors.secondary.light,
        dark: colors.secondary.dark,
        lighter: tint(colors.secondary.main),
        contrastText: '#ffffff',
      },
      success: {
        main: colors.success.main,
        light: colors.success.light,
        dark: colors.success.dark,
        lighter: tint(colors.success.main),
      },
      warning: {
        main: colors.warning.main,
        light: colors.warning.light,
        dark: colors.warning.dark,
        lighter: tint(colors.warning.main),
      },
      error: {
        main: colors.error.main,
        light: colors.error.light,
        dark: colors.error.dark,
        lighter: tint(colors.error.main),
      },
      info: {
        main: colors.info.main,
        light: colors.info.light,
        dark: colors.info.dark,
        lighter: tint(colors.info.main),
      },
      grey: colors.grey,
      background: {
        default: isDark ? '#050505' : '#e9e7e2',
        paper: isDark ? '#0b0b11' : '#fbfaf7',
      },
      text: {
        primary: isDark ? '#fafafa' : '#1d1c1a',
        secondary: isDark ? '#a1a1aa' : '#706c64',
      },
      divider: isDark ? 'rgba(255,255,255,0.08)' : '#d4d0c8',
      action: {
        active: isDark ? colors.grey[400] : colors.grey[600],
        hover: isDark ? alpha(colors.grey[50], 0.08) : alpha(colors.grey[900], 0.04),
        selected: isDark ? alpha(colors.primary.main, 0.16) : alpha(colors.primary.main, 0.08),
        disabled: isDark ? colors.grey[700] : colors.grey[300],
        disabledBackground: isDark ? colors.grey[800] : colors.grey[100],
      },
    },
    typography: {
      fontFamily: 'var(--font-body), "Segoe UI", "Helvetica Neue", Arial, sans-serif',
      h1: { fontFamily: 'var(--font-display), "Avenir Next", sans-serif', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.12 },
      h2: { fontFamily: 'var(--font-display), "Avenir Next", sans-serif', fontWeight: 700, letterSpacing: '-0.028em', lineHeight: 1.14 },
      h3: { fontFamily: 'var(--font-display), "Avenir Next", sans-serif', fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.16 },
      h4: { fontFamily: 'var(--font-display), "Avenir Next", sans-serif', fontWeight: 650, letterSpacing: '-0.015em', lineHeight: 1.2 },
      h5: { fontFamily: 'var(--font-display), "Avenir Next", sans-serif', fontWeight: 620, letterSpacing: '-0.01em', lineHeight: 1.24 },
      h6: { fontFamily: 'var(--font-display), "Avenir Next", sans-serif', fontWeight: 600, letterSpacing: '-0.006em', lineHeight: 1.28 },
      subtitle1: { fontWeight: 600, letterSpacing: '-0.004em' },
      subtitle2: { fontWeight: 600, letterSpacing: '-0.002em' },
      button: { fontWeight: 650, letterSpacing: '0.005em' },
      overline: { fontWeight: 600, letterSpacing: '0.08em' },
    },
    shape: { borderRadius: 8 },
    shadows: [
      'none',
      currentShadows.sm,
      currentShadows.sm,
      currentShadows.md,
      currentShadows.md,
      currentShadows.md,
      currentShadows.lg,
      currentShadows.lg,
      currentShadows.lg,
      currentShadows.lg,
      currentShadows.xl,
      currentShadows.xl,
      currentShadows.xl,
      currentShadows.xl,
      currentShadows.xl,
      currentShadows.xl,
      currentShadows['2xl'],
      currentShadows['2xl'],
      currentShadows['2xl'],
      currentShadows['2xl'],
      currentShadows['2xl'],
      currentShadows['2xl'],
      currentShadows['2xl'],
      currentShadows['2xl'],
      currentShadows['2xl'],
    ],
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            scrollbarColor: isDark
              ? `${colors.grey[700]} ${colors.grey[900]}`
              : `${colors.grey[300]} ${colors.grey[100]}`,
            '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
              width: 8,
              height: 8,
            },
            '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
              borderRadius: 8,
              backgroundColor: isDark ? colors.grey[700] : colors.grey[300],
              border: '2px solid transparent',
              backgroundClip: 'content-box',
            },
            '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': {
              backgroundColor: isDark ? colors.grey[900] : colors.grey[100],
              borderRadius: 8,
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: 8,
            fontWeight: 600,
            padding: '8px 20px',
            transition: 'background-color 160ms ease, border-color 160ms ease, color 160ms ease',
          },
          contained: {
            boxShadow: 'none',
            '&:hover': { boxShadow: 'none' },
          },
          containedPrimary: {
            background: colors.primary.main,
            boxShadow: 'none',
            '&:hover': {
              background: colors.primary.dark,
              boxShadow: 'none',
            },
          },
          containedSecondary: {
            background: gradients.secondary,
            '&:hover': { background: gradients.secondary },
          },
          containedSuccess: {
            background: gradients.success,
            boxShadow: currentShadows.success,
          },
          containedWarning: {
            background: gradients.warning,
            boxShadow: currentShadows.warning,
          },
          containedError: {
            background: gradients.error,
            boxShadow: currentShadows.error,
          },
          outlined: {
            borderWidth: '1.5px',
            borderColor: isDark ? colors.grey[700] : colors.grey[300],
            '&:hover': {
              borderWidth: '1.5px',
              backgroundColor: alpha(colors.primary.main, isDark ? 0.08 : 0.04),
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            boxShadow: isDark ? '0 1px 2px rgba(0,0,0,.28)' : '0 1px 2px rgba(29,28,26,.05), 0 8px 24px rgba(29,28,26,.06)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,.08)' : '#d4d0c8'}`,
            backgroundColor: isDark ? '#0b0b11' : '#fbfaf7',
            transition: 'border-color 160ms ease, box-shadow 160ms ease',
            '&:hover': {
              boxShadow: isDark ? '0 1px 2px rgba(0,0,0,.28)' : '0 1px 2px rgba(29,28,26,.06), 0 10px 28px rgba(29,28,26,.08)',
              borderColor: isDark ? 'rgba(255,255,255,.12)' : '#cbc7be',
            },
          },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: {
            padding: 24,
            '&:last-child': { paddingBottom: 24 },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            boxShadow: 'none',
            backgroundColor: isDark ? '#0b0b11' : '#fbfaf7',
            backgroundImage: 'none',
          },
          elevation0: { boxShadow: 'none' },
          elevation1: { boxShadow: currentShadows.sm },
          elevation2: { boxShadow: currentShadows.md },
          elevation3: { boxShadow: currentShadows.lg },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontWeight: 500,
            transition: 'all 0.2s ease',
          },
          colorPrimary: {
            backgroundColor: alpha(colors.primary.main, isDark ? 0.2 : 0.1),
            color: isDark ? colors.primary.light : colors.primary.dark,
            '&:hover': {
              backgroundColor: alpha(colors.primary.main, isDark ? 0.3 : 0.2),
            },
          },
          colorSecondary: {
            backgroundColor: alpha(colors.secondary.main, isDark ? 0.2 : 0.1),
            color: isDark ? colors.secondary.light : colors.secondary.dark,
          },
          colorSuccess: {
            backgroundColor: alpha(colors.success.main, isDark ? 0.2 : 0.1),
            color: isDark ? colors.success.light : colors.success.dark,
          },
          colorWarning: {
            backgroundColor: alpha(colors.warning.main, isDark ? 0.2 : 0.1),
            color: isDark ? colors.warning.light : colors.warning.dark,
          },
          colorError: {
            backgroundColor: alpha(colors.error.main, isDark ? 0.2 : 0.1),
            color: isDark ? colors.error.light : colors.error.dark,
          },
          colorInfo: {
            backgroundColor: alpha(colors.info.main, isDark ? 0.2 : 0.1),
            color: isDark ? colors.info.light : colors.info.dark,
          },
          outlined: {
            borderColor: isDark ? colors.grey[700] : colors.grey[300],
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            height: 8,
            backgroundColor: isDark ? colors.grey[800] : colors.grey[100],
          },
          bar: { borderRadius: 8, background: gradients.primary },
          barColorPrimary: { background: gradients.primary },
          barColorSecondary: { background: gradients.secondary },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius: 10,
              backgroundColor: isDark ? colors.grey[900] : '#ffffff',
              transition: 'all 0.2s ease',
              '& fieldset': {
                borderColor: isDark ? colors.grey[700] : colors.grey[300],
              },
              '&:hover .MuiOutlinedInput-notchedOutline': {
                borderColor: colors.primary.light,
              },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderWidth: 2,
                boxShadow: `0 0 0 4px ${alpha(colors.primary.main, isDark ? 0.2 : 0.1)}`,
              },
            },
            '& .MuiInputLabel-root': {
              color: isDark ? colors.grey[400] : colors.grey[500],
            },
            '& .MuiInputBase-input': {
              color: isDark ? colors.grey[50] : colors.grey[900],
            },
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: isDark ? colors.grey[700] : colors.grey[300],
            },
          },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          root: {
            fontWeight: 600,
            boxShadow: currentShadows.sm,
          },
          colorDefault: {
            background: gradients.primary,
            color: '#ffffff',
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            transition: 'all 0.2s ease',
            '&:hover': {
              backgroundColor: alpha(colors.primary.main, isDark ? 0.12 : 0.08),
              transform: 'scale(1.05)',
            },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            marginBottom: 4,
            transition: 'all 0.2s ease',
            '&:hover': {
              backgroundColor: alpha(colors.primary.main, isDark ? 0.1 : 0.06),
            },
            '&.Mui-selected': {
              backgroundColor: alpha(colors.primary.main, isDark ? 0.16 : 0.1),
              '&:hover': {
                backgroundColor: alpha(colors.primary.main, isDark ? 0.2 : 0.15),
              },
            },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: {
            height: 3,
            borderRadius: '3px 3px 0 0',
            background: gradients.primary,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 500,
            minHeight: 48,
            transition: 'all 0.2s ease',
            color: isDark ? colors.grey[400] : colors.grey[600],
            '&.Mui-selected': {
              fontWeight: 600,
              color: isDark ? colors.primary.light : colors.primary.main,
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 20,
            boxShadow: currentShadows['2xl'],
            backgroundColor: isDark ? colors.grey[900] : '#ffffff',
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            fontSize: '1.25rem',
            fontWeight: 600,
            padding: '24px 24px 16px',
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: { padding: '16px 24px' },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: { padding: '16px 24px 24px', gap: 12 },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            fontWeight: 500,
          },
          standardSuccess: {
            backgroundColor: alpha(colors.success.main, isDark ? 0.15 : 0.1),
            color: isDark ? colors.success.light : colors.success.dark,
          },
          standardWarning: {
            backgroundColor: alpha(colors.warning.main, isDark ? 0.15 : 0.1),
            color: isDark ? colors.warning.light : colors.warning.dark,
          },
          standardError: {
            backgroundColor: alpha(colors.error.main, isDark ? 0.15 : 0.1),
            color: isDark ? colors.error.light : colors.error.dark,
          },
          standardInfo: {
            backgroundColor: alpha(colors.info.main, isDark ? 0.15 : 0.1),
            color: isDark ? colors.info.light : colors.info.dark,
          },
        },
      },
      MuiBadge: {
        styleOverrides: {
          badge: {
            fontWeight: 600,
            fontSize: '0.7rem',
            minWidth: 18,
            height: 18,
            padding: '0 4px',
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: isDark ? colors.grey[700] : colors.grey[800],
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: '0.75rem',
            fontWeight: 500,
          },
          arrow: {
            color: isDark ? colors.grey[700] : colors.grey[800],
          },
        },
      },
      MuiStepper: {
        styleOverrides: {
          root: { padding: 16 },
        },
      },
      MuiStepLabel: {
        styleOverrides: {
          label: {
            fontWeight: 500,
            color: isDark ? colors.grey[400] : colors.grey[600],
            '&.Mui-active': {
              fontWeight: 600,
              color: isDark ? colors.primary.light : colors.primary.main,
            },
            '&.Mui-completed': {
              fontWeight: 500,
              color: isDark ? colors.success.light : colors.success.main,
            },
          },
        },
      },
      MuiStepIcon: {
        styleOverrides: {
          root: {
            color: isDark ? colors.grey[700] : colors.grey[300],
            '&.Mui-active': { color: colors.primary.main },
            '&.Mui-completed': { color: colors.success.main },
          },
        },
      },
      MuiAccordion: {
        styleOverrides: {
          root: {
            backgroundColor: isDark ? colors.grey[900] : '#ffffff',
            '&:before': { display: 'none' },
            borderRadius: '12px !important',
            border: `1px solid ${isDark ? colors.grey[800] : colors.grey[200]}`,
            '&.Mui-expanded': {
              margin: '0 0 16px 0',
            },
          },
        },
      },
      MuiAccordionSummary: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            '&:hover': {
              backgroundColor: alpha(colors.primary.main, isDark ? 0.08 : 0.04),
            },
          },
        },
      },
      MuiTable: {
        styleOverrides: {
          root: { borderCollapse: 'separate', borderSpacing: 0 },
        },
      },
      MuiTableHead: {
        styleOverrides: {
          root: {
            '& .MuiTableCell-head': {
              backgroundColor: isDark ? colors.grey[800] : colors.grey[50],
              fontWeight: 600,
              color: isDark ? colors.grey[300] : colors.grey[600],
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            },
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            transition: 'all 0.2s ease',
            '&:hover': {
              backgroundColor: alpha(colors.primary.main, isDark ? 0.04 : 0.02),
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${isDark ? colors.grey[800] : colors.grey[100]}`,
            padding: '16px',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            border: 'none',
            boxShadow: currentShadows.xl,
            backgroundColor: isDark ? colors.grey[900] : '#ffffff',
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: currentShadows.md,
            backgroundColor: isDark ? colors.grey[900] : '#ffffff',
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 12,
            boxShadow: currentShadows.xl,
            border: `1px solid ${isDark ? colors.grey[800] : colors.grey[100]}`,
            marginTop: 4,
            backgroundColor: isDark ? colors.grey[900] : '#ffffff',
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            margin: '2px 8px',
            padding: '10px 12px',
            transition: 'all 0.15s ease',
            '&:hover': {
              backgroundColor: alpha(colors.primary.main, isDark ? 0.1 : 0.06),
            },
          },
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: {
            borderColor: isDark ? colors.grey[800] : colors.grey[100],
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: { width: 50, height: 28, padding: 0 },
          switchBase: {
            padding: 2,
            '&.Mui-checked': {
              transform: 'translateX(22px)',
              color: '#fff',
              '& + .MuiSwitch-track': {
                backgroundColor: colors.primary.main,
                opacity: 1,
                border: 0,
              },
            },
          },
          thumb: {
            width: 24,
            height: 24,
            boxShadow: currentShadows.sm,
          },
          track: {
            borderRadius: 14,
            backgroundColor: isDark ? colors.grey[700] : colors.grey[300],
            opacity: 1,
          },
        },
      },
      MuiSlider: {
        styleOverrides: {
          root: { height: 8 },
          rail: {
            backgroundColor: isDark ? colors.grey[700] : colors.grey[200],
            opacity: 1,
          },
          track: { background: gradients.primary, border: 'none' },
          thumb: {
            width: 20,
            height: 20,
            backgroundColor: '#fff',
            border: `3px solid ${colors.primary.main}`,
            boxShadow: currentShadows.md,
            '&:hover': { boxShadow: currentShadows.primary },
          },
          mark: {
            backgroundColor: isDark ? colors.grey[600] : colors.grey[400],
          },
          markLabel: {
            color: isDark ? colors.grey[400] : colors.grey[600],
          },
        },
      },
      MuiSkeleton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            backgroundColor: isDark ? colors.grey[800] : colors.grey[100],
          },
        },
      },
      MuiRating: {
        styleOverrides: {
          root: {
            color: colors.warning.main,
          },
          iconEmpty: {
            color: isDark ? colors.grey[700] : colors.grey[300],
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            color: isDark ? colors.grey[400] : colors.grey[600],
          },
        },
      },
      MuiFormLabel: {
        styleOverrides: {
          root: {
            color: isDark ? colors.grey[400] : colors.grey[600],
          },
        },
      },
    },
  };
};

// Default theme (for backward compatibility)
const theme = createTheme(getDesignTokens('light'));

// Export additional utilities
export { colors, shadows };
export default theme;
