'use client';

import { createTheme, alpha, type PaletteMode, type ThemeOptions } from '@mui/material/styles';
import { performancePalettes, systemFont } from '@/lib/performance-design';

declare module '@mui/material/styles' {
  interface PaletteColor { lighter?: string; }
  interface SimplePaletteColorOptions { lighter?: string; }
}

// Kept for existing feature imports. All action surfaces are deliberately solid.
export const colors = {
  primary: { main: '#0066cc', light: '#64a7ff', dark: '#004f9f', 50: '#eaf3ff', 100: '#d6e8ff', 200: '#b5d6ff', 500: '#0066cc', 600: '#005bb8', 700: '#004f9f' },
  secondary: { main: '#62636b', light: '#b0b1bb', dark: '#45464e' },
  success: { main: '#167348', light: '#70d6a1', dark: '#105835' },
  warning: { main: '#925700', light: '#edc16b', dark: '#714300' },
  error: { main: '#bd2935', light: '#ff929b', dark: '#96202b' },
  info: { main: '#0066cc', light: '#64a7ff', dark: '#004f9f' },
  grey: { 50: '#f5f5f7', 100: '#eeeef2', 200: '#dcdde3', 300: '#b7b9c4', 400: '#92949f', 500: '#6e7079', 600: '#62636b', 700: '#45464e', 800: '#25262b', 900: '#1c1d21', 950: '#101114' },
};
export const gradients = {
  primary: 'var(--suite-accent)', secondary: 'var(--suite-muted)', success: 'var(--suite-positive)',
  warning: 'var(--suite-warning)', error: 'var(--suite-danger)', info: 'var(--suite-accent)',
  purple: 'var(--suite-accent)', sunset: 'var(--suite-warning)', ocean: 'var(--suite-accent)',
  dark: 'var(--suite-surface)', glass: 'var(--performance-chrome)', cardHover: 'var(--suite-surface-muted)',
};
export const shadows = {
  sm: '0 1px 3px rgba(20,24,40,.05)', md: '0 2px 8px rgba(20,24,40,.08)',
  lg: '0 8px 24px rgba(20,24,40,.12)', xl: '0 8px 32px rgba(20,24,40,.14)',
  '2xl': '0 12px 40px rgba(20,24,40,.18)', primary: 'none', primaryHover: 'none',
  success: 'none', warning: 'none', error: 'none', card: '0 1px 3px rgba(20,24,40,.05)',
  cardHover: '0 1px 3px rgba(20,24,40,.05)', glow: 'none',
};

