'use client'

import { motion, useReducedMotion } from 'framer-motion'

interface TextRevealProps {
  text: string
  delay?: number
  stagger?: number
}

/** Word-by-word blur + rise. Inline, so it can sit inside an existing heading or highlighted span. */
export default function TextReveal({ text, delay = 0, stagger = 0.06 }: TextRevealProps) {
  const prefersReducedMotion = useReducedMotion()
  const words = text.split(' ')

  return (
    <>
      {words.map((word, index) => (
        <motion.span
          key={`${word}-${index}`}
          style={{ display: 'inline-block', willChange: 'transform' }}
          initial={prefersReducedMotion ? false : { opacity: 0, y: '0.4em', filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.75, delay: delay + index * stagger, ease: [0.22, 1, 0.36, 1] }}
        >
          {word}
          {index < words.length - 1 ? ' ' : ''}
        </motion.span>
      ))}
    </>
  )
}
