'use client'

import Link from 'next/link'
import type { ComponentProps } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import styles from '../LandingEffects.module.css'

type ShimmerLinkProps = ComponentProps<typeof Link>

/** A Next Link with a periodic light sweep. Keeps whatever `.marketing-button` classes it is given. */
export default function ShimmerLink({ className = '', children, ...props }: ShimmerLinkProps) {
  const prefersReducedMotion = useReducedMotion()

  return (
    <Link {...props} className={`${className} ${styles.shimmerHost}`.trim()}>
      {!prefersReducedMotion && (
        <motion.span
          aria-hidden="true"
          className={styles.shimmerSweep}
          initial={{ x: '-160%' }}
          animate={{ x: '360%' }}
          transition={{ duration: 2, repeat: Infinity, repeatDelay: 2.6, ease: 'easeInOut' }}
        />
      )}
      <span className={styles.shimmerContent}>{children}</span>
    </Link>
  )
}
