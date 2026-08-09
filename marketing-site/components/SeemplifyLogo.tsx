'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

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
  const [isAkwa, setIsAkwa] = useState(false)

  useEffect(() => {
    if (window.location.hostname.includes('akwa') || window.location.hostname.includes('ibom')) {
      setIsAkwa(true)
    }
  }, [])

  return (
    <div
      className={`${animated ? 'seemplify-logo--animated' : ''} ${className}`.trim()}
      style={{ width, height }}
      role="img"
      aria-label={isAkwa ? "Akwa Ibom State" : "Seemplify"}
    >
      <Image
        src={isAkwa ? "/logoakwa.png" : "/logo.svg"}
        alt={isAkwa ? "Akwa Ibom State" : "Seemplify"}
        width={1229}
        height={512}
        className="h-full w-full object-contain"
        priority={priority}
      />
    </div>
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
