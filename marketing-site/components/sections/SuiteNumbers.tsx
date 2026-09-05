'use client'

import { motion } from 'framer-motion'
import NumberTicker from '../motion/NumberTicker'
import styles from '../LandingEffects.module.css'

interface SuiteNumbersProps {
  marketCount: number
}

/** Four facts the rest of the page already states, counted up on scroll. */
export default function SuiteNumbers({ marketCount }: SuiteNumbersProps) {
  const items = [
    { value: 8, label: 'Connected workspaces', detail: 'Recruiter through Learning' },
    { value: 1, label: 'Shared identity', detail: 'One person, one record' },
    { value: marketCount, label: 'Published markets', detail: 'Payroll coverage stated per country' },
    { value: 2, label: 'AI runtimes', detail: 'ChatGPT or Local inference' },
  ]

  return (
    <section className={styles.numbers} aria-label="Platform at a glance">
      <div className="marketing-container">
        <div className={styles.numbersGrid}>
          {items.map((item, index) => (
            <motion.div
              key={item.label}
              className={styles.numbersCell}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.5, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className={styles.numbersValue}>
                <NumberTicker value={item.value} />
              </span>
              <span className={styles.numbersLabel}>{item.label}</span>
              <span className={styles.numbersDetail}>{item.detail}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
