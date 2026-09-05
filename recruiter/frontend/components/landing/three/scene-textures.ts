'use client';

import * as THREE from 'three';

/**
 * Canvas-painted textures for the Recruiter landing's 3D scenes. Everything
 * the scenes show as "paper" or "UI" is drawn here in the Seemplify tokens,
 * so the WebGL layer carries no DOM and the type matches the page.
 */

/** Seemplify tokens, mirrored from app/landing-brand.css. */
export const INK = {
  canvas: '#f1efe9',
  surface: '#fffdfa',
  sunken: '#ebe7df',
  block: '#ddd8ce',
  paperEdge: '#e9e4da',
  line: 'rgba(49, 45, 57, 0.14)',
  lineStrong: 'rgba(49, 45, 57, 0.26)',
  text: '#191816',
  muted: '#625e57',
  faint: '#8a847a',
  brand: '#7047eb',
  brandSoft: '#e6ddff',
  brandInk: '#4a2fb2',
  positive: '#00875f',
  positiveSoft: '#d6f0e6',
  warning: '#ae6c00',
  warningSoft: '#f9ead0',
  white: '#ffffff',
} as const;

let fontCache: { body: string; display: string } | null = null;

/** The landing's font stacks, read from the brand skin so canvas text matches the page. */
export function sceneFonts() {
  if (fontCache) return fontCache;
  const body = '"IBM Plex Sans", system-ui, sans-serif';
  const display = '"Space Grotesk", "IBM Plex Sans", system-ui, sans-serif';
  if (typeof document === 'undefined') return { body, display };
  const host = document.querySelector('.landing-seemplify') ?? document.body;
  const css = getComputedStyle(host);
  const bodyVar = css.getPropertyValue('--marketing-font').trim();
  const displayVar = css.getPropertyValue('--marketing-heading').trim();
  fontCache = { body: bodyVar || css.fontFamily || body, display: displayVar || bodyVar || display };
  return fontCache;
}

export type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** A canvas + CanvasTexture pair that can be repainted in place. */
export class Painted {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly painter: Painter,
    anisotropy = 8,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
    this.paint();
  }

  paint() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.painter(this.ctx, this.width, this.height);
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}

/** Repaint once web fonts have arrived so nothing stays in the fallback face. */
export function repaintWhenFontsReady(items: Painted[]) {
  if (typeof document === 'undefined' || !document.fonts?.ready) return;
  document.fonts.ready
    .then(() => {
      fontCache = null;
      items.forEach((item) => item.paint());
    })
    .catch(() => {});
}

/* ----------------------------------------------------------------------- */
/* Drawing helpers                                                          */
/* ----------------------------------------------------------------------- */

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function fillRounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string, lineWidth = 2) {
  roundedPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function write(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = 'left',
  baseline: CanvasTextBaseline = 'alphabetic',
) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
}

/** Small-caps style label with manual letter spacing. */
function writeSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string, spacing: number) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
}

/* ----------------------------------------------------------------------- */
/* Painters                                                                 */
/* ----------------------------------------------------------------------- */

export interface SheetProfile {
  initials: string;
  name: string;
  role: string;
  meta: string;
  skills: string[];
  /** [title, first line width, second line width] as fractions of the text column. */
  roles: Array<[string, number, number]>;
  education: string;
}

/** An A4 CV: real name, role and skills, with paragraph lines suggested as bars. */
export function paintSheet(p: SheetProfile): Painter {
  return (ctx, w, h) => {
    const f = sceneFonts();
    const margin = 96;
    const column = w - margin * 2;

    ctx.fillStyle = INK.surface;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = INK.brand;
    ctx.fillRect(0, 0, w, 14);

    // Identity block.
    ctx.fillStyle = INK.brandSoft;
    ctx.beginPath();
    ctx.arc(margin + 74, 200, 74, 0, Math.PI * 2);
    ctx.fill();
    write(ctx, p.initials, margin + 74, 204, `600 58px ${f.display}`, INK.brandInk, 'center', 'middle');
    write(ctx, p.name, margin + 184, 176, `600 64px ${f.display}`, INK.text);
    write(ctx, p.role, margin + 184, 236, `400 40px ${f.body}`, INK.muted);
    write(ctx, p.meta, margin + 184, 286, `400 34px ${f.body}`, INK.faint);

    ctx.fillStyle = INK.line;
    ctx.fillRect(margin, 344, column, 2);

    // Skills.
    writeSpaced(ctx, 'SKILLS', margin, 414, `600 27px ${f.body}`, INK.faint, 5);
    let cursor = margin;
    ctx.font = `500 32px ${f.body}`;
    for (const skill of p.skills) {
      const width = ctx.measureText(skill).width + 48;
      if (cursor + width > w - margin) break;
      fillRounded(ctx, cursor, 442, width, 62, 31, INK.sunken);
      write(ctx, skill, cursor + width / 2, 474, `500 32px ${f.body}`, INK.muted, 'center', 'middle');
      cursor += width + 18;
    }

    // Experience: a real title per role, then two "paragraph" bars.
    writeSpaced(ctx, 'EXPERIENCE', margin, 600, `600 27px ${f.body}`, INK.faint, 5);
    p.roles.forEach(([title, a, b], i) => {
      const y = 640 + i * 168;
      write(ctx, title, margin, y + 30, `600 35px ${f.body}`, INK.text);
      fillRounded(ctx, margin, y + 58, column * a, 18, 9, INK.sunken);
      fillRounded(ctx, margin, y + 90, column * b, 18, 9, INK.sunken);
    });

    // Education.
    const eduY = 640 + p.roles.length * 168 + 34;
    writeSpaced(ctx, 'EDUCATION', margin, eduY, `600 27px ${f.body}`, INK.faint, 5);
    write(ctx, p.education, margin, eduY + 56, `500 34px ${f.body}`, INK.muted);

    // Footer stamp from the parser.
    ctx.fillStyle = INK.line;
    ctx.fillRect(margin, h - 118, column, 2);
    ctx.fillStyle = INK.positive;
    ctx.beginPath();
    ctx.arc(margin + 10, h - 66, 9, 0, Math.PI * 2);
    ctx.fill();
    write(ctx, `Parsed · ${p.skills.length} skills · ${p.roles.length} roles`, margin + 34, h - 66, `500 30px ${f.body}`, INK.faint, 'left', 'middle');
  };
}

