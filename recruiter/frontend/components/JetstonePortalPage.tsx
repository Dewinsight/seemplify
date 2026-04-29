'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, Shield, Users, Star, Menu, X, MapPin, Phone, Mail,
  Award,
  LogIn, ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import ScrollReveal from '@/components/animations/ScrollReveal';
import StickyHeader from '@/components/StickyHeader';
import ScrollProgress from '@/components/ui/ScrollProgress';
import BackToTop from '@/components/ui/BackToTop';
import AtsComparisonSection from '@/components/AtsComparisonSection';
import WorkflowSection from '@/components/WorkflowSection';

const btnPrimary = 'bg-gradient-to-r from-green-700 to-green-900 hover:from-green-800 hover:to-green-950 text-white border-0 shadow-lg';
const btnOutline = 'bg-white border border-green-400 text-green-950 hover:bg-green-50/90 shadow-sm';

export default function JetstonePortalPage() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: '#about', label: 'About' },
    { href: '#ai-approach', label: 'Our Approach' },
    { href: '#hiring-journey', label: 'Hiring Journey' },
  ];

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    // Solid-colour base so iOS Safari never bleeds dark GradientMesh orbs through
    <div className="min-h-screen bg-[#f0faf4] text-slate-900 overflow-x-hidden relative jetstone-light-theme">
      {/* Subtle static decorative blobs — no animated blurs that break on iOS */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div style={{ background: 'radial-gradient(ellipse 70% 55% at 15% 20%, rgba(134,239,172,0.22), transparent)' }} className="absolute inset-0" />
        <div style={{ background: 'radial-gradient(ellipse 60% 50% at 85% 75%, rgba(251,191,36,0.14), transparent)' }} className="absolute inset-0" />
      </div>
      <ScrollProgress />
      <BackToTop />

      {/* ── Header ── */}
      <StickyHeader>
        <div className="container mx-auto px-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-14 shrink-0 items-center md:h-16">
              <Image
                src="/logoakwa.png"
                alt="Government of Akwa Ibom State"
                width={360}
                height={80}
                className="h-12 w-auto max-w-[min(42vw,260px)] bg-transparent object-contain md:h-14 md:max-w-[280px]"
                priority
              />
            </div>
            <div className="hidden sm:block border-l border-green-200 pl-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-green-950 leading-tight">
                Office of the Head of Service
              </p>
              <p className="text-[10px] font-semibold text-green-800/75">
                Government of Akwa Ibom State
              </p>
            </div>
          </div>

          <nav className="hidden lg:flex items-center gap-6">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} className="text-sm font-medium text-slate-700 hover:text-green-800 transition-colors">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden md:flex gap-3">
            <Button variant="outline" size="sm" className={btnOutline} onClick={() => window.location.href = '/login'}>
              Manage Applicants
            </Button>
          </div>

          <button className="lg:hidden p-2 text-slate-700 hover:bg-green-100 rounded-lg" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
                onClick={() => setIsMobileMenuOpen(false)} />
              <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 right-0 bottom-0 w-72 bg-white z-50 shadow-2xl border-l border-green-100">
                <div className="flex justify-end p-4">
                  <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 hover:bg-green-50 rounded-lg">
                    <X className="w-5 h-5 text-slate-600" />
                  </button>
                </div>
                <nav className="px-6 space-y-2 pb-6">
                  {navLinks.map((link) => (
                    <a key={link.href} href={link.href}
                      className="flex items-center gap-2 py-3 text-slate-700 font-medium border-b border-green-50 hover:text-green-800"
                      onClick={() => setIsMobileMenuOpen(false)}>
                      <ChevronRight className="w-4 h-4 text-green-500" />
                      {link.label}
                    </a>
                  ))}
                  <Button className={`w-full mt-6 ${btnPrimary}`} onClick={() => { setIsMobileMenuOpen(false); window.location.href = '/login'; }}>
                    Manage Applicants
                  </Button>
                </nav>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </StickyHeader>

      <div className="h-24" />

      {/* ── HERO ── */}
      <section id="hero" className="relative z-10 container mx-auto px-4 pt-10 pb-16 md:pt-16 md:pb-24 lg:pt-20 lg:pb-28 flex flex-col lg:flex-row items-center gap-8 lg:gap-12">

        {/* ── Left: text ── */}
        <div className="w-full lg:w-1/2 space-y-5 md:space-y-6 text-center lg:text-left">

          {/* Badge — no logo inside to keep it tight on mobile */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}
            className="inline-flex items-center gap-2 bg-green-100 border border-green-200 rounded-full px-3.5 py-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            <span className="text-green-900 text-[11px] sm:text-xs font-semibold tracking-wide uppercase leading-none">
              Official HR Management Portal · Akwa Ibom State
            </span>
          </motion.div>

          {/* Heading — capped so it never overflows a phone */}
          <motion.h1
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.1 }}
            className="text-3xl sm:text-4xl md:text-4xl lg:text-5xl xl:text-5xl font-black leading-[1.12] tracking-tight text-slate-900 max-w-xl mx-auto lg:mx-0"
          >
            Transparent.{' '}Merit-Based.{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-green-700 via-amber-700 to-yellow-600 whitespace-nowrap">
              AI-Driven.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.2 }}
            className="text-base md:text-lg text-slate-600 max-w-lg mx-auto lg:mx-0 leading-relaxed"
          >
            Under the ARISE Agenda, Akwa Ibom State is building a merit-driven public service.
            This portal helps HR teams manage applicants transparently — from intake to offer.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.3 }}
            className="flex flex-wrap justify-center lg:justify-start gap-3"
          >
            <Button
              className={`h-11 px-6 text-sm font-semibold ${btnPrimary}`}
              onClick={() => scrollTo('ai-approach')}
            >
              Our Approach <ArrowRight className="ml-1.5 w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              className={`h-11 px-6 text-sm font-semibold ${btnOutline}`}
              onClick={() => { window.location.href = '/login'; }}
            >
              <LogIn className="mr-1.5 w-4 h-4" />
              HR Sign-in
            </Button>
          </motion.div>

          {/* Stats row */}
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }}
            className="flex flex-wrap justify-center lg:justify-start gap-6 pt-1"
          >
            {[
              { label: 'Agency programmes', value: '40+' },
              { label: 'Pipeline visibility', value: '100%' },
              { label: 'Audit-ready', value: '✓' },
            ].map((s) => (
              <div key={s.label} className="text-center lg:text-left">
                <div className="text-xl font-black text-green-800">{s.value}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* ── Right: Governor photo ── */}
        <motion.div
          className="w-full lg:w-1/2 flex justify-center"
          initial={{ opacity: 0, scale: 0.93 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.75, delay: 0.25 }}
        >
          <div className="relative w-full max-w-[320px] sm:max-w-[380px] lg:max-w-[440px]">
            {/* Photo card */}
            <div className="relative z-10 rounded-2xl overflow-hidden border-4 border-green-200 shadow-xl">
              <Image
                src="/governor-umo-eno.png"
                alt="Governor Umo Eno — Akwa Ibom State"
                width={440} height={520}
                className="w-full object-cover object-top"
                priority
              />
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-green-950/90 to-transparent px-5 py-4">
                <p className="text-white font-black text-base leading-tight">His Excellency</p>
                <p className="text-amber-300 font-bold text-sm">Gov. Umo Eno PhD</p>
                <p className="text-green-300 text-xs">Executive Governor, Akwa Ibom State</p>
              </div>
            </div>

            {/* Seal — top-right, sized to stay inside on mobile */}
            <div className="absolute -top-4 -right-3 sm:-top-5 sm:-right-5 z-20 drop-shadow-md">
              <Image
                src="/logoakwa.png"
                alt="Akwa Ibom State seal"
                width={80} height={80}
                className="h-14 w-14 sm:h-16 sm:w-16 object-contain bg-transparent"
              />
            </div>

            {/* Quote card — hidden on tiny screens to avoid overflow */}
            <motion.div
              className="hidden sm:block absolute -bottom-6 -left-4 lg:-bottom-8 lg:-left-6 bg-white border border-green-100 rounded-xl shadow-lg px-4 py-3 max-w-[190px] z-20"
              initial={{ opacity: 0, y: 16, rotate: -2 }} animate={{ opacity: 1, y: 0, rotate: -2 }}
              transition={{ delay: 0.9, duration: 0.45 }}
            >
              <div className="flex gap-0.5 mb-1.5">
                {[...Array(5)].map((_, i) => <Star key={i} className="w-3 h-3 text-amber-400 fill-amber-400" />)}
              </div>
              <p className="text-xs text-slate-700 italic leading-snug">
                "A transparent, merit-driven Akwa Ibom for all."
              </p>
              <p className="text-[10px] text-green-700 font-semibold mt-1">— Gov. Umo Eno</p>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* ── GOVERNOR'S MESSAGE ── Akwa Ibom green; transparent PNG/WebP portrait */}
      <section id="about" className="relative z-10 pt-20 md:pt-28 pb-0 overflow-hidden bg-gradient-to-br from-green-950 via-green-900 to-emerald-950">
        <div className="container mx-auto px-4">
          <div className="flex flex-col lg:flex-row items-center justify-between gap-12">
            <div className="lg:w-3/5 text-center lg:text-left pb-20 md:pb-28">
              <ScrollReveal>
                <div className="mb-6 flex justify-center lg:justify-start">
                  <Image src="/logoakwa.png" alt="" width={280} height={80} className="h-16 w-auto max-w-[min(100%,320px)] bg-transparent object-contain md:h-20" />
                </div>
                <div className="inline-flex items-center gap-2 bg-amber-400/20 border border-amber-400/30 rounded-full px-4 py-1.5 mb-6">
                  <Award className="w-4 h-4 text-amber-300" />
                  <span className="text-amber-200 text-xs font-semibold uppercase tracking-wide">Governor's Message</span>
                </div>
                <blockquote className="text-2xl md:text-3xl lg:text-4xl font-bold leading-relaxed mb-8 italic text-white drop-shadow-sm">
                  "We are building a state where every qualified Akwa Ibom citizen has a fair chance to serve
                  and contribute to our collective progress. This portal is our commitment to that promise."
                </blockquote>
                <div className="flex flex-col items-center lg:items-start gap-1">
                  <p className="text-xl font-bold text-amber-200">His Excellency, Governor Umo Eno</p>
                  <p className="text-base text-green-100">Executive Governor, Akwa Ibom State</p>
                </div>
              </ScrollReveal>
            </div>
            
            <div className="lg:w-2/5 relative flex justify-center lg:justify-end self-end">
              <ScrollReveal delay={0.2}>
                <div className="relative z-10 w-[320px] md:w-[420px] lg:w-[480px] bottom-0 -mb-2">
                  <Image
                    src="/pueiii1.webp"
                    alt="Governor Umo Eno"
                    width={480}
                    height={600}
                    className="h-auto w-full object-contain object-bottom"
                    sizes="(max-width: 1024px) 90vw, 480px"
                  />
                </div>
              </ScrollReveal>
            </div>
          </div>
        </div>
      </section>

      {/* ── AI APPROACH (Beyond Traditional HR Management) ── */}
      <div id="ai-approach" className="relative z-10 bg-white">
        <AtsComparisonSection />
      </div>

      {/* ── STREAMLINED HIRING JOURNEY ── */}
      <div id="hiring-journey" className="relative z-10 bg-slate-50">
        <WorkflowSection />
      </div>

      {/* ── VALUES ── */}
      <section id="values" className="relative z-10 container mx-auto px-4 py-20 md:py-28">
        <ScrollReveal>
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-green-100 border border-green-200 rounded-full px-4 py-1.5 mb-5">
              <Star className="w-4 h-4 text-green-700" />
              <span className="text-green-800 text-xs font-semibold uppercase tracking-wide">Our Commitment</span>
            </div>
            <h2 className="text-3xl md:text-5xl font-black text-slate-900 mb-4">
              Built on{' '}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-green-700 to-amber-700">Integrity</span>
            </h2>
            <p className="text-slate-600 text-lg max-w-2xl mx-auto">
              Principles that govern how hiring teams use this platform and serve the public.
            </p>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              icon: <Shield className="w-8 h-8" />,
              title: 'Transparency',
              desc: 'All selection criteria, timelines, and results are published openly. No hidden processes or closed-door decisions.',
              color: 'from-green-700 to-emerald-600',
              bg: 'from-green-50 to-emerald-50',
              border: 'border-green-100',
            },
            {
              icon: <Award className="w-8 h-8" />,
              title: 'Merit-Based Selection',
              desc: 'Candidates are assessed solely on qualifications, skills, and competency. Background, connections, or patronage play no role.',
              color: 'from-amber-600 to-orange-500',
              bg: 'from-amber-50 to-orange-50',
              border: 'border-amber-100',
            },
            {
              icon: <Users className="w-8 h-8" />,
              title: 'Equal Opportunity',
              desc: 'Applications are welcome from all qualified residents regardless of gender, religion, local government, or disability status.',
              color: 'from-blue-600 to-indigo-500',
              bg: 'from-blue-50 to-indigo-50',
              border: 'border-blue-100',
            },
          ].map((v, i) => (
            <ScrollReveal key={i} delay={i * 0.1}>
              <div className={`bg-gradient-to-br ${v.bg} border ${v.border} rounded-2xl p-8 h-full`}>
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${v.color} flex items-center justify-center text-white shadow-lg mb-5`}>
                  {v.icon}
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{v.title}</h3>
                <p className="text-slate-700 leading-relaxed">{v.desc}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="relative z-10 py-20 bg-gradient-to-r from-green-900 via-green-800 to-green-900 jetstone-cta-banner">
        <div className="container mx-auto px-4">
          <ScrollReveal>
            <div className="flex flex-col lg:flex-row items-center justify-between gap-8">
              <div className="flex items-center gap-6">
                <div className="flex h-16 flex-shrink-0 items-center">
                  <Image src="/logoakwa.png" alt="Akwa Ibom State" width={220} height={72} className="h-14 w-auto max-w-[220px] bg-transparent object-contain md:h-16" />
                </div>
                <div>
                  <h2 className="text-2xl md:text-3xl font-black text-white mb-2">
                    Run HR programmes with clarity
                  </h2>
                  <p className="text-green-100 text-base md:text-lg">
                    Sign in to review applicants, manage pipelines, and keep every stage fair and accountable.
                  </p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 flex-shrink-0">
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-amber-400 px-8 py-3 text-base font-bold text-green-950 shadow-lg transition-colors hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-2 focus-visible:ring-offset-green-900"
                >
                  Manage applicants
                  <ArrowRight className="h-5 w-5 shrink-0" aria-hidden />
                </Link>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ── CONTACT ── */}
      <section id="contact" className="relative z-10 container mx-auto px-4 py-20">
        <ScrollReveal>
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-3">Contact & Support</h2>
            <p className="text-slate-600 text-lg">Reach the human resources team for administrator and technical assistance.</p>
          </div>
        </ScrollReveal>
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
      </section>

      {/* ── FOOTER ── */}
      <footer className="relative z-10 bg-green-950 text-white py-12 mt-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="flex h-12 flex-shrink-0 items-center">
                <Image src="/logoakwa.png" alt="" width={200} height={56} className="h-10 w-auto max-w-[200px] bg-transparent object-contain md:h-12" />
              </div>
              <div>
                <p className="font-bold text-amber-300">Government of Akwa Ibom State</p>
                <p className="text-green-400 text-xs">The Land of Promise · Nigeria</p>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-6 text-sm">
              <Link href="/login" className="text-green-200 hover:text-white transition-colors">HR sign-in</Link>
              <Link href="/privacy" className="text-green-300 hover:text-white transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="text-green-300 hover:text-white transition-colors">Terms of Use</Link>
            </div>
          </div>

          <div className="border-t border-green-800/60 mt-8 pt-6 text-center">
            <p className="text-green-400 text-xs">
              © {new Date().getFullYear()} Government of Akwa Ibom State. All rights reserved.
            </p>
            <p className="text-green-600 text-xs mt-1">
              This is the official Human Resource Management Portal of the Akwa Ibom State Government. All applications are subject to verification.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
