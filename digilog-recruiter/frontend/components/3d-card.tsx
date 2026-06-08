"use client"

import type React from "react"

import { useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface ThreeDCardProps {
  children: React.ReactNode
  className?: string
  containerClassName?: string
  glareClassName?: string
  rotationIntensity?: number
  glareOpacity?: number
  glareSize?: number
  borderRadius?: string
}

export function ThreeDCard({
  children,
  className,
  containerClassName,
  glareClassName,
  rotationIntensity = 10,
  glareOpacity = 0.2,
  glareSize = 0.6,
  borderRadius = "rounded-xl",
}: ThreeDCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [rotation, setRotation] = useState({ x: 0, y: 0 })
  const [glarePosition, setGlarePosition] = useState({ x: 0, y: 0 })
  const [isHovered, setIsHovered] = useState(false)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return

    const rect = cardRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const mouseX = e.clientX
    const mouseY = e.clientY

    const rotateY = ((mouseX - centerX) / (rect.width / 2)) * rotationIntensity
    const rotateX = ((centerY - mouseY) / (rect.height / 2)) * rotationIntensity

    setRotation({ x: rotateX, y: rotateY })
    setGlarePosition({
      x: ((mouseX - rect.left) / rect.width) * 100,
      y: ((mouseY - rect.top) / rect.height) * 100,
    })
  }

  const handleMouseEnter = () => {
    setIsHovered(true)
  }

  const handleMouseLeave = () => {
    setIsHovered(false)
    setRotation({ x: 0, y: 0 })
  }

  return (
    <div
      ref={cardRef}
      className={cn("relative transition-transform duration-200", containerClassName)}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: isHovered
          ? `perspective(1000px) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) scale3d(1.02, 1.02, 1.02)`
          : "perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)",
        transition: "transform 0.2s ease",
      }}
    >
      <div
        className={cn(
          "absolute inset-0 opacity-0 transition-opacity duration-300",
          isHovered ? "opacity-100" : "opacity-0",
          borderRadius,
          glareClassName,
        )}
        style={{
          background: `radial-gradient(circle at ${glarePosition.x}% ${glarePosition.y}%, rgba(255, 255, 255, ${glareOpacity}) 0%, rgba(255, 255, 255, 0) ${glareSize * 100}%)`,
        }}
      />
      <div className={cn("h-full w-full", borderRadius, className)}>{children}</div>
    </div>
  )
}
