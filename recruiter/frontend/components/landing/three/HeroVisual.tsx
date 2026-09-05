'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, useScroll } from 'framer-motion';
import { Award, ChartPie, Radar } from 'lucide-react';
import BorderBeam from '@/components/landing/motion/BorderBeam';

/** Static stand-in: SSR, reduced motion, or no WebGL. A paper stack and a score chip, in CSS only. */
function HeroPoster() {
  return (
    <div className="absolute inset-0" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute left-[16%] top-[26%] h-[48%] w-[34%] rounded-[3px] border border-[color:var(--marketing-line)] bg-[color:var(--marketing-surface)]"
          style={{ transform: `rotate(${(i - 1) * 7}deg) translate(${i * 3}px, ${i * 5}px)`, boxShadow: 'var(--marketing-shadow)' }}
        >
          <div className="mx-[12%] mt-[14%] h-[6%] w-[52%] rounded-full bg-[color:var(--marketing-brand)] opacity-70" />
          <div className="mx-[12%] mt-[8%] h-[4%] w-[70%] rounded-full bg-[color:var(--marketing-surface-sunken)]" />
          <div className="mx-[12%] mt-[5%] h-[4%] w-[60%] rounded-full bg-[color:var(--marketing-surface-sunken)]" />
        </div>
      ))}
      <div
        className="absolute right-[14%] top-[34%] rounded-full px-4 py-2 text-sm font-semibold"
        style={{ background: 'var(--marketing-brand)', color: 'var(--marketing-canvas)', boxShadow: 'var(--marketing-shadow)' }}
      >
        95% match
      </div>
    </div>
  );
}

// three.js + R3F only load in the browser, after hydration.
const ShortlistScene = dynamic(() => import('./ShortlistScene'), { ssr: false, loading: () => <HeroPoster /> });

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

const chip =
  'absolute overflow-hidden rounded-xl border border-white/15 bg-slate-900/70 px-4 py-3 shadow-xl shadow-black/30 backdrop-blur-md';

/**
 * The hero's 3D stage: a pile of CVs read by the AI, with the strongest five
 * rising into a ranked shortlist — and the live chips floating over it.
 */
export default function HeroVisual() {
  const reduceMotion = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const spreadRef = useRef(0);
  const hoverRef = useRef(false);
  const [canRender, setCanRender] = useState(false);
  const [compact, setCompact] = useState(false);
  const [inView, setInView] = useState(false);

  // 0 while the hero is fully in view, 1 once it has scrolled away — the set sinks with it.
  const { scrollYProgress } = useScroll({ target: wrapRef, offset: ['start start', 'end start'] });
  useEffect(
    () =>
      scrollYProgress.on('change', (value) => {
        spreadRef.current = value;
      }),
    [scrollYProgress],
  );

  useEffect(() => {
    setCanRender(!reduceMotion && supportsWebGL());
    setCompact(window.matchMedia('(max-width: 640px)').matches);
  }, [reduceMotion]);

  // Only spend GPU while the hero is actually on screen.
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
      className="relative mx-auto aspect-square w-full max-w-[560px] overflow-hidden rounded-2xl border border-white/15 md:max-w-none"
      style={{ background: 'radial-gradient(120% 85% at 28% 8%, #dccfff 0%, #f2eee7 52%, #e6e1d8 100%)' }}
      onPointerEnter={() => {
        hoverRef.current = true;
      }}
      onPointerLeave={() => {
        hoverRef.current = false;
      }}
    >
      <div className="absolute inset-0" aria-hidden>
        {canRender ? <ShortlistScene active={inView} compact={compact} spreadRef={spreadRef} hoverRef={hoverRef} /> : <HeroPoster />}
      </div>

      <motion.div
        data-chip="dark"
        className={`${chip} right-3 top-3 md:right-4 md:top-4`}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 0.6 }}
      >
        <BorderBeam size={80} duration={7} colorFrom="#7047eb" colorTo="#00875f" />
        <div className="flex items-center gap-2 text-sm">
          <ChartPie className="h-4 w-4 text-cyan-300" />
          <span className="font-semibold text-white">98% match rate</span>
        </div>
      </motion.div>

      <motion.div
        data-chip="dark"
        className={`${chip} bottom-4 right-3 hidden md:right-4 md:block`}
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.1, duration: 0.6 }}
      >
        <BorderBeam size={80} duration={9} delay={3} colorFrom="#7047eb" colorTo="#ae6c00" />
        <div className="flex items-center gap-3">
          <Award className="h-5 w-5 text-purple-300" />
          <div>
            <div className="text-xs text-slate-400">Top talent</div>
            <div className="text-sm font-medium text-white">Identified in seconds</div>
          </div>
        </div>
      </motion.div>

      <motion.div
        data-chip="dark"
        className={`${chip} left-3 top-3 hidden md:left-4 md:top-4 lg:block`}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.3, duration: 0.6 }}
      >
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <Radar className="h-3.5 w-3.5 text-emerald-300" />
          Ranking 720 candidates live
        </div>
      </motion.div>
    </div>
  );
}
