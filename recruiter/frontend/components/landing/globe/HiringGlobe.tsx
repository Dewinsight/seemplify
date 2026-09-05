'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import createGlobe, { type Arc, type Marker } from 'cobe';
import { useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

const LAGOS: [number, number] = [6.5244, 3.3792];
const LONDON: [number, number] = [51.5072, -0.1276];
const NEW_YORK: [number, number] = [40.7128, -74.006];
const NAIROBI: [number, number] = [-1.2921, 36.8219];
const DUBAI: [number, number] = [25.2048, 55.2708];
const SINGAPORE: [number, number] = [1.3521, 103.8198];
const BERLIN: [number, number] = [52.52, 13.405];
const TORONTO: [number, number] = [43.6532, -79.3832];
const SYDNEY: [number, number] = [-33.8688, 151.2093];
const SAO_PAULO: [number, number] = [-23.5505, -46.6333];
const JOHANNESBURG: [number, number] = [-26.2041, 28.0473];
const ACCRA: [number, number] = [5.6037, -0.187];

const MARKERS: Marker[] = [
  { location: LAGOS, size: 0.1 },
  { location: LONDON, size: 0.07 },
  { location: NEW_YORK, size: 0.07 },
  { location: NAIROBI, size: 0.06 },
  { location: DUBAI, size: 0.06 },
  { location: SINGAPORE, size: 0.05 },
  { location: BERLIN, size: 0.05 },
  { location: TORONTO, size: 0.05 },
  { location: SYDNEY, size: 0.05 },
  { location: SAO_PAULO, size: 0.05 },
  { location: JOHANNESBURG, size: 0.05 },
  { location: ACCRA, size: 0.05 },
];

const ARCS: Arc[] = [
  { from: LAGOS, to: LONDON },
  { from: LAGOS, to: NEW_YORK },
  { from: LAGOS, to: NAIROBI },
  { from: LAGOS, to: DUBAI },
  { from: LONDON, to: TORONTO },
  { from: NAIROBI, to: SINGAPORE },
];

type GlobeTheme = 'light' | 'dark';

const PALETTES = {
  light: {
    dark: 0,
    diffuse: 0.9,
    mapBrightness: 3.2,
    mapBaseBrightness: 0.08,
    baseColor: [0.96, 0.95, 0.92] as [number, number, number],
    markerColor: [0.44, 0.28, 0.92] as [number, number, number],
    glowColor: [0.9, 0.86, 0.98] as [number, number, number],
    arcColor: [0.44, 0.28, 0.92] as [number, number, number],
  },
  dark: {
    dark: 1,
    diffuse: 1.8,
    mapBrightness: 9,
    baseColor: [0.3, 0.32, 0.62] as [number, number, number],
    markerColor: [0.55, 0.85, 1] as [number, number, number],
    glowColor: [0.3, 0.24, 0.65] as [number, number, number],
    arcColor: [0.7, 0.45, 0.98] as [number, number, number],
  },
};

/** cobe (MIT, ~5 kB WebGL). Drag to spin; idles slowly; sleeps off-screen. */
export default function HiringGlobe({ className, theme = 'dark' }: { className?: string; theme?: GlobeTheme }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();
  const [ready, setReady] = useState(false);
  const drag = useRef({ startX: null as number | null, offset: 0, base: 0 });
  const visible = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let width = canvas.offsetWidth;
    let phi = 0;
    let raf = 0;
    const onResize = () => {
      width = canvas.offsetWidth;
    };
    window.addEventListener('resize', onResize);

    const globe = createGlobe(canvas, {
      ...PALETTES[theme],
      devicePixelRatio: 2,
      width: width * 2,
      height: width * 2,
      phi: 0,
      theta: 0.28,
      mapSamples: 20000,
      markers: MARKERS,
      arcs: ARCS,
      opacity: 0.95,
    });

    const io = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
    });
    io.observe(canvas);

    const loop = () => {
      if (visible.current) {
        if (!reduceMotion && drag.current.startX === null) phi += 0.0028;
        globe.update({ phi: phi + drag.current.offset, width: width * 2, height: width * 2 });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    setReady(true);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('resize', onResize);
      globe.destroy();
    };
  }, [reduceMotion, theme]);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    drag.current.startX = e.clientX;
    drag.current.base = drag.current.offset;
    e.currentTarget.style.cursor = 'grabbing';
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current.startX === null) return;
    drag.current.offset = drag.current.base + (e.clientX - drag.current.startX) / 180;
  };
  const endDrag = (e: PointerEvent<HTMLCanvasElement>) => {
    drag.current.startX = null;
    e.currentTarget.style.cursor = 'grab';
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      className={cn(
        'aspect-square w-full cursor-grab touch-none transition-opacity duration-1000',
        ready ? 'opacity-100' : 'opacity-0',
        className,
      )}
      aria-label="Globe showing interview activity across Lagos, London, New York, Nairobi, Dubai and other cities"
    />
  );
}
