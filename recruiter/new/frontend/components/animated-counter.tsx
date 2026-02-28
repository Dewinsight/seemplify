"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface AnimatedCounterProps {
  value: number
  duration?: number
  className?: string
}

export function AnimatedCounter({ value, duration = 1000, className }: AnimatedCounterProps) {
  const [count, setCount] = useState(0)
  const countRef = useRef(count)
  const startTimeRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    countRef.current = count
  }, [count])

  useEffect(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
    }

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp
      }

      const progress = timestamp - startTimeRef.current
      const percentage = Math.min(progress / duration, 1)

      // Easing function for smoother animation
      const easeOutQuart = 1 - Math.pow(1 - percentage, 4)

      setCount(Math.floor(easeOutQuart * value))

      if (percentage < 1) {
        frameRef.current = requestAnimationFrame(animate)
      }
    }

    frameRef.current = requestAnimationFrame(animate)

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
      }
    }
  }, [value, duration])

  return <span className={cn("tabular-nums", className)}>{count.toLocaleString()}</span>
}
