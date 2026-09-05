'use client';

import { useEffect, useRef } from 'react';
import { animate, useInView, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface NumberTickerProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}

/** Counts up from 0 when scrolled into view. Writes to the DOM node directly so it never re-renders the tree. */
export default function NumberTicker({ value, decimals = 0, prefix = '', suffix = '', duration = 1.8, className }: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15% 0px' });
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    const format = (v: number) => `${prefix}${v.toFixed(decimals)}${suffix}`;
    if (reduceMotion) {
      el.textContent = format(value);
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = format(v);
      },
    });
    return () => controls.stop();
  }, [inView, value, decimals, prefix, suffix, duration, reduceMotion]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {`${prefix}${(0).toFixed(decimals)}${suffix}`}
    </span>
  );
}
