'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

type ShimmerButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Drop-shadow colour under the button. */
  glow?: string;
};

/** Gradient CTA with a periodic light sweep. Plain <button> underneath, so it composes with Magnetic. */
const ShimmerButton = forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  ({ className, children, glow = 'rgba(23, 21, 18, 0.28)', style, ...props }, ref) => {
    const reduceMotion = useReducedMotion();
    return (
      <button
        ref={ref}
        className={cn(
          'group relative inline-flex h-14 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 px-8 text-lg font-semibold text-white transition-[transform,box-shadow] duration-300 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 active:scale-[0.98]',
          className,
        )}
        style={{ boxShadow: `0 20px 50px -12px ${glow}`, ...style }}
        {...props}
      >
        {!reduceMotion && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent"
            initial={{ x: '-180%' }}
            animate={{ x: '420%' }}
            transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1.8, ease: 'easeInOut' }}
          />
        )}
        <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
      </button>
    );
  },
);
ShimmerButton.displayName = 'ShimmerButton';

export default ShimmerButton;
