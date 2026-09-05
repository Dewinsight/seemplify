'use client'

import { motion, useReducedMotion } from 'framer-motion'

interface BorderBeamProps {
  size?: number
  duration?: number
  delay?: number
  colorFrom?: string
  colorTo?: string
  borderWidth?: number
}

/**
 * A light that travels around the parent's border. The parent needs
 * `position: relative`, `overflow: hidden` and a border-radius.
 */
export default function BorderBeam({
  size = 120,
  duration = 9,
  delay = 0,
  colorFrom = 'var(--marketing-brand)',
  colorTo = 'var(--marketing-positive)',
  borderWidth = 1,
}: BorderBeamProps) {
  const prefersReducedMotion = useReducedMotion()
  if (prefersReducedMotion) return null

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        borderRadius: 'inherit',
        borderWidth,
        borderStyle: 'solid',
        borderColor: 'transparent',
        maskClip: 'padding-box, border-box',
        maskComposite: 'intersect',
        maskImage: 'linear-gradient(transparent, transparent), linear-gradient(#000, #000)',
        WebkitMaskClip: 'padding-box, border-box',
        WebkitMaskComposite: 'source-in',
        WebkitMaskImage: 'linear-gradient(transparent, transparent), linear-gradient(#000, #000)',
      }}
    >
      <motion.div
        style={{
          position: 'absolute',
          width: size,
          aspectRatio: '1',
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)`,
        }}
        initial={{ offsetDistance: '0%' }}
        animate={{ offsetDistance: '100%' }}
        transition={{ repeat: Infinity, ease: 'linear', duration, delay: -delay }}
      />
    </div>
  )
}
