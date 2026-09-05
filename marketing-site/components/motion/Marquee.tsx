'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useAnimationFrame, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, useVelocity } from 'framer-motion'
import styles from '../LandingEffects.module.css'

interface MarqueeProps {
  children: ReactNode
  /** Pixels per second at rest. */
  speed?: number
  reverse?: boolean
}

function wrap(min: number, max: number, value: number) {
  const range = max - min
  return ((((value - min) % range) + range) % range) + min
}

/**
 * Infinite horizontal scroller that speeds up with the page's scroll velocity
 * and reverses when you scroll back (React Bits ScrollVelocity pattern).
 */
export default function Marquee({ children, speed = 40, reverse = false }: MarqueeProps) {
  const prefersReducedMotion = useReducedMotion()
  const copyRef = useRef<HTMLDivElement>(null)
  const [copyWidth, setCopyWidth] = useState(0)
  const baseX = useMotionValue(0)
  const { scrollY } = useScroll()
  const scrollVelocity = useVelocity(scrollY)
  const smoothVelocity = useSpring(scrollVelocity, { damping: 50, stiffness: 400 })
  const velocityFactor = useTransform(smoothVelocity, [0, 1000], [0, 4], { clamp: false })
  const direction = useRef(reverse ? -1 : 1)

  useLayoutEffect(() => {
    const measure = () => setCopyWidth(copyRef.current?.offsetWidth ?? 0)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useAnimationFrame((_, delta) => {
    if (prefersReducedMotion || copyWidth === 0) return
    const base = reverse ? -1 : 1
    const factor = velocityFactor.get()
    // Scrolling back briefly reverses the run; otherwise it just hurries.
    if (factor < -0.5) direction.current = -base
    else if (factor > 0.5) direction.current = base
    let move = direction.current * speed * (delta / 1000)
    move += move * Math.abs(factor)
    baseX.set(baseX.get() + move)
  })

  const x = useTransform(baseX, (value) => (copyWidth === 0 ? '0px' : `${wrap(-copyWidth, 0, value)}px`))

  return (
    <div className={styles.marquee}>
      <motion.div className={styles.marqueeTrack} style={{ x: prefersReducedMotion ? 0 : x }}>
        <div ref={copyRef} className={styles.marqueeCopy}>
          {children}
        </div>
        <div className={styles.marqueeCopy} aria-hidden="true">
          {children}
        </div>
      </motion.div>
    </div>
  )
}
