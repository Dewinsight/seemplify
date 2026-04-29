'use client'

import Link from 'next/link'
import Image from 'next/image'
import { motion, useReducedMotion } from 'framer-motion'
import SeemplifyLogo from '@/components/SeemplifyLogo'
import HeroBackground from '@/components/HeroBackground'
import type { LucideIcon } from 'lucide-react'
import {
  Shield,
  Users,
  Award,
  ArrowRight,
  MapPin,
  Phone,
  Mail,
  UserPlus,
  KeyRound,
  BarChart3,
  Clock,
  CalendarDays,
  Wallet,
  GraduationCap,
  ClipboardCheck,
  Sparkles,
} from 'lucide-react'

const IDP_URL = 'https://akwa.aiinnigeria.com'
const APP_URL = 'https://ibom.aiinnigeria.com'

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] },
})

type ServiceItem = {
  title: string
  description: string
  icon: LucideIcon
  accent: string
}

type ServiceGroup = {
  id: string
  label: string
  blurb: string
  items: ServiceItem[]
}

/** Mirrors the Seemplify platform modules (recruiter + HR suite), not recruitment-only */
const SERVICE_GROUPS: ServiceGroup[] = [
  {
    id: 'talent',
    label: 'Talent & access',
    blurb: 'From first application to secure sign-in across programmes.',
    items: [
      {
        title: 'Recruiting & pipelines',
        description:
          'AI-assisted sourcing, structured stages, scorecards, and audit-ready decisions for every campaign.',
        icon: UserPlus,
        accent: 'from-emerald-600 to-green-800',
      },
      {
        title: 'Identity & SSO',
        description:
          'Central authentication, role-based access, and policy-aware sessions for staff and partners.',
        icon: KeyRound,
        accent: 'from-green-700 to-emerald-700',
      },
      {
        title: 'Onboarding',
        description:
          'Digitised tasks, compliance checkpoints, and equipment or access provisioning before day one.',
        icon: ClipboardCheck,
        accent: 'from-amber-600 to-orange-600',
      },
    ],
  },
  {
    id: 'workforce',
    label: 'Workforce operations',
    blurb: 'Day-to-day people data: time, attendance, and leave — in one place.',
    items: [
      {
        title: 'Time & attendance',
        description:
          'Accurate clocks, shifts, and geofencing with alerts that support compliance and fairness.',
        icon: Clock,
        accent: 'from-teal-600 to-emerald-700',
      },
      {
        title: 'Leave management',
        description:
          'Policies, balances, holidays, and approvals with a clear trail for administrators.',
        icon: CalendarDays,
        accent: 'from-amber-500 to-yellow-600',
      },
      {
        title: 'Performance',
        description:
          'Goals, reviews, feedback, and cycles that align teams to public-service standards.',
        icon: BarChart3,
        accent: 'from-green-800 to-slate-800',
      },
    ],
  },
  {
    id: 'pay-learn',
    label: 'Pay & development',
    blurb: 'Compensation precision and continuous learning for a capable workforce.',
    items: [
      {
        title: 'Payroll',
        description:
          'Runs, reconciliations, and statutory routing with documentation suitable for oversight.',
        icon: Wallet,
        accent: 'from-emerald-700 to-teal-800',
      },
      {
        title: 'Learning (LMS)',
        description:
          'Courses, certifications, and pathways that keep skills current across agencies.',
        icon: GraduationCap,
        accent: 'from-amber-700 to-amber-900',
      },
    ],
  },
]

const MARQUEE_PARTS = [
  'Recruiting',
  'Performance',
  'Leave',
  'Payroll',
  'Time & attendance',
  'Learning',
  'Fair process',
  'Audit-ready',
]

