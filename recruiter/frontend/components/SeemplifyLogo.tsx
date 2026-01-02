'use client'

interface SeemplifyLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

// Simple flat Seemplify logo - matches IDP style
export default function SeemplifyLogo({ size = 'md', className = '' }: SeemplifyLogoProps) {
  const sizes = {
    sm: 28,
    md: 36,
    lg: 44,
    xl: 56,
  }

  const dimension = sizes[size]

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      style={{ width: dimension, height: dimension }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="seemplifyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <path
        d="M 65 25 Q 75 25 75 35 Q 75 45 65 45 Q 50 50 35 55 Q 25 55 25 65 Q 25 75 35 75"
        stroke="url(#seemplifyGradient)"
        strokeWidth="8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="65" cy="25" r="6" fill="#fff" />
      <circle cx="50" cy="50" r="6" fill="#fff" />
      <circle cx="35" cy="75" r="6" fill="#fff" />
    </svg>
  )
}

// Alias for consistency
export function SeemplifyIcon({ size = 'md', className = '' }: SeemplifyLogoProps) {
  return <SeemplifyLogo size={size} className={className} />
}

// Horizontal logo with "Seemplify Recruiter" text
export function SeemplifyRecruiterLogo({ size = 'md' }: SeemplifyLogoProps) {
  const textSizes = {
    sm: { main: 'text-base', sub: 'text-[10px]' },
    md: { main: 'text-lg', sub: 'text-xs' },
    lg: { main: 'text-xl', sub: 'text-xs' },
    xl: { main: 'text-2xl', sub: 'text-sm' },
  }

  const text = textSizes[size]

  return (
    <div className="flex items-center gap-3">
      <SeemplifyLogo size={size} />
      <div className="flex flex-col justify-center">
        <div className={`font-semibold tracking-tight leading-none ${text.main}`}>
          <span className="text-white">Seemplify</span>
          <span className="ml-1.5 font-light text-blue-400">Recruiter</span>
        </div>
        <p className={`text-zinc-500 leading-none mt-1 ${text.sub}`}>AI-Powered Hiring</p>
      </div>
    </div>
  )
}
