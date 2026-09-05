'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useReducedMotion, useScroll } from 'framer-motion'
import { useMarketingTheme } from '@/lib/useMarketingTheme'
import styles from '../LandingEffects.module.css'

// three.js + R3F only load in the browser, after hydration.
const HeroCardsScene = dynamic(() => import('./HeroCardsScene'), { ssr: false })

type DragState = import('./HeroCardsScene').DragState

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
  const dragRef = useRef<DragState>({ active: false, pending: 0, velocity: 0 })
  const pointerRef = useRef<{ id: number | null; x: number }>({ id: null, x: 0 })
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

  // Drag (mouse or touch) spins the carousel; a full sweep across the frame is about a quarter turn.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointerRef.current = { id: event.pointerId, x: event.clientX }
    dragRef.current.active = true
    dragRef.current.velocity = 0
    dragRef.current.pending = 0
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.dataset.dragging = 'true'
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerRef.current.id !== event.pointerId) return
    const dx = event.clientX - pointerRef.current.x
    pointerRef.current.x = event.clientX
    dragRef.current.pending += (dx / Math.max(1, event.currentTarget.clientWidth)) * 1.7
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerRef.current.id !== event.pointerId) return
    pointerRef.current.id = null
    dragRef.current.active = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    delete event.currentTarget.dataset.dragging
  }

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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <HeroCardsScene active={inView} theme={theme} compact={compact} spreadRef={spreadRef} hoverRef={hoverRef} dragRef={dragRef} />
      <div className={styles.orbitVignette} />
    </div>
  )
}
