import Image from 'next/image'
import type { CSSProperties } from 'react'
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

export default function ProductShowcase({ product }: { product: ProductPageData }) {
  const capture = captures[product.visual]
  const imageRatio = `${capture.width} / ${capture.height}`

  return (
    <figure className={styles.showcase}>
      <div className={styles.frame}>
        <div className={styles.frameBar}>
          <strong>{product.name}</strong>
          <span>{capture.view}</span>
        </div>
        <div className={styles.viewport} style={{ '--capture-ratio': imageRatio } as CSSProperties}>
          <Image
            src={capture.src}
            alt={capture.alt}
            width={capture.width}
            height={capture.height}
            sizes="(max-width: 920px) 100vw, 52vw"
            priority
          />
        </div>
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
