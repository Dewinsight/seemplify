'use client'

import { useEffect, useState } from 'react'

/**
 * Static hero background — deliberately no animated motion.div blurs.
 * Large CSS filter:blur + framer-motion animation breaks on iOS Safari:
 * the blobs render as opaque colour fills rather than soft glows, making
 * the page look completely wrong. Plain radial-gradient CSS works on every
 * browser, including iOS 15+.
 */
export default function HeroBackground() {
  const [isAkwa, setIsAkwa] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hostname.includes('akwaibom')) {
      setIsAkwa(true)
    }
  }, [])

  const bg = isAkwa
    ? '#f0faf4'              // light green tint — matches Akwa Ibom palette
    : '#f7f7fb'              // default light grey

  // Static radial glows — all defined in plain CSS so iOS renders them correctly
  const radials = isAkwa
    ? `
        radial-gradient(ellipse 70% 55% at 15% 10%, rgba(21,128,61,0.18), transparent),
        radial-gradient(ellipse 55% 45% at 85% 5%,  rgba(217,119,6,0.14),  transparent),
        radial-gradient(ellipse 60% 50% at 55% 75%, rgba(16,185,129,0.12), transparent)
      `
    : `
        radial-gradient(ellipse 70% 55% at 15% 10%, rgba(56,189,248,0.15),  transparent),
        radial-gradient(ellipse 55% 45% at 85% 5%,  rgba(16,185,129,0.13),  transparent),
        radial-gradient(ellipse 60% 50% at 55% 75%, rgba(99,102,241,0.10),  transparent)
      `

  return (
    <div
      aria-hidden
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{ zIndex: 0 }}
    >
      {/* Solid base — prevents any bleed-through on iOS */}
      <div className="absolute inset-0" style={{ background: bg }} />

      {/* Colour glows — static CSS only, no JS animation */}
      <div
        className="absolute inset-0"
        style={{ background: radials, opacity: 0.9 }}
      />

      {/* Subtle dot grid — CSS background-image, no animation */}
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(0,0,0,0.5) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Soft bottom fade to white */}
      <div
        className="absolute inset-x-0 bottom-0 h-48"
        style={{
          background: `linear-gradient(to bottom, transparent, ${bg})`,
        }}
      />
    </div>
  )
}
