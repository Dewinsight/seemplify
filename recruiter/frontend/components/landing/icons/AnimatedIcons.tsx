'use client';

import { motion, type Variants } from 'framer-motion';

/**
 * Lucide outlines wrapped in framer-motion (pqoqubbw/icons pattern).
 * They respond to the parent's `whileHover="hover"` variant — any wrapper
 * that sets `initial="idle" animate="idle" whileHover="hover"` drives them.
 */

interface IconProps {
  className?: string;
  size?: number;
  strokeWidth?: number;
}

const svgProps = (size: number, strokeWidth: number, className?: string) => ({
  xmlns: 'http://www.w3.org/2000/svg',
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
});

const draw: Variants = {
  idle: { pathLength: 1, opacity: 1 },
  hover: { pathLength: [0, 1], opacity: [0.3, 1], transition: { duration: 0.65, ease: 'easeInOut' } },
};

const drawDelayed = (delay: number): Variants => ({
  idle: { pathLength: 1 },
  hover: { pathLength: [0, 1], transition: { duration: 0.5, delay, ease: 'easeOut' } },
});

const pop: Variants = {
  idle: { scale: 1, rotate: 0 },
  hover: { scale: [1, 1.14, 1], transition: { duration: 0.55 } },
};

const wiggle: Variants = {
  idle: { rotate: 0 },
  hover: { rotate: [0, -8, 8, -4, 0], transition: { duration: 0.6 } },
};

const slideIn: Variants = {
  idle: { x: 0, opacity: 1 },
  hover: { x: [-5, 0], opacity: [0, 1], transition: { duration: 0.45, ease: 'easeOut' } },
};

export function ZapIcon({ className, size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <motion.svg {...svgProps(size, strokeWidth, className)} variants={pop}>
      <motion.path
        variants={draw}
        d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
      />
    </motion.svg>
  );
}

export function UsersIcon({ className, size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <motion.svg {...svgProps(size, strokeWidth, className)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <motion.path variants={slideIn} d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <motion.path variants={slideIn} d="M16 3.13a4 4 0 0 1 0 7.75" />
    </motion.svg>
  );
}

export function BarChartIcon({ className, size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <motion.svg {...svgProps(size, strokeWidth, className)}>
      <path d="M3 3v18h18" />
      <motion.path variants={drawDelayed(0)} d="M8 17v-3" />
      <motion.path variants={drawDelayed(0.08)} d="M13 17V5" />
      <motion.path variants={drawDelayed(0.16)} d="M18 17V9" />
    </motion.svg>
  );
}

export function ShieldCheckIcon({ className, size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <motion.svg {...svgProps(size, strokeWidth, className)} variants={pop}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <motion.path variants={draw} d="m9 12 2 2 4-4" />
    </motion.svg>
  );
}

export function CalendarIcon({ className, size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <motion.svg {...svgProps(size, strokeWidth, className)} variants={wiggle}>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <motion.path variants={draw} d="M3 10h18" />
    </motion.svg>
  );
}

export function CpuIcon({ className, size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <motion.svg {...svgProps(size, strokeWidth, className)}>
      <rect width="16" height="16" x="4" y="4" rx="2" />
      <motion.rect
        width="6"
        height="6"
        x="9"
        y="9"
        rx="1"
        style={{ originX: '12px', originY: '12px' }}
        variants={{ idle: { scale: 1, opacity: 1 }, hover: { scale: [1, 0.7, 1.15, 1], opacity: [1, 0.5, 1], transition: { duration: 0.7 } } }}
      />
      <path d="M15 2v2" />
      <path d="M15 20v2" />
      <path d="M2 15h2" />
      <path d="M2 9h2" />
      <path d="M20 15h2" />
      <path d="M20 9h2" />
      <path d="M9 2v2" />
      <path d="M9 20v2" />
    </motion.svg>
  );
}

export function BriefcaseIcon({ className, size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <motion.svg {...svgProps(size, strokeWidth, className)}>
      <motion.path
        variants={{ idle: { y: 0 }, hover: { y: [0, -2.5, 0], transition: { duration: 0.5 } } }}
        d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"
      />
      <rect width="20" height="14" x="2" y="6" rx="2" />
    </motion.svg>
  );
}

export function ChartPieIcon({ className, size = 24, strokeWidth = 2 }: IconProps) {
  return (
    <motion.svg {...svgProps(size, strokeWidth, className)}>
      <motion.path
        variants={{ idle: { x: 0, y: 0 }, hover: { x: [0, 1.6, 0], y: [0, -1.6, 0], transition: { duration: 0.6 } } }}
        d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"
      />
      <motion.path variants={draw} d="M21.21 15.89A10 10 0 1 1 8 2.83" />
    </motion.svg>
  );
}

export function SparklesIcon({ className, size = 24, strokeWidth = 2 }: IconProps) {
  const spark = (delay: number): Variants => ({
    idle: { opacity: 1, scale: 1 },
    hover: { opacity: [0, 1], scale: [0.4, 1.2, 1], transition: { duration: 0.5, delay } },
  });
  return (
    <motion.svg {...svgProps(size, strokeWidth, className)}>
      <motion.path
        style={{ originX: '12px', originY: '12px' }}
        variants={{ idle: { rotate: 0, scale: 1 }, hover: { rotate: [0, 20, 0], scale: [1, 1.12, 1], transition: { duration: 0.7 } } }}
        d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
      />
      <motion.path variants={spark(0.1)} d="M20 3v4" />
      <motion.path variants={spark(0.1)} d="M22 5h-4" />
      <motion.path variants={spark(0.25)} d="M4 17v2" />
      <motion.path variants={spark(0.25)} d="M5 18H3" />
    </motion.svg>
  );
}