export function getDesignTokens(mode: PaletteMode): ThemeOptions {
  const p = performancePalettes[mode];
  const dark = mode === 'dark';
  const focus = { outline: `2px solid ${p.accent}`, outlineOffset: 3 };
  const feedback = { transition: 'background-color 140ms ease-out, color 140ms ease-out, border-color 140ms ease-out', '&:active:not(.Mui-disabled)': { opacity: .72, transition: 'none' }, '&.Mui-focusVisible': focus };
  const semantic = (main: string, light: string, deep: string) => ({ main, light, dark: dark ? main : deep, lighter: alpha(main, dark ? .16 : .08) });
  return {
    palette: {
      mode,
      primary: { ...semantic(p.accent, colors.primary.light, dark ? '#93c2ff' : '#004f9f'), contrastText: p.actionInk },
      secondary: { ...semantic(p.muted, '#b0b1bb', '#45464e'), contrastText: dark ? '#101114' : '#ffffff' },
      success: semantic(p.positive, colors.success.light, colors.success.dark),
      warning: semantic(p.warning, colors.warning.light, colors.warning.dark),
      error: semantic(p.danger, colors.error.light, colors.error.dark),
      info: semantic(p.accent, colors.info.light, colors.info.dark),
      grey: colors.grey,
      background: { default: p.canvas, paper: p.surface },
      text: { primary: p.ink, secondary: p.muted, disabled: alpha(p.ink, .4) },
      divider: p.line,
      action: { active: p.muted, hover: alpha(p.ink, .045), selected: alpha(p.accent, .1), disabled: alpha(p.ink, .38), disabledBackground: p.mutedSurface },
    },
    typography: {
      fontFamily: systemFont,
      h1: { fontSize: 'clamp(1.75rem, 3vw, 2.25rem)', fontWeight: 650, letterSpacing: '-.025em', lineHeight: 1.18 },
      h2: { fontSize: 'clamp(1.625rem, 2.5vw, 2rem)', fontWeight: 650, letterSpacing: '-.025em', lineHeight: 1.2 },
      h3: { fontSize: '1.75rem', fontWeight: 650, letterSpacing: '-.02em', lineHeight: 1.2 },
      h4: { fontSize: 'clamp(1.5rem, 2.5vw, 1.875rem)', fontWeight: 650, letterSpacing: '-.025em', lineHeight: 1.2 },
      h5: { fontSize: '1.25rem', fontWeight: 650, letterSpacing: '-.015em', lineHeight: 1.3 },
      h6: { fontSize: '1.0625rem', fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.4 },
      body1: { fontSize: '.9375rem', lineHeight: 1.6, letterSpacing: 0 },
      body2: { fontSize: '.875rem', lineHeight: 1.55, letterSpacing: 0 },
      subtitle1: { fontSize: '.9375rem', fontWeight: 600, lineHeight: 1.5 },
      subtitle2: { fontSize: '.875rem', fontWeight: 600, lineHeight: 1.5 },
      caption: { fontSize: '.75rem', lineHeight: 1.5, letterSpacing: '.01em' },
      button: { fontSize: '.875rem', fontWeight: 600, letterSpacing: 0, textTransform: 'none' },
      overline: { fontSize: '.75rem', fontWeight: 600, lineHeight: 1.5, letterSpacing: '.015em', textTransform: 'none' },
    },
    shape: { borderRadius: 8 },
    components: {
      MuiCssBaseline: { styleOverrides: {
        body: { background: p.canvas, color: p.ink, fontFamily: systemFont },
        '@media (prefers-reduced-motion: reduce)': { '*, *::before, *::after': { animationDuration: '.01ms !important', animationIterationCount: '1 !important', transitionDuration: '.01ms !important', scrollBehavior: 'auto !important' } },
      } },
      MuiTypography: { styleOverrides: { root: { overflowWrap: 'anywhere' } } },
      MuiButtonBase: { defaultProps: { disableRipple: true }, styleOverrides: { root: { ...feedback, scrollMarginTop: '5.5rem', '@media (hover: none) and (pointer: coarse)': { minHeight: 44 } } } },
      MuiButton: { styleOverrides: {
        root: { borderRadius: 8, minHeight: 40, padding: '8px 16px', fontWeight: 600, boxShadow: 'none', ...feedback },
        sizeSmall: { minHeight: 34, padding: '6px 12px', fontSize: '.8125rem' },
        sizeLarge: { minHeight: 44, padding: '10px 20px' },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
        outlined: { borderColor: p.strongLine, '&:hover': { borderColor: p.accent, background: p.accentSoft } },
        text: { '&:hover': { background: p.accentSoft } },
      } },
      MuiIconButton: { styleOverrides: { root: { ...feedback, borderRadius: 8, '&:hover': { background: p.mutedSurface } } } },
      MuiPaper: { styleOverrides: { root: { background: p.surface, backgroundImage: 'none', color: p.ink }, outlined: { borderColor: p.line }, rounded: { borderRadius: 12 }, elevation1: { boxShadow: p.shadow } } },
      MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { background: p.surface, border: `1px solid ${p.line}`, borderRadius: 12, boxShadow: 'none' } } },
      MuiCardContent: { styleOverrides: { root: { padding: 24, '&:last-child': { paddingBottom: 24 }, '@media(max-width:599px)': { padding: 16, '&:last-child': { paddingBottom: 16 } } } } },
      MuiCardActionArea: { styleOverrides: { root: feedback } },
      MuiChip: { styleOverrides: { root: { borderRadius: 6, fontWeight: 500, fontSize: '.75rem', maxWidth: '100%' }, label: { overflow: 'hidden', textOverflow: 'ellipsis' } } },
      MuiOutlinedInput: { styleOverrides: {
        root: { borderRadius: 8, background: p.surface, '& .MuiOutlinedInput-notchedOutline': { borderColor: p.strongLine }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: p.muted }, '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: p.accent, borderWidth: 2 }, '&.Mui-focused': { boxShadow: `0 0 0 3px ${alpha(p.accent,.12)}` } },
        input: { '@media(hover:none) and (pointer:coarse)': { fontSize: '1rem' } },
      } },
      MuiInputLabel: { styleOverrides: { root: { color: p.muted } } },
      MuiFormLabel: { styleOverrides: { root: { color: p.muted } } },
      MuiFormHelperText: { styleOverrides: { root: { color: p.muted, lineHeight: 1.5 } } },
      MuiTabs: { styleOverrides: { root: { minHeight: 44, borderBottom: `1px solid ${p.line}` }, indicator: { height: 2, borderRadius: '2px 2px 0 0', background: p.accent }, scrollButtons: { '&.Mui-disabled': { opacity: .35 } } } },
      MuiTab: {
        defaultProps: {
          onFocus: (event) => {
            // Reveal a keyboard target before activation rather than waiting for
            // the Tabs selection animation while it is outside the viewport.
            if (event.currentTarget.matches(':focus-visible')) {
              event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
            }
          },
        },
        styleOverrides: { root: { minHeight: 44, minWidth: 0, padding: '10px 16px', textTransform: 'none', fontWeight: 500, fontSize: '.875rem', color: p.muted, ...feedback, '&.Mui-selected': { color: p.accent, fontWeight: 600 } } },
      },
      MuiDialog: { defaultProps: { transitionDuration: 150 }, styleOverrides: { paper: { borderRadius: 16, background: p.surface, border: `1px solid ${p.line}`, boxShadow: p.overlayShadow, maxHeight: 'calc(100dvh - 3rem)', '@media(max-width:599px)': { margin: 16, width: 'calc(100% - 32px)', maxWidth: 'calc(100% - 32px)' } } } },
      MuiDialogTitle: { styleOverrides: { root: { padding: '24px 24px 16px', fontSize: '1.25rem', lineHeight: 1.3, fontWeight: 650, letterSpacing: '-.015em' } } },
      MuiDialogContent: { styleOverrides: { root: { padding: '16px 24px', overflowWrap: 'anywhere' } } },
      MuiDialogActions: { styleOverrides: { root: { padding: '16px 24px 24px', gap: 8, flexWrap: 'wrap' } } },
      MuiBackdrop: { styleOverrides: { root: { background: 'rgba(10, 14, 24, .42)' } } },
      MuiDrawer: { styleOverrides: { paper: { background: p.surface, color: p.ink, borderColor: p.line, boxShadow: p.overlayShadow } } },
      MuiAppBar: { styleOverrides: { root: { background: p.chrome, color: p.ink, backdropFilter: 'blur(20px)', boxShadow: 'none', borderBottom: `1px solid ${p.line}`, '@media(prefers-reduced-transparency:reduce), (prefers-contrast:more)': { background: p.surface, backdropFilter: 'none' } } } },
      MuiPopover: { styleOverrides: { paper: { border: `1px solid ${p.line}`, borderRadius: 10, background: p.surface, boxShadow: p.overlayShadow } } },
      MuiMenu: { styleOverrides: { paper: { background: p.surface, border: `1px solid ${p.line}`, borderRadius: 10, boxShadow: p.overlayShadow, marginTop: 4 } } },
      MuiMenuItem: { styleOverrides: { root: { ...feedback, borderRadius: 6, margin: '2px 6px', padding: '8px 10px', fontSize: '.875rem', '&.Mui-selected': { background: p.accentSoft, color: p.accent }, '&.Mui-selected:hover': { background: p.accentSoft } } } },
      MuiListItemButton: { styleOverrides: { root: { ...feedback, borderRadius: 8, '&.Mui-selected': { background: p.accentSoft, color: p.accent } } } },
      MuiTableContainer: { styleOverrides: { root: { maxWidth: '100%', overflowX: 'auto', borderRadius: 10 } } },
      MuiTable: { styleOverrides: { root: { fontVariantNumeric: 'tabular-nums' } } },
      MuiTableCell: { styleOverrides: { root: { borderColor: p.line, padding: '14px 16px', fontSize: '.875rem', lineHeight: 1.5 }, head: { background: p.mutedSurface, color: p.muted, fontWeight: 600, fontSize: '.75rem', letterSpacing: '.01em', textTransform: 'none' } } },
      MuiTableRow: { styleOverrides: { root: { '&.MuiTableRow-hover:hover': { background: alpha(p.accent,.04) } } } },
      MuiLinearProgress: { styleOverrides: { root: { height: 6, borderRadius: 4, background: p.mutedSurface }, bar: { borderRadius: 4 } } },
      MuiCircularProgress: { defaultProps: { size: 32 } },
      MuiAvatar: { styleOverrides: { root: { fontSize: '.9375rem', fontWeight: 600 }, colorDefault: { background: p.accentSoft, color: p.accent } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10, lineHeight: 1.5 }, standardSuccess: { background: alpha(p.positive,.1), color: p.positive }, standardWarning: { background: alpha(p.warning,.1), color: p.warning }, standardError: { background: alpha(p.danger,.1), color: p.danger }, standardInfo: { background: p.accentSoft, color: p.accent } } },
      MuiTooltip: { styleOverrides: { tooltip: { borderRadius: 6, padding: '8px 12px', fontSize: '.75rem', lineHeight: 1.5, background: dark ? '#e6e7ec' : '#25262b', color: dark ? '#101114' : '#ffffff' } } },
      MuiAccordion: { styleOverrides: { root: { border: `1px solid ${p.line}`, background: p.surface, boxShadow: 'none', '&:before': { display: 'none' }, '&.Mui-expanded': { margin: '0 0 16px' } } } },
      MuiAccordionSummary: { styleOverrides: { root: { '&:hover': { background: p.mutedSurface } } } },
      MuiDivider: { styleOverrides: { root: { borderColor: p.line } } },
      MuiSkeleton: { styleOverrides: { root: { background: p.mutedSurface, borderRadius: 8 } } },
      MuiSwitch: { styleOverrides: { switchBase: { '&.Mui-checked': { color: p.accent, '& + .MuiSwitch-track': { background: p.accent, opacity: .45 } } } } },
      MuiSlider: { styleOverrides: { root: { height: 6 }, thumb: { boxShadow: p.shadow, '&:hover': { boxShadow: `0 0 0 6px ${alpha(p.accent,.12)}` } } } },
      MuiStepLabel: { styleOverrides: { label: { '&.Mui-active': { fontWeight: 600, color: p.ink }, '&.Mui-completed': { color: p.muted } } } },
    },
  };
}

export default createTheme(getDesignTokens('light'));
