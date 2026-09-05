'use client'

import Link from 'next/link'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useCallback, useRef, type MouseEvent, type ReactNode } from 'react'
import MotionIcon from '../motion/MotionIcon'
import styles from '../LandingEffects.module.css'

const MotionLink = motion.create(Link)

interface SuiteCardProps {
  href: string
  name: string
  description: string
  status?: string
  icon: ReactNode
}

/**
 * The existing `.marketing-suite-card` link, plus a cursor-tracked spotlight
 * and an icon that lifts on hover. Mouse movement writes CSS variables straight
 * to the node, so it never re-renders.
 */
export default function SuiteCard({ href, name, description, status, icon }: SuiteCardProps) {
  const ref = useRef<HTMLAnchorElement>(null)
  const prefersReducedMotion = useReducedMotion()
  // A few degrees of tilt toward the cursor; springs back on leave.
  const rotateX = useSpring(useMotionValue(0), { stiffness: 160, damping: 20 })
  const rotateY = useSpring(useMotionValue(0), { stiffness: 160, damping: 20 })

  const onMouseMove = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      const element = ref.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      element.style.setProperty('--spot-x', `${x}px`)
      element.style.setProperty('--spot-y', `${y}px`)
      if (prefersReducedMotion) return
      rotateY.set((x / rect.width - 0.5) * 6)
      rotateX.set((0.5 - y / rect.height) * 5)
    },
    [prefersReducedMotion, rotateX, rotateY],
  )

  const onMouseLeave = useCallback(() => {
    rotateX.set(0)
    rotateY.set(0)
  }, [rotateX, rotateY])

  return (
    <MotionLink
      ref={ref}
      href={href}
      className={`marketing-suite-card ${styles.suiteCard}`}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      initial="idle"
      animate="idle"
      whileHover="hover"
    >
      <span className={styles.suiteSpotlight} aria-hidden="true" />
      <span className={styles.suiteContent}>
        <div className="marketing-suite-card__topline">
          <MotionIcon>{icon}</MotionIcon>
          {status ? <span>{status}</span> : null}
        </div>
        <h3>{name}</h3>
        <p>{description}</p>
        <span className="marketing-suite-card__link">
          Explore {name} <ArrowRight aria-hidden="true" size={15} />
        </span>
      </span>
    </MotionLink>
  )
}