export interface PillOptions {
  fill: string;
  color: string;
  stroke?: string;
  sub?: string;
  subColor?: string;
  size?: number;
  shadow?: boolean;
  display?: boolean;
}

/** A floating pill: one line of text, optionally with a smaller second line. */
export function paintPill(label: string, opts: PillOptions): Painter {
  return (ctx, w, h) => {
    const f = sceneFonts();
    const pad = Math.round(h * 0.16);
    const size = opts.size ?? Math.round(h * 0.42);
    if (opts.shadow !== false) {
      ctx.shadowColor = 'rgba(49, 45, 57, 0.22)';
      ctx.shadowBlur = pad * 1.6;
      ctx.shadowOffsetY = pad * 0.5;
    }
    fillRounded(ctx, pad, pad, w - pad * 2, h - pad * 2, (h - pad * 2) / 2, opts.fill, opts.stroke, 3);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    const face = opts.display === false ? f.body : f.display;
    if (opts.sub) {
      write(ctx, label, w / 2, h * 0.43, `600 ${size}px ${face}`, opts.color, 'center', 'middle');
      write(ctx, opts.sub, w / 2, h * 0.7, `500 ${Math.round(size * 0.46)}px ${f.body}`, opts.subColor ?? opts.color, 'center', 'middle');
    } else {
      write(ctx, label, w / 2, h / 2 + 2, `600 ${size}px ${face}`, opts.color, 'center', 'middle');
    }
  };
}

/** A small floating card: eyebrow, title, one line of detail. */
export function paintCard(eyebrow: string, title: string, detail: string): Painter {
  return (ctx, w, h) => {
    const f = sceneFonts();
    const pad = Math.round(h * 0.1);
    ctx.shadowColor = 'rgba(49, 45, 57, 0.2)';
    ctx.shadowBlur = pad * 1.4;
    ctx.shadowOffsetY = pad * 0.4;
    fillRounded(ctx, pad, pad, w - pad * 2, h - pad * 2, Math.round(h * 0.11), INK.surface, INK.lineStrong, 3);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    const x = pad * 2.2;
    writeSpaced(ctx, eyebrow, x, h * 0.33, `600 ${Math.round(h * 0.11)}px ${f.body}`, INK.brand, 4);
    write(ctx, title, x, h * 0.58, `600 ${Math.round(h * 0.2)}px ${f.display}`, INK.text);
    write(ctx, detail, x, h * 0.78, `400 ${Math.round(h * 0.125)}px ${f.body}`, INK.muted);
  };
}

/** A quiet caption on a surface pill: uppercase, letter-spaced. */
export function paintCaption(label: string): Painter {
  return (ctx, w, h) => {
    const f = sceneFonts();
    const pad = Math.round(h * 0.14);
    fillRounded(ctx, pad, pad, w - pad * 2, h - pad * 2, (h - pad * 2) / 2, INK.surface, INK.lineStrong, 3);
    ctx.font = `600 ${Math.round(h * 0.3)}px ${f.body}`;
    const spacing = 4;
    let width = 0;
    for (const ch of label) width += ctx.measureText(ch).width + spacing;
    writeSpaced(ctx, label, (w - width + spacing) / 2, h / 2 + h * 0.11, ctx.font, INK.muted, spacing);
  };
}

/** A timeline lane: sunken strip with hour ticks. */
export function paintLane(hours: number): Painter {
  return (ctx, w, h) => {
    fillRounded(ctx, 0, 0, w, h, Math.min(24, h / 2), INK.sunken);
    ctx.fillStyle = INK.lineStrong;
    for (let i = 0; i <= hours; i++) {
      const x = Math.round((i / hours) * (w - 4)) + 2;
      const tall = i % 2 === 0;
      ctx.fillRect(x - 1, 0, 3, tall ? h * 0.22 : h * 0.12);
    }
  };
}

/** Vertical light beam: solid at the top, gone at the bottom. */
export function paintBeam(color: string): Painter {
  return (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, hexToRgba(color, 0.7));
    g.addColorStop(0.35, hexToRgba(color, 0.32));
    g.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
}

/** Soft round dot for point sprites. */
export function paintDot(color: string): Painter {
  return (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, hexToRgba(color, 1));
    g.addColorStop(0.45, hexToRgba(color, 0.85));
    g.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
}

function hexToRgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
