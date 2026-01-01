'use client';

import { createTheme, alpha } from '@mui/material/styles';

// Premium color palette
const colors = {
  primary: {
    main: '#6366f1',
    light: '#818cf8',
    dark: '#4f46e5',
    50: '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
  },
  secondary: {
    main: '#ec4899',
    light: '#f472b6',
    dark: '#db2777',
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
    main: '#3b82f6',
    light: '#60a5fa',
    dark: '#2563eb',
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
  },
};

// Gradient definitions as CSS strings
export const gradients = {
  primary: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%)',
  secondary: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
  success: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
  warning: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
  error: 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)',
  info: 'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)',
  purple: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
  primary: '0 10px 40px -10px rgba(99, 102, 241, 0.4)',
  primaryHover: '0 20px 60px -15px rgba(99, 102, 241, 0.5)',
  success: '0 10px 40px -10px rgba(16, 185, 129, 0.4)',
  warning: '0 10px 40px -10px rgba(245, 158, 11, 0.4)',
  error: '0 10px 40px -10px rgba(239, 68, 68, 0.4)',
  card: '0 4px 20px -4px rgba(0, 0, 0, 0.1)',
  cardHover: '0 20px 40px -12px rgba(0, 0, 0, 0.15)',
  glow: '0 0 40px rgba(99, 102, 241, 0.3)',
};

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: colors.primary.main,
      light: colors.primary.light,
      dark: colors.primary.dark,
      contrastText: '#ffffff',
    },
    secondary: {
      main: colors.secondary.main,
      light: colors.secondary.light,
      dark: colors.secondary.dark,
      contrastText: '#ffffff',
    },
    success: {
      main: colors.success.main,
      light: colors.success.light,
      dark: colors.success.dark,
    },
    warning: {
      main: colors.warning.main,
      light: colors.warning.light,
      dark: colors.warning.dark,
    },
    error: {
      main: colors.error.main,
      light: colors.error.light,
      dark: colors.error.dark,
    },
    info: {
      main: colors.info.main,
      light: colors.info.light,
      dark: colors.info.dark,
    },
    grey: colors.grey,
    background: {
      default: '#f8fafc',
      paper: '#ffffff',
    },
    text: {
      primary: colors.grey[900],
      secondary: colors.grey[500],
    },
    divider: colors.grey[200],
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontWeight: 800,
      letterSpacing: '-0.025em',
    },
    h2: {
      fontWeight: 700,
      letterSpacing: '-0.025em',
    },
    h3: {
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    h4: {
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    h5: {
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    h6: {
      fontWeight: 600,
      letterSpacing: '-0.01em',
    },
    subtitle1: {
      fontWeight: 500,
    },
    subtitle2: {
      fontWeight: 500,
    },
    button: {
      fontWeight: 600,
      letterSpacing: '0.01em',
    },
    overline: {
      fontWeight: 600,
      letterSpacing: '0.08em',
    },
  },
  shape: {
    borderRadius: 12,
  },
  shadows: [
    'none',
    shadows.sm,
    shadows.sm,
    shadows.md,
    shadows.md,
    shadows.md,
    shadows.lg,
    shadows.lg,
    shadows.lg,
    shadows.lg,
    shadows.xl,
    shadows.xl,
    shadows.xl,
    shadows.xl,
    shadows.xl,
    shadows.xl,
    shadows['2xl'],
    shadows['2xl'],
    shadows['2xl'],
    shadows['2xl'],
    shadows['2xl'],
    shadows['2xl'],
    shadows['2xl'],
    shadows['2xl'],
    shadows['2xl'],
  ],
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarColor: `${colors.grey[300]} ${colors.grey[100]}`,
          '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
            width: 8,
            height: 8,
          },
          '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
            borderRadius: 8,
            backgroundColor: colors.grey[300],
            border: '2px solid transparent',
            backgroundClip: 'content-box',
          },
          '&::-webkit-scrollbar-track, & *::-webkit-scrollbar-track': {
            backgroundColor: colors.grey[100],
            borderRadius: 8,
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 10,
          fontWeight: 600,
          padding: '8px 20px',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            transform: 'translateY(-1px)',
          },
          '&:active': {
            transform: 'translateY(0)',
          },
        },
        contained: {
          boxShadow: shadows.md,
          '&:hover': {
            boxShadow: shadows.lg,
          },
        },
        containedPrimary: {
          background: gradients.primary,
          boxShadow: shadows.primary,
          '&:hover': {
            background: gradients.primary,
            boxShadow: shadows.primaryHover,
          },
        },
        containedSecondary: {
          background: gradients.secondary,
          '&:hover': {
            background: gradients.secondary,
          },
        },
        containedSuccess: {
          background: gradients.success,
          boxShadow: shadows.success,
        },
        containedWarning: {
          background: gradients.warning,
          boxShadow: shadows.warning,
        },
        containedError: {
          background: gradients.error,
          boxShadow: shadows.error,
        },
        outlined: {
          borderWidth: '1.5px',
          '&:hover': {
            borderWidth: '1.5px',
            backgroundColor: alpha(colors.primary.main, 0.04),
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          boxShadow: shadows.card,
          border: `1px solid ${colors.grey[100]}`,
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            boxShadow: shadows.cardHover,
            borderColor: colors.grey[200],
          },
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 24,
          '&:last-child': {
            paddingBottom: 24,
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          boxShadow: shadows.card,
        },
        elevation0: {
          boxShadow: 'none',
        },
        elevation1: {
          boxShadow: shadows.sm,
        },
        elevation2: {
          boxShadow: shadows.md,
        },
        elevation3: {
          boxShadow: shadows.lg,
        },
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
          backgroundColor: alpha(colors.primary.main, 0.1),
          color: colors.primary.dark,
          '&:hover': {
            backgroundColor: alpha(colors.primary.main, 0.2),
          },
        },
        colorSecondary: {
          backgroundColor: alpha(colors.secondary.main, 0.1),
          color: colors.secondary.dark,
        },
        colorSuccess: {
          backgroundColor: alpha(colors.success.main, 0.1),
          color: colors.success.dark,
        },
        colorWarning: {
          backgroundColor: alpha(colors.warning.main, 0.1),
          color: colors.warning.dark,
        },
        colorError: {
          backgroundColor: alpha(colors.error.main, 0.1),
          color: colors.error.dark,
        },
        colorInfo: {
          backgroundColor: alpha(colors.info.main, 0.1),
          color: colors.info.dark,
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          height: 8,
          backgroundColor: colors.grey[100],
        },
        bar: {
          borderRadius: 8,
          background: gradients.primary,
        },
        barColorPrimary: {
          background: gradients.primary,
        },
        barColorSecondary: {
          background: gradients.secondary,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 10,
            transition: 'all 0.2s ease',
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: colors.primary.light,
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderWidth: 2,
              boxShadow: `0 0 0 4px ${alpha(colors.primary.main, 0.1)}`,
            },
          },
        },
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          boxShadow: shadows.sm,
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
            backgroundColor: alpha(colors.primary.main, 0.08),
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
            backgroundColor: alpha(colors.primary.main, 0.06),
          },
          '&.Mui-selected': {
            backgroundColor: alpha(colors.primary.main, 0.1),
            '&:hover': {
              backgroundColor: alpha(colors.primary.main, 0.15),
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
          '&.Mui-selected': {
            fontWeight: 600,
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 20,
          boxShadow: shadows['2xl'],
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
        root: {
          padding: '16px 24px',
        },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: '16px 24px 24px',
          gap: 12,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          fontWeight: 500,
        },
        standardSuccess: {
          backgroundColor: alpha(colors.success.main, 0.1),
          color: colors.success.dark,
        },
        standardWarning: {
          backgroundColor: alpha(colors.warning.main, 0.1),
          color: colors.warning.dark,
        },
        standardError: {
          backgroundColor: alpha(colors.error.main, 0.1),
          color: colors.error.dark,
        },
        standardInfo: {
          backgroundColor: alpha(colors.info.main, 0.1),
          color: colors.info.dark,
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
          backgroundColor: colors.grey[800],
          padding: '8px 12px',
          borderRadius: 8,
          fontSize: '0.75rem',
          fontWeight: 500,
        },
        arrow: {
          color: colors.grey[800],
        },
      },
    },
    MuiStepper: {
      styleOverrides: {
        root: {
          padding: 16,
        },
      },
    },
    MuiStepLabel: {
      styleOverrides: {
        label: {
          fontWeight: 500,
          '&.Mui-active': {
            fontWeight: 600,
          },
          '&.Mui-completed': {
            fontWeight: 500,
          },
        },
      },
    },
    MuiStepIcon: {
      styleOverrides: {
        root: {
          '&.Mui-active': {
            color: colors.primary.main,
          },
          '&.Mui-completed': {
            color: colors.success.main,
          },
        },
      },
    },
    MuiTable: {
      styleOverrides: {
        root: {
          borderCollapse: 'separate',
          borderSpacing: 0,
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-head': {
            backgroundColor: colors.grey[50],
            fontWeight: 600,
            color: colors.grey[600],
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
            backgroundColor: alpha(colors.primary.main, 0.02),
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${colors.grey[100]}`,
          padding: '16px',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          border: 'none',
          boxShadow: shadows.xl,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: shadows.md,
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          boxShadow: shadows.xl,
          border: `1px solid ${colors.grey[100]}`,
          marginTop: 4,
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
            backgroundColor: alpha(colors.primary.main, 0.06),
          },
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: colors.grey[100],
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          width: 50,
          height: 28,
          padding: 0,
        },
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
          boxShadow: shadows.sm,
        },
        track: {
          borderRadius: 14,
          backgroundColor: colors.grey[300],
          opacity: 1,
        },
      },
    },
    MuiSlider: {
      styleOverrides: {
        root: {
          height: 8,
        },
        rail: {
          backgroundColor: colors.grey[200],
          opacity: 1,
        },
        track: {
          background: gradients.primary,
          border: 'none',
        },
        thumb: {
          width: 20,
          height: 20,
          backgroundColor: '#fff',
          border: `3px solid ${colors.primary.main}`,
          boxShadow: shadows.md,
          '&:hover': {
            boxShadow: shadows.primary,
          },
        },
      },
    },
    MuiSkeleton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: colors.grey[100],
        },
      },
    },
  },
});

// Export additional utilities
export { colors, shadows };
export default theme;
