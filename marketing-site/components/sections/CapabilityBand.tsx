'use client'

import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  CalendarDays,
  GraduationCap,
  KeyRound,
  MapPin,
  MessageSquareText,
  Mic2,
  ScanSearch,
  ShieldCheck,
  Target,
  UserRoundCheck,
  WalletCards,
} from 'lucide-react'
import Marquee from '../motion/Marquee'
import styles from '../LandingEffects.module.css'

// Every chip is a capability the page already describes for one of the eight workspaces.
const ROW_A: Array<[string, LucideIcon]> = [
  ['CV understanding & matching', ScanSearch],
  ['Guided AI interviews', Mic2],
  ['Structured onboarding journeys', UserRoundCheck],
  ['Leave balances & approvals', CalendarDays],
  ['OKRs & review cycles', Target],
  ['Geofenced attendance', MapPin],
]

const ROW_B: Array<[string, LucideIcon]> = [
  ['Pay runs with approval gates', WalletCards],
  ['Courses & development tracking', GraduationCap],
  ['Single sign-on', KeyRound],
  ['Organisation-aware roles', ShieldCheck],
  ['Recruiter assistant', MessageSquareText],
  ['Employee listening & journeys', BarChart3],
]

function Chip({ label, Icon }: { label: string; Icon: LucideIcon }) {
  return (
    <span className={styles.bandChip}>
      <Icon aria-hidden="true" size={15} />
      {label}
    </span>
  )
}

export default function CapabilityBand() {
  return (
    <section className={styles.band} aria-label="What the suite covers">
      <p className={styles.bandKicker}>Everything people operations touches, in one place</p>
      <div className={styles.bandRows}>
        <Marquee speed={42}>
          {ROW_A.map(([label, Icon]) => (
            <Chip key={label} label={label} Icon={Icon} />
          ))}
        </Marquee>
        <Marquee speed={36} reverse>
          {ROW_B.map(([label, Icon]) => (
            <Chip key={label} label={label} Icon={Icon} />
          ))}
        </Marquee>
      </div>
    </section>
  )
}
