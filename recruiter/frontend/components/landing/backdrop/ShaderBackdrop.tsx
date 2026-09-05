'use client';

import { useEffect, useState } from 'react';
import { MeshGradient } from '@paper-design/shaders-react';
import { useReducedMotion } from 'framer-motion';

const IDLE_SPEED = 0.22;

type Variant = 'light' | 'dark';

// Light: the Seemplify cream, lilac and a breath of mint. Dark: the original deep violet.
const COLORS: Record<Variant, string[]> = {
  light: ['#efece5', '#d9caff', '#c9b9f4', '#f4f0e9', '#cdece0'],
  dark: ['#050816', '#1e1b4b', '#312e81', '#4c1d95', '#0b1220'],
};

/**
 * Full-page GPU mesh gradient (Paper Shaders, Apache-2.0) in place of the
 * blurred-div orbs. One canvas, zero dependencies. Freezes when the tab is
 * hidden or the visitor prefers reduced motion.
 */
export default function ShaderBackdrop({ variant = 'dark' }: { variant?: Variant }) {
  const reduceMotion = useReducedMotion();
  const [speed, setSpeed] = useState(0);

  useEffect(() => {
    const sync = () => setSpeed(document.hidden || reduceMotion ? 0 : IDLE_SPEED);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [reduceMotion]);

  const light = variant === 'light';

  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <MeshGradient
        className="absolute inset-0"
        style={{ width: '100%', height: '100%', opacity: light ? 0.72 : 1 }}
        colors={COLORS[variant]}
        distortion={light ? 0.75 : 0.9}
        swirl={light ? 0.4 : 0.55}
        grainMixer={light ? 0.06 : 0.12}
        grainOverlay={light ? 0.04 : 0.1}
        speed={speed}
      />
      {light ? (
        <>
          {/* Keep the cream ground dominant; the gradient only breathes at the top. */}
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(241,239,233,0.85)_60%,rgba(241,239,233,1)_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(49,45,57,0.09)_1px,transparent_1px)] bg-[size:28px_28px] opacity-60" />
        </>
      ) : (
        <>
          <div className="absolute inset-0 bg-slate-950/40" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,rgba(2,6,23,0.55)_75%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:48px_48px]" />
        </>
      )}
    </div>
  );
}
