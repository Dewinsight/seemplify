'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'

interface SeemplifyLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  animated?: boolean
  className?: string
  showTagline?: boolean
}

const sizeMap = {
  sm: { width: 132, height: 55 },
  md: { width: 168, height: 70 },
  lg: { width: 208, height: 87 },
  xl: { width: 280, height: 117 },
}

function LogoImage({
  width,
  height,
  animated,
  className,
  priority,
}: {
  width: number
  height: number
  animated: boolean
  className: string
  priority: boolean
}) {
  return (
    <motion.div
      className={className}
      style={{ width, height }}
      initial={animated ? { opacity: 0, y: 4 } : false}
      animate={animated ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      role="img"
      aria-label="Seemplify"
    >
      <Image
        src="/images/seemplifylogo.png"
        alt="Seemplify"
        width={1229}
        height={512}
        className="h-full w-full object-contain"
        priority={priority}
      />
    </motion.div>
  )
}

export default function SeemplifyLogo({
  size = 'md',
  animated = false,
  className = '',
}: SeemplifyLogoProps) {
  const dimensions = sizeMap[size]
  return (
    <LogoImage
      width={dimensions.width}
      height={dimensions.height}
      animated={animated}
      className={className}
      priority={size === 'xl'}
    />
  )
}

export function SeemplifyIcon({ size = 'md', className = '' }: Omit<SeemplifyLogoProps, 'animated' | 'showTagline'>) {
  return <SeemplifyLogo size={size} className={className} />
}

export function SeemplifyLogoWithText({ size = 'md', animated = false, className = '' }: SeemplifyLogoProps) {
  return <SeemplifyLogo size={size} animated={animated} className={className} />
}
