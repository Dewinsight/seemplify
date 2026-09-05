'use client'

import createGlobe, { type Arc, type COBEOptions, type Marker } from 'cobe'
import { MapPin } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { useReducedMotion } from 'framer-motion'
import { useMarketingTheme, type MarketingTheme } from '@/lib/useMarketingTheme'
import styles from '../LandingEffects.module.css'

// Every city the published market pages name.
const CITY_COORDS: Record<string, [number, number]> = {
  Lagos: [6.5244, 3.3792],
  Abuja: [9.0765, 7.3986],
  'Port Harcourt': [4.8156, 7.0498],
  Accra: [5.6037, -0.187],
  Kumasi: [6.6885, -1.6244],
  Takoradi: [4.8845, -1.7554],
  Nairobi: [-1.2921, 36.8219],
  Mombasa: [-4.0435, 39.6682],
  Kisumu: [-0.0917, 34.768],
  Johannesburg: [-26.2041, 28.0473],
  'Cape Town': [-33.9249, 18.4241],
  Durban: [-29.8587, 31.0218],
  London: [51.5072, -0.1276],
  Manchester: [53.4808, -2.2426],
  Birmingham: [52.4862, -1.8904],
}

type Palette = Pick<COBEOptions, 'dark' | 'diffuse' | 'mapBrightness' | 'baseColor' | 'markerColor' | 'glowColor' | 'arcColor'> & {
  mapBaseBrightness?: number
}

const PALETTES: Record<MarketingTheme, Palette> = {
  light: {
    dark: 0,
    diffuse: 1.15,
    mapBrightness: 5,
    mapBaseBrightness: 0.04,
    baseColor: [0.9, 0.88, 0.84],
    markerColor: [0.42, 0.25, 0.9],
    glowColor: [0.78, 0.7, 0.99],
    arcColor: [0.42, 0.25, 0.9],
  },
  dark: {
    dark: 1,
    diffuse: 1.7,
    mapBrightness: 8,
    baseColor: [0.26, 0.22, 0.42],
    markerColor: [0.66, 0.56, 1],
    glowColor: [0.24, 0.19, 0.42],
    arcColor: [0.72, 0.6, 1],
  },
}

interface MarketsGlobeProps {
  markets: Array<{ country: string; cities: string[] }>
  caption: string
}

/** cobe (MIT, ~5 kB WebGL) plotting the published markets. Drag to spin; sleeps off-screen. */
export default function MarketsGlobe({ markets, caption }: MarketsGlobeProps) {
  const theme = useMarketingTheme()
  const prefersReducedMotion = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const drag = useRef({ startX: null as number | null, offset: 0, base: 0 })
  const visible = useRef(true)
  // Start with Africa facing the viewer, then drift slowly east.
  const phiRef = useRef(0.25)

  const cityCount = markets.reduce((total, market) => total + market.cities.filter((city) => CITY_COORDS[city]).length, 0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const markers: Marker[] = []
    const hubs: [number, number][] = []
    markets.forEach((market) => {
      market.cities.forEach((city, index) => {
        const location = CITY_COORDS[city]
        if (!location) return
        markers.push({ location, size: index === 0 ? 0.095 : 0.055 })
        if (index === 0) hubs.push(location)
      })
    })
    // One organisation, many markets: thread the hub cities together.
    const arcs: Arc[] = hubs.slice(1).map((to, index) => ({ from: hubs[index], to }))

    let width = canvas.offsetWidth
    let raf = 0
    const onResize = () => {
      width = canvas.offsetWidth
    }
    window.addEventListener('resize', onResize)

    const globe = createGlobe(canvas, {
      ...PALETTES[theme],
      devicePixelRatio: 2,
      width: width * 2,
      height: width * 2,
      phi: phiRef.current,
      theta: 0.22,
      mapSamples: 22000,
      markers,
      arcs,
      opacity: 0.96,
    })

    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting
    })
    observer.observe(canvas)

    const loop = () => {
      if (visible.current) {
        if (!prefersReducedMotion && drag.current.startX === null) phiRef.current += 0.0011
        globe.update({ phi: phiRef.current + drag.current.offset, width: width * 2, height: width * 2 })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    setReady(true)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      globe.destroy()
    }
  }, [markets, theme, prefersReducedMotion])

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    drag.current.startX = event.clientX
    drag.current.base = drag.current.offset
    event.currentTarget.style.cursor = 'grabbing'
  }
  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (drag.current.startX === null) return
    drag.current.offset = drag.current.base + (event.clientX - drag.current.startX) / 180
  }
  const endDrag = (event: PointerEvent<HTMLCanvasElement>) => {
    drag.current.startX = null
    event.currentTarget.style.cursor = 'grab'
  }

  return (
    <figure className={styles.globeFigure}>
      <div className={styles.globeStage}>
        <div className={styles.globeGlow} aria-hidden="true" />
        <canvas
          ref={canvasRef}
          className={styles.globeCanvas}
          style={{ opacity: ready ? 1 : 0 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          aria-label={`Globe showing ${markets.map((market) => market.country).join(', ')}`}
        />
        <div className={styles.globeLegend} aria-hidden="true">
          <strong>
            {markets.length} markets · {cityCount} cities
          </strong>
          <span>Drag to spin</span>
        </div>
      </div>
      <figcaption className={styles.globeCaption}>
        <MapPin size={17} aria-hidden="true" />
        {caption}
      </figcaption>
    </figure>
  )
}
