'use client'

import { type ReactNode, useState, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import HeroBackground from '@/components/HeroBackground'
import SeemplifyLogo from '@/components/SeemplifyLogo'
import ThemeToggle from '@/components/ThemeToggle'
import BookDemoModal from '@/components/BookDemoModal'
import JsonLd from '@/components/JsonLd'

import HeroBannerBeautiful from '../public/hero-banner-beautiful.png'
import HeroBannerDark from '../public/hero-banner-dark.png'
import HRProfessionalsImage from '../public/images/hr-professionals.png'
import LeadersReviewingImage from '../public/images/leaders-reviewing.png'
import { CheckCircle, Shield, Zap, TrendingUp, UserPlus, FileSignature, Laptop, Award } from 'lucide-react'
import {
  broaderEnglishSpeakingAfricanCountries,
  homeFaqs,
  localizedMarketMap,
  primaryMarketMap,
  primaryMarkets,
  type SeoMarket,
} from './seo-markets'
import { absoluteUrl, idpUrl, siteConfig } from './site-config'

const IDP_LOGIN_URL = idpUrl('/')
const IDP_SIGNUP_URL = idpUrl('/signup')
const MARKET_COOKIE = 'seemplify-market'

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
    className={`group relative h-full overflow-hidden rounded-[2rem] border border-black/5 bg-white/60 p-8 shadow-xl backdrop-blur-2xl transition-all duration-500 hover:border-black/10 dark:border-white/10 dark:bg-[#0b0b11]/80 hover:dark:border-white/20 dark:shadow-[0_0_40px_-20px_rgba(0,0,0,0.5)] ${className}`}
    whileHover={{ y: -8, scale: 1.01 }}
    transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
  >
    {/* Dynamic Background Glow */}
    <div className="absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100">
      <div className={`absolute -inset-2 bg-gradient-to-br ${accent} opacity-10 dark:opacity-20 blur-2xl transition-all duration-700 group-hover:opacity-20 dark:group-hover:opacity-30`} />
      <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-white/40 blur-3xl dark:bg-white/10" />
    </div>

    <div className="relative z-10 flex h-full flex-col">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.25em] text-zinc-500 dark:text-white/50">
        <span className="font-semibold tracking-[0.3em] text-zinc-800 dark:text-white/80">{tag}</span>
        <span>Module</span>
      </div>

      <div className={`mt-6 h-[3px] w-12 rounded-full bg-gradient-to-r ${accent}`} />

      <h3 className="mt-5 font-display text-3xl font-medium tracking-tight text-zinc-900 transition-colors group-hover:text-black dark:text-white dark:group-hover:text-white/90">
        {title}
      </h3>

      <p className="mt-3 leading-relaxed text-zinc-600 dark:text-white/60">
        {description}
      </p>

      <div className="mt-8 flex-1 transition-transform duration-500 group-hover:-translate-y-1">
        {visual}
      </div>
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
  <div className="relative h-40 rounded-2xl border border-black/10 bg-white p-3 dark:border-white/20 dark:bg-zinc-900/40 overflow-hidden">
    <div className="grid grid-cols-3 gap-3 h-full">
      {/* Sourced Column */}
      <div className="flex flex-col gap-2">
        <div className="text-[9px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">Sourced</div>
        <div className="h-6 rounded-md bg-zinc-50 dark:bg-white/5 border border-black/5 dark:border-white/5 flex items-center px-2 gap-2">
          <div className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-white/20" />
          <div className="h-1.5 w-8 rounded-sm bg-zinc-200 dark:bg-white/20" />
        </div>
        <div className="h-6 rounded-md bg-zinc-50 dark:bg-white/5 border border-black/5 dark:border-white/5 flex items-center px-2 gap-2">
          <div className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-white/20" />
          <div className="h-1.5 w-6 rounded-sm bg-zinc-200 dark:bg-white/20" />
        </div>
      </div>

      {/* Interview Column */}
      <div className="flex flex-col gap-2 relative">
        <div className="text-[9px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">Interview</div>
        <div className="h-10 rounded-md bg-white dark:bg-white/[0.08] shadow-sm flex flex-col justify-center px-2 gap-1.5 ring-1 ring-black/5 dark:ring-white/10 relative z-10">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-sky-400/80" />
            <div className="h-1.5 w-8 rounded-sm bg-zinc-200 dark:bg-white/20" />
          </div>
          <div className="h-1 w-full rounded-sm bg-zinc-100 dark:bg-white/5 overflow-hidden">
            <motion.div className="h-full bg-sky-400/80" animate={{ width: ['30%', '80%', '40%'] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} />
          </div>
        </div>
      </div>

      {/* Hired Column */}
      <div className="flex flex-col gap-2">
        <div className="text-[9px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">Hired</div>
        <div className="h-6 rounded-md bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 border-dashed flex items-center px-2 gap-2 justify-center">
          <span className="text-zinc-300 dark:text-white/20 text-xs">+</span>
        </div>
      </div>
    </div>

    {/* Animated Card moving across columns (Smoother, Slower) */}
    <motion.div
      className="absolute top-[68px] left-3 h-8 w-[28%] rounded-md bg-white dark:bg-zinc-800 border border-black/10 dark:border-white/20 shadow-md flex items-center px-2 gap-2 z-20"
      animate={{
        x: ['0%', '115%', '230%'],
        opacity: [0, 1, 0.8]
      }}
      transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', times: [0, 0.5, 1] }}
    >
      <div className="h-3 w-3 rounded-full bg-violet-400/80 flex items-center justify-center">
      </div>
      <div className="h-1.5 w-6 rounded-sm bg-zinc-300 dark:bg-white/60" />
    </motion.div>
  </div>
)

