'use client'

import type { KeyboardEvent, ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarCheck2,
  Clock3,
  UserRoundCheck,
  WalletCards,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring } from 'framer-motion'
import { useRef, useState } from 'react'
import styles from './MarketingMotion.module.css'

const storySteps = [
  {
    number: '01',
    label: 'Hire',
    title: 'Make the decision with the evidence beside it.',
    description: 'Applications, CV analysis, matching and interview notes stay connected to the role and candidate record.',
    handoff: 'Recruiter to Core HR',
    icon: BriefcaseBusiness,
  },
  {
    number: '02',
    label: 'Welcome',
    title: 'Carry the person into the organisation without re-entering them.',
    description: 'The new colleague moves into team membership, access, documents and structured onboarding work.',
    handoff: 'Core HR to onboarding',
    icon: UserRoundCheck,
  },
  {
    number: '03',
    label: 'Support',
    title: 'Keep everyday people work in the same context.',
    description: 'Leave, attendance, goals, feedback and learning use the same person and organisation structure.',
    handoff: 'Time, leave, performance and learning',
    icon: CalendarCheck2,
  },
  {
    number: '04',
    label: 'Pay',
    title: 'Review payroll with the underlying decisions visible.',
    description: 'Prepare pay runs, adjustments and exports with approval gates and explicit jurisdiction coverage.',
    handoff: 'People records to payroll review',
    icon: WalletCards,
  },
] as const

export function PageProgress() {
  const prefersReducedMotion = useReducedMotion()
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 170,
    damping: 34,
    restDelta: 0.001,
  })

  if (prefersReducedMotion) return null

  return <motion.div className={styles.pageProgress} style={{ scaleX }} aria-hidden="true" />
}

export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const prefersReducedMotion = useReducedMotion()

  return (
    <motion.div
      className={className}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
      whileInView={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.16 }}
      transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

export function SuiteHandoffGraphic() {
  const prefersReducedMotion = useReducedMotion()
  const nodes = [
    { label: 'Candidate', detail: 'Recruiter', icon: BriefcaseBusiness },
    { label: 'Colleague', detail: 'Core HR', icon: UserRoundCheck },
    { label: 'Workday', detail: 'Time & leave', icon: Clock3 },
    { label: 'Pay review', detail: 'Payroll', icon: WalletCards },
  ]

  return (
    <div className={styles.handoff} role="img" aria-label="Illustrative handoff from candidate to colleague, workday and payroll review">
      <div className={styles.handoffLine} aria-hidden="true">
        <motion.span
          className={styles.handoffLineHorizontal}
          initial={prefersReducedMotion ? false : { scaleX: 0 }}
          whileInView={prefersReducedMotion ? undefined : { scaleX: 1 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.span
          className={styles.handoffLineVertical}
          initial={prefersReducedMotion ? false : { scaleY: 0 }}
          whileInView={prefersReducedMotion ? undefined : { scaleY: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      {nodes.map((node, index) => {
        const Icon = node.icon
        return (
          <motion.div
            className={styles.handoffNode}
            key={node.label}
            aria-hidden="true"
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            whileInView={prefersReducedMotion ? undefined : { opacity: 1 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ delay: 0.12 + index * 0.16, duration: 0.35 }}
          >
            <span className={styles.handoffIcon}><Icon size={18} aria-hidden="true" /></span>
            <strong>{node.label}</strong>
            <small>{node.detail}</small>
          </motion.div>
        )
      })}
    </div>
  )
}

export function ProductStoryRail() {
  const [activeIndex, setActiveIndex] = useState(0)
  const prefersReducedMotion = useReducedMotion()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const story = storySteps[activeIndex]
  const Icon = story.icon

  const selectStory = (nextIndex: number, focusTab = false) => {
    const bounded = (nextIndex + storySteps.length) % storySteps.length
    setActiveIndex(bounded)
    if (focusTab) window.requestAnimationFrame(() => tabRefs.current[bounded]?.focus())
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = index + 1
    if (event.key === 'ArrowLeft') nextIndex = index - 1
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = storySteps.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    selectStory(nextIndex, true)
  }

  return (
    <div className={styles.storyRail} aria-label="Connected people journey">
      <div className={styles.storyTabs} role="tablist" aria-label="People journey stages">
        {storySteps.map((step, index) => (
          <button
            key={step.label}
            ref={(element) => { tabRefs.current[index] = element }}
            type="button"
            role="tab"
            aria-selected={activeIndex === index}
            aria-controls="marketing-story-panel"
            id={`marketing-story-tab-${index}`}
            tabIndex={activeIndex === index ? 0 : -1}
            onClick={() => selectStory(index)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            <span>{step.number}</span>
            {step.label}
          </button>
        ))}
      </div>

      <div className={styles.storyViewport} aria-live="polite">
        <AnimatePresence initial={false} mode="wait">
          <motion.article
            id="marketing-story-panel"
            role="tabpanel"
            aria-labelledby={`marketing-story-tab-${activeIndex}`}
            key={story.label}
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: -18 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <Icon size={28} aria-hidden="true" />
            <p>{story.handoff}</p>
            <h3>{story.title}</h3>
            <span>{story.description}</span>
          </motion.article>
        </AnimatePresence>
      </div>

      <div className={styles.storyControls}>
        <p>{activeIndex + 1} of {storySteps.length}</p>
        <div>
          <button type="button" onClick={() => selectStory(activeIndex - 1)} aria-label="Previous journey stage">
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => selectStory(activeIndex + 1)} aria-label="Next journey stage">
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
