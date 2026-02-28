"use client"

import type React from "react"

import { useState } from "react"
import { Button, type ButtonProps } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import confetti from "canvas-confetti"

interface ConfettiButtonProps extends ButtonProps {
  confettiColors?: string[]
}

export function ConfettiButton({
  children,
  confettiColors = ["#3b82f6", "#8b5cf6", "#10b981", "#f97316", "#ec4899"],
  className,
  ...props
}: ConfettiButtonProps) {
  const [isAnimating, setIsAnimating] = useState(false)

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (rect.left + rect.width / 2) / window.innerWidth
    const y = (rect.top + rect.height / 2) / window.innerHeight

    setIsAnimating(true)
    setTimeout(() => setIsAnimating(false), 700)

    confetti({
      particleCount: 100,
      spread: 70,
      origin: { x, y: y },
      colors: confettiColors,
      disableForReducedMotion: true,
    })

    props.onClick?.(e)
  }

  return (
    <Button
      className={cn("relative overflow-hidden transition-all", isAnimating && "animate-pulse", className)}
      onClick={handleClick}
      {...props}
    >
      {children}
    </Button>
  )
}
