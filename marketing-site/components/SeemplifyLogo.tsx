'use client'

import { useId } from 'react'
import { motion } from 'framer-motion'

interface SeemplifyLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  animated?: boolean
  className?: string
  showTagline?: boolean
}

const sizeMap = {
  sm: { width: 148, height: 30, taglineHeight: 42 },
  md: { width: 176, height: 36, taglineHeight: 52 },
  lg: { width: 212, height: 44, taglineHeight: 60 },
  xl: { width: 288, height: 58, taglineHeight: 82 },
}

function WordmarkSvg({
  width,
  height,
  animated,
  className,
  showTagline,
}: {
  width: number
  height: number
  animated: boolean
  className: string
  showTagline: boolean
}) {
  const gradientId = useId().replace(/:/g, '')
  const glowId = `${gradientId}-glow`
  const totalHeight = showTagline ? sizeMap.xl.taglineHeight : height

  return (
    <motion.svg
      viewBox={showTagline ? '0 0 520 132' : '0 0 520 84'}
      className={className}
      style={{ width, height: totalHeight }}
      initial={animated ? { opacity: 0, y: 4 } : false}
      animate={animated ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      role="img"
      aria-label="Seemplify"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#b980ff" />
          <stop offset="42%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#4c1d95" />
        </linearGradient>
        <filter id={glowId} x="-10%" y="-30%" width="120%" height="160%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g filter={animated ? `url(#${glowId})` : undefined}>
        <text
          x="10"
          y="60"
          fill={`url(#${gradientId})`}
          fontFamily="'Space Grotesk', 'IBM Plex Sans', sans-serif"
          fontSize="72"
          fontWeight="700"
          letterSpacing="-4"
        >
          seemplify
        </text>
      </g>

      {showTagline ? (
        <text
          x="115"
          y="106"
          fill="#6c6881"
          fontFamily="'IBM Plex Sans', system-ui, sans-serif"
          fontSize="25"
          fontWeight="500"
          letterSpacing="0.4"
        >
          Run Simple, Run Smart
        </text>
      ) : null}
    </motion.svg>
  )
}

export default function SeemplifyLogo({
  size = 'md',
  animated = false,
  className = '',
  showTagline = false,
}: SeemplifyLogoProps) {
  const dimensions = sizeMap[size]
  return (
    <WordmarkSvg
      width={dimensions.width}
      height={dimensions.height}
      animated={animated}
      className={className}
      showTagline={showTagline}
    />
  )
}

export function SeemplifyIcon({ size = 'md', className = '' }: Omit<SeemplifyLogoProps, 'animated' | 'showTagline'>) {
  const dimensionMap = {
    sm: 24,
    md: 30,
    lg: 36,
    xl: 44,
  }
  const dimension = dimensionMap[size]
  const gradientId = useId().replace(/:/g, '')

  return (
    <svg
      viewBox="0 0 88 88"
      className={className}
      style={{ width: dimension, height: dimension }}
      role="img"
      aria-label="Seemplify"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#b980ff" />
          <stop offset="48%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#4c1d95" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="72" height="72" rx="22" fill="rgba(124,58,237,0.12)" />
      <path
        d="M56 22C63 22 68 26 68 33C68 40 63 44 56 44H43C38 44 34 46.7 34 51C34 55.6 38.1 58 44 58H64"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SeemplifyLogoWithText({ size = 'md', animated = false, className = '' }: SeemplifyLogoProps) {
  return <SeemplifyLogo size={size} animated={animated} className={className} showTagline />
}
