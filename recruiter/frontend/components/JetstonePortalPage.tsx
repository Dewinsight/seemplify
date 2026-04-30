'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, Shield, Users, Award, LogIn, ChevronRight,
  Menu, X, MapPin, Phone, Mail, Star, Briefcase, GraduationCap,
  FileCheck, Building2, ClipboardList, CheckCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import ScrollReveal from '@/components/animations/ScrollReveal';
import StickyHeader from '@/components/StickyHeader';
import ScrollProgress from '@/components/ui/ScrollProgress';
import BackToTop from '@/components/ui/BackToTop';

/* ── ticker items ─────────────────────────────────────── */
const TICKER_ITEMS = [
  'ARISE Workforce Agenda',
  'AI-Assisted Recruitment',
  'Performance Management',
  'Leave Management',
  'Payroll Administration',
  'Time & Attendance',
  'Learning & Development',
  'Fair Process',
  'Equal Opportunity',
  'Transparent Selection',
  'Merit-Based Hiring',
  'Civil Service Modernisation',
];

function Ticker() {
  const doubled = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div className="relative overflow-hidden bg-amber-400 py-2.5 z-10">
      <motion.div
        className="flex gap-10 whitespace-nowrap"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 32, ease: 'linear', repeat: Infinity }}
      >
        {doubled.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-3 text-green-950 text-xs sm:text-sm font-semibold tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-green-900 shrink-0" />
            {item}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

/* ── main component ───────────────────────────────────── */
export default function JetstonePortalPage() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: '#about', label: 'About' },
    { href: '#features', label: 'Features' },
    { href: '#values', label: 'Our Values' },
    { href: '#contact', label: 'Contact' },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900 overflow-x-hidden">
      <ScrollProgress />
      <BackToTop />

      {/* ══════════════════════════════════════════════════
          HEADER
      ══════════════════════════════════════════════════ */}
      <StickyHeader>
        <div className="container mx-auto px-4 flex justify-between items-center">
          {/* Logo group */}
          <div className="flex items-center gap-3">
            <Image
              src="/logoakwa.png"
              alt="Government of Akwa Ibom State"
              width={200}
              height={56}
              className="h-10 w-auto max-w-[180px] sm:max-w-[220px] object-contain bg-transparent"
              priority
            />
            <div className="hidden sm:block border-l border-green-200 pl-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-green-950 leading-tight">
                Office of the Head of Service
              </p>
              <p className="text-[10px] font-semibold text-green-700">
                Government of Akwa Ibom State
              </p>
            </div>
          </div>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-7">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href}
                className="text-sm font-medium text-slate-600 hover:text-green-800 transition-colors">
                {l.label}
              </a>
            ))}
          </nav>

          {/* Desktop CTA */}
          <div className="hidden md:block">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-full bg-green-800 hover:bg-green-900 text-white text-sm font-semibold px-5 py-2.5 transition-colors shadow-sm"
            >
              <LogIn className="w-4 h-4" />
              HR Sign-in
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            className="lg:hidden p-2 text-slate-700 hover:bg-green-100 rounded-lg"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/40 z-40"
                onClick={() => setIsMobileMenuOpen(false)}
              />
              <motion.div
                initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 26, stiffness: 220 }}
                className="fixed top-0 right-0 bottom-0 w-72 bg-white z-50 shadow-2xl border-l border-green-100"
              >
                <div className="flex justify-between items-center p-4 border-b border-green-50">
                  <p className="font-bold text-green-900 text-sm">Menu</p>
                  <button onClick={() => setIsMobileMenuOpen(false)} className="p-1.5 hover:bg-green-50 rounded-lg">
                    <X className="w-5 h-5 text-slate-600" />
                  </button>
                </div>
                <nav className="px-5 py-4 space-y-1">
                  {navLinks.map((l) => (
                    <a key={l.href} href={l.href}
                      className="flex items-center gap-2 py-3 px-3 rounded-lg text-slate-700 font-medium hover:bg-green-50 hover:text-green-900"
                      onClick={() => setIsMobileMenuOpen(false)}>
                      <ChevronRight className="w-4 h-4 text-green-400" />
                      {l.label}
                    </a>
                  ))}
                  <div className="pt-4">
                    <Link href="/login"
                      className="flex items-center justify-center gap-2 w-full rounded-full bg-green-800 text-white font-semibold py-3 hover:bg-green-900 transition-colors"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      <LogIn className="w-4 h-4" />
                      HR Sign-in
                    </Link>
                  </div>
                </nav>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </StickyHeader>

      {/* Header spacer */}
      <div className="h-[72px]" />

      {/* ══════════════════════════════════════════════════
          HERO  — split panel
      ══════════════════════════════════════════════════ */}
      <section id="hero" className="relative overflow-hidden">
        {/* ── mobile: stacked | lg: side-by-side ── */}
        <div className="flex flex-col lg:flex-row min-h-[88vh] lg:min-h-[92vh]">

          {/* LEFT PANEL — deep government green */}
          <div className="relative lg:w-[58%] flex flex-col justify-center px-6 sm:px-10 lg:px-16 xl:px-20 py-14 lg:py-20 bg-green-950"
            style={{ background: 'linear-gradient(135deg, #052e16 0%, #14532d 55%, #166534 100%)' }}>

            {/* Subtle diagonal watermark stripes */}
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage: 'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)',
                backgroundSize: '18px 18px',
              }}
            />

            <div className="relative z-10 max-w-xl">
              {/* Official badge */}
              <motion.div
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
                className="inline-flex items-center gap-2 mb-7 bg-white/10 border border-white/20 rounded-full px-4 py-1.5"
              >
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                <span className="text-white/90 text-[11px] sm:text-xs font-semibold tracking-widest uppercase">
                  Official HR Management Portal
                </span>
              </motion.div>

              {/* Main headline */}
              <motion.h1
                initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}
                className="text-4xl sm:text-5xl lg:text-5xl xl:text-6xl font-black leading-[1.07] tracking-tight text-white mb-2"
              >
                ARISE
                <span className="text-amber-400"> WORKFORCE</span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.18 }}
                className="text-lg sm:text-xl lg:text-xl font-bold text-green-200 mb-5 leading-snug"
              >
                Building a Digital, AI-driven<br className="hidden sm:block" />
                Workforce of the Golden Era
              </motion.p>

              <motion.p
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.26 }}
                className="text-sm sm:text-base text-green-100/80 max-w-md leading-relaxed mb-8"
              >
                Under the leadership of His Excellency Governor Umo Eno PhD and the ARISE Agenda,
                the Akwa Ibom State Government is advancing a more efficient, responsive, and
                people-centred public service through the AKS-HRMS.
              </motion.p>

              {/* CTAs */}
              <motion.div
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.34 }}
                className="flex flex-wrap gap-3 mb-10"
              >
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-full bg-amber-400 hover:bg-amber-300 text-green-950 font-bold text-sm px-6 py-3 shadow-lg transition-colors"
                >
                  <LogIn className="w-4 h-4" />
                  HR Sign-in
                </Link>
                <a
                  href="#features"
                  className="inline-flex items-center gap-2 rounded-full border border-white/30 hover:bg-white/10 text-white font-semibold text-sm px-6 py-3 transition-colors"
                >
                  Explore features
                  <ArrowRight className="w-4 h-4" />
                </a>
              </motion.div>

              {/* Stats row */}
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                className="flex flex-wrap gap-6 border-t border-white/10 pt-6"
              >
                {[
                  { value: '40+', label: 'Agency programmes' },
                  { value: '100%', label: 'Pipeline visibility' },
                  { value: 'ISO', label: 'Audit-ready process' },
                ].map((s) => (
                  <div key={s.label}>
                    <div className="text-2xl font-black text-amber-400">{s.value}</div>
                    <div className="text-xs text-green-300 font-medium">{s.label}</div>
                  </div>
                ))}
              </motion.div>
            </div>
          </div>

          {/* RIGHT PANEL — governor photo */}
          <motion.div
            className="relative lg:w-[42%] min-h-[380px] sm:min-h-[460px] lg:min-h-0"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.2 }}
          >
            <Image
              src="/governor-umo-eno-hd.png"
              alt="Governor Umo Eno PhD — Akwa Ibom State"
              fill
              className="object-cover object-center lg:object-top"
              priority
              sizes="(max-width: 1024px) 100vw, 42vw"
            />
            {/* Bottom name plate */}
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-green-950/95 via-green-950/60 to-transparent px-6 py-6 sm:py-8">
              <div className="flex items-end gap-4">
                <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-amber-400/70 shadow-lg shrink-0">
                  <Image src="/akwa-ibom-seal.png" alt="" width={48} height={48} className="w-full h-full object-cover" />
                </div>
                <div>
                  <p className="text-white font-black text-base sm:text-lg leading-tight">His Excellency</p>
                  <p className="text-amber-400 font-bold text-sm">Governor Umo Eno PhD</p>
                  <p className="text-green-300 text-xs">Executive Governor, Akwa Ibom State</p>
                </div>
              </div>
            </div>

            {/* Floating quote — desktop only */}
            <motion.div
              className="hidden lg:block absolute top-8 right-6 bg-white/95 backdrop-blur-sm border border-green-100 rounded-2xl shadow-xl p-4 max-w-[200px]"
              initial={{ opacity: 0, y: -12, rotate: 2 }} animate={{ opacity: 1, y: 0, rotate: 2 }}
              transition={{ delay: 1.1, duration: 0.5 }}
            >
              <div className="flex gap-0.5 mb-2">
                {[...Array(5)].map((_, i) => <Star key={i} className="w-3 h-3 text-amber-400 fill-amber-400" />)}
              </div>
              <p className="text-[11px] text-slate-700 italic leading-snug">
                "A transparent, merit-driven Akwa Ibom — for every citizen."
              </p>
              <p className="text-[10px] text-green-700 font-bold mt-1.5">— Gov. Umo Eno</p>
            </motion.div>
          </motion.div>
        </div>

        {/* Amber ticker strip */}
        <Ticker />
      </section>

      {/* ══════════════════════════════════════════════════
          FEATURES — "Everything in one portal"
      ══════════════════════════════════════════════════ */}
      <section id="features" className="py-20 md:py-28 bg-white">
        <div className="container mx-auto px-4">
          <ScrollReveal>
            <div className="text-center mb-14">
              <span className="inline-flex items-center gap-2 bg-green-100 border border-green-200 rounded-full px-4 py-1.5 mb-5">
                <span className="w-2 h-2 rounded-full bg-green-600" />
                <span className="text-green-800 text-xs font-semibold uppercase tracking-wide">Everything in one portal</span>
              </span>
              <h2 className="text-3xl md:text-4xl lg:text-5xl font-black text-slate-900 mb-4 leading-tight">
                End-to-end Human Resource{' '}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-green-700 to-amber-600">Management</span>
              </h2>
              <p className="text-slate-500 text-base md:text-lg max-w-2xl mx-auto">
                From job posting to offer letter — every step is transparent, documented, and auditable
                under the ARISE Workforce Agenda.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: <Briefcase className="w-5 h-5" />,
                title: 'Talent & Careers',
                desc: 'Post vacancies across all MDAs, manage applications and track candidate pipelines with full audit trails.',
                accent: 'bg-green-700',
                ring: 'ring-green-100',
              },
              {
                icon: <FileCheck className="w-5 h-5" />,
                title: 'Recruitment Pipeline',
                desc: 'Screen CVs with AI assistance, shortlist candidates objectively and move them through structured stages.',
                accent: 'bg-amber-500',
                ring: 'ring-amber-100',
              },
              {
                icon: <Users className="w-5 h-5" />,
                title: 'Interview Management',
                desc: 'Schedule interviews, collect structured feedback, generate AI-assisted interview questions per role.',
                accent: 'bg-blue-600',
                ring: 'ring-blue-100',
              },
              {
                icon: <GraduationCap className="w-5 h-5" />,
                title: 'Learning & Development',
                desc: 'Track training programmes and capacity-building activities across the civil service.',
                accent: 'bg-purple-600',
                ring: 'ring-purple-100',
              },
              {
                icon: <Building2 className="w-5 h-5" />,
                title: 'MDA Administration',
                desc: 'Manage roles and permissions per Ministry, Department and Agency with role-based access control.',
                accent: 'bg-rose-600',
                ring: 'ring-rose-100',
              },
              {
                icon: <ClipboardList className="w-5 h-5" />,
                title: 'Audit & Compliance',
                desc: 'Every action is logged. Full audit trail available for internal review, compliance and governance.',
                accent: 'bg-teal-600',
                ring: 'ring-teal-100',
              },
            ].map((f, i) => (
              <ScrollReveal key={i} delay={i * 0.07}>
                <div className={`group bg-white border border-slate-100 rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-300 ring-1 ${f.ring}`}>
                  <div className={`w-10 h-10 rounded-xl ${f.accent} flex items-center justify-center text-white mb-4 shadow-sm group-hover:scale-110 transition-transform`}>
                    {f.icon}
                  </div>
                  <h3 className="font-bold text-slate-900 mb-2">{f.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          GOVERNOR'S MESSAGE (full employee lifecycle)
      ══════════════════════════════════════════════════ */}
      <section id="about" className="relative overflow-hidden bg-green-950">
        {/* diagonal stripe watermark */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: 'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)',
            backgroundSize: '20px 20px',
          }}
        />
        <div className="relative z-10 container mx-auto px-4 py-20 md:py-28">
          <div className="flex flex-col lg:flex-row items-center gap-12">
            {/* Text */}
            <div className="lg:w-3/5 text-center lg:text-left">
              <ScrollReveal>
                <Image
                  src="/logoakwa.png"
                  alt=""
                  width={220}
                  height={60}
                  className="h-14 w-auto max-w-[min(100%,260px)] object-contain bg-transparent mb-7 mx-auto lg:mx-0"
                />
                <div className="inline-flex items-center gap-2 bg-amber-400/15 border border-amber-400/25 rounded-full px-4 py-1.5 mb-6">
                  <Award className="w-4 h-4 text-amber-300" />
                  <span className="text-amber-200 text-xs font-semibold uppercase tracking-wide">The full employee lifecycle</span>
                </div>
                <h2 className="text-2xl md:text-3xl lg:text-4xl font-black text-white mb-6 leading-tight">
                  "We are building a state where every<br className="hidden md:block" />
                  qualified citizen has a fair chance to serve."
                </h2>
                <p className="text-green-200 text-base md:text-lg leading-relaxed mb-8 max-w-xl mx-auto lg:mx-0">
                  Under Governor Umo Eno's ARISE Agenda, AKS-HRMS is the digital backbone of Akwa Ibom's
                  public service — combining AI, transparency, and accountability to transform how the
                  government recruits, develops, and retains its workforce.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto lg:mx-0">
                  {[
                    'AI-assisted candidate ranking',
                    'Transparent selection criteria',
                    'Bias-free screening pipeline',
                    'Fully auditable decisions',
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-2.5">
                      <CheckCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <span className="text-green-100 text-sm">{item}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-1">
                  <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-amber-400/60 shadow-lg shrink-0">
                    <Image src="/governor-umo-eno-hd.png" alt="Governor Umo Eno" width={48} height={48} className="w-full h-full object-cover object-top" />
                  </div>
                  <div className="sm:ml-3 text-center sm:text-left">
                    <p className="font-bold text-amber-300">His Excellency, Governor Umo Eno PhD</p>
                    <p className="text-green-400 text-sm">Executive Governor, Akwa Ibom State</p>
                  </div>
                </div>
              </ScrollReveal>
            </div>

            {/* Photo */}
            <div className="lg:w-2/5 flex justify-center">
              <ScrollReveal delay={0.2}>
                <div className="relative max-w-[320px] sm:max-w-[360px] w-full">
                  <div className="rounded-3xl overflow-hidden border-4 border-green-700 shadow-2xl">
                    <Image
                      src="/governor-umo-eno-hd.png"
                      alt="Governor Umo Eno PhD"
                      width={360}
                      height={460}
                      className="w-full object-cover object-top"
                    />
                  </div>
                  <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full overflow-hidden ring-4 ring-amber-400/60 bg-white shadow-xl">
                    <Image src="/akwa-ibom-seal.png" alt="" width={64} height={64} className="w-full h-full object-cover" />
                  </div>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          VALUES
      ══════════════════════════════════════════════════ */}
      <section id="values" className="py-20 md:py-28 bg-slate-50">
        <div className="container mx-auto px-4">
          <ScrollReveal>
            <div className="text-center mb-14">
              <span className="inline-flex items-center gap-2 bg-green-100 border border-green-200 rounded-full px-4 py-1.5 mb-5">
                <Star className="w-4 h-4 fill-green-600 text-green-600" />
                <span className="text-green-800 text-xs font-semibold uppercase tracking-wide">Our commitment</span>
              </span>
              <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-3">
                Built on{' '}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-green-700 to-amber-600">Integrity</span>
              </h2>
              <p className="text-slate-500 text-base max-w-xl mx-auto">
                Principles that govern every recruitment decision made through this portal.
              </p>
            </div>
          </ScrollReveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: <Shield className="w-7 h-7" />,
                title: 'Transparency',
                desc: 'All selection criteria, timelines and results are published. No hidden processes or closed-door decisions.',
                bg: 'bg-green-700',
                border: 'border-green-100',
                cardBg: 'bg-green-50',
              },
              {
                icon: <Award className="w-7 h-7" />,
                title: 'Merit-Based Selection',
                desc: 'Candidates are assessed solely on qualifications, skills, and competency. Background and connections play no role.',
                bg: 'bg-amber-500',
                border: 'border-amber-100',
                cardBg: 'bg-amber-50',
              },
              {
                icon: <Users className="w-7 h-7" />,
                title: 'Equal Opportunity',
                desc: 'All qualified Akwa Ibom residents are welcome regardless of gender, religion, LGA of origin, or disability.',
                bg: 'bg-blue-600',
                border: 'border-blue-100',
                cardBg: 'bg-blue-50',
              },
            ].map((v, i) => (
              <ScrollReveal key={i} delay={i * 0.1}>
                <div className={`${v.cardBg} border ${v.border} rounded-2xl p-7 h-full`}>
                  <div className={`w-14 h-14 rounded-2xl ${v.bg} flex items-center justify-center text-white shadow-md mb-5`}>
                    {v.icon}
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">{v.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{v.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          CTA BANNER
      ══════════════════════════════════════════════════ */}
      <section className="relative bg-green-900 py-16 overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: 'repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)',
            backgroundSize: '18px 18px',
          }}
        />
        <div className="relative z-10 container mx-auto px-4">
          <ScrollReveal>
            <div className="flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="flex items-center gap-5 flex-1">
                <Image
                  src="/logoakwa.png"
                  alt=""
                  width={120}
                  height={48}
                  className="h-12 w-auto shrink-0 object-contain bg-transparent hidden sm:block"
                />
                <div>
                  <h2 className="text-xl md:text-2xl font-black text-white mb-1">
                    Run HR programmes with clarity
                  </h2>
                  <p className="text-green-200 text-sm md:text-base">
                    Sign in to review applicants, manage pipelines, and keep every stage fair and accountable.
                  </p>
                </div>
              </div>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full bg-amber-400 hover:bg-amber-300 text-green-950 font-bold text-base px-8 py-3.5 shadow-lg transition-colors shrink-0"
              >
                Manage applicants
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          CONTACT
      ══════════════════════════════════════════════════ */}
      <section id="contact" className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <ScrollReveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl font-black text-slate-900 mb-2">Contact & Support</h2>
              <p className="text-slate-500">Reach the HR team for assistance with the portal.</p>
            </div>
          </ScrollReveal>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-3xl mx-auto">
            {[
              { icon: <MapPin className="w-5 h-5 text-green-700" />, title: 'Address', detail: 'Government House, Uyo, Akwa Ibom State, Nigeria' },
              { icon: <Phone className="w-5 h-5 text-green-700" />, title: 'Phone', detail: '+234 (0) 800 AKWA IBOM' },
              { icon: <Mail className="w-5 h-5 text-green-700" />, title: 'Email', detail: 'recruitment@akwaibomstate.gov.ng' },
            ].map((c, i) => (
              <ScrollReveal key={i} delay={i * 0.08}>
                <div className="flex flex-col items-center text-center bg-slate-50 border border-slate-100 rounded-2xl p-6">
                  <div className="w-11 h-11 rounded-xl bg-green-100 border border-green-200 flex items-center justify-center mb-3">
                    {c.icon}
                  </div>
                  <p className="font-semibold text-slate-800 mb-1 text-sm">{c.title}</p>
                  <p className="text-slate-500 text-xs">{c.detail}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════════════ */}
      <footer className="bg-green-950 text-white py-12">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <Image
                src="/logoakwa.png"
                alt=""
                width={160}
                height={48}
                className="h-10 w-auto object-contain bg-transparent"
              />
              <div className="border-l border-green-700 pl-4">
                <p className="font-bold text-amber-300 text-sm">Government of Akwa Ibom State</p>
                <p className="text-green-400 text-xs">The Land of Promise · Nigeria</p>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-6 text-sm">
              <Link href="/login" className="text-green-300 hover:text-white transition-colors">HR Sign-in</Link>
              <Link href="/privacy" className="text-green-300 hover:text-white transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="text-green-300 hover:text-white transition-colors">Terms of Use</Link>
            </div>
          </div>

          <div className="border-t border-green-800/50 mt-8 pt-6 text-center">
            <p className="text-green-500 text-xs">
              © {new Date().getFullYear()} Government of Akwa Ibom State. All rights reserved.
            </p>
            <p className="text-green-700 text-xs mt-1">
              Official Human Resource Management Portal — AKS-HRMS. All applications are subject to verification.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