export default function AkwaIbomHomePage() {
  const reduceMotion = useReducedMotion()

  return (
    <div className="akwaibom-theme relative min-h-screen bg-gradient-to-br from-green-50 via-amber-50/30 to-white text-slate-900">
      <HeroBackground />
      <div className="bg-noise" aria-hidden />

      {/* ── HEADER ── */}
      <header className="fixed top-0 z-50 w-full border-b border-green-200/50 bg-white/85 backdrop-blur-xl">
        <nav className="container mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <SeemplifyLogo size="sm" animated={false} />
            <div className="hidden border-l border-green-200 pl-3 sm:block">
              <p className="text-[11px] font-extrabold uppercase leading-tight tracking-wide text-green-950">
                Government of Akwa Ibom State
              </p>
              <p className="text-[10px] font-semibold text-green-800/75">
                Office of the Head of Service
              </p>
            </div>
          </Link>

          <div className="hidden items-center gap-8 text-sm font-medium text-slate-800 lg:flex">
            <Link href="#about" className="transition-colors duration-200 hover:text-green-800">
              About
            </Link>
            <Link href="#services" className="transition-colors duration-200 hover:text-green-800">
              Platform
            </Link>
            <Link href="#values" className="transition-colors duration-200 hover:text-green-800">
              Values
            </Link>
            <Link href="#contact" className="transition-colors duration-200 hover:text-green-800">
              Contact
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href={`${APP_URL}/login`}
              className="rounded-full bg-gradient-to-r from-green-700 to-green-900 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-green-900/15 transition-colors duration-200 hover:from-green-800 hover:to-green-950 cursor-pointer"
            >
              HR Sign-in
            </Link>
          </div>
        </nav>
      </header>

      <main className="relative z-10">
        {/* ── HERO ── */}
        <section className="relative overflow-hidden pt-32 pb-24">
          <div className="container relative z-10 mx-auto max-w-7xl px-6">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <div className="max-w-2xl space-y-7">
                <motion.div
                  {...fadeUp(0)}
                  className="inline-flex items-center gap-2 rounded-full border border-green-200/80 bg-white/90 px-4 py-2 shadow-sm"
                >
                  <span className="w-2 h-2 rounded-full bg-green-600 shrink-0" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-green-900">
                    Official HR Management Portal
                  </span>
                </motion.div>

                <motion.h1
                  {...fadeUp(0.1)}
                  className="font-display text-4xl font-black leading-[1.08] tracking-tight text-slate-900 md:text-5xl lg:text-6xl xl:text-7xl"
                >
                  ARISE WORKFORCE…{' '}
                  <span className="bg-gradient-to-r from-green-700 via-amber-700 to-yellow-600 bg-clip-text text-transparent">
                    Building a Digital, AI-driven Workforce of the Golden Era!
                  </span>
                </motion.h1>

                <motion.p {...fadeUp(0.2)} className="max-w-xl text-lg leading-relaxed text-slate-700">
                  Under the leadership of His Excellency Governor Umo Eno PhD and the ARISE Agenda, the Akwa
                  Ibom State Government is advancing a more efficient, responsive, and people-centred public
                  service. As part of this commitment, we proudly introduce AKS-HRMS — the Akwa Ibom State
                  Human Resource Management System, a core pillar of the ARISE Workforce Agenda designed to
                  strengthen Human Capital Development and accelerate the digitalization of the Civil Service.
                </motion.p>

                <motion.div {...fadeUp(0.25)} className="flex flex-wrap gap-3">
                  {['Full HR suite', 'Agency programmes', 'Audit-ready'].map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-green-200 bg-green-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-green-900"
                    >
                      {tag}
                    </span>
                  ))}
                </motion.div>

                <motion.div {...fadeUp(0.3)} className="flex flex-wrap gap-4">
                  <Link
                    href={`${APP_URL}/login`}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-gradient-to-r from-green-700 to-green-900 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-green-900/20 transition-colors duration-200 hover:from-green-800 hover:to-green-950"
                  >
                    Open HR portal <ArrowRight className="h-5 w-5" aria-hidden />
                  </Link>
                  <Link
                    href={IDP_URL}
                    className="inline-flex cursor-pointer items-center rounded-full border-2 border-green-400/80 bg-white px-8 py-3.5 text-base font-semibold text-green-950 transition-colors duration-200 hover:bg-green-50"
                  >
                    State sign-in (IDP)
                  </Link>
                </motion.div>

                <motion.div {...fadeUp(0.5)} className="flex flex-wrap gap-6 pt-2">
                  {[
                    { label: 'Agency programmes', value: '40+' },
                    { label: 'Pipeline visibility', value: '100%' },
                    { label: 'Human in the loop', value: '✓' },
                  ].map((s) => (
                    <div key={s.label} className="text-center">
                      <div className="text-2xl font-black text-green-900">{s.value}</div>
                      <div className="text-xs font-medium text-slate-600">{s.label}</div>
                    </div>
                  ))}
                </motion.div>
              </div>

              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="relative mx-auto w-full max-w-md"
              >
                <div className="relative z-10 overflow-hidden rounded-3xl border-4 border-green-200 shadow-2xl shadow-green-900/10">
                  <Image
                    src="/mrs-elsie-anietie-peters.png"
                    alt="Mrs. Elsie Anietie Peters — Head of Civil Service, Akwa Ibom State"
                    width={540}
                    height={620}
                    className="w-full object-cover object-top"
                    priority
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-green-950/95 to-transparent p-6">
                    <p className="text-xl font-black text-white">Mrs. Elsie Anietie Peters</p>
                    <p className="text-lg font-bold text-amber-300">Head of Civil Service</p>
                    <p className="text-sm font-semibold text-green-200">Akwa Ibom State</p>
                  </div>
                </div>
                <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-green-200/50 via-amber-100/40 to-transparent blur-2xl" />
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── MARQUEE ── */}
        <div className="border-y border-green-200/50 bg-gradient-to-r from-green-50 via-white to-amber-50/40 py-5">
          {reduceMotion ? (
            <p className="px-6 text-center font-display text-lg font-bold text-green-900 md:text-xl">
              {MARQUEE_PARTS.join(' · ')}
            </p>
          ) : (
            <motion.div
              className="flex whitespace-nowrap"
              animate={{ x: ['0%', '-50%'] }}
              transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
            >
              {Array.from({ length: 8 }).map((_, i) => (
                <span
                  key={i}
                  className="mx-10 font-display text-2xl font-bold tracking-tight text-green-900 md:text-3xl"
                >
                  {MARQUEE_PARTS.join(' · ')} ·{' '}
                </span>
              ))}
            </motion.div>
          )}
        </div>

        {/* ── PLATFORM (full Seemplify HR suite) ── */}
        <section id="services" className="relative py-24">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(21,128,61,0.06),_transparent_55%)]" />
          <div className="container relative mx-auto max-w-7xl px-6">
            <div className="mb-16 text-center">
              <span className="mb-4 inline-flex items-center rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-green-900 shadow-sm ring-1 ring-green-200/80">
                Seemplify HR platform
              </span>
              <h2 className="mb-4 font-display text-3xl font-black text-slate-900 md:text-5xl">
                Everything in{' '}
                <span className="bg-gradient-to-r from-green-700 to-amber-600 bg-clip-text text-transparent">
                  one portal
                </span>
              </h2>
              <p className="mx-auto max-w-3xl text-pretty text-lg text-slate-600">
                Beyond recruitment: the same integrated stack used on Seemplify — talent acquisition, identity,
                time and attendance, leave, performance, payroll, and learning — tailored for Akwa Ibom
                programmes with State branding and oversight.
              </p>
            </div>

            <div className="space-y-16">
              {SERVICE_GROUPS.map((group, gi) => (
                <div key={group.id}>
                  <div className="mb-8 max-w-3xl">
                    <h3 className="font-display text-xl font-bold text-green-950 md:text-2xl">{group.label}</h3>
                    <p className="mt-1 text-slate-600">{group.blurb}</p>
                  </div>
                  <div
                    className={`grid gap-5 ${
                      group.items.length === 2 ? 'md:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'
                    }`}
                  >
                    {group.items.map((svc, i) => {
                      const Icon = svc.icon
                      return (
                        <motion.div
                          key={svc.title}
                          initial={{ opacity: 0, y: 16 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true, margin: '-40px' }}
                          transition={{ delay: i * 0.05 + gi * 0.02 }}
                          className="group cursor-pointer rounded-3xl border border-slate-200/90 bg-white/95 p-6 shadow-[0_1px_0_rgba(15,23,42,0.04)] ring-1 ring-black/[0.03] transition-all duration-200 hover:-translate-y-0.5 hover:border-green-300/90 hover:shadow-lg hover:shadow-green-900/5"
                        >
                          <div
                            className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${svc.accent} text-white shadow-md`}
                          >
                            <Icon className="h-6 w-6" strokeWidth={2} aria-hidden />
                          </div>
                          <h4 className="mb-2 text-lg font-bold text-slate-900">{svc.title}</h4>
                          <p className="text-sm leading-relaxed text-slate-600">{svc.description}</p>
                        </motion.div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── ABOUT / LIFECYCLE — second governor image ── */}
        <section id="about" className="relative overflow-hidden py-24">
          <div className="absolute inset-0 bg-gradient-to-br from-green-950 via-green-900 to-green-950" />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
          <div className="container relative mx-auto max-w-7xl px-6">
            <div className="grid items-center gap-14 lg:grid-cols-2">
              <div>
                <span className="mb-6 inline-flex items-center rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-amber-200 ring-1 ring-white/15">
                  How it works
                </span>
                <h2 className="mb-6 font-display text-3xl font-black text-white md:text-5xl">
                  The full{' '}
                  <span className="text-amber-300">employee lifecycle</span>
                </h2>
                <p className="mb-10 text-lg leading-relaxed text-green-100/95">
                  From campaign launch to payroll and learning — structured workflows, clear ownership, and
                  records suitable for public accountability. AI assists scoring and routing; approvals and
                  outcomes stay with your teams.
                </p>
                <div className="space-y-5">
                  {[
                    {
                      step: '01',
                      title: 'Recruit & verify',
                      desc: 'Campaigns, applications, and identity-backed access for assessors and admins.',
                    },
                    {
                      step: '02',
                      title: 'Operate & develop',
                      desc: 'Time, leave, and performance rhythms that match how agencies actually run.',
                    },
                    {
                      step: '03',
                      title: 'Pay & train',
                      desc: 'Payroll precision plus LMS pathways so skills keep pace with mandates.',
                    },
                    {
                      step: '04',
                      title: 'Report & audit',
                      desc: 'Exports and trails that support oversight without slowing delivery.',
                    },
                  ].map((item) => (
                    <div key={item.step} className="flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-amber-400 text-sm font-bold text-green-950">
                        {item.step}
                      </div>
                      <div>
                        <h4 className="font-bold text-white">{item.title}</h4>
                        <p className="text-sm text-green-100/90">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative mx-auto max-w-md">
                <div className="relative overflow-hidden rounded-3xl border-2 border-amber-400/40 shadow-2xl shadow-black/30">
                  <Image
                    src="/governor-umo-eno-thumbs.png"
                    alt="Governor Umo Eno"
                    width={540}
                    height={620}
                    className="w-full object-cover object-center"
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-green-950/95 via-green-950/40 to-transparent px-6 pb-6 pt-16">
                    <p className="text-sm font-semibold uppercase tracking-wider text-amber-200">Leadership</p>
                    <p className="text-lg font-bold text-white">Service delivery through accountable HR</p>
                  </div>
                </div>
                <div className="absolute -bottom-6 -right-6 hidden max-w-[200px] rounded-2xl border border-white/20 bg-white/10 p-4 text-sm text-white backdrop-blur-md md:block">
                  <Sparkles className="mb-2 h-5 w-5 text-amber-300" aria-hidden />
                  One stack: recruiting, workforce, payroll, and learning — aligned to State programmes.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── VALUES ── */}
        <section id="values" className="border-t border-green-100/80 bg-gradient-to-b from-white to-green-50/50 py-24">
          <div className="container mx-auto max-w-7xl px-6">
            <div className="mb-16 text-center">
              <h2 className="mb-4 font-display text-3xl font-black text-slate-900 md:text-5xl">Our commitment</h2>
              <p className="mx-auto max-w-2xl text-pretty text-lg text-slate-600">
                Standards we apply across every module — from recruiting to payroll — for everyone who depends
                on public programmes.
              </p>
            </div>
            <div className="grid gap-8 md:grid-cols-3">
              {[
                {
                  icon: Shield,
                  title: 'Transparency & accountability',
                  desc: 'Decisions, stages, and approvals leave a trace stakeholders can follow.',
                  ring: 'ring-green-200/80',
                  iconBg: 'from-green-600 to-emerald-700',
                },
                {
                  icon: Award,
                  title: 'Merit-based selection',
                  desc: 'Assessment anchored on skills and rules — not favour or informal channels.',
                  ring: 'ring-amber-200/90',
                  iconBg: 'from-amber-500 to-orange-600',
                },
                {
                  icon: Users,
                  title: 'Equal opportunity',
                  desc: 'Inclusive access for qualified residents across agencies and backgrounds.',
                  ring: 'ring-slate-200/90',
                  iconBg: 'from-slate-700 to-green-900',
                },
              ].map((v, i) => {
                const Icon = v.icon
                return (
                  <motion.div
                    key={v.title}
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08 }}
                    className={`rounded-3xl border border-slate-200/90 bg-white p-8 shadow-sm ring-1 ${v.ring} transition-shadow duration-200 hover:shadow-md`}
                  >
                    <div
                      className={`mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${v.iconBg} text-white shadow-lg`}
                    >
                      <Icon className="h-7 w-7" strokeWidth={2} aria-hidden />
                    </div>
                    <h3 className="mb-3 text-xl font-bold text-slate-900">{v.title}</h3>
                    <p className="leading-relaxed text-slate-600">{v.desc}</p>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="border-t border-green-900/20 bg-gradient-to-r from-green-900 via-green-800 to-green-900 py-20">
          <div className="container mx-auto max-w-7xl px-6">
            <div className="flex flex-col items-center justify-between gap-10 lg:flex-row">
              <div className="flex max-w-2xl flex-col items-start gap-6 sm:flex-row sm:items-center">
                <Image src="/logoakwa.png" alt="Akwa Ibom State" width={220} height={72} className="h-14 w-auto object-contain" />
                <div>
                  <h2 className="mb-2 text-2xl font-black text-white md:text-3xl">Run programmes with clarity</h2>
                  <p className="text-base text-green-100 md:text-lg">
                    Sign in to manage applicants, workforce records, and reporting — with branding and controls
                    built for Akwa Ibom State.
                  </p>
                </div>
              </div>
              <Link
                href={`${APP_URL}/login`}
                className="inline-flex flex-shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-amber-400 px-8 py-3.5 text-base font-bold text-green-950 shadow-lg transition-colors duration-200 hover:bg-amber-300"
              >
                Go to portal <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        {/* ── CONTACT ── */}
        <section id="contact" className="py-20 pb-24">
          <div className="container mx-auto max-w-7xl px-6">
            <div className="mx-auto max-w-4xl rounded-[2rem] border border-green-200/80 bg-white/95 p-10 shadow-xl shadow-green-900/5 ring-1 ring-black/[0.03] md:p-12">
              <div className="mb-10 text-center">
                <h2 className="mb-3 font-display text-3xl font-black text-slate-900 md:text-4xl">Contact & support</h2>
                <p className="text-lg text-slate-600">
                  Reach the human resources team for administrator and technical assistance.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                {[
                  {
                    icon: MapPin,
                    title: 'Address',
                    detail: 'Government House, Uyo, Akwa Ibom State, Nigeria',
                  },
                  {
                    icon: Phone,
                    title: 'Phone',
                    detail: '+234 (0) 800 AKWA IBOM',
                  },
                  {
                    icon: Mail,
                    title: 'Email',
                    detail: 'recruitment@akwaibomstate.gov.ng',
                  },
                ].map((c) => {
                  const Icon = c.icon
                  return (
                    <div
                      key={c.title}
                      className="flex flex-col items-center rounded-2xl border border-slate-200/90 bg-green-50/40 p-6 text-center transition-colors duration-200 hover:border-green-300/80"
                    >
                      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-green-200 bg-white shadow-sm">
                        <Icon className="h-6 w-6 text-green-800" aria-hidden />
                      </div>
                      <p className="mb-1 font-semibold text-slate-900">{c.title}</p>
                      <p className="text-sm leading-relaxed text-slate-600">{c.detail}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── FOOTER (z-index above noise overlay) ── */}
      <footer className="akwa-footer border-t border-green-800/80 bg-green-950 text-white">
        <div className="container mx-auto max-w-7xl px-6 py-14">
          <div className="grid gap-12 md:grid-cols-3">
            <div className="space-y-4">
              <Image src="/logoakwa.png" alt="Akwa Ibom State" width={200} height={56} className="h-10 w-auto object-contain" />
              <p className="font-semibold text-amber-200">Government of Akwa Ibom State</p>
              <p className="text-sm text-green-300/90">The Land of Promise · Nigeria</p>
              <p className="max-w-xs text-sm leading-relaxed text-green-200/85">
                Official Human Resource Management Portal of the Office of the Head of Service.
              </p>
              <div className="pt-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-green-300/70">
                  Technical partner
                </p>
                <div className="inline-flex flex-col items-start">
                  <Image
                    src="/jetstone-consulting-white.png"
                    alt="Jetstone Consulting"
                    width={180}
                    height={48}
                    className="h-8 w-auto object-contain"
                  />
                  <span className="mt-1 text-xs font-semibold uppercase tracking-[0.28em] text-white/85">
                    Consulting
                  </span>
                </div>
              </div>
            </div>
            <div>
              <p className="mb-4 text-xs font-bold uppercase tracking-wider text-amber-200/90">On this page</p>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link href="#about" className="text-green-200 transition-colors duration-200 hover:text-white cursor-pointer">
                    About the lifecycle
                  </Link>
                </li>
                <li>
                  <Link href="#services" className="text-green-200 transition-colors duration-200 hover:text-white cursor-pointer">
                    Platform capabilities
                  </Link>
                </li>
                <li>
                  <Link href="#values" className="text-green-200 transition-colors duration-200 hover:text-white cursor-pointer">
                    Values
                  </Link>
                </li>
                <li>
                  <Link href="#contact" className="text-green-200 transition-colors duration-200 hover:text-white cursor-pointer">
                    Contact
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="mb-4 text-xs font-bold uppercase tracking-wider text-amber-200/90">Services</p>
              <ul className="space-y-2 text-sm text-green-200/90">
                <li>
                  <Link href={`${APP_URL}/login`} className="transition-colors duration-200 hover:text-white cursor-pointer">
                    HR portal (ibom)
                  </Link>
                </li>
                <li>
                  <Link href={IDP_URL} className="transition-colors duration-200 hover:text-white cursor-pointer">
                    Identity (sign-in)
                  </Link>
                </li>
                <li>
                  <Link href="/privacy-policy" className="transition-colors duration-200 hover:text-white cursor-pointer">
                    Privacy policy
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="transition-colors duration-200 hover:text-white cursor-pointer">
                    Terms of use
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-12 border-t border-green-800/70 pt-8 text-center">
            <p className="text-xs leading-relaxed text-green-400/95">
              © {new Date().getFullYear()} Government of Akwa Ibom State. Official Human Resource Management Portal.
              All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
