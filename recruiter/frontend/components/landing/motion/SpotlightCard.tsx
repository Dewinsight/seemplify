'use client';

import { useCallback, useRef, type MouseEvent, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
  lift?: boolean;
  /** Rendered at the card root, outside the padded content — e.g. a BorderBeam. */
  beam?: ReactNode;
}

/**
 * Glass card with a cursor-tracked radial highlight. Writes CSS vars straight
 * to the node, so mouse movement never re-renders React. Broadcasts the
 * `hover` variant so AnimatedIcons inside it react too.
 */
export default function SpotlightCard({
  children,
  className,
  spotlightColor = 'rgba(139, 92, 246, 0.30)',
  lift = true,
  beam,
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const onMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
  }, []);

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMouseMove}
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-lg backdrop-blur-xl transition-colors duration-300 hover:border-white/25',
        className,
      )}
      initial="idle"
      animate="idle"
      whileHover="hover"
      variants={{ idle: { y: 0 }, hover: { y: lift ? -4 : 0 } }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background: `radial-gradient(460px circle at var(--spot-x, 50%) var(--spot-y, 50%), ${spotlightColor}, transparent 62%)`,
        }}
      />
      {beam}
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}
