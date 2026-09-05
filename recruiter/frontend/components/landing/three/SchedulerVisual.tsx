'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/** Static stand-in: three lanes and a highlighted slot, in CSS only. */
function SchedulerPoster() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-4 px-[10%]" aria-hidden>
      {['Lagos', 'New York', 'Nairobi'].map((city, i) => (
        <div key={city} className="flex items-center gap-3">
          <span className="w-16 text-xs font-semibold text-[color:var(--marketing-muted)]">{city}</span>
          <div className="relative h-8 flex-1 rounded-full bg-[color:var(--marketing-surface-sunken)]">
            <div className="absolute left-[8%] top-1/2 h-4 w-[16%] -translate-y-1/2 rounded-full bg-[color:var(--marketing-line-strong)]" />
            <div className="absolute left-[38%] top-1/2 h-4 w-[12%] -translate-y-1/2 rounded-full bg-[color:var(--marketing-line-strong)]" style={{ left: `${38 + i * 6}%` }} />
            <div className="absolute left-[64%] top-0 h-8 w-[14%] rounded-md border-2 border-[color:var(--marketing-positive)] bg-[color:var(--marketing-brand)] opacity-70" />
          </div>
        </div>
      ))}
    </div>
  );
}

const SchedulerScene = dynamic(() => import('./SchedulerScene'), { ssr: false, loading: () => <SchedulerPoster /> });

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Frame for the scheduling scene: gated to the viewport, with a CSS fallback. */
export default function SchedulerVisual({ className = '' }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [canRender, setCanRender] = useState(false);
  const [compact, setCompact] = useState(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    setCanRender(!reduceMotion && supportsWebGL());
    setCompact(window.matchMedia('(max-width: 640px)').matches);
  }, [reduceMotion]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      data-scene-frame=""
      className={`relative aspect-square w-full overflow-hidden rounded-2xl border border-white/15 ${className}`}
      style={{ background: 'radial-gradient(120% 85% at 70% 6%, #dccfff 0%, #f2eee7 52%, #e6e1d8 100%)' }}
    >
      <div className="absolute inset-0" aria-hidden>
        {canRender ? <SchedulerScene active={inView} compact={compact} /> : <SchedulerPoster />}
      </div>
    </div>
  );
}
