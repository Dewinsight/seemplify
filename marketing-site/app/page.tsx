'use client'

import { type ReactNode, useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import HeroBackground from '@/components/HeroBackground'
import SeemplifyLogo from '@/components/SeemplifyLogo'
import ThemeToggle from '@/components/ThemeToggle'
import BookDemoModal from '@/components/BookDemoModal'

import HeroBannerBeautiful from '../public/hero-banner-beautiful.png'
import HeroBannerDark from '../public/hero-banner-dark.png'

const IDP_URL = 'https://auth.seemplifyai.com'

type ModuleCardProps = {
  title: string
  description: string
  tag: string
  accent: string
  className?: string
  visual: ReactNode
}

type InfoCardProps = {
  title: string
  description: string
  eyebrow?: string
  variant?: 'default' | 'inverse'
}



const ModuleCard = ({ title, description, tag, accent, className = '', visual }: ModuleCardProps) => (
  <motion.div
    className={`group relative h-full overflow-hidden rounded-3xl border border-black/10 bg-white p-6 shadow-[0_30px_60px_-50px_rgba(15,23,42,0.35)] backdrop-blur-xl transition dark:border-white/20 dark:bg-white/[0.04] dark:shadow-none ${className}`}
    whileHover={{ y: -6 }}
    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
  >
    <div className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
      <div className="absolute inset-0 bg-gradient-to-br from-black/5 via-white/70 to-transparent dark:from-white/10 dark:via-white/5" />
      <div className="absolute -top-12 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full bg-black/10 blur-3xl dark:bg-white/20" />
    </div>
    <div className="relative z-10 flex h-full flex-col">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.28em] text-zinc-600 dark:text-white/60">
        <span>{tag}</span>
        <span className="text-zinc-400 dark:text-white/40">Module</span>
      </div>
      <div className={`mt-4 h-[2px] w-10 rounded-full bg-gradient-to-r ${accent}`} />
      <h3 className="mt-4 font-display text-2xl text-zinc-900 dark:text-white">{title}</h3>
      <p className="mt-2 text-sm text-zinc-700 dark:text-white/75">{description}</p>
      <div className="mt-6 flex-1">{visual}</div>
    </div>
  </motion.div>
)

const InfoCard = ({ title, description, eyebrow, variant = 'default' }: InfoCardProps) => {
  const isInverse = variant === 'inverse'

  return (
    <div
      className={`rounded-2xl border p-6 shadow-[0_20px_40px_-30px_rgba(15,23,42,0.3)] ${isInverse
        ? 'border-white/15 bg-white/5 text-white shadow-[0_20px_45px_-25px_rgba(0,0,0,0.45)]'
        : 'border-black/10 bg-white dark:border-white/20 dark:bg-white/[0.05] dark:shadow-none'
        }`}
    >
      {eyebrow && (
        <p
          className={`text-xs uppercase tracking-[0.3em] ${isInverse ? 'text-white/60' : 'text-zinc-700 dark:text-white/60'
            }`}
        >
          {eyebrow}
        </p>
      )}
      <h3 className={`mt-3 font-display text-xl ${isInverse ? 'text-white' : 'text-zinc-900 dark:text-white'}`}>
        {title}
      </h3>
      <p className={`mt-2 text-sm ${isInverse ? 'text-white/70' : 'text-zinc-800 dark:text-white/75'}`}>
        {description}
      </p>
    </div>
  )
}



