'use client'

import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import styles from './ElectricBorder.module.css'

/**
 * Animated "electric" outline: a canvas traces the block's rounded rectangle
 * with layered noise, over two blurred glow borders. Adapted from React Bits'
 * ElectricBorder (MIT + Commons Clause), themed through CSS variables.
 */

interface ElectricBorderProps {
  children?: ReactNode
  color?: string
  speed?: number
  chaos?: number
  borderRadius?: number
  className?: string
  style?: CSSProperties
}

export default function ElectricBorder({
  children,
  color = '#8b63ff',
  speed = 0.8,
  chaos = 0.1,
  borderRadius = 12,
  className,
  style,
}: ElectricBorderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<number | null>(null)
  const timeRef = useRef(0)
  const lastFrameTimeRef = useRef(0)

  const random = useCallback((x: number) => (Math.sin(x * 12.9898) * 43758.5453) % 1, [])

  const noise2D = useCallback(
    (x: number, y: number) => {
      const i = Math.floor(x)
      const j = Math.floor(y)
      const fx = x - i
      const fy = y - j
      const a = random(i + j * 57)
      const b = random(i + 1 + j * 57)
      const c = random(i + (j + 1) * 57)
      const d = random(i + 1 + (j + 1) * 57)
      const ux = fx * fx * (3.0 - 2.0 * fx)
      const uy = fy * fy * (3.0 - 2.0 * fy)
      return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy
    },
    [random],
  )

  const octavedNoise = useCallback(
    (x: number, octaves: number, lacunarity: number, gain: number, baseAmplitude: number, baseFrequency: number, time: number, seed: number) => {
      let y = 0
      let amplitude = baseAmplitude
      let frequency = baseFrequency
      for (let i = 0; i < octaves; i++) {
        const octaveAmplitude = i === 0 ? 0 : amplitude
        y += octaveAmplitude * noise2D(frequency * x + seed * 100, time * frequency * 0.3)
        frequency *= lacunarity
        amplitude *= gain
      }
      return y
    },
    [noise2D],
  )

  const cornerPoint = useCallback((cx: number, cy: number, r: number, start: number, arc: number, progress: number) => {
    const angle = start + progress * arc
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  }, [])

  const roundedRectPoint = useCallback(
    (t: number, left: number, top: number, width: number, height: number, radius: number) => {
      const straightWidth = width - 2 * radius
      const straightHeight = height - 2 * radius
      const cornerArc = (Math.PI * radius) / 2
      const perimeter = 2 * straightWidth + 2 * straightHeight + 4 * cornerArc
      const distance = t * perimeter
      let accumulated = 0

      if (distance <= accumulated + straightWidth) {
        const p = (distance - accumulated) / straightWidth
        return { x: left + radius + p * straightWidth, y: top }
      }
      accumulated += straightWidth
      if (distance <= accumulated + cornerArc) {
        return cornerPoint(left + width - radius, top + radius, radius, -Math.PI / 2, Math.PI / 2, (distance - accumulated) / cornerArc)
      }
      accumulated += cornerArc
      if (distance <= accumulated + straightHeight) {
        const p = (distance - accumulated) / straightHeight
        return { x: left + width, y: top + radius + p * straightHeight }
      }
      accumulated += straightHeight
      if (distance <= accumulated + cornerArc) {
        return cornerPoint(left + width - radius, top + height - radius, radius, 0, Math.PI / 2, (distance - accumulated) / cornerArc)
      }
      accumulated += cornerArc
      if (distance <= accumulated + straightWidth) {
        const p = (distance - accumulated) / straightWidth
        return { x: left + width - radius - p * straightWidth, y: top + height }
      }
      accumulated += straightWidth
      if (distance <= accumulated + cornerArc) {
        return cornerPoint(left + radius, top + height - radius, radius, Math.PI / 2, Math.PI / 2, (distance - accumulated) / cornerArc)
      }
      accumulated += cornerArc
      if (distance <= accumulated + straightHeight) {
        const p = (distance - accumulated) / straightHeight
        return { x: left, y: top + height - radius - p * straightHeight }
      }
      accumulated += straightHeight
      return cornerPoint(left + radius, top + radius, radius, Math.PI, Math.PI / 2, (distance - accumulated) / cornerArc)
    },
    [cornerPoint],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const octaves = 10
    const lacunarity = 1.6
    const gain = 0.7
    const frequency = 10
    const displacement = 60
    const borderOffset = 60

    const updateSize = () => {
      const rect = container.getBoundingClientRect()
      const width = rect.width + borderOffset * 2
      const height = rect.height + borderOffset * 2
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.scale(dpr, dpr)
      return { width, height }
    }

    let { width, height } = updateSize()
    let visible = true

    const draw = (now: number) => {
      animationRef.current = requestAnimationFrame(draw)
      if (!visible) return

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const deltaTime = (now - lastFrameTimeRef.current) / 1000
      timeRef.current += deltaTime * speed
      lastFrameTimeRef.current = now

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.scale(dpr, dpr)
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      const left = borderOffset
      const top = borderOffset
      const borderWidth = width - 2 * borderOffset
      const borderHeight = height - 2 * borderOffset
      const radius = Math.min(borderRadius, Math.min(borderWidth, borderHeight) / 2)
      const sampleCount = Math.floor((2 * (borderWidth + borderHeight) + 2 * Math.PI * radius) / 2)

      ctx.beginPath()
      for (let i = 0; i <= sampleCount; i++) {
        const progress = i / sampleCount
        const point = roundedRectPoint(progress, left, top, borderWidth, borderHeight, radius)
        const xNoise = octavedNoise(progress * 8, octaves, lacunarity, gain, chaos, frequency, timeRef.current, 0)
        const yNoise = octavedNoise(progress * 8, octaves, lacunarity, gain, chaos, frequency, timeRef.current, 1)
        const x = point.x + xNoise * displacement
        const y = point.y + yNoise * displacement
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.stroke()
    }

    const resizeObserver = new ResizeObserver(() => {
      const next = updateSize()
      width = next.width
      height = next.height
    })
    resizeObserver.observe(container)

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
    })
    io.observe(container)

    animationRef.current = requestAnimationFrame(draw)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      resizeObserver.disconnect()
      io.disconnect()
    }
  }, [color, speed, chaos, borderRadius, octavedNoise, roundedRectPoint])

  const vars = { '--electric-border-color': color, borderRadius } as CSSProperties

  return (
    <div ref={containerRef} className={`${styles.root} ${className ?? ''}`} style={{ ...vars, ...style }}>
      <div className={styles.canvasWrap}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
      <div className={styles.layers}>
        <div className={styles.glow1} />
        <div className={styles.glow2} />
        <div className={styles.backgroundGlow} />
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  )
}
