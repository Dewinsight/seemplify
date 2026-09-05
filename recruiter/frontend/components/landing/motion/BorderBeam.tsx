'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface BorderBeamProps {
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  borderWidth?: number;
  className?: string;
}

/**
 * A light that travels around the parent's border (Magic UI pattern).
 * Parent needs `relative` + `overflow-hidden` + a border-radius.
 */
export default function BorderBeam({
  size = 120,
  duration = 8,
  delay = 0,
  colorFrom = '#60a5fa',
  colorTo = '#a855f7',
  borderWidth = 1,
  className,
}: BorderBeamProps) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 rounded-[inherit] [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]',
        className,
      )}
      style={{ borderWidth, borderStyle: 'solid', borderColor: 'transparent' }}
    >
      <motion.div
        className="absolute aspect-square"
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)`,
        }}
        initial={{ offsetDistance: '0%' }}
        animate={{ offsetDistance: '100%' }}
        transition={{ repeat: Infinity, ease: 'linear', duration, delay: -delay }}
      />
    </div>
  );
}
