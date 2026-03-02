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
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="50%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>

        {/* Glow effect */}
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Subtle glowing backdrop */}
      <motion.circle
        cx="50"
        cy="50"
        r="40"
        fill="url(#logoGradient)"
        opacity="0.15"
        initial={{ scale: 0.8 }}
        animate={animated ? { scale: [0.8, 1.05, 0.8] } : {}}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />

      <g filter="url(#glow)">
        {/* Left Diamond Facet */}
        <motion.polygon
          points="50,15 20,40 50,85"
          fill="none"
          stroke="url(#logoGradient)"
          strokeWidth="4"
          strokeLinejoin="round"
          initial={{ opacity: 0, pathLength: 0 }}
          animate={animated ? { opacity: 1, pathLength: 1 } : { opacity: 1, pathLength: 1 }}
          transition={{ duration: 1.5, ease: "easeInOut" }}
        />

        {/* Right Diamond Facet */}
        <motion.polygon
          points="50,15 80,40 50,85"
          fill="none"
          stroke="url(#logoGradient)"
          strokeWidth="4"
          strokeLinejoin="round"
          initial={{ opacity: 0, pathLength: 0 }}
          animate={animated ? { opacity: 1, pathLength: 1 } : { opacity: 1, pathLength: 1 }}
          transition={{ duration: 1.5, delay: 0.2, ease: "easeInOut" }}
        />

        {/* Top Diamond Facet */}
        <motion.polygon
          points="50,15 20,40 80,40"
          fill="url(#logoGradient)"
          fillOpacity="0.2"
          stroke="url(#logoGradient)"
          strokeWidth="3"
          strokeLinejoin="round"
          initial={{ opacity: 0 }}
          animate={animated ? { opacity: 1 } : { opacity: 1 }}
          transition={{ duration: 1, delay: 0.8, ease: "easeOut" }}
        />

        {/* Center Vertical Line */}
        <motion.line
          x1="50" y1="15" x2="50" y2="85"
          stroke="url(#logoGradient)"
          strokeWidth="3"
          initial={{ pathLength: 0 }}
          animate={animated ? { pathLength: 1 } : { pathLength: 1 }}
          transition={{ duration: 1.2, delay: 0.5, ease: "easeInOut" }}
        />

        {/* Connection points (Facets intersection) */}
        {[
          { cx: 50, cy: 15, delay: 1.2 },
          { cx: 20, cy: 40, delay: 1.3 },
          { cx: 80, cy: 40, delay: 1.4 },
          { cx: 50, cy: 85, delay: 1.5 },
          { cx: 50, cy: 40, delay: 1.6 },
        ].map((node, index) => (
          <motion.circle
            key={index}
            cx={node.cx}
            cy={node.cy}
            r="4"
            fill="white"
            initial={{ scale: 0 }}
            animate={animated ? { scale: [0, 1.5, 1] } : { scale: [0, 1, 1] }}
            transition={{ duration: 0.6, delay: node.delay, ease: "easeOut" }}
          />
        ))}

        {/* Floating AI energy accents */}
        <motion.g
          initial={{ opacity: 0 }}
          animate={animated ? { y: [-2, 2, -2], opacity: [0, 0.8, 0.4] } : { opacity: 0.7 }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        >
          <circle cx="28" cy="25" r="2" fill="#2dd4bf" />
          <circle cx="72" cy="25" r="2.5" fill="#6366f1" />
          <circle cx="65" cy="70" r="1.5" fill="#10b981" />
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
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="50%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>

      {/* Simplified Diamond Icon */}
      <g>
        {/* Left Side */}
        <polygon
          points="50,15 20,40 50,85"
          fill="none"
          stroke="url(#iconGradient)"
          strokeWidth="6"
          strokeLinejoin="round"
        />

        {/* Right Side */}
        <polygon
          points="50,15 80,40 50,85"
          fill="url(#iconGradient)"
          fillOpacity="0.3"
          stroke="url(#iconGradient)"
          strokeWidth="6"
          strokeLinejoin="round"
        />

        {/* Center line */}
        <line x1="50" y1="15" x2="50" y2="85" stroke="url(#iconGradient)" strokeWidth="4" />

        {/* Key nodes */}
        <circle cx="50" cy="15" r="4" fill="white" />
        <circle cx="20" cy="40" r="4" fill="white" />
        <circle cx="80" cy="40" r="4" fill="white" />
        <circle cx="50" cy="85" r="4" fill="white" />
      </g>
    </svg>
  )
}

// Horizontal logo with text
export function SeemplifyLogoWithText({ size = 'md', animated = false }: SeemplifyLogoProps) {
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
        <div className="font-bold tracking-tight leading-none text-zinc-900 dark:text-white" style={{ fontSize: height * 0.4 }}>
          <span>Seemplify</span>
          <span className="font-light bg-gradient-to-r from-emerald-400 via-teal-400 to-indigo-400 bg-clip-text text-transparent">AI</span>
        </div>
        <p className="text-zinc-500 dark:text-slate-400 text-xs leading-none mt-0.5">HR Simplified</p>
      </div>
    </div>
  )
}
