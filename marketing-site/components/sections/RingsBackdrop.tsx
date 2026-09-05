'use client'

import { useMarketingTheme } from '@/lib/useMarketingTheme'
import MagicRings from '../effects/MagicRings'
import styles from '../LandingEffects.module.css'

/**
 * Backdrop for the closing call to action. Dark theme: additive blooming rings
 * (React Bits MagicRings). Light theme: a still, soft brand bloom — additive
 * WebGL glow has nothing to add on a cream ground.
 */
export default function RingsBackdrop() {
  const theme = useMarketingTheme()

  if (theme === 'light') {
    return <div className={`${styles.ctaRings} ${styles.ctaBloom}`} aria-hidden="true" />
  }

  return (
    <div className={styles.ctaRings}>
      <MagicRings
        color="#8b63ff"
        colorTwo="#2ed3a0"
        alphaMode="luminance"
        opacity={0.6}
        speed={0.5}
        ringCount={7}
        baseRadius={0.2}
        radiusStep={0.085}
        lineThickness={1.4}
        attenuation={14}
        noiseAmount={0.03}
      />
    </div>
  )
}
