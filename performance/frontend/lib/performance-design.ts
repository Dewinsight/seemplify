/** Performance-only design values shared by SSR CSS, Tailwind and Material UI. */
export const systemFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const performancePalettes = {
  light: {
    canvas: '#f5f5f7', surface: '#ffffff', mutedSurface: '#eeeef2',
    ink: '#1d1d1f', muted: '#62636b', subtle: '#6e7079',
    line: '#dcdde3', strongLine: '#858791', accent: '#0066cc', accentSoft: '#eaf3ff',
    actionInk: '#ffffff', positive: '#167348', warning: '#925700', danger: '#bd2935',
    chrome: 'rgba(250, 250, 252, .92)', shadow: '0 1px 3px rgba(20, 24, 40, .05)',
    overlayShadow: '0 8px 32px rgba(20, 24, 40, .14)',
  },
  dark: {
    canvas: '#101114', surface: '#1c1d21', mutedSurface: '#25262b',
    ink: '#f5f5f7', muted: '#b0b1bb', subtle: '#a2a4af',
    line: '#393a43', strongLine: '#777a87', accent: '#64a7ff', accentSoft: '#172c48',
    actionInk: '#071426', positive: '#70d6a1', warning: '#edc16b', danger: '#ff929b',
    chrome: 'rgba(28, 29, 33, .94)', shadow: '0 1px 3px rgba(0, 0, 0, .18)',
    overlayShadow: '0 8px 32px rgba(0, 0, 0, .38)',
  },
} as const;

function rgb(hex: string) {
  return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)).join(' ');
}

function cssPalette(mode: keyof typeof performancePalettes) {
  const p = performancePalettes[mode];
  const aliases = {
    '--suite-canvas': p.canvas, '--suite-surface': p.surface, '--suite-surface-muted': p.mutedSurface,
    '--suite-ink': p.ink, '--suite-muted': p.muted, '--suite-subtle': p.subtle,
    '--suite-line': p.line, '--suite-line-strong': p.strongLine, '--suite-accent': p.accent,
    '--suite-accent-soft': p.accentSoft, '--suite-positive': p.positive, '--suite-warning': p.warning,
    '--suite-danger': p.danger, '--suite-action': p.accent, '--suite-action-ink': p.actionInk,
    '--suite-shadow': p.shadow, '--performance-chrome': p.chrome, '--performance-overlay-shadow': p.overlayShadow,
    '--background-rgb': rgb(p.canvas), '--foreground-rgb': rgb(p.ink), '--card-rgb': rgb(p.surface),
    '--muted-rgb': rgb(p.mutedSurface), '--muted-foreground-rgb': rgb(p.muted),
    '--border-rgb': rgb(p.line), '--input-rgb': rgb(p.strongLine), '--primary-rgb': rgb(p.accent),
    '--primary-foreground-rgb': rgb(p.actionInk), '--accent-rgb': rgb(p.accentSoft),
    '--danger-rgb': rgb(p.danger), '--positive-rgb': rgb(p.positive), '--warning-rgb': rgb(p.warning),
    '--background-start-rgb': rgb(p.canvas).replaceAll(' ', ', '),
    '--background-end-rgb': rgb(p.canvas).replaceAll(' ', ', '),
  };
  return Object.entries(aliases).map(([name, value]) => `${name}:${value}`).join(';');
}

// Deterministic, public constants only: stable before hydration and in every portal.
export const performanceCssTokens = `:root,[data-theme="light"]{color-scheme:light;${cssPalette('light')}}html.dark,[data-theme="dark"]{color-scheme:dark;${cssPalette('dark')}}`;
