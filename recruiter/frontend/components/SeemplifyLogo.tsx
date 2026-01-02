'use client'

import { motion } from 'framer-motion'

interface SeemplifyLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  animated?: boolean
  className?: string
}

export default function SeemplifyLogo({ size = 'md', animated = true, className = '' }: SeemplifyLogoProps) {
  const sizes = {
    sm: 32,
    md: 44,
    lg: 56,
    xl: 72,
  }

  const dimension = sizes[size]

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      style={{ width: dimension, height: dimension }}
    >
      <defs>
        {/* Main gradient for the logo */}
        <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>

        {/* Glow effect */}
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      {/* Background circle with subtle glow */}
      <motion.circle
        cx="50"
        cy="50"
        r="45"
        fill="url(#logoGradient)"
        opacity="0.1"
        initial={{ scale: 0.8 }}
        animate={animated ? { scale: [0.8, 1, 0.8] } : {}}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Main "S" shape made of connected nodes */}
      <g filter="url(#glow)">
        {/* Top arc of S */}
        <motion.path
          d="M 65 25 Q 75 25 75 35 Q 75 45 65 45"
          stroke="url(#logoGradient)"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={animated ? { pathLength: 1 } : { pathLength: 1 }}
          transition={{ duration: 1, ease: "easeInOut" }}
        />

        {/* Middle curve */}
        <motion.path
          d="M 65 45 Q 50 50 35 55"
          stroke="url(#logoGradient)"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={animated ? { pathLength: 1 } : { pathLength: 1 }}
          transition={{ duration: 1, delay: 0.2, ease: "easeInOut" }}
        />

        {/* Bottom arc of S */}
        <motion.path
          d="M 35 55 Q 25 55 25 65 Q 25 75 35 75"
          stroke="url(#logoGradient)"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={animated ? { pathLength: 1 } : { pathLength: 1 }}
          transition={{ duration: 1, delay: 0.4, ease: "easeInOut" }}
        />

        {/* Connection nodes - representing network/connections */}
        {[
          { cx: 65, cy: 25, delay: 0.6 },
          { cx: 75, cy: 35, delay: 0.7 },
          { cx: 65, cy: 45, delay: 0.8 },
          { cx: 50, cy: 50, delay: 0.9 },
          { cx: 35, cy: 55, delay: 1.0 },
          { cx: 25, cy: 65, delay: 1.1 },
          { cx: 35, cy: 75, delay: 1.2 },
        ].map((node, index) => (
          <motion.circle
            key={index}
            cx={node.cx}
            cy={node.cy}
            r="4"
            fill="white"
            initial={{ scale: 0 }}
            animate={animated ? { scale: [0, 1.2, 1] } : { scale: 1 }}
            transition={{ duration: 0.5, delay: node.delay, ease: "easeOut" }}
          />
        ))}

        {/* AI indicator - small accent lines */}
        <motion.g
          initial={{ opacity: 0 }}
          animate={animated ? { opacity: [0, 1, 0.7] } : { opacity: 0.7 }}
          transition={{ duration: 1, delay: 1.3 }}
        >
          {/* Top right accent */}
          <line x1="78" y1="28" x2="83" y2="23" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" />
          <line x1="78" y1="32" x2="85" y2="32" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" />

          {/* Bottom left accent */}
          <line x1="22" y1="68" x2="17" y2="73" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" />
          <line x1="22" y1="72" x2="15" y2="72" stroke="#ec4899" strokeWidth="2" strokeLinecap="round" />
        </motion.g>
      </g>
    </svg>
  )
}

// Icon-only version (simplified for small sizes)
export function SeemplifyIcon({ size = 'md', className = '' }: Omit<SeemplifyLogoProps, 'animated'>) {
  const sizes = {
    sm: 24,
    md: 32,
    lg: 40,
    xl: 48,
  }

  const dimension = sizes[size]

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      style={{ width: dimension, height: dimension }}
    >
      <defs>
        <linearGradient id="iconGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>

      {/* Simplified S with nodes */}
      <g>
        <path
          d="M 65 25 Q 75 25 75 35 Q 75 45 65 45 Q 50 50 35 55 Q 25 55 25 65 Q 25 75 35 75"
          stroke="url(#iconGradient)"
          strokeWidth="7"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Key nodes */}
        <circle cx="65" cy="25" r="5" fill="white" />
        <circle cx="50" cy="50" r="5" fill="white" />
        <circle cx="35" cy="75" r="5" fill="white" />
      </g>
    </svg>
  )
}

// Horizontal logo with "Seemplify Recruiter" text
export function SeemplifyRecruiterLogo({ size = 'md', animated = false }: SeemplifyLogoProps) {
  const heights = {
    sm: 32,
    md: 44,
    lg: 56,
    xl: 72,
  }

  const height = heights[size]

  return (
    <div className="flex items-center gap-3">
      <SeemplifyLogo size={size} animated={animated} />
      <div className="flex flex-col justify-center">
        <div className="font-semibold tracking-tight leading-none" style={{ fontSize: height * 0.36 }}>
          <span className="text-white">Seemplify</span>
          <span className="ml-1.5 font-light text-blue-400">Recruiter</span>
        </div>
        <p className="text-zinc-500 text-xs leading-none mt-1">AI-Powered Hiring</p>
      </div>
    </div>
  )
}
