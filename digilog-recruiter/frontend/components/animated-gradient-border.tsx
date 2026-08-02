"use client"

import { useEffect, useRef } from "react"

export function AnimatedGradientBorder() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animationFrameId: number
    let hue = 0

    const resizeCanvas = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (rect) {
        canvas.width = rect.width
        canvas.height = rect.height
      }
    }

    const render = () => {
      if (!ctx) return

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Create gradient
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
      gradient.addColorStop(0, `hsl(${hue}, 100%, 65%)`)
      gradient.addColorStop(0.5, `hsl(${hue + 60}, 100%, 65%)`)
      gradient.addColorStop(1, `hsl(${hue + 120}, 100%, 65%)`)

      // Draw border
      ctx.strokeStyle = gradient
      ctx.lineWidth = 2
      ctx.strokeRect(0, 0, canvas.width, canvas.height)

      // Update hue for animation
      hue = (hue + 0.5) % 360

      animationFrameId = requestAnimationFrame(render)
    }

    window.addEventListener("resize", resizeCanvas)
    resizeCanvas()
    render()

    return () => {
      window.removeEventListener("resize", resizeCanvas)
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none rounded-lg" style={{ zIndex: 1 }} />
}