const IdentityOrbit = () => (
  <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-2xl">
    {/* Central Hub */}
    <div className="absolute h-14 w-14 rounded-2xl border border-black/10 bg-white/70 backdrop-blur-md shadow-sm dark:border-white/20 dark:bg-white/5 z-20 flex flex-col items-center justify-center">
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500 dark:text-white/60">SSO</div>
    </div>

    {/* Subtle Orbit Rings */}
    <div className="absolute h-24 w-24 rounded-full border border-black/5 dark:border-white/5" />
    <div className="absolute h-36 w-36 rounded-full border border-black/5 dark:border-white/5" />

    {/* Slower Orbiting Elements */}
    <motion.div
      className="absolute h-24 w-24 rounded-full"
      animate={{ rotate: 360 }}
      transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
    >
      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-fuchsia-400/80 shadow-[0_0_12px_rgba(217,70,239,0.4)]" />
    </motion.div>

    <motion.div
      className="absolute h-36 w-36 rounded-full"
      animate={{ rotate: -360 }}
      transition={{ duration: 32, repeat: Infinity, ease: 'linear' }}
    >
      <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 h-3 w-3 rounded-full bg-violet-400/80 shadow-[0_0_12px_rgba(167,139,250,0.4)]" />
    </motion.div>
  </div>
)

const PerformanceBars = () => {
  const metrics = [
    { label: 'Q1', value: 65, color: 'bg-zinc-200 dark:bg-white/10' },
    { label: 'Q2', value: 45, color: 'bg-zinc-200 dark:bg-white/10' },
    { label: 'Q3', value: 82, color: 'bg-zinc-300 dark:bg-white/20 border-t border-white/20' },
    { label: 'Q4', value: 95, color: 'bg-gradient-to-t from-violet-500/80 to-fuchsia-400/80 shadow-[0_0_15px_rgba(167,139,250,0.2)]' }
  ]

  return (
    <div className="relative h-40 flex flex-col justify-end gap-2 pb-2 px-2">
      {/* Subtle Background Grid Lines */}
      <div className="absolute inset-x-2 bottom-6 top-4 flex flex-col justify-between z-0 opacity-10">
        {[...Array(4)].map((_, i) => <div key={i} className="w-full h-px bg-zinc-500 border-dashed" />)}
      </div>

      <div className="relative z-10 flex h-24 items-end gap-3 px-2">
        {metrics.map((metric, index) => (
          <div key={metric.label} className="relative flex-1 h-full flex items-end justify-center">
            <motion.div
              className={`w-full max-w-[28px] rounded-t-sm ${metric.color}`}
              initial={{ height: '10%' }}
              animate={{ height: `${metric.value}%` }}
              transition={{ duration: 2, delay: index * 0.15, ease: [0.25, 1, 0.5, 1] }}
            />
          </div>
        ))}
      </div>

      {/* Minimum viable labels for cleanliness */}
      <div className="flex px-2 gap-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex-1 text-center text-[9px] font-mono tracking-wider text-zinc-400 dark:text-white/40">
            {metric.label}
          </div>
        ))}
      </div>
    </div>
  )
}

