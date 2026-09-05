'use client'

import Link from 'next/link'
import type { ComponentProps } from 'react'
import styles from './StarBorder.module.css'

type StarBorderLinkProps = ComponentProps<typeof Link> & {
  color?: string
  speed?: string
}

/**
 * A Next Link with two soft lights sweeping along its top and bottom edges.
 * Adapted from React Bits' StarBorder (MIT + Commons Clause); the inner face
 * keeps whatever `.marketing-button` classes it is given.
 */
export default function StarBorderLink({ className = '', color = 'var(--marketing-brand)', speed = '6s', children, ...props }: StarBorderLinkProps) {
  return (
    <span className={styles.host}>
      <span aria-hidden="true" className={styles.bottom} style={{ background: `radial-gradient(circle, ${color}, transparent 10%)`, animationDuration: speed }} />
      <span aria-hidden="true" className={styles.top} style={{ background: `radial-gradient(circle, ${color}, transparent 10%)`, animationDuration: speed }} />
      <Link {...props} className={`${className} ${styles.inner}`.trim()}>
        {children}
      </Link>
    </span>
  )
}
