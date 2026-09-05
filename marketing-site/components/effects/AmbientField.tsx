'use client'

import { useEffect, useRef } from 'react'

/**
 * A quiet dot field behind the whole site. Dots drift with scroll (a little
 * slower than the page) and lean away from the cursor. Colours come from the
 * live --marketing-* tokens, so it follows the theme toggle; it sleeps when the
 * tab is hidden and does nothing under reduced motion.
 */
export default function AmbientField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (window.location.hostname.toLowerCase().includes('akwaibom')) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const SPACING = 46
    let width = 0
    let height = 0
    let dpr = 1
    let dotColor = 'rgba(49, 45, 57, 0.18)'
    let accent = 'rgba(112, 72, 232, 0.7)'
    const pointer = { x: -9999, y: -9999, active: false }
    let scrollY = window.scrollY
    let raf = 0
    let running = true

    const readTokens = () => {
      const style = getComputedStyle(document.documentElement)
      const line = style.getPropertyValue('--marketing-line-strong').trim()
      const brand = style.getPropertyValue('--marketing-brand').trim()
      if (line) dotColor = line
      if (brand) accent = brand
    }

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!running) return
      ctx.clearRect(0, 0, width, height)
      // The field scrolls at a fifth of the page speed — a gentle parallax.
      const offsetY = (-scrollY * 0.2) % SPACING
      const cols = Math.ceil(width / SPACING) + 2
      const rows = Math.ceil(height / SPACING) + 2

      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const baseX = i * SPACING + (j % 2 ? SPACING / 2 : 0)
          const baseY = j * SPACING + offsetY
          let x = baseX
          let y = baseY
          let radius = 1
          let color = dotColor
          if (pointer.active) {
            const dx = baseX - pointer.x
            const dy = baseY - pointer.y
            const distance = Math.hypot(dx, dy)
            if (distance < 170) {
              const force = (1 - distance / 170)
              const push = force * force * 14
              x += (dx / (distance || 1)) * push
              y += (dy / (distance || 1)) * push
              radius = 1 + force * 1.6
              if (force > 0.35) color = accent
            }
          }
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fillStyle = color
          ctx.globalAlpha = color === accent ? 0.55 : 0.5
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }

    const onPointerMove = (event: PointerEvent) => {
      pointer.x = event.clientX
      pointer.y = event.clientY
      pointer.active = true
    }
    const onPointerLeave = () => {
      pointer.active = false
    }
    const onScroll = () => {
      scrollY = window.scrollY
    }
    const onVisibility = () => {
      running = !document.hidden
    }

    readTokens()
    resize()
    const themeObserver = new MutationObserver(readTokens)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      themeObserver.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.9 }}
    />
  )
}
