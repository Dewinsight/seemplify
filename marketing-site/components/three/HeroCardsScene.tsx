'use client'

import * as THREE from 'three'
import { useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Html, Lightformer, PerformanceMonitor, RoundedBox } from '@react-three/drei'
import type { MarketingTheme } from '@/lib/useMarketingTheme'
import SilkPlane from './SilkPlane'
import styles from '../LandingEffects.module.css'

/**
 * "One person. One record." — the same colleague's record card, as each of the
 * eight workspaces sees it, fanned on a slow carousel. The cards are real DOM
 * (drei <Html transform>) set in the site's own type and tokens, mounted on
 * thin paper-like slabs that cast soft contact shadows.
 */

const CARD_W = 2.3
const CARD_H = 1.5
const CARD_T = 0.05
const RING_RADIUS = 3.3
const DOM_WIDTH = 280
// drei maps 1 CSS px to (distanceFactor / 400) world units in transform mode.
const DISTANCE_FACTOR = (CARD_W / DOM_WIDTH) * 400
// The carousel is authored in small units but rendered 100x larger. drei's transform mode treats one world
// unit as one CSS pixel at the perspective plane, so a tiny world sits a few pixels from the eye and is
// magnified ~150x; Chrome's sub-pixel snapping of the overlay then shows up as the DOM faces drifting off
// their slabs. At 100 units per card-width the magnification is ~1.5x and snapping is invisible.
const WORLD = 100

type Tone = 'brand' | 'positive' | 'warning' | 'neutral'

interface RecordView {
  workspace: string
  tone: Tone
  rows: Array<[string, string]>
  status: string
  /** 0–1: a small progress bar under the rows, where the workspace has one. */
  progress?: number
}

// One colleague, seen from every workspace. Fictional sample data.
const PERSON = { name: 'Amara Nwosu', role: 'Product designer · Design', initials: 'AN' }

const RECORDS: RecordView[] = [
  { workspace: 'Recruiter', tone: 'brand', rows: [['Stage', 'Shortlist'], ['Interview', 'Thu · 10:00']], status: 'CV analysed' },
  { workspace: 'Core HR', tone: 'neutral', rows: [['Team', 'Design · Lagos'], ['Onboarding', '4 of 6 tasks']], status: 'Active member', progress: 4 / 6 },
  { workspace: 'Leave', tone: 'positive', rows: [['Request', 'Annual · 16–17 Jun'], ['Balance', '14 days']], status: 'Ready for decision' },
  { workspace: 'Performance', tone: 'brand', rows: [['Cycle', 'Q3 goals'], ['Key results', '3 tracked']], status: 'Check-in due', progress: 0.45 },
  { workspace: 'Time', tone: 'positive', rows: [['Clock in', '08:58'], ['Timesheet', 'Week 24 · draft']], status: 'On site' },
  { workspace: 'Payroll', tone: 'warning', rows: [['Run', 'June'], ['Adjustments', '2 pending']], status: 'Pending review' },
  { workspace: 'Experience', tone: 'neutral', rows: [['Survey', 'Onboarding pulse'], ['Questions', '12']], status: 'Sent' },
  { workspace: 'Learning', tone: 'brand', rows: [['Course', 'Manager foundations'], ['Progress', '2 of 3 lessons']], status: 'In progress', progress: 2 / 3 },
]

interface Palette {
  silk: string
  slab: string
  track: string
  shadow: string
  shadowOpacity: number
  keyLight: string
}

const PALETTES: Record<MarketingTheme, Palette> = {
  light: { silk: '#d4c6f6', slab: '#ffffff', track: '#7047eb', shadow: '#312d39', shadowOpacity: 0.42, keyLight: '#ffffff' },
  dark: { silk: '#3f3170', slab: '#221e2c', track: '#a98eff', shadow: '#000000', shadowOpacity: 0.34, keyLight: '#e6dfff' },
}

interface RecordCardProps {
  record: RecordView
  index: number
  angle: number
  palette: Palette
  spreadRef: MutableRefObject<number>
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)

