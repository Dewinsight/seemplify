'use client'

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import styles from '../LandingEffects.module.css'

/**
 * Gives any icon a lift-and-tilt when an ancestor broadcasts the `hover`
 * variant (`initial="idle" animate="idle" whileHover="hover"`).
 */
export default function MotionIcon({ children }: { children: ReactNode }) {
  return (
    <motion.span
      className={styles.motionIcon}
      variants={{
        idle: { y: 0, rotate: 0, scale: 1 },
        hover: { y: -2, rotate: [0, -10, 6, 0], scale: 1.12, transition: { duration: 0.55, ease: 'easeOut' } },
      }}
    >
      {children}
    </motion.span>
  )
}
