'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useReducedMotion, useScroll } from 'framer-motion'
import { useMarketingTheme } from '@/lib/useMarketingTheme'
import styles from '../LandingEffects.module.css'

// three.js + R3F only load in the browser, after hydration.
const HeroCardsScene = dynamic(() => import('./HeroCardsScene'), { ssr: false })

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * Swaps the hero photograph for the 3D record carousel once we know the
 * browser can run it. The photo stays as the SSR markup and the reduced-motion
 * / no-WebGL fallback, so the humane first impression is never lost.
 */
export default function HeroOrbit({ children }: { children: ReactNode }) {
  const theme = useMarketingTheme()
  const prefersReducedMotion = useReducedMotion()
  const frameRef = useRef<HTMLDivElement>(null)
  const spreadRef = useRef(0)
  const hoverRef = useRef(false)
  const [canRender, setCanRender] = useState(false)
  const [compact, setCompact] = useState(false)
  const [inView, setInView] = useState(false)

  // 0 while the hero is fully in view, 1 once it has scrolled away — the carousel spreads with it.
  const { scrollYProgress } = useScroll({ target: frameRef, offset: ['start start', 'end start'] })
  useEffect(() => scrollYProgress.on('change', (value) => { spreadRef.current = value }), [scrollYProgress])

  useEffect(() => {
    setCanRender(!prefersReducedMotion && supportsWebGL())
    setCompact(window.matchMedia('(max-width: 760px)').matches)
  }, [prefersReducedMotion])

  // Only spend GPU while the hero is on screen.
  useEffect(() => {
    const element = frameRef.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.05 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [canRender])

  if (!canRender) return <>{children}</>

  return (
    <div
      ref={frameRef}
      className={styles.orbitFrame}
      aria-hidden="true"
      onPointerEnter={() => {
        hoverRef.current = true
      }}
      onPointerLeave={() => {
        hoverRef.current = false
      }}
    >
      <HeroCardsScene active={inView} theme={theme} compact={compact} spreadRef={spreadRef} hoverRef={hoverRef} />
      <div className={styles.orbitVignette} />
    </div>
  )
}
