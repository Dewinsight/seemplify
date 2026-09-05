'use client'

import { useRef, type CSSProperties, type ReactNode } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'

interface ParallaxProps {
  children: ReactNode
  /** Pixels of travel across the element's pass through the viewport. */
  offset?: number
  className?: string
  style?: CSSProperties
}

/** Moves its children a little slower than the page as they pass through the viewport. */
export default function Parallax({ children, offset = 40, className, style }: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [offset, -offset])

  return (
    <motion.div ref={ref} className={className} style={{ ...style, y: prefersReducedMotion ? 0 : y }}>
      {children}
    </motion.div>
  )
}
