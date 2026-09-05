'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface TextRevealProps {
  text: string;
  className?: string;
  /** Applied to every word — put gradient / bg-clip classes here, not on the parent. */
  wordClassName?: string;
  delay?: number;
  stagger?: number;
}

/** Word-by-word blur + rise reveal. framer-motion only, no extra engine. */
export default function TextReveal({ text, className, wordClassName, delay = 0, stagger = 0.07 }: TextRevealProps) {
  const reduceMotion = useReducedMotion();
  const words = text.split(' ');

  return (
    <span className={cn('inline', className)}>
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          className={cn('inline-block will-change-transform', wordClassName)}
          initial={reduceMotion ? false : { opacity: 0, y: '0.45em', filter: 'blur(12px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.8, delay: delay + i * stagger, ease: [0.21, 0.47, 0.32, 0.98] }}
        >
          {word}
          {i < words.length - 1 ? '\u00A0' : ''}
        </motion.span>
      ))}
    </span>
  );
}