const LeaveCalendar = () => {
  const days = Array.from({ length: 28 }, (_, i) => i + 1)
  const approved = new Set([12, 13, 14, 15, 16])
  const pending = new Set([24, 25])

  return (
    <div className="relative h-40 flex flex-col pt-2">
      <div className="flex justify-between items-center mb-3 px-2">
        <div className="text-[10px] font-bold tracking-widest uppercase text-zinc-800 dark:text-white/80">October</div>
        <div className="flex gap-2 text-[8px] uppercase tracking-wider font-semibold">
          <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400"><div className="w-2 h-2 rounded bg-violet-400" /> Approved</span>
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400"><div className="w-2 h-2 rounded bg-amber-400" /> Pending</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-[10px] px-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => (
          <div key={`header-${d}`} className="text-center font-bold text-zinc-400 mb-1">{d}</div>
        ))}
        {days.map((day) => {
          const isApproved = approved.has(day)
          const isPending = pending.has(day)

          let baseClass = "flex h-6 items-center justify-center rounded-md font-medium text-zinc-600 dark:text-white/70 "

          if (isApproved) {
            baseClass += "bg-violet-400/20 text-violet-700 dark:text-violet-200 border-b-2 border-violet-500"
          } else if (isPending) {
            baseClass += "bg-amber-400/20 text-amber-700 dark:text-amber-200 border-b-2 border-amber-500 border-dashed"
          }

          return (
            <motion.div
              key={day}
              className={baseClass}
              whileHover={{ scale: 1.1 }}
              animate={isPending ? { opacity: [0.6, 1, 0.6] } : undefined}
              transition={isPending ? { duration: 2, repeat: Infinity } : undefined}
            >
              {day}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

const PayrollLedger = () => {
  const rows = [
    { label: 'Base Salary', value: '$8,400', type: 'plus' },
    { label: 'Commissions', value: '$1,250', type: 'plus' },
    { label: 'Taxes & Ded.', value: '-$2,140', type: 'minus' },
  ]

  return (
    <div className="relative h-40 rounded-2xl border border-black/10 bg-white p-4 dark:border-white/20 dark:bg-[#0b0b11]/80 shadow-inner flex flex-col justify-between overflow-hidden">
      <div className="space-y-3 z-10">
        {rows.map((row, i) => (
          <motion.div
            key={row.label}
            className="flex items-center justify-between text-[11px]"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.2, duration: 0.8 }}
          >
            <span className="text-zinc-500 dark:text-white/60 font-medium">{row.label}</span>
            <span className={`font-mono font-semibold ${row.type === 'plus' ? 'text-zinc-800 dark:text-white/90' : 'text-rose-500 dark:text-rose-400'}`}>
              {row.value}
            </span>
          </motion.div>
        ))}
      </div>

      <div className="mt-2 pt-2 border-t border-black/10 dark:border-white/10 flex items-center justify-between z-10">
        <span className="text-[10px] uppercase tracking-widest text-zinc-400 dark:text-white/40 font-bold">Net Pay</span>
        <motion.span
          className="font-display text-lg text-violet-600 dark:text-violet-400 font-bold"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          $7,510
        </motion.span>
      </div>

      {/* Scanning effect */}
      <motion.div
        className="absolute inset-x-0 h-8 bg-gradient-to-b from-transparent via-violet-400/10 to-transparent z-0 pointer-events-none"
        animate={{ top: ['-20%', '120%'] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  )
}

const TimeClock = () => (
  <div className="relative flex h-40 flex-col items-center justify-center overflow-hidden rounded-2xl border border-black/5 dark:border-white/10 bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-900/50 dark:to-black/50">
    {/* Concentric pulsing circles */}
    <motion.div
      className="absolute h-32 w-32 rounded-full border border-fuchsia-400/20"
      animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: 'easeOut' }}
    />
    <motion.div
      className="absolute h-32 w-32 rounded-full border border-violet-500/30"
      animate={{ scale: [1, 1.5], opacity: [0.8, 0] }}
      transition={{ duration: 3, repeat: Infinity, ease: 'easeOut', delay: 1 }}
    />

    <div className="absolute h-24 w-24 rounded-full bg-white dark:bg-zinc-900 shadow-[0_0_30px_rgba(168,85,247,0.15)] z-0" />

    <div className="relative z-10 flex flex-col items-center">
      <div className="font-mono text-4xl font-light tracking-tight text-zinc-800 dark:text-white mb-2">
        09<span className="text-violet-500 animate-pulse">:</span>41<span className="text-xl text-zinc-400 ml-1">AM</span>
      </div>

      <motion.div
        className="flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 shadow-sm backdrop-blur-sm"
        whileHover={{ scale: 1.05 }}
      >
        <div className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-pulse" />
        <span className="text-[9px] uppercase tracking-widest text-violet-700 dark:text-violet-300 font-bold">Clocked In</span>
      </motion.div>
    </div>

    {/* Abstract location pin */}
    <div className="absolute bottom-2 right-3 flex items-center gap-1 opacity-50">
      <div className="h-3 w-3 rounded-full border border-zinc-500 flex items-center justify-center"><div className="h-1 w-1 rounded-full bg-zinc-500" /></div>
      <span className="text-[8px] font-mono text-zinc-500">HQ-NY</span>
    </div>
  </div>
)

const LMSChecklist = () => {
  const courses = [
    { title: 'Security & Compliance 2024', progress: 100, completed: true },
    { title: 'Leadership Fundamentals', progress: 68, completed: false },
    { title: 'New Feature Rollout', progress: 15, completed: false },
  ]

  return (
    <div className="relative h-40 flex flex-col justify-center space-y-4 px-2">
      {courses.map((course, index) => (
        <div key={course.title} className="flex items-center gap-4 group">

          {/* Status Icon */}
          <div className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${course.completed ? 'border-violet-500 bg-violet-500/10' : 'border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800'}`}>
            {course.completed ? (
              <CheckCircle className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
            ) : (
              <motion.div
                className="h-2 w-2 rounded-full bg-fuchsia-500"
                animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, delay: index * 0.3 }}
              />
            )}
          </div>

          {/* Course Details & Progress */}
          <div className="flex-1 space-y-1.5">
            <div className="flex justify-between items-center text-[11px]">
              <span className={`font-medium ${course.completed ? 'text-zinc-400 dark:text-zinc-500 line-through' : 'text-zinc-700 dark:text-white/90'}`}>
                {course.title}
              </span>
              <span className="text-[9px] font-mono text-zinc-500">{course.progress}%</span>
            </div>

            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <motion.div
                className={`h-full ${course.completed ? 'bg-violet-500' : 'bg-gradient-to-r from-fuchsia-400 to-violet-400'}`}
                initial={{ width: 0 }}
                animate={{ width: `${course.progress}%` }}
                transition={{ duration: 1.5, delay: index * 0.2, ease: "easeOut" }}
              />
            </div>
          </div>

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
            <span className="font-display font-medium tracking-tight bg-gradient-to-r from-violet-500 to-fuchsia-600 bg-clip-text text-transparent dark:from-violet-400 dark:to-fuchsia-400">Run Seemple.</span>
          </div>
        ))}
      </motion.div>
    </div>
  </div>
)

const OnboardingFlow = () => {
  return (
    <div className="relative h-40 rounded-2xl border border-black/10 bg-white p-3 dark:border-white/20 dark:bg-white/[0.03] overflow-hidden">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-6 w-6 shrink-0 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-[10px] font-bold">1</div>
        <div className="h-2 w-full rounded-md bg-black/5 dark:bg-white/10" />
      </div>
      <div className="flex items-center gap-3 mb-3 opacity-60">
        <div className="h-6 w-6 shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-white/40 flex items-center justify-center text-[10px] font-bold">2</div>
        <div className="h-2 w-3/4 rounded-md bg-black/5 dark:bg-white/5" />
      </div>
      <div className="flex items-center gap-3 opacity-30">
        <div className="h-6 w-6 shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-white/40 flex items-center justify-center text-[10px] font-bold">3</div>
        <div className="h-2 w-1/2 rounded-md bg-black/5 dark:bg-white/5" />
      </div>

      {/* Slower, smoother completion block */}
      <motion.div
        className="absolute top-2 left-11 right-3 h-8 rounded-md bg-gradient-to-r from-indigo-500/10 to-violet-500/20 border-l border-indigo-400"
        initial={{ width: '0%', opacity: 0 }}
        animate={{ width: 'calc(100% - 44px)', opacity: [0, 1, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
      >
        <div className="h-full w-full flex items-center justify-end px-3">
          <CheckCircle className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
        </div>
      </motion.div>
    </div>
  )
}

const modules: ModuleCardProps[] = [
  {
    title: 'Recruiting',
    tag: 'Talent Acquisition',
    description: 'Move candidates from signal to hire with precision routing, automated pipelines, and custom scorecards.',
    accent: 'from-sky-500 via-indigo-500 to-transparent',
    visual: <RecruitingKanban />,
    className: 'md:col-span-8 min-h-[340px]',
  },
  {
    title: 'Identity Provider',
    tag: 'Access & Security',
    description: 'Centralized SSO with granular policy enforcement, role-based access control, and continuous trust scoring.',
    accent: 'from-fuchsia-500 via-indigo-500 to-transparent',
    visual: <IdentityOrbit />,
    className: 'md:col-span-4 min-h-[340px]',
  },
  {
    title: 'Performance',
    tag: 'Growth & Reviews',
    description: 'Live OKR calibration, continuous feedback loops, and automated cyclical review cycles across dynamic teams.',
    accent: 'from-violet-500 via-fuchsia-500 to-transparent',
    visual: <PerformanceBars />,
    className: 'md:col-span-4 min-h-[340px]',
  },
  {
    title: 'Time & Attendance',
    tag: 'Workforce',
    description: 'Pulse-accurate, geofenced time tracking with biometric capabilities and automatic compliance alerts.',
    accent: 'from-indigo-400 via-fuchsia-400 to-transparent',
    visual: <TimeClock />,
    className: 'md:col-span-4 min-h-[340px]',
  },
  {
    title: 'Leave',
    tag: 'Time Off',
    description: 'Automated global policy checks with real-time accrual balance sync, public holidays, and instant approvals.',
    accent: 'from-amber-400 via-orange-400 to-transparent',
    visual: <LeaveCalendar />,
    className: 'md:col-span-4 min-h-[340px]',
  },
  {
    title: 'Payroll',
    tag: 'Finance & Comp',
    description: 'Run global payroll with audit-ready precision, instant reconciliation, and automated tax compliance routing.',
    accent: 'from-violet-500 via-fuchsia-500 to-transparent',
    visual: <PayrollLedger />,
    className: 'md:col-span-4 min-h-[340px]',
  },
  {
    title: 'Learning (LMS)',
    tag: 'Development',
    description: 'Curated skill pathways that adapt to role changes, automated certification tracking, and compliance cadences.',
    accent: 'from-fuchsia-400 via-violet-400 to-transparent',
    visual: <LMSChecklist />,
    className: 'md:col-span-8 min-h-[340px]',
  },
  {
    title: 'Onboarding',
    tag: 'Employee Journey',
    description: 'Automate compliance forms, remote equipment provisioning, and deeply engaging orientation tasks before day one.',
    accent: 'from-purple-500 via-pink-500 to-transparent',
    visual: <OnboardingFlow />,
    className: 'md:col-span-12 min-h-[320px]',
  },
]

const homeStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: siteConfig.name,
      url: siteConfig.url,
      logo: absoluteUrl('/images/seemplifylogo.png'),
      email: siteConfig.contactEmail,
      areaServed: broaderEnglishSpeakingAfricanCountries.map((country) => ({
        '@type': 'Country',
        name: country,
      })),
    },
    {
      '@type': 'WebSite',
      name: siteConfig.name,
      url: siteConfig.url,
      description: siteConfig.description,
    },
    {
      '@type': 'SoftwareApplication',
      name: siteConfig.name,
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Human Resources Software',
      operatingSystem: 'Web',
      url: siteConfig.url,
      description: siteConfig.description,
      areaServed: broaderEnglishSpeakingAfricanCountries.map((country) => ({
        '@type': 'Country',
        name: country,
      })),
      featureList: [
        'Recruiting workflow automation',
        'Digital onboarding',
        'Leave management',
        'Performance management',
        'Time and attendance',
        'Payroll operations',
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: homeFaqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    },
  ],
}

function getCookieValue(cookieName: string) {
  if (typeof document === 'undefined') {
    return null
  }

  const cookiePrefix = `${cookieName}=`
  const cookiePart = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(cookiePrefix))

  return cookiePart ? decodeURIComponent(cookiePart.slice(cookiePrefix.length)) : null
}

export default function HomePage() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [personalizedMarket, setPersonalizedMarket] = useState<SeoMarket | null>(null)

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    const marketSlug = getCookieValue(MARKET_COOKIE)
    const nextMarket =
      marketSlug && marketSlug !== 'global' ? localizedMarketMap[marketSlug] ?? null : null

    setPersonalizedMarket(nextMarket)
  }, [])

  const isAfricaPersonalization = personalizedMarket
    ? Boolean(primaryMarketMap[personalizedMarket.slug])
    : false

  const heroEyebrow = personalizedMarket
    ? `${personalizedMarket.country} HR Software`
    : 'Global HR Software'
  const heroTitle = personalizedMarket ? `AI HR software for ${personalizedMarket.country}` : 'AI HR software'
  const heroSubtitle = personalizedMarket
    ? 'built for modern teams.'
    : 'for modern people ops.'
  const heroDescription = personalizedMarket
    ? `${personalizedMarket.intro} Manage recruiting, onboarding, leave, performance, time, and payroll workflows in one operating system.`
    : 'Seemplify unifies recruiting, onboarding, leave, performance, time, and payroll workflows for modern teams across regions in one operating system.'
  const heroTags = personalizedMarket
    ? [personalizedMarket.country, 'People Ops', 'Approvals', 'Performance', 'Localized Workflows']
    : ['Global teams', 'Multi-country ops', 'Recruiting', 'Performance', 'Payroll']
  const heroStats = personalizedMarket
    ? [
      { label: 'Detected Market', value: personalizedMarket.country },
      { label: 'Experience', value: 'Localized' },
      { label: 'Avg. Launch Time', value: '14 days' },
    ]
    : [
      { label: 'Primary Markets', value: `${primaryMarkets.length}` },
      { label: 'Regional Coverage', value: `${broaderEnglishSpeakingAfricanCountries.length} Countries` },
      { label: 'Avg. Launch Time', value: '14 days' },
    ]
  const africaSectionTitle = personalizedMarket
    ? isAfricaPersonalization
      ? `Support teams in ${personalizedMarket.country} while staying aligned across the wider region.`
      : `Operate in the ${personalizedMarket.country} while keeping regional expansion options open.`
    : 'Built for teams operating across Africa with local context where it matters.'
  const africaSectionDescription = personalizedMarket
    ? isAfricaPersonalization
      ? `This visit is highlighting ${personalizedMarket.country}, while still giving you access to Seemplify's broader Africa coverage for regional and multi-country teams.`
      : `This visit is highlighting the ${personalizedMarket.country}. Seemplify still supports multi-country operating models, including teams expanding into or working with African markets.`
    : 'Whether you manage one country or several, Seemplify gives HR teams a consistent operating model across Nigeria, Ghana, Kenya, South Africa, and other English-speaking African markets.'
  const prioritizedMarkets = personalizedMarket
    ? isAfricaPersonalization
    ? [
      personalizedMarket,
      ...primaryMarkets.filter((market) => market.slug !== personalizedMarket.slug),
    ]
      : primaryMarkets
    : primaryMarkets

  return (
    <div className="relative min-h-screen bg-[#f7f7fb] text-zinc-900 dark:bg-[#020205] dark:text-white">
      <JsonLd data={homeStructuredData} />
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
          <Link href="/" className="flex items-center">
            <SeemplifyLogo size="sm" animated={false} />
          </Link>

          <div className="hidden items-center gap-8 text-sm text-zinc-700 dark:text-white/80 lg:flex">
            <Link href="#modules" className="transition hover:text-zinc-900 dark:hover:text-white">Modules</Link>
            <Link href="#how-it-works" className="transition hover:text-zinc-900 dark:hover:text-white">How It Works</Link>
            <Link href="#africa" className="transition hover:text-zinc-900 dark:hover:text-white">Markets</Link>
            <Link href="#platform" className="transition hover:text-zinc-900 dark:hover:text-white">Platform</Link>
            <Link href="#faq" className="transition hover:text-zinc-900 dark:hover:text-white">FAQ</Link>
            <Link href="#cta" className="transition hover:text-zinc-900 dark:hover:text-white">Demo</Link>
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <ThemeToggle />
            <Link href={IDP_LOGIN_URL} className="text-sm text-zinc-700 transition hover:text-zinc-900 dark:text-white/80 dark:hover:text-white">
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
            href={IDP_SIGNUP_URL}
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
                  <span className="h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_12px_rgba(168,85,247,0.8)]" />
                  {heroEyebrow}
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.9, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-6 font-display text-5xl leading-[1.05] tracking-tight text-[#35184f] dark:text-white md:text-7xl"
                >
                  {heroTitle}
                  <span className="block bg-gradient-to-r from-[#4c1d95] via-[#7c3aed] to-[#a855f7] bg-clip-text text-transparent dark:from-white dark:via-violet-200 dark:to-fuchsia-200">
                    {heroSubtitle}
                  </span>
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.9, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-6 max-w-xl text-lg text-[#5f4d74] dark:text-white/75"
                >
                  {heroDescription}
                </motion.p>

                <div className="mt-6 flex max-w-3xl flex-wrap gap-3">
                  {heroTags.map((market) => (
                    <span
                      key={market}
                      className="rounded-full border border-black/10 bg-white/80 px-4 py-2 text-xs uppercase tracking-[0.25em] text-zinc-700 dark:border-white/15 dark:bg-white/[0.05] dark:text-white/70"
                    >
                      {market}
                    </span>
                  ))}
                </div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.9, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-8 flex flex-wrap gap-4"
                >
                  <Link
                    href={IDP_SIGNUP_URL}
                    data-track-cta="hero-start-free-trial"
                    className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white shadow-[0_0_35px_rgba(15,23,42,0.2)] transition hover:shadow-[0_0_45px_rgba(15,23,42,0.35)] dark:bg-white dark:text-black dark:shadow-[0_0_35px_rgba(255,255,255,0.25)] dark:hover:shadow-[0_0_45px_rgba(255,255,255,0.4)]"
                  >
                    Start Free Trial
                  </Link>
                  <button
                    data-track-cta="hero-book-demo"
                    onClick={() => setIsModalOpen(true)}
                    className="rounded-full border border-black/10 bg-white px-6 py-3 text-sm text-zinc-700 transition hover:border-black/30 dark:border-white/20 dark:bg-white/5 dark:text-white/80 dark:hover:border-white/40"
                  >
                    Book a Demo
                  </button>
                </motion.div>

                <div className="mt-10 grid gap-6 text-sm text-zinc-700 dark:text-white/70 sm:grid-cols-3">
                  {heroStats.map((stat) => (
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
            <div className="absolute bottom-[-120px] right-0 h-80 w-80 rounded-full bg-violet-400/15 blur-[160px]" />
          </div>
          <div className="container relative z-10 mx-auto px-6">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <motion.div
                className="relative"
                initial={{ opacity: 0, x: -50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
              >
                <div className="relative z-10 rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                  <Image
                    src={HRProfessionalsImage}
                    alt="HR Professionals collaborating"
                    width={700}
                    height={500}
                    className="w-full object-cover rounded-2xl"
                    placeholder="blur"
                  />

                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent" />

                  {/* Floating elements */}
                  <motion.div
                    className="absolute top-6 right-6 bg-white/10 backdrop-blur-md p-3 rounded-xl border border-white/20 shadow-lg"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.5 }}
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-violet-400" />
                      <span className="text-sm font-medium text-white">Workflow Authorized</span>
                    </div>
                  </motion.div>

                  <motion.div
                    className="absolute bottom-6 left-6 bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-lg"
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.7 }}
                  >
                    <div className="flex items-center gap-3">
                      <Zap className="w-5 h-5 text-fuchsia-400" />
                      <div>
                        <div className="text-xs text-white/70">Data Synced</div>
                        <div className="text-sm font-medium text-white">Real-time update</div>
                      </div>
                    </div>
                  </motion.div>
                </div>
              </motion.div>

              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-white/60">How It Works</p>
                <h2 className="mt-4 font-display text-4xl text-white md:text-5xl">
                  From signal to action in three steps.
                </h2>
                <p className="mt-4 text-white/70 mb-8">
                  Seemplify normalizes data across your workforce stack, then orchestrates automation
                  through verified workflows. Every action is auditable and reversible.
                </p>
                <div className="grid gap-4">
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
          </div>
        </section>

        {/* Onboarding Section */}
        <section id="onboarding" className="relative py-24 overflow-hidden">
          <div className="absolute inset-0 bg-[#f8efe6] dark:bg-transparent" />
          <div className="container relative z-10 mx-auto px-6">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-zinc-600 dark:text-white/60">First Impressions</p>
                <h2 className="mt-4 font-display text-4xl text-zinc-900 dark:text-white md:text-5xl">
                  Seamless Digital Onboarding.
                </h2>
                <p className="mt-4 text-zinc-700 dark:text-white/75 mb-8">
                  Welcome new hires with structured, engaging digital journeys. Ensure compliance, equipment provisioning, and cultural integration happens automatically on day one.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoCard
                    eyebrow="Journey"
                    title="Guided Paths"
                    description="Personalized 30-60-90 day playbooks for every role."
                  />
                  <InfoCard
                    eyebrow="IT Sync"
                    title="Auto-Provisioning"
                    description="Hardware and software access granted before day one."
                  />
                </div>
              </div>

              <motion.div
                className="relative lg:order-last order-first"
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
              >
                <div className="relative z-10 rounded-3xl overflow-hidden border border-black/10 dark:border-white/10 shadow-2xl">
                  <Image
                    src="https://images.unsplash.com/photo-1573164574572-cb89e39749b4?auto=format&fit=crop&q=80&w=800"
                    alt="Black professional onboarding"
                    width={800}
                    height={600}
                    className="w-full object-cover rounded-3xl"
                  />

                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent" />

                  <motion.div
                    className="absolute top-8 right-8 bg-white/95 dark:bg-black/60 backdrop-blur-md p-4 rounded-xl border border-black/5 dark:border-white/10 shadow-lg"
                    initial={{ opacity: 0, y: -20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.5 }}
                  >
                    <div className="flex items-center gap-3">
                      <UserPlus className="w-6 h-6 text-indigo-500 dark:text-indigo-400" />
                      <div>
                        <div className="text-xs text-zinc-500 dark:text-white/60">Welcome Packet</div>
                        <div className="text-sm font-bold text-zinc-900 dark:text-white">Sent & Viewed</div>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div
                    className="absolute bottom-8 left-8 bg-white/95 dark:bg-black/60 backdrop-blur-md p-4 rounded-xl border border-black/5 dark:border-white/10 shadow-lg"
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.7 }}
                  >
                    <div className="flex items-center gap-3">
                      <Award className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                      <div>
                        <div className="text-xs text-zinc-500 dark:text-white/60">Training Status</div>
                        <div className="text-sm font-bold text-zinc-900 dark:text-white">100% Complete</div>
                      </div>
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Document Signing Section */}
        <section id="documents" className="relative py-24 bg-[#0b0b11] text-white">
          <div className="absolute inset-0 opacity-50">
            <div className="absolute top-0 right-0 h-96 w-96 rounded-full bg-fuchsia-500/10 blur-[120px]" />
          </div>
          <div className="container relative z-10 mx-auto px-6">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <motion.div
                className="relative"
                initial={{ opacity: 0, x: -50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
              >
                <div className="relative z-10 rounded-3xl overflow-hidden border border-white/10 shadow-2xl">
                  <Image
                    src="https://images.unsplash.com/photo-1573164713714-d95e436ab8d6?auto=format&fit=crop&q=80&w=800"
                    alt="Black professional signing document digitally"
                    width={800}
                    height={600}
                    className="w-full object-cover rounded-3xl"
                  />

                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 to-transparent" />

                  <motion.div
                    className="absolute top-8 left-8 bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-lg"
                    initial={{ opacity: 0, scale: 0.9 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.5 }}
                  >
                    <div className="flex items-center gap-3">
                      <FileSignature className="w-6 h-6 text-violet-400" />
                      <div>
                        <div className="text-xs text-white/70">Offer Letter</div>
                        <div className="text-sm font-bold text-white">Document Signed ✓</div>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div
                    className="absolute bottom-8 right-8 bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 shadow-lg"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.7 }}
                  >
                    <div className="flex items-center gap-3">
                      <Shield className="w-5 h-5 text-blue-400" />
                      <div className="text-sm font-medium text-white">Audit Trail Secured</div>
                    </div>
                  </motion.div>
                </div>
              </motion.div>

              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-white/60">Compliance & Trust</p>
                <h2 className="mt-4 font-display text-4xl text-white md:text-5xl">
                  Secure Digital Signatures.
                </h2>
                <p className="mt-4 text-white/70 mb-8">
                  Execute contracts, NDAs, and policy updates instantly with our legally binding electronic signature flows. Every signature generates a traceable audit ledger.
                </p>
                <div className="grid gap-4">
                  {[
                    {
                      eyebrow: 'Legal',
                      title: 'Binding Signatures',
                      description: 'ESIGN and eIDAS compliant signatures embedded in your workflows.',
                    },
                    {
                      eyebrow: 'Storage',
                      title: 'Immutable Vaulting',
                      description: 'Documents are encrypted at rest and permanently accessible via the employee record.',
                    }
                  ].map((item) => (
                    <InfoCard key={item.title} variant="inverse" {...item} />
                  ))}
                </div>
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
              <motion.div
                className="relative"
                initial={{ opacity: 0, x: 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
              >
                <div className="relative z-10 rounded-3xl overflow-hidden border border-black/10 dark:border-white/10 shadow-2xl">
                  <Image
                    src={LeadersReviewingImage}
                    alt="Leaders reviewing platform data"
                    width={800}
                    height={600}
                    className="w-full object-cover rounded-3xl"
                    placeholder="blur"
                  />

                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-900/40 dark:to-slate-900/60" />

                  {/* Floating elements */}
                  <motion.div
                    className="absolute top-8 left-8 bg-white/90 dark:bg-black/50 backdrop-blur-md p-4 rounded-xl border border-black/5 dark:border-white/10 shadow-lg"
                    initial={{ opacity: 0, y: -20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.5 }}
                  >
                    <div className="flex items-center gap-3">
                      <TrendingUp className="w-6 h-6 text-violet-500 dark:text-violet-400" />
                      <div>
                        <div className="text-xs text-zinc-500 dark:text-white/60">System Uptime</div>
                        <div className="text-sm font-bold text-zinc-900 dark:text-white">99.99%</div>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div
                    className="absolute bottom-8 right-8 bg-white/90 dark:bg-black/50 backdrop-blur-md p-4 rounded-xl border border-black/5 dark:border-white/10 shadow-lg"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.7 }}
                  >
                    <div className="flex items-center gap-3">
                      <Shield className="w-5 h-5 text-blue-500 dark:text-blue-400" />
                      <span className="text-sm font-medium text-zinc-900 dark:text-white">Zero-Trust Active</span>
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        <section id="africa" className="relative py-24 bg-[#f8efe6] dark:bg-transparent">
          <div className="absolute inset-0 bg-gradient-to-b from-[#f8efe6] via-transparent to-transparent dark:from-transparent" />
          <div className="container relative z-10 mx-auto px-6">
            <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-zinc-600 dark:text-white/60">Regional Coverage</p>
                <h2 className="mt-4 font-display text-4xl text-zinc-900 dark:text-white md:text-5xl">
                  {africaSectionTitle}
                </h2>
                <p className="mt-4 text-zinc-700 dark:text-white/75">
                  {africaSectionDescription}
                </p>
                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  <InfoCard
                    eyebrow="Primary Markets"
                    title="Nigeria, Ghana, Kenya, South Africa"
                    description="Explore country-specific pages with relevant workflows, examples, and FAQs for each market."
                  />
                  <InfoCard
                    eyebrow="Broader Reach"
                    title="English-Speaking Africa"
                    description="Support distributed teams across English-speaking African markets with one consistent operating system."
                  />
                </div>

                <div className="mt-8 flex flex-wrap gap-3 text-sm text-zinc-700 dark:text-white/70">
                  {broaderEnglishSpeakingAfricanCountries.map((country) => (
                    <span
                      key={country}
                      className="rounded-full border border-black/10 bg-white/80 px-4 py-2 dark:border-white/15 dark:bg-white/[0.05]"
                    >
                      {country}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Link
                  href="/africa"
                  className="rounded-3xl border border-black/10 bg-[#0b2f29] p-8 text-white transition hover:-translate-y-1 dark:border-white/10"
                >
                  <p className="text-xs uppercase tracking-[0.35em] text-white/60">Africa Overview</p>
                  <h3 className="mt-4 font-display text-3xl">HR Software for Africa</h3>
                  <p className="mt-4 text-sm text-white/75">
                    See how Seemplify supports multi-country HR teams across Africa.
                  </p>
                </Link>

                {prioritizedMarkets.map((market) => (
                  <Link
                    key={market.slug}
                    href={`/africa/${market.slug}`}
                    className="rounded-3xl border border-black/10 bg-white p-8 transition hover:-translate-y-1 hover:border-violet-500/40 dark:border-white/10 dark:bg-white/[0.04]"
                  >
                    <p className="text-xs uppercase tracking-[0.35em] text-zinc-500 dark:text-white/50">
                      {market.country}
                    </p>
                    <h3 className="mt-4 font-display text-3xl text-zinc-900 dark:text-white">
                      {market.headline}
                    </h3>
                    <p className="mt-4 text-sm text-zinc-700 dark:text-white/70">
                      {market.description}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="relative py-24">
          <div className="container mx-auto px-6">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.35em] text-zinc-600 dark:text-white/60">SEO FAQ</p>
              <h2 className="mt-4 font-display text-4xl text-zinc-900 dark:text-white md:text-5xl">
                Answers for high-intent African HR software queries.
              </h2>
              <p className="mt-4 text-zinc-700 dark:text-white/75">
                This section supports long-tail search intent and feeds matching FAQ structured data
                for the homepage.
              </p>
            </div>

            <div className="mt-10 grid gap-4">
              {homeFaqs.map((faq) => (
                <article
                  key={faq.question}
                  className="rounded-3xl border border-black/10 bg-white p-8 dark:border-white/10 dark:bg-white/[0.04]"
                >
                  <h3 className="font-display text-2xl text-zinc-900 dark:text-white">
                    {faq.question}
                  </h3>
                  <p className="mt-3 text-zinc-700 dark:text-white/75">{faq.answer}</p>
                </article>
              ))}
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
                    href={IDP_SIGNUP_URL}
                    data-track-cta="footer-start-free-trial"
                    className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white shadow-[0_0_35px_rgba(15,23,42,0.2)] transition hover:shadow-[0_0_45px_rgba(15,23,42,0.35)] dark:bg-white dark:text-black dark:shadow-[0_0_35px_rgba(255,255,255,0.25)] dark:hover:shadow-[0_0_45px_rgba(255,255,255,0.4)]"
                  >
                    Start Free Trial
                  </Link>
                  <button
                    data-track-cta="footer-book-demo"
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
          <div className="flex items-center">
            <SeemplifyLogo size="sm" animated={false} />
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
