"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

interface AnimatedBarProps {
  value: number
  maxValue?: number
  color?: string
  height?: string
  duration?: number
  className?: string
}

export function AnimatedBar({
  value,
  maxValue = 100,
  color = "bg-primary",
  height = "h-2",
  duration = 1000,
  className,
}: AnimatedBarProps) {
  const [width, setWidth] = useState(0)
  const percentage = (value / maxValue) * 100

  useEffect(() => {
    const timeout = setTimeout(() => {
      setWidth(percentage)
    }, 100)

    return () => clearTimeout(timeout)
  }, [percentage])

  return (
    <div className={cn("w-full bg-muted rounded-full overflow-hidden", height, className)}>
      <div
        className={cn(color, "rounded-full transition-all ease-out", height)}
        style={{
          width: `${width}%`,
          transitionDuration: `${duration}ms`,
        }}
      />
    </div>
  )
}
