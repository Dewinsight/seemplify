'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface MarqueeProps {
  children: ReactNode;
  /** Seconds for one full loop. */
  duration?: number;
  reverse?: boolean;
  className?: string;
}

/** Infinite horizontal scroller. Renders children twice and translates by exactly one copy. */
export default function Marquee({ children, duration = 38, reverse = false, className }: MarqueeProps) {
  const reduceMotion = useReducedMotion();
  return (
    <div
      className={cn(
        'relative flex w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]',
        className,
      )}
    >
      <motion.div
        className="flex w-max shrink-0 items-center gap-3 pr-3"
        animate={reduceMotion ? undefined : { x: reverse ? ['-50%', '0%'] : ['0%', '-50%'] }}
        transition={{ duration, repeat: Infinity, ease: 'linear' }}
      >
        {children}
        {children}
      </motion.div>
    </div>
  );
}