const RecruitingKanban = () => (
  <div className="relative h-32 rounded-2xl border border-black/10 bg-white p-3 dark:border-white/20 dark:bg-black/30">
    <div className="grid grid-cols-3 text-[10px] uppercase tracking-[0.2em] text-zinc-700 dark:text-white/60">
      <span>Screen</span>
      <span>Interview</span>
      <span>Hired</span>
    </div>
    <div className="mt-2 grid grid-cols-3 gap-2">
      {[0, 1, 2].map((col) => (
        <div key={col} className="space-y-2">
          <div className="h-3 rounded-md bg-black/10 dark:bg-white/10" />
          <div className="h-3 rounded-md bg-black/5 opacity-70 dark:bg-white/10 dark:opacity-80" />
        </div>
      ))}
    </div>
    <motion.div
      className="absolute left-3 top-9 h-7 w-[28%] rounded-lg border border-sky-300/40 bg-gradient-to-r from-sky-400/40 to-indigo-400/40 p-1 shadow-[0_0_15px_rgba(99,102,241,0.4)]"
      animate={{ x: ['0%', '36%', '72%'], opacity: [0.5, 1, 0.85] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
    >
      <div className="h-2 w-3/4 rounded-sm bg-white/80 dark:bg-white/90" />
      <div className="mt-1 h-1 w-1/2 rounded-sm bg-white/60 dark:bg-white/70" />
    </motion.div>
    <motion.div
      className="absolute left-3 top-[86px] h-6 w-[26%] rounded-lg border border-black/10 bg-black/5 p-1 dark:border-white/20 dark:bg-white/15"
      animate={{ x: ['0%', '36%', '72%'], opacity: [0.35, 0.8, 0.5] }}
      transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut', delay: 1.4 }}
    >
      <div className="h-1.5 w-2/3 rounded-sm bg-zinc-200/80 dark:bg-white/75" />
      <div className="mt-1 h-1 w-1/3 rounded-sm bg-zinc-200/70 dark:bg-white/60" />
    </motion.div>
  </div>
)

const IdentityOrbit = () => (
  <div className="relative flex h-32 items-center justify-center">
    <div className="absolute h-16 w-16 rounded-2xl border border-black/10 bg-white/70 backdrop-blur dark:border-white/25 dark:bg-white/10">
      <div className="absolute inset-2 rounded-xl border border-black/10 dark:border-white/20" />
      <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono uppercase tracking-[0.3em] text-zinc-600 dark:text-white/75">
        SSO
      </div>
    </div>
    <motion.div
      className="absolute h-28 w-28 rounded-full border border-black/10 dark:border-white/20"
      animate={{ rotate: 360 }}
      transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
    >
      <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
      <div className="absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.7)]" />
      <div className="absolute right-1 top-1/3 h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.7)]" />
    </motion.div>
    <motion.div
      className="absolute h-40 w-40 rounded-full border border-black/5 dark:border-white/15"
      animate={{ rotate: -360 }}
      transition={{ duration: 26, repeat: Infinity, ease: 'linear' }}
    >
      <div className="absolute right-6 bottom-2 h-1.5 w-1.5 rounded-full bg-zinc-400/60 dark:bg-white/70" />
      <div className="absolute left-6 top-4 h-1.5 w-1.5 rounded-full bg-zinc-400/50 dark:bg-white/60" />
    </motion.div>
  </div>
)

const PerformanceBars = () => {
  const bars = [52, 78, 64, 90]
  return (
    <div className="flex h-32 items-end gap-3">
      {bars.map((height, index) => (
        <div key={`${height}-${index}`} className="relative flex-1 h-full">
          <div className="absolute inset-0 rounded-md bg-black/5 dark:bg-white/5" />
          <motion.div
            className="absolute inset-x-0 bottom-0 rounded-md bg-gradient-to-t from-violet-500/70 via-fuchsia-400/70 to-cyan-300/60"
            animate={{ height: ['25%', `${height}%`] }}
            transition={{
              duration: 3 + index * 0.6,
              repeat: Infinity,
              repeatType: 'mirror',
              ease: 'easeInOut',
            }}
          />
        </div>
      ))}
    </div>
  )
}

const LeaveCalendar = () => {
  const days = Array.from({ length: 28 }, (_, i) => i + 1)
  const approved = new Set([3, 4, 11, 17, 24])
  return (
    <div className="grid grid-cols-7 gap-1 text-[10px]">
      {days.map((day) => {
        const isApproved = approved.has(day)
        return (
          <motion.div
            key={day}
            className={`flex h-6 items-center justify-center rounded-md border text-zinc-600 dark:text-white/70 ${isApproved
              ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-700 dark:text-emerald-200'
              : 'border-black/10 bg-white/70 dark:border-white/20 dark:bg-white/[0.04]'
              }`}
            animate={
              isApproved
                ? {
                  opacity: [0.4, 1, 0.4],
                  scale: [1, 1.05, 1],
                }
                : undefined
            }
            transition={
              isApproved
                ? {
                  duration: 2.4,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }
                : undefined
            }
          >
            {day}
          </motion.div>
        )
      })}
    </div>
  )
}

const PayrollLedger = () => {
  const rows = [
    { label: 'Base', value: '$4,800' },
    { label: 'Bonus', value: '$620' },
    { label: 'Tax', value: '-$940' },
    { label: 'Net', value: '$4,480' },
  ]

  return (
    <div className="relative h-32 rounded-2xl border border-black/10 bg-white p-3 dark:border-white/20 dark:bg-white/[0.05]">
      <div className="space-y-2 text-[11px] text-zinc-700 dark:text-white/80">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-zinc-700 dark:text-white/70">{row.label}</span>
            <span className="font-mono text-zinc-800 dark:text-white/90">{row.value}</span>
          </div>
        ))}
      </div>
      <motion.div
        className="absolute left-3 right-3 bottom-4 h-px bg-gradient-to-r from-transparent via-amber-400/80 to-transparent"
        animate={{ x: ['-30%', '30%'] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}

const TimeClock = () => (
  <div className="relative flex h-32 flex-col items-center justify-center">
    <motion.div
      className="absolute h-24 w-24 rounded-full border border-cyan-400/40"
      animate={{ scale: [1, 1.08, 1], opacity: [0.2, 0.6, 0.2] }}
      transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
    />
    <div className="relative z-10 font-mono text-3xl tracking-[0.3em] text-zinc-900 dark:text-white">
      09
      <motion.span
        className="text-cyan-600 dark:text-cyan-200"
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        :
      </motion.span>
      41
    </div>
    <div className="relative z-10 mt-3 rounded-full border border-emerald-400/40 bg-emerald-400/15 px-3 py-1 text-[10px] uppercase tracking-[0.35em] text-emerald-700 dark:text-emerald-100">
      Clocked In
    </div>
  </div>
)

const LMSChecklist = () => {
  const courses = [
    { title: 'Onboarding Core', progress: 92 },
    { title: 'Security Compliance', progress: 68 },
    { title: 'Leadership Tracks', progress: 44 },
  ]

  return (
    <div className="space-y-3">
      {courses.map((course, index) => (
        <div key={course.title} className="flex items-center gap-3">
          <div className="flex h-4 w-4 items-center justify-center rounded border border-black/10 bg-black/5 dark:border-white/25 dark:bg-white/15">
            <motion.div
              className="h-2 w-2 rounded-sm bg-emerald-400"
              animate={{ scale: [0.6, 1, 0.6] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: index * 0.3 }}
            />
          </div>
          <div className="flex-1">
            <div className="text-[11px] text-zinc-700 dark:text-white/80">{course.title}</div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
              <motion.div
                className="h-full bg-gradient-to-r from-emerald-400/80 to-cyan-400/60"
                animate={{ width: [`${Math.max(10, course.progress - 20)}%`, `${course.progress}%`] }}
                transition={{ duration: 2.6, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
              />
            </div>
          </div>
          <span className="text-[10px] text-zinc-600 dark:text-white/60">{course.progress}%</span>
        </div>
      ))}
    </div>
  )
}



const MarqueeStrip = () => (
  <div className="relative z-20 w-full overflow-hidden border-y border-black/5 bg-white py-5 dark:border-white/10 dark:bg-[#0b0b11]">
    <div className="flex whitespace-nowrap">
      <motion.div
        animate={{ x: ["0%", "-50%"] }}
        transition={{ repeat: Infinity, ease: "linear", duration: 30 }}
        className="flex items-center gap-24"
      >
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 text-3xl text-zinc-900 dark:text-white md:text-4xl">
            <span className="font-sans italic font-light tracking-wide opacity-40">Run Smart.</span>
            <span className="font-display font-medium tracking-tight bg-gradient-to-r from-emerald-500 to-cyan-600 bg-clip-text text-transparent dark:from-emerald-400 dark:to-cyan-400">Run Seemple.</span>
          </div>
        ))}
      </motion.div>
    </div>
  </div>
)

const modules: ModuleCardProps[] = [
  {
    title: 'Recruiting',
    tag: 'Talent',
    description: 'Move candidates from signal to hire with precision routing and automation.',
    accent: 'from-sky-400/80 via-indigo-400/70 to-transparent',
    visual: <RecruitingKanban />,
    className: 'md:col-span-7 min-h-[300px]',
  },
  {
    title: 'Identity',
    tag: 'Access',
    description: 'Centralized SSO with policy enforcement and continuous trust scoring.',
    accent: 'from-emerald-400/80 via-cyan-400/70 to-transparent',
    visual: <IdentityOrbit />,
    className: 'md:col-span-5 min-h-[300px]',
  },
  {
    title: 'Performance',
    tag: 'Growth',
    description: 'Live OKR calibration and continuous feedback loops across teams.',
    accent: 'from-violet-400/80 via-fuchsia-400/70 to-transparent',
    visual: <PerformanceBars />,
    className: 'md:col-span-4 min-h-[260px]',
  },
  {
    title: 'Leave',
    tag: 'Time Off',
    description: 'Automated policy checks with real-time balance sync and approvals.',
    accent: 'from-emerald-300/80 via-lime-300/60 to-transparent',
    visual: <LeaveCalendar />,
    className: 'md:col-span-4 min-h-[260px]',
  },
  {
    title: 'Payroll',
    tag: 'Finance',
    description: 'Run payroll with audit-ready precision and instant reconciliation.',
    accent: 'from-amber-300/80 via-orange-300/70 to-transparent',
    visual: <PayrollLedger />,
    className: 'md:col-span-4 min-h-[260px]',
  },
  {
    title: 'Time',
    tag: 'Attendance',
    description: 'Pulse-accurate time tracking with automatic compliance alerts.',
    accent: 'from-cyan-300/80 via-blue-300/70 to-transparent',
    visual: <TimeClock />,
    className: 'md:col-span-6 min-h-[260px]',
  },
  {
    title: 'LMS',
    tag: 'Learning',
    description: 'Skill pathways that adapt to role changes and certification cadence.',
    accent: 'from-emerald-300/80 via-teal-300/70 to-transparent',
    visual: <LMSChecklist />,
    className: 'md:col-span-6 min-h-[260px]',
  },
]

export default function HomePage() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className="relative min-h-screen bg-[#f7f7fb] text-zinc-900 dark:bg-[#020205] dark:text-white">
      <BookDemoModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      <div className="bg-noise" />
      <HeroBackground />

      <header
        className={`fixed top-0 z-50 w-full transition-all duration-300 ${isScrolled
          ? 'border-b border-black/5 bg-white/70 backdrop-blur-xl dark:border-white/15 dark:bg-[#020205]/80'
          : 'border-b border-transparent bg-transparent'
          }`}
      >
        <nav className="container mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <SeemplifyLogo size="sm" animated={false} />
            <span className="font-display text-lg tracking-tight text-zinc-900 dark:text-white">Seemplify</span>
          </Link>

          <div className="hidden items-center gap-8 text-sm text-zinc-700 dark:text-white/80 lg:flex">
            <Link href="#modules" className="transition hover:text-zinc-900 dark:hover:text-white">Modules</Link>
            <Link href="#how-it-works" className="transition hover:text-zinc-900 dark:hover:text-white">How It Works</Link>
            <Link href="#platform" className="transition hover:text-zinc-900 dark:hover:text-white">Platform</Link>
            <Link href="#cta" className="transition hover:text-zinc-900 dark:hover:text-white">Demo</Link>
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <ThemeToggle />
            <Link href={IDP_URL} className="text-sm text-zinc-700 transition hover:text-zinc-900 dark:text-white/80 dark:hover:text-white">
              Sign In
            </Link>
            <button
              onClick={() => setIsModalOpen(true)}
              className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-[0_0_30px_rgba(15,23,42,0.2)] transition hover:shadow-[0_0_40px_rgba(15,23,42,0.35)] dark:bg-white dark:text-black dark:shadow-[0_0_30px_rgba(255,255,255,0.2)] dark:hover:shadow-[0_0_40px_rgba(255,255,255,0.35)]"
            >
              Book Demo
            </button>
          </div>

          <Link
            href={IDP_URL}
            className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-zinc-700 transition hover:border-black/30 dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:border-white/30 md:hidden"
          >
            Get Started
          </Link>
        </nav>
      </header>

      <main className="relative z-10">
        <section className="relative overflow-hidden pt-32 pb-24 bg-[#f8efe6] dark:bg-transparent">
          <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#f8efe6] via-[#f8efe6]/60 to-transparent dark:from-transparent dark:via-transparent" />
          <div className="container relative z-10 mx-auto px-6">
            <div className="grid gap-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
              <div>
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  className="inline-flex items-center gap-3 rounded-full border border-black/10 bg-white px-4 py-2 text-xs uppercase tracking-[0.35em] text-zinc-700 dark:border-white/20 dark:bg-white/10 dark:text-white/75"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.8)]" />
                  Unified HR OS
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.9, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-6 font-display text-5xl leading-[1.05] tracking-tight text-[#0b2f29] dark:text-white md:text-7xl"
                >
                  The operating system
                  <span className="block bg-gradient-to-r from-[#0b2f29] via-emerald-800 to-teal-700 bg-clip-text text-transparent dark:from-white dark:via-cyan-200 dark:to-emerald-200">
                    for modern people ops.
                  </span>
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.9, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-6 max-w-xl text-lg text-[#294942] dark:text-white/75"
                >
                  Seemplify unifies recruiting, identity, performance, time, and payroll into one
                  cinematic control surface. Precision workflows, continuous intelligence, and zero
                  compromise execution.
                </motion.p>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.9, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-8 flex flex-wrap gap-4"
                >
                  <Link
                    href={IDP_URL}
                    className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white shadow-[0_0_35px_rgba(15,23,42,0.2)] transition hover:shadow-[0_0_45px_rgba(15,23,42,0.35)] dark:bg-white dark:text-black dark:shadow-[0_0_35px_rgba(255,255,255,0.25)] dark:hover:shadow-[0_0_45px_rgba(255,255,255,0.4)]"
                  >
                    Start Free Trial
                  </Link>
                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="rounded-full border border-black/10 bg-white px-6 py-3 text-sm text-zinc-700 transition hover:border-black/30 dark:border-white/20 dark:bg-white/5 dark:text-white/80 dark:hover:border-white/40"
                  >
                    Book a Demo
                  </button>
                </motion.div>

                <div className="mt-10 grid gap-6 text-sm text-zinc-700 dark:text-white/70 sm:grid-cols-3">
                  {[
                    { label: 'Automation Coverage', value: '94%' },
                    { label: 'Core Modules', value: '7' },
                    { label: 'Avg. Launch Time', value: '14 days' },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-2xl border border-black/5 bg-white/70 p-4 dark:border-white/20 dark:bg-white/[0.05]">
                      <div className="text-xs uppercase tracking-[0.25em] text-zinc-600 dark:text-white/40">{stat.label}</div>
                      <div className="mt-2 font-display text-2xl text-zinc-900 dark:text-white">{stat.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <Image
                  src={HeroBannerBeautiful}
                  alt="Seemplify Platform Overview"
                  width={1000}
                  height={800}
                  className="block w-full h-auto object-contain dark:hidden"
                  priority
                  placeholder="blur"
                />
                <Image
                  src={HeroBannerDark}
                  alt="Seemplify Platform Overview (Dark Mode)"
                  width={1000}
                  height={800}
                  className="hidden w-full h-auto object-contain dark:block"
                  priority
                  placeholder="blur"
                />
              </motion.div>
            </div>
          </div>
        </section>

        <MarqueeStrip />

        <section id="modules" className="relative py-24">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#f0f1f6] to-transparent dark:via-[#06060b]" />
          <div className="container mx-auto px-6">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.35em] text-zinc-600 dark:text-white/60">Featured Modules</p>
              <h2 className="mt-4 font-display text-4xl text-zinc-900 dark:text-white md:text-5xl">
                A unified suite, engineered as systems.
              </h2>
              <p className="mt-4 text-zinc-700 dark:text-white/75">
                Every module speaks the same data language. Signals stay synchronized across the
                platform so every action has context and intent.
              </p>
            </div>

            <div className="mt-12 grid gap-6 md:grid-cols-12">
              {modules.map((module) => (
                <ModuleCard key={module.title} {...module} />
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="relative py-24 bg-[#0b0b11] text-white">
          <div className="absolute inset-0 opacity-70">
            <div className="absolute -top-24 left-10 h-72 w-72 rounded-full bg-indigo-500/20 blur-[140px]" />
            <div className="absolute bottom-[-120px] right-0 h-80 w-80 rounded-full bg-emerald-400/15 blur-[160px]" />
          </div>
          <div className="container relative z-10 mx-auto px-6">
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-white/60">How It Works</p>
                <h2 className="mt-4 font-display text-4xl text-white md:text-5xl">
                  From signal to action in three steps.
                </h2>
                <p className="mt-4 text-white/70">
                  Seemplify normalizes data across your workforce stack, then orchestrates automation
                  through verified workflows. Every action is auditable and reversible.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  {
                    eyebrow: '01',
                    title: 'Connect',
                    description: 'Sync HRIS, payroll, ATS, and time signals into one secure graph.',
                  },
                  {
                    eyebrow: '02',
                    title: 'Orchestrate',
                    description: 'Automate approvals, reviews, and compliance routing with guardrails.',
                  },
                  {
                    eyebrow: '03',
                    title: 'Measure',
                    description: 'Track outcomes with live dashboards and continuous optimization.',
                  },
                ].map((item) => (
                  <InfoCard key={item.title} variant="inverse" {...item} />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="platform" className="relative py-24">
          <div className="absolute inset-0 z-0 bg-gradient-to-b from-transparent via-[#eef0f5] to-transparent dark:via-[#050509]" />
          <div className="container relative z-10 mx-auto px-6">
            <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-zinc-700 dark:text-white/60">Platform Layer</p>
                <h2 className="mt-4 font-display text-4xl text-zinc-900 dark:text-white md:text-5xl">
                  A single operating surface for people ops.
                </h2>
                <p className="mt-4 text-zinc-900 dark:text-white/75">
                  The platform connects identity, recruiting, performance, time, payroll, and learning
                  so every team works from the same intelligence plane. Deploy modules independently
                  or activate the full suite for full visibility.
                </p>
                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  {[
                    {
                      eyebrow: 'Signal Sync',
                      title: 'Unified Data Spine',
                      description: 'All workforce events resolve into a normalized timeline.',
                      variant: 'default',
                    },
                    {
                      eyebrow: 'Governance',
                      title: 'Policy-First Automation',
                      description: 'Guardrails enforce approvals, thresholds, and audit trails.',
                      variant: 'default',
                    },
                    {
                      eyebrow: 'Security',
                      title: 'Zero-Trust Access',
                      description: 'SSO, role scopes, and continuous access scoring.',
                      variant: 'default',
                    },
                    {
                      eyebrow: 'Analytics',
                      title: 'Executive Clarity',
                      description: 'Operational dashboards with predictive benchmarks.',
                      variant: 'default',
                    },
                  ].map((item) => (
                    <InfoCard key={item.title} {...item} variant={item.variant as "default" | "inverse" | undefined} />
                  ))}
                </div>
              </div>
              <div className="rounded-3xl border border-black/15 bg-white p-8 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.35)] dark:border-white/20 dark:bg-white/[0.06] dark:shadow-none">
                <div className="flex items-center justify-between text-xs text-zinc-700 dark:text-white/70">
                  <span className="font-mono uppercase tracking-[0.35em]">System Map</span>
                  <span className="text-zinc-400 dark:text-white/50">Live View</span>
                </div>
                <div className="mt-6 grid gap-4">
                  {[
                    { title: 'Identity', detail: 'Access & trust graph', value: '99.9% uptime' },
                    { title: 'Recruiting', detail: 'Pipeline velocity', value: '−42% time‑to‑hire' },
                    { title: 'Performance', detail: 'Feedback cadence', value: '+3.1x touchpoints' },
                  ].map((row) => (
                    <div key={row.title} className="rounded-2xl border border-black/15 bg-white p-4 shadow-[0_12px_24px_-18px_rgba(15,23,42,0.35)] dark:border-white/20 dark:bg-white/[0.05] dark:shadow-none">
                      <div className="flex items-center justify-between text-sm text-zinc-900 dark:text-white/80">
                        <span className="font-medium text-zinc-900 dark:text-white">{row.title}</span>
                        <span className="text-xs text-zinc-700 dark:text-white/60">{row.value}</span>
                      </div>
                      <p className="mt-2 text-xs text-zinc-800 dark:text-white/65">{row.detail}</p>
                      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15">
                        <motion.div
                          className="h-full bg-gradient-to-r from-cyan-400/80 to-emerald-400/70"
                          animate={{ width: ['35%', '80%', '35%'] }}
                          transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="cta" className="relative py-24">
          <div className="container mx-auto px-6">
            <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
              <div className="rounded-3xl border border-black/10 bg-white p-10 backdrop-blur-xl dark:border-white/20 dark:bg-white/[0.06] md:p-14">
                <p className="text-xs uppercase tracking-[0.35em] text-zinc-600 dark:text-white/60">Why Seemplify</p>
                <h3 className="mt-4 font-display text-3xl text-zinc-900 dark:text-white md:text-4xl">
                  Explainable automation, measurable outcomes.
                </h3>
                <p className="mt-4 text-zinc-700 dark:text-white/75">
                  Every workflow ships with a transparent rule set, audit trail, and live metrics.
                  Teams move faster without losing control.
                </p>
                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  <InfoCard
                    eyebrow="Trust"
                    title="Full Audit Trails"
                    description="Every change, approval, and override is logged and exportable."
                  />
                  <InfoCard
                    eyebrow="Speed"
                    title="Automation Coverage"
                    description="Prebuilt workflows cover 90% of HR operations out of the box."
                  />
                  <InfoCard
                    eyebrow="Quality"
                    title="Decision Support"
                    description="AI-assisted insights, always paired with human approvals."
                  />
                  <InfoCard
                    eyebrow="Scale"
                    title="Global Ready"
                    description="Multi-region permissions, compliance, and localized policies."
                  />
                </div>
              </div>
              <div className="rounded-3xl border border-black/10 bg-white p-10 text-center backdrop-blur-xl dark:border-white/20 dark:bg-white/[0.06] md:p-14">
                <h3 className="font-display text-3xl text-zinc-900 dark:text-white md:text-4xl">Ready to run a cinematic HR stack?</h3>
                <p className="mt-4 text-zinc-700 dark:text-white/75">
                  Book a walkthrough or jump straight into the platform. We will map your workforce
                  workflows in days, not quarters.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-4">
                  <Link
                    href={IDP_URL}
                    className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white shadow-[0_0_35px_rgba(15,23,42,0.2)] transition hover:shadow-[0_0_45px_rgba(15,23,42,0.35)] dark:bg-white dark:text-black dark:shadow-[0_0_35px_rgba(255,255,255,0.25)] dark:hover:shadow-[0_0_45px_rgba(255,255,255,0.4)]"
                  >
                    Start Free Trial
                  </Link>
                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="rounded-full border border-black/10 bg-white px-6 py-3 text-sm text-zinc-700 transition hover:border-black/30 dark:border-white/20 dark:bg-white/5 dark:text-white/80 dark:hover:border-white/40"
                  >
                    Book a Demo
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-black/10 bg-white/90 py-12 backdrop-blur-xl dark:border-white/20 dark:bg-[#0b0b11]">
        <div className="container mx-auto flex flex-col items-center justify-between gap-6 px-6 text-sm text-zinc-700 dark:text-white/80 md:flex-row">
          <div className="flex items-center gap-3">
            <SeemplifyLogo size="sm" animated={false} />
            <span className="font-display text-zinc-900 dark:text-white">Seemplify</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/privacy-policy" className="transition hover:text-zinc-900 dark:hover:text-white">
              Privacy
            </Link>
            <Link href="/terms" className="transition hover:text-zinc-900 dark:hover:text-white">
              Terms
            </Link>
            <Link href="mailto:michael.egbo@aiinnigeria.com" className="transition hover:text-zinc-900 dark:hover:text-white">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
