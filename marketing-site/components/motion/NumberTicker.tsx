'use client'

import { useEffect, useRef } from 'react'
import { animate, useInView, useReducedMotion } from 'framer-motion'

interface NumberTickerProps {
  value: number
  decimals?: number
  prefix?: string
  suffix?: string
  duration?: number
  className?: string
}

/** Counts up from 0 once scrolled into view. Writes to the node directly, so it never re-renders the tree. */
export default function NumberTicker({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 1.6,
  className,
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-15% 0px' })
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    const element = ref.current
    if (!element || !inView) return
    const format = (current: number) => `${prefix}${current.toFixed(decimals)}${suffix}`
    if (prefersReducedMotion) {
      element.textContent = format(value)
      return
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (current) => {
        element.textContent = format(current)
      },
    })
    return () => controls.stop()
  }, [inView, value, decimals, prefix, suffix, duration, prefersReducedMotion])

  return (
    <span ref={ref} className={className}>
      {`${prefix}${(0).toFixed(decimals)}${suffix}`}
    </span>
  )
}
