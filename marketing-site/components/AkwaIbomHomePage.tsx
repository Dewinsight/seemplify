'use client'

import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import SeemplifyLogo from '@/components/SeemplifyLogo'
import HeroBackground from '@/components/HeroBackground'
import JsonLd from '@/components/JsonLd'
import { Shield, Users, Award, ArrowRight, CheckCircle, MapPin, Phone, Mail } from 'lucide-react'

const IDP_URL = 'https://akwa.aiinnigeria.com'
const APP_URL = 'https://ibom.aiinnigeria.com'

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] },
})

export default function AkwaIbomHomePage() {
  return (
    <div className="akwaibom-theme relative min-h-screen bg-gradient-to-br from-green-50 via-amber-50/30 to-white text-slate-900">
      <HeroBackground />
      <div className="bg-noise" />

      {/* ── HEADER ── */}
      <header className="fixed top-0 z-50 w-full border-b border-green-200/40 bg-white/80 backdrop-blur-xl">
        <nav className="container mx-auto flex items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <SeemplifyLogo size="sm" animated={false} />
            <div className="hidden sm:block">
              <p className="text-[10px] font-bold text-green-900 leading-tight">Govt. of Akwa Ibom State</p>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-slate-500">Powered by</span>
                <Image src="/jetstone-logo.png" alt="Jetstone Education" width={64} height={14} className="object-contain h-3 w-auto" />
              </div>
            </div>
          </Link>

          <div className="hidden items-center gap-8 text-sm text-slate-700 lg:flex">
            <Link href="#about" className="transition hover:text-green-800">About</Link>
            <Link href="#services" className="transition hover:text-green-800">Services</Link>
            <Link href="#values" className="transition hover:text-green-800">Values</Link>
            <Link href="#contact" className="transition hover:text-green-800">Contact</Link>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href={`${APP_URL}/login`}
              className="rounded-full bg-gradient-to-r from-green-700 to-green-900 px-5 py-2 text-sm font-medium text-white shadow-lg transition hover:from-green-800 hover:to-green-950"
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
                  className="inline-flex items-center gap-2 rounded-full bg-green-100 border border-green-200 px-4 py-2"
                >
                  <Image src="/logoakwa.png" alt="" width={160} height={40} className="h-7 w-auto object-contain" />
                  <span className="text-green-900 text-xs font-semibold tracking-wide uppercase">Official HR Management Portal</span>
                </motion.div>

                <motion.h1
                  {...fadeUp(0.1)}
                  className="font-display text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-black leading-[1.08] tracking-tight text-slate-900"
                >
                  Fair. Transparent.{' '}
                  <span className="bg-clip-text text-transparent bg-gradient-to-r from-green-700 via-amber-700 to-yellow-600">
                    AI-Driven.
                  </span>
                </motion.h1>

                <motion.p {...fadeUp(0.2)} className="text-lg text-slate-700 max-w-xl leading-relaxed">
                  The official Human Resource Management Portal for Akwa Ibom State. Manage recruitment,
                  screening, interviews, and decisions with full transparency and accountability.
                </motion.p>

                <motion.div {...fadeUp(0.25)} className="flex flex-wrap gap-3">
                  {['40+ Agency Programs', '100% Pipeline Visibility', 'Audit-ready'].map((tag) => (
                    <span key={tag} className="rounded-full border border-green-200 bg-green-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-green-800">
                      {tag}
                    </span>
                  ))}
                </motion.div>

                <motion.div {...fadeUp(0.3)} className="flex flex-wrap gap-4">
                  <Link
                    href={`${APP_URL}/login`}
                    className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-green-700 to-green-900 px-8 py-3.5 text-base font-semibold text-white shadow-lg transition hover:from-green-800 hover:to-green-950"
                  >
                    Explore Portal <ArrowRight className="w-5 h-5" />
                  </Link>
                  <Link
                    href={IDP_URL}
                    className="inline-flex items-center rounded-full border-2 border-green-300 bg-white px-8 py-3.5 text-base font-semibold text-green-900 transition hover:bg-green-50"
                  >
                    HR Sign-in
                  </Link>
                </motion.div>

                <motion.div {...fadeUp(0.5)} className="flex flex-wrap gap-6 pt-2">
                  {[
                    { label: 'Agency programs', value: '40+' },
                    { label: 'Pipeline visibility', value: '100%' },
                    { label: 'Audit-ready', value: '\u2713' },
                  ].map((s) => (
                    <div key={s.label} className="text-center">
                      <div className="text-2xl font-black text-green-800">{s.value}</div>
                      <div className="text-xs text-slate-500 font-medium">{s.label}</div>
                    </div>
                  ))}
                </motion.div>
              </div>

              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, delay: 0.3 }}
                className="relative mx-auto max-w-md w-full"
              >
                <div className="relative z-10 rounded-3xl overflow-hidden border-4 border-green-200 shadow-2xl">
                  <Image
                    src="/governor-umo-eno.png"
                    alt="Governor Umo Eno — Akwa Ibom State"
                    width={540}
                    height={620}
                    className="w-full object-cover object-top"
                    priority
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-green-950/90 to-transparent p-6">
                    <p className="text-white font-black text-xl">His Excellency</p>
                    <p className="text-amber-300 font-bold text-lg">Gov. Umo Eno</p>
                  </div>
                </div>
                <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-green-200/50 via-amber-100/40 to-transparent blur-2xl" />
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── MARQUEE ── */}
        <div className="overflow-hidden border-y border-green-200/40 bg-green-50/50 py-5">
          <motion.div
            className="flex whitespace-nowrap"
            animate={{ x: ['0%', '-50%'] }}
            transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <span key={i} className="mx-8 font-display text-3xl font-bold tracking-tight bg-gradient-to-r from-green-700 to-amber-600 bg-clip-text text-transparent">
                Fair Recruitment &bull; Transparent Governance &bull; Merit-Based Selection &bull;
              </span>
            ))}
          </motion.div>
        </div>

        {/* ── HR SERVICES (replaces modules) ── */}
        <section id="services" className="py-24">
          <div className="container mx-auto max-w-7xl px-6">
            <div className="text-center mb-16">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800 mb-4">
                Complete HR Suite
              </span>
              <h2 className="font-display text-3xl md:text-5xl font-black text-slate-900 mb-4">
                End-to-End{' '}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-green-700 to-amber-600">
                  Human Resource Management
                </span>
              </h2>
              <p className="text-slate-600 text-lg max-w-3xl mx-auto">
                Every stage of the HR lifecycle in one portal — from candidate sourcing through onboarding,
                leave management, performance reviews, and payroll.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { title: 'Candidate Sourcing', desc: 'Receive and parse job applications with AI-powered profile analysis.', color: 'from-green-500 to-emerald-600' },
                { title: 'Merit-Based Screening', desc: 'Objective qualification scoring and competency gap analysis.', color: 'from-amber-500 to-orange-500' },
                { title: 'Pipeline Management', desc: 'Manage candidates through standardized recruitment stages.', color: 'from-emerald-500 to-teal-600' },
                { title: 'Interview Scheduling', desc: 'Calendar integration with Google Meet and MS Teams support.', color: 'from-green-600 to-green-800' },
                { title: 'Structured Interviews', desc: 'Standardized question banks with real-time transcription.', color: 'from-amber-600 to-yellow-600' },
                { title: 'Feedback Collection', desc: 'Structured interviewer feedback forms with aggregation.', color: 'from-emerald-600 to-green-700' },
                { title: 'Decision & Onboarding', desc: 'Analytics dashboards for data-driven hiring decisions.', color: 'from-green-700 to-emerald-800' },
                { title: 'Leave Management', desc: 'Manage employee leave requests, approvals, and accruals.', color: 'from-blue-500 to-indigo-600' },
                { title: 'Performance Reviews', desc: 'OKRs, continuous feedback, and structured evaluation cycles.', color: 'from-purple-500 to-indigo-600' },
              ].map((svc, i) => (
                <motion.div
                  key={svc.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                  className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-lg hover:border-green-300"
                >
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${svc.color} flex items-center justify-center text-white shadow-lg mb-4`}>
                    <CheckCircle className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">{svc.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{svc.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── ABOUT / HOW IT WORKS ── */}
        <section id="about" className="py-24 bg-gradient-to-r from-green-900 via-green-800 to-green-900">
          <div className="container mx-auto max-w-7xl px-6">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-700/30 text-green-100 mb-6">
                  How It Works
                </span>
                <h2 className="font-display text-3xl md:text-5xl font-black text-white mb-6">
                  Streamlined{' '}
                  <span className="text-amber-300">Hiring Journey</span>
                </h2>
                <p className="text-green-100 text-lg mb-8 leading-relaxed">
                  From candidate intake to final hiring decision, every step is structured, auditable, and fair.
                  Our AI assists but never decides — human judgment remains at the center.
                </p>
                <div className="space-y-4">
                  {[
                    { step: '01', title: 'Post & Source', desc: 'Applications flow in from the official state portal.' },
                    { step: '02', title: 'Screen & Rank', desc: 'AI scores candidates objectively on qualifications.' },
                    { step: '03', title: 'Interview & Evaluate', desc: 'Structured interviews with standardized feedback.' },
                    { step: '04', title: 'Decide & Onboard', desc: 'Data-driven decisions with full audit trail.' },
                  ].map((item) => (
                    <div key={item.step} className="flex gap-4 items-start">
                      <div className="w-10 h-10 rounded-xl bg-amber-400 flex items-center justify-center text-green-950 font-bold text-sm flex-shrink-0">
                        {item.step}
                      </div>
                      <div>
                        <h4 className="text-white font-bold">{item.title}</h4>
                        <p className="text-green-200 text-sm">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative">
                <Image
                  src="/governor-umo-eno.png"
                  alt="Akwa Ibom State HR Management"
                  width={540}
                  height={620}
                  className="rounded-2xl border-2 border-green-600/30 shadow-2xl w-full max-w-md mx-auto"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── VALUES ── */}
        <section id="values" className="py-24">
          <div className="container mx-auto max-w-7xl px-6">
            <div className="text-center mb-16">
              <h2 className="font-display text-3xl md:text-5xl font-black text-slate-900 mb-4">Our Commitment</h2>
              <p className="text-slate-600 text-lg max-w-2xl mx-auto">
                Every aspect of our recruitment process upholds the highest standards of public service.
              </p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  icon: <Shield className="w-8 h-8" />,
                  title: 'Transparency & Accountability',
                  desc: 'Every hiring decision is logged and auditable. Stakeholders can verify that processes followed proper procedure at every stage.',
                  color: 'from-green-500 to-emerald-600', bg: 'from-green-50 to-emerald-50', border: 'border-green-100',
                },
                {
                  icon: <Award className="w-8 h-8" />,
                  title: 'Merit-Based Selection',
                  desc: 'Candidates are assessed solely on qualifications, skills, and competency. Background, connections, or patronage play no role.',
                  color: 'from-amber-600 to-orange-500', bg: 'from-amber-50 to-orange-50', border: 'border-amber-100',
                },
                {
                  icon: <Users className="w-8 h-8" />,
                  title: 'Equal Opportunity',
                  desc: 'Applications are welcome from all qualified residents regardless of gender, religion, local government, or disability status.',
                  color: 'from-blue-600 to-indigo-500', bg: 'from-blue-50 to-indigo-50', border: 'border-blue-100',
                },
              ].map((v, i) => (
                <motion.div
                  key={v.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className={`bg-gradient-to-br ${v.bg} border ${v.border} rounded-2xl p-8`}
                >
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${v.color} flex items-center justify-center text-white shadow-lg mb-5`}>
                    {v.icon}
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-3">{v.title}</h3>
                  <p className="text-slate-700 leading-relaxed">{v.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA BANNER ── */}
        <section className="py-20 bg-gradient-to-r from-green-900 via-green-800 to-green-900">
          <div className="container mx-auto max-w-7xl px-6">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
              <div className="flex items-center gap-6">
                <Image src="/logoakwa.png" alt="Akwa Ibom State" width={220} height={72} className="h-14 w-auto object-contain" />
                <div>
                  <h2 className="text-2xl md:text-3xl font-black text-white mb-2">
                    Run HR programmes with clarity
                  </h2>
                  <p className="text-green-100 text-base md:text-lg">
                    Sign in to review applicants, manage pipelines, and keep every stage fair and accountable.
                  </p>
                </div>
              </div>
              <div className="flex gap-4 flex-shrink-0">
                <Link
                  href={`${APP_URL}/login`}
                  className="inline-flex items-center gap-2 rounded-md bg-amber-400 px-8 py-3 text-base font-bold text-green-950 shadow-lg transition hover:bg-amber-300"
                >
                  Manage applicants <ArrowRight className="w-5 h-5" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── CONTACT ── */}
        <section id="contact" className="py-24">
          <div className="container mx-auto max-w-7xl px-6">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-3">Contact & Support</h2>
              <p className="text-slate-600 text-lg">Reach the human resources team for administrator and technical assistance.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
              {[
                { icon: <MapPin className="w-6 h-6 text-green-700" />, title: 'Address', detail: 'Government House, Uyo, Akwa Ibom State, Nigeria' },
                { icon: <Phone className="w-6 h-6 text-green-700" />, title: 'Phone', detail: '+234 (0) 800 AKWA IBOM' },
                { icon: <Mail className="w-6 h-6 text-green-700" />, title: 'Email', detail: 'recruitment@akwaibomstate.gov.ng' },
              ].map((c, i) => (
                <div key={i} className="flex flex-col items-center text-center bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                  <div className="w-12 h-12 rounded-xl bg-green-50 border border-green-200 flex items-center justify-center mb-3">
                    {c.icon}
                  </div>
                  <p className="font-semibold text-slate-900 mb-1">{c.title}</p>
                  <p className="text-slate-600 text-sm">{c.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ── FOOTER ── */}
      <footer className="bg-green-950 text-white py-12">
        <div className="container mx-auto max-w-7xl px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <Image src="/logoakwa.png" alt="" width={200} height={56} className="h-10 w-auto object-contain" />
              <div>
                <p className="font-bold text-amber-300">Government of Akwa Ibom State</p>
                <p className="text-green-400 text-xs">The Land of Promise &middot; Nigeria</p>
              </div>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <Link href={`${APP_URL}/login`} className="text-green-200 hover:text-white transition-colors">HR sign-in</Link>
              <Link href="/privacy-policy" className="text-green-300 hover:text-white transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="text-green-300 hover:text-white transition-colors">Terms of Use</Link>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-green-800/60 text-center">
            <p className="text-green-400 text-xs">
              &copy; {new Date().getFullYear()} Jetstone Education &middot; Official Human Resource Management Portal of the Akwa Ibom State Government.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
