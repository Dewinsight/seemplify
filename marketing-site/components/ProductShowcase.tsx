'use client'

import ThemedImage from '@/components/ThemedImage'
import { useRef, type CSSProperties, type MouseEvent } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { CheckCircle2, Sparkles, Waypoints } from 'lucide-react'
import type { ProductPageData, ProductVisualKind } from '@/app/products/product-data'
import styles from './ProductShowcase.module.css'

type ProductCapture = {
  src: string
  width: number
  height: number
  view: string
  description: string
  alt: string
}

const captures: Record<ProductVisualKind, ProductCapture> = {
  recruiter: {
    src: '/images/product-showcases/recruiter.png',
    width: 1982,
    height: 973,
    view: 'Role, applicants and AI matching',
    description: 'Review applicants, the hiring pipeline, interviews, insights and evidence-led matching from the same open role.',
    alt: 'Recruiter job workspace showing applicants, hiring pipeline, interviews and AI matching for an open role',
  },
  'core-hr': {
    src: '/images/product-showcases/core-hr-onboarding.png',
    width: 1500,
    height: 650,
    view: 'People transition builder',
    description: 'Start an onboarding, exit or retirement process with its documents and handoff steps attached.',
    alt: 'People Transitions workflow for starting an onboarding, exit or retirement process',
  },
  leave: {
    src: '/images/product-showcases/leave-management.png',
    width: 830,
    height: 690,
    view: 'Leave request',
    description: 'Choose the policy, dates and approval context while the available balance stays in view.',
    alt: 'Leave Management request form with leave type, dates, reason and current balance',
  },
  performance: {
    src: '/images/product-showcases/performance-goal-setting-wide.png',
    width: 1200,
    height: 900,
    view: 'Goal-setting workflow',
    description: 'Define the goal, align it to a parent, add weighted objectives and set measurable key results before the cycle begins.',
    alt: 'Performance Management create goal workflow with alignment, objectives, weights and measurable key results',
  },
  time: {
    src: '/images/product-showcases/time-clock-in.png',
    width: 1215,
    height: 545,
    view: 'Employee clock-in',
    description: 'Clock in from the live workday view while the current timesheet, weekly hours and clock state stay visible.',
    alt: 'Time and Attendance employee workday showing the live timer, Clock in action and current timesheet',
  },
  payroll: {
    src: '/images/product-showcases/payroll.png',
    width: 1220,
    height: 865,
    view: 'Payroll run preparation',
    description: 'Set the pay period and calculation options before the run moves into review.',
    alt: 'Payroll run preparation screen with pay period, currency and calculation options',
  },
  experience: {
    src: '/images/product-showcases/experience-survey-builder.png',
    width: 1672,
    height: 941,
    view: 'Survey builder',
    description: 'Shape the questions, response options, branching and presentation before the programme is published.',
    alt: 'Experience Management survey builder showing question structure, question editing and survey configuration',
  },
  learning: {
    src: '/images/product-showcases/learning-lesson.png',
    width: 1280,
    height: 775,
    view: 'Lesson and assessment',
    description: 'Move through a structured curriculum, complete each lesson and check understanding with chapter and lesson quizzes.',
    alt: 'Seemplify Learning lesson player showing course content, curriculum progress and quiz actions',
  },
}

const CALLOUT_ICONS = [Sparkles, CheckCircle2, Waypoints]
const CALLOUT_SLOTS = [styles.calloutTopRight, styles.calloutLeft, styles.calloutBottomRight]

const springValues = { damping: 26, stiffness: 120, mass: 1.2 }

/**
 * The real product screenshot in a window frame that tilts toward the cursor,
 * sits on a brand glow, and carries three floating callouts drawn from the
 * product's own capability list. Falls back to a still frame under reduced motion.
 */
export default function ProductShowcase({ product }: { product: ProductPageData }) {
  const capture = captures[product.visual]
  const imageRatio = `${capture.width} / ${capture.height}`
  const prefersReducedMotion = useReducedMotion()
  const stageRef = useRef<HTMLDivElement>(null)

  const rotateX = useSpring(useMotionValue(0), springValues)
  const rotateY = useSpring(useMotionValue(0), springValues)
  const glowX = useSpring(useMotionValue(50), springValues)
  const glowY = useSpring(useMotionValue(40), springValues)
  const glow = useTransform([glowX, glowY], ([x, y]) => `radial-gradient(520px circle at ${x}% ${y}%, color-mix(in srgb, var(--marketing-brand) 34%, transparent), transparent 62%)`)

  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const px = (event.clientX - rect.left) / rect.width
    const py = (event.clientY - rect.top) / rect.height
    rotateY.set((px - 0.5) * 10)
    rotateX.set((0.5 - py) * 8)
    glowX.set(px * 100)
    glowY.set(py * 100)
  }

  const onMouseLeave = () => {
    rotateX.set(0)
    rotateY.set(0)
    glowX.set(50)
    glowY.set(40)
  }

  const callouts = product.capabilities.slice(0, 3)

  return (
    <figure className={styles.showcase}>
      <div ref={stageRef} className={styles.stage} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
        <motion.div className={styles.glow} style={{ backgroundImage: glow }} aria-hidden="true" />

        <motion.div
          className={styles.tilt}
          style={{ rotateX, rotateY, transformPerspective: 1400 }}
          initial={prefersReducedMotion ? false : { opacity: 0, y: 28, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className={styles.frame}>
            <div className={styles.frameBar}>
              <span className={styles.frameDots} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <strong>{product.name}</strong>
              <span>{capture.view}</span>
            </div>
            <div className={styles.viewport} style={{ '--capture-ratio': imageRatio } as CSSProperties}>
              <ThemedImage
                src={capture.src}
                alt={capture.alt}
                width={capture.width}
                height={capture.height}
                sizes="(max-width: 920px) 100vw, 52vw"
                priority
              />
              {!prefersReducedMotion && <span className={styles.sheen} aria-hidden="true" />}
            </div>
          </div>

          {callouts.map((capability, index) => {
            const Icon = CALLOUT_ICONS[index]
            return (
              <motion.div
                key={capability.title}
                className={`${styles.callout} ${CALLOUT_SLOTS[index]}`}
                style={{ translateZ: 60 + index * 20 }}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45 + index * 0.16, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
              >
                <motion.span
                  className={styles.calloutInner}
                  animate={prefersReducedMotion ? undefined : { y: [0, -5, 0] }}
                  transition={{ duration: 5 + index, repeat: Infinity, ease: 'easeInOut', delay: index * 0.8 }}
                >
                  <Icon aria-hidden="true" size={15} />
                  <span>{capability.title}</span>
                </motion.span>
              </motion.div>
            )
          })}
        </motion.div>
      </div>

      <figcaption>
        <strong>{capture.view}</strong>
        <span>{capture.description}</span>
      </figcaption>
      <ol className={styles.process} aria-label={`${product.name} process`}>
        {product.workflow.map((step, index) => (
          <li key={step.title}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{step.title}</strong>
          </li>
        ))}
      </ol>
    </figure>
  )
}
