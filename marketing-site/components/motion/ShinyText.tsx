'use client'

import { useRef } from 'react'
import { motion, useAnimationFrame, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'

interface ShinyTextProps {
  text: string
  /** Seconds for one sweep. */
  speed?: number
  /** Seconds to rest between sweeps. */
  delay?: number
  color?: string
  shineColor?: string
  className?: string
}

/** A light that sweeps across the text every few seconds (React Bits pattern, framer-motion port). */
export default function ShinyText({
  text,
  speed = 2.4,
  delay = 3,
  color = 'currentColor',
  shineColor = 'color-mix(in srgb, currentColor 30%, #ffffff)',
  className,
}: ShinyTextProps) {
  const prefersReducedMotion = useReducedMotion()
  const progress = useMotionValue(0)
  const elapsed = useRef(0)
  const last = useRef<number | null>(null)

  useAnimationFrame((time) => {
    if (prefersReducedMotion) return
    if (last.current === null) {
      last.current = time
      return
    }
    elapsed.current += time - last.current
    last.current = time
    const cycle = (speed + delay) * 1000
    const t = elapsed.current % cycle
    progress.set(t < speed * 1000 ? (t / (speed * 1000)) * 100 : 100)
  })

  const backgroundPosition = useTransform(progress, (p) => `${150 - p * 2}% center`)

  if (prefersReducedMotion) return <span className={className}>{text}</span>

  return (
    <motion.span
      className={className}
      style={{
        display: 'inline-block',
        backgroundImage: `linear-gradient(120deg, ${color} 0%, ${color} 38%, ${shineColor} 50%, ${color} 62%, ${color} 100%)`,
        backgroundSize: '200% auto',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundPosition,
      }}
    >
      {text}
    </motion.span>
  )
}