function RecordCard({ record, index, angle, palette, spreadRef }: RecordCardProps) {
  const group = useRef<THREE.Group>(null)
  const dom = useRef<HTMLDivElement>(null)
  const material = useRef<THREE.MeshStandardMaterial>(null)
  const camera = useThree((state) => state.camera)
  const scratch = useMemo(
    () => ({ normal: new THREE.Vector3(), toCamera: new THREE.Vector3(), position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }),
    [],
  )

  // Priority -2: this runs before drei's <Html> update (priority 0), so the DOM face never lags the slab.
  useFrame(({ clock }) => {
    const g = group.current
    if (!g || !dom.current) return
    const t = clock.elapsedTime
    const radius = RING_RADIUS + spreadRef.current * 0.7
    g.position.set(radius * Math.cos(angle), 0, radius * Math.sin(angle))
    g.rotation.set(0, -angle + Math.PI / 2, 0)

    // How squarely this card faces the camera drives its opacity and lift.
    g.getWorldQuaternion(scratch.quaternion)
    g.getWorldPosition(scratch.position)
    scratch.normal.set(0, 0, 1).applyQuaternion(scratch.quaternion)
    scratch.toCamera.copy(camera.position).sub(scratch.position).normalize()
    const facing = scratch.normal.dot(scratch.toCamera)
    const visible = THREE.MathUtils.clamp((facing + 0.1) / 0.85, 0, 1)
    // Staggered entrance: each card rises into place over the first second.
    const intro = easeOut(THREE.MathUtils.clamp((t - 0.15 - index * 0.09) / 1.1, 0, 1))

    g.position.y = 0.16 * visible + Math.sin(t * 0.9 + angle * 3) * 0.035 - (1 - intro) * 0.6
    g.scale.setScalar(0.88 + 0.12 * intro)
    // Fully hide cards that have turned away, so nothing reads mirrored through the front ones.
    dom.current.style.opacity = facing < 0.05 ? '0' : String((0.08 + visible * 0.92) * intro)
    dom.current.dataset.front = visible > 0.92 ? 'true' : 'false'
    if (material.current) material.current.opacity = facing < 0.05 ? 0 : (0.12 + 0.88 * visible) * intro
  }, -2)

  return (
    <group ref={group}>
      <RoundedBox args={[CARD_W, CARD_H, CARD_T]} radius={0.07} smoothness={6}>
        <meshStandardMaterial ref={material} color={palette.slab} roughness={0.85} metalness={0} transparent />
      </RoundedBox>
      <Html
        transform
        distanceFactor={DISTANCE_FACTOR}
        position={[0, 0, CARD_T / 2 + 0.003]}
        // A wide range so each card's distance maps to its own z-index; the default 20 steps left them tied.
        zIndexRange={[1000, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div ref={dom} className={styles.recordCard} data-tone={record.tone} style={{ width: DOM_WIDTH }}>
          <div className={styles.recordHead}>
            <span className={styles.recordAvatar}>{PERSON.initials}</span>
            <div className={styles.recordWho}>
              <strong>{PERSON.name}</strong>
              <small>{PERSON.role}</small>
            </div>
            <span className={styles.recordWorkspace}>{record.workspace}</span>
          </div>
          <dl className={styles.recordRows}>
            {record.rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {record.progress !== undefined && (
            <div className={styles.recordBar} aria-hidden="true">
              <i style={{ width: `${Math.round(record.progress * 100)}%` }} />
            </div>
          )}
          <div className={styles.recordFoot}>
            <span className={styles.recordStatus}>
              <i />
              {record.status}
            </span>
            <span className={styles.recordId}>SEE-1042</span>
          </div>
        </div>
      </Html>
    </group>
  )
}

/** Pointer drag state shared with the frame: radians pending since the last frame, and the fling velocity. */
export interface DragState {
  active: boolean
  pending: number
  velocity: number
}

interface CarouselProps {
  palette: Palette
  spreadRef: MutableRefObject<number>
  hoverRef: MutableRefObject<boolean>
  dragRef: MutableRefObject<DragState>
}

/** Slow carousel; the pointer nudges it, hovering slows it, scrolling spreads it, dragging spins it. */
function Carousel({ palette, spreadRef, hoverRef, dragRef }: CarouselProps) {
  const ring = useRef<THREE.Group>(null)
  const drift = useRef(0)
  const speed = useRef(0.09)

  useFrame((state, delta) => {
    if (!ring.current) return
    const drag = dragRef.current
    speed.current = THREE.MathUtils.damp(speed.current, hoverRef.current ? 0.025 : 0.09, 2.5, delta)
    if (drag.active) {
      // Follow the finger: whatever moved since the last frame becomes rotation, and its rate is kept for the fling.
      if (drag.pending !== 0) {
        drift.current += drag.pending
        drag.velocity = THREE.MathUtils.clamp(drag.pending / Math.max(delta, 1 / 120), -7, 7)
        drag.pending = 0
      } else {
        drag.velocity = THREE.MathUtils.damp(drag.velocity, 0, 18, delta)
      }
    } else {
      // Released: coast on the fling, then settle back into the slow drift.
      drift.current += delta * (speed.current + drag.velocity)
      drag.velocity = THREE.MathUtils.damp(drag.velocity, 0, 2.4, delta)
    }
    const targetY = drift.current + state.pointer.x * 0.28
    const targetX = 0.04 + state.pointer.y * -0.06 + spreadRef.current * 0.18
    ring.current.rotation.y = THREE.MathUtils.damp(ring.current.rotation.y, targetY, drag.active ? 16 : 4, delta)
    ring.current.rotation.x = THREE.MathUtils.damp(ring.current.rotation.x, targetX, 4, delta)
    // drei's <Html> reads matrixWorld in its own frame callback (priority 0); three only refreshes it at
    // render time, one frame later. Refresh the ring now so the DOM faces sit exactly on this frame's slabs.
    ring.current.updateMatrixWorld(true)
  }, -1)

  return (
    <group ref={ring} position={[0, 0.82, 0]}>
      {RECORDS.map((record, index) => (
        <RecordCard
          key={record.workspace}
          record={record}
          index={index}
          angle={(index / RECORDS.length) * Math.PI * 2}
          palette={palette}
          spreadRef={spreadRef}
        />
      ))}
      {/* The track the record travels along. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -CARD_H / 2 - 0.2, 0]}>
        <ringGeometry args={[RING_RADIUS - 0.012, RING_RADIUS + 0.012, 160]} />
        <meshBasicMaterial color={palette.track} transparent opacity={0.28} depthWrite={false} />
      </mesh>
    </group>
  )
}

interface HeroCardsSceneProps {
  active?: boolean
  theme?: MarketingTheme
  compact?: boolean
  /** 0–1: how far the hero has scrolled out of view. */
  spreadRef: MutableRefObject<number>
  /** True while the pointer is over the hero frame. */
  hoverRef: MutableRefObject<boolean>
  /** Drag input from the frame (mouse or touch). */
  dragRef: MutableRefObject<DragState>
}

function LookAt({ target }: { target: [number, number, number] }) {
  const camera = useThree((state) => state.camera)
  useMemo(() => camera.lookAt(...target), [camera, target])
  return null
}

export default function HeroCardsScene({ active = true, theme = 'light', compact = false, spreadRef, hoverRef, dragRef }: HeroCardsSceneProps) {
  const palette = PALETTES[theme]
  const [dpr, setDpr] = useState(1.5)
  const light = theme === 'light'
  const target = useMemo<[number, number, number]>(() => [0, 0.66 * WORLD, 0], [])

  return (
    <Canvas
      className={styles.orbitCanvas}
      frameloop={active ? 'always' : 'never'}
      dpr={dpr}
      camera={{ position: [0, 2.3 * WORLD, (compact ? 8.6 : 10.4) * WORLD], fov: 30, near: 1, far: 60 * WORLD }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ background: 'transparent' }}
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} />
      <LookAt target={target} />
      <ambientLight intensity={light ? 1.1 : 0.6} />
      <directionalLight position={[3, 6, 4]} intensity={light ? 1.5 : 1.1} color={palette.keyLight} />

      <SilkPlane color={palette.silk} lightMode={light} speed={2.2} scale={1.1} rotation={0.4} noiseIntensity={light ? 0.45 : 0.3} depth={9 * WORLD} />

      <group scale={WORLD}>
        <Carousel palette={palette} spreadRef={spreadRef} hoverRef={hoverRef} dragRef={dragRef} />
      </group>

      <ContactShadows position={[0, (0.82 - CARD_H / 2 - 0.22) * WORLD, 0]} opacity={palette.shadowOpacity} scale={12 * WORLD} blur={3.2} far={3 * WORLD} color={palette.shadow} />

      <Environment resolution={128}>
        <Lightformer form="circle" intensity={light ? 1.2 : 1.6} color="#ffffff" position={[-3, 5, 4]} scale={3} />
        <Lightformer form="circle" intensity={0.5} color="#c4b5fd" position={[4, 2, -5]} scale={6} />
      </Environment>
    </Canvas>
  )
}

