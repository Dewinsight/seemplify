'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TeamIllustration,
  CalendarIllustration,
  ChartIllustration,
  PayrollIllustration,
} from '@/components/AnimatedIllustrations'
import SeemplifyLogo, { SeemplifyIcon } from '@/components/SeemplifyLogo'
import ThemeToggle from '@/components/ThemeToggle'

// Dynamic imports
const HiringPipelineFlow = dynamic(() => import('@/components/HiringPipelineFlow'), {
  ssr: false,
  loading: () => <div className="w-full h-[250px] rounded-2xl bg-zinc-200 dark:bg-zinc-900/50 animate-pulse-subtle" />
})
const LeaveApprovalFlow = dynamic(() => import('@/components/LeaveApprovalFlow'), {
  ssr: false,
  loading: () => <div className="w-full h-[180px] rounded-2xl bg-zinc-200 dark:bg-zinc-900/50 animate-pulse-subtle" />
})
const PerformanceCycleFlow = dynamic(() => import('@/components/PerformanceCycleFlow'), {
  ssr: false,
  loading: () => <div className="w-full h-64 rounded-2xl bg-zinc-200 dark:bg-zinc-900/50 animate-pulse-subtle" />
})

const IDP_URL = 'https://auth.seemplifyai.com'

// Minimal Geometric Icons
const IconRecruiting = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <path d="M20 8v6M23 11h-6" />
  </svg>
)

const IconCalendar = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)

const IconPerformance = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5">
    <line x1="12" y1="20" x2="12" y2="10" />
    <line x1="18" y1="20" x2="18" y2="4" />
    <line x1="6" y1="20" x2="6" y2="16" />
  </svg>
)

const IconPayroll = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <line x1="2" y1="10" x2="22" y2="10" />
  </svg>
)

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [activeProduct, setActiveProduct] = useState(0)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Auto-rotate products
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveProduct(prev => (prev + 1) % 4)
    }, 6000)
    return () => clearInterval(interval)
  }, [])

  const products = [
    {
      title: 'Recruiting',
      tagline: 'Acquire Talent',
      description: 'Advanced pipeline tracking and automated scheduling.',
      icon: <IconRecruiting />,
      illustration: <TeamIllustration />,
      color: 'text-blue-400',
      features: ['Pipeline tracking', 'Smart scheduling', 'Scorecards'],
      url: 'https://app.seemplifyai.com',
    },
    {
      title: 'Time Off',
      tagline: 'Manage Leave',
      description: 'Streamlined requests and automated balance calculations.',
      icon: <IconCalendar />,
      illustration: <CalendarIllustration />,
      color: 'text-emerald-400',
      features: ['One-click approval', 'Calendar sync', 'Balance audit'],
      url: 'https://leave.seemplifyai.com',
    },
    {
      title: 'Performance',
      tagline: 'Drive Growth',
      description: 'Data-driven review cycles and 360° feedback loops.',
      icon: <IconPerformance />,
      illustration: <ChartIllustration />,
      color: 'text-purple-400',
      features: ['OKR alignment', '360° cycles', 'Analytics'],
      url: 'https://performance.seemplifyai.com',
    },
    {
      title: 'Payroll',
      tagline: 'Process Comp',
      description: 'Automated payroll runs with real-time tax compliance.',
      icon: <IconPayroll />,
      illustration: <PayrollIllustration />,
      color: 'text-amber-400',
      features: ['Auto-run', 'Compliance', 'Reporting'],
      url: 'https://payroll.seemplifyai.com',
    },
  ]

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#050505] text-zinc-900 dark:text-white selection:bg-indigo-500/30 transition-colors duration-300">
      <div className="bg-noise" />

      {/* Ambient Lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[1000px] h-[1000px] bg-indigo-200/30 dark:bg-indigo-900/20 rounded-full blur-[120px] opacity-40 dark:opacity-20" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[800px] h-[800px] bg-violet-200/30 dark:bg-violet-900/20 rounded-full blur-[120px] opacity-40 dark:opacity-20" />
      </div>

      {/* Header */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white/80 dark:bg-[#050505]/80 backdrop-blur-xl border-b border-zinc-200 dark:border-white/[0.08]' : ''
        }`}>
        <nav className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center space-x-3 group">
              <SeemplifyLogo size="sm" animated={false} />
              <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white/90">
                Seemplify
              </span>
            </Link>

            <div className="hidden lg:flex items-center space-x-8">
              <Link href="#products" className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">Products</Link>
              <Link href="#how-it-works" className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">Methodology</Link>
              <Link href="#why-us" className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">Advantages</Link>
            </div>

            <div className="hidden md:flex items-center space-x-4">
              <ThemeToggle />
              <Link href={IDP_URL} className="text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
                Sign In
              </Link>
              <Link href={IDP_URL} className="px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black rounded text-sm font-medium hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors">
                Get Started
              </Link>
            </div>

            {/* Mobile Toggle */}
            <button className="lg:hidden p-2 text-zinc-600 dark:text-zinc-400" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              <div className="w-5 h-5 flex flex-col justify-center gap-1.5">
                <span className={`block w-full h-0.5 bg-current transition-transform ${mobileMenuOpen ? 'rotate-45 translate-y-2' : ''}`} />
                <span className={`block w-full h-0.5 bg-current transition-opacity ${mobileMenuOpen ? 'opacity-0' : ''}`} />
                <span className={`block w-full h-0.5 bg-current transition-transform ${mobileMenuOpen ? '-rotate-45 -translate-y-2' : ''}`} />
              </div>
            </button>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32">
        <div className="container mx-auto px-6">
          <div className="max-w-4xl mx-auto text-center">

            {/* Minimal Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="inline-flex items-center px-3 py-1 rounded-full border border-zinc-200 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur-md mb-8 shadow-sm dark:shadow-none"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300 tracking-wide uppercase">Unified HR Operating System</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="text-5xl md:text-7xl font-bold tracking-tighter mb-8 bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-500 dark:from-white dark:via-white dark:to-zinc-500 bg-clip-text text-transparent"
            >
              Orchestrate your<br />entire workforce.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="text-lg md:text-xl text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto mb-12 leading-relaxed font-light"
            >
              A single, high-performance platform for recruiting, management, and compensation.
              Designed for modern teams.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="flex flex-col sm:flex-row gap-4 justify-center mb-24"
            >
              <Link
                href={IDP_URL}
                className="inline-flex items-center justify-center px-8 py-3 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg font-medium hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-all duration-300 shadow-lg"
              >
                Start Free Trial
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex items-center justify-center px-8 py-3 border border-zinc-300 dark:border-zinc-800 rounded-lg font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-all duration-300"
              >
                View Architecture
              </Link>
            </motion.div>

            {/* Architectural Product Showcase */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="relative"
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto mb-6">
                {products.map((product, index) => (
                  <button
                    key={product.title}
                    onClick={() => setActiveProduct(index)}
                    className={`group p-4 rounded-xl border transition-all duration-300 text-left relative overflow-hidden ${activeProduct === index
                      ? 'border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900/50 shadow-sm dark:shadow-none'
                      : 'border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 hover:bg-white/50 dark:hover:bg-zinc-900/20'
                      }`}
                  >
                    <div className={`mb-3 ${activeProduct === index ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300'}`}>
                      {product.icon}
                    </div>
                    <div className={`text-sm font-medium ${activeProduct === index ? 'text-zinc-900 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400'}`}>{product.title}</div>

                    {/* Active Line Indicator */}
                    {activeProduct === index && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute bottom-0 left-0 w-full h-[1px] bg-indigo-500"
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* Main Display Glass Card */}
              <div className="glass-card rounded-2xl p-1">
                <div className="rounded-xl bg-white/80 dark:bg-black/40 p-8 md:p-12 overflow-hidden relative min-h-[400px] flex items-center">

                  {/* Content */}
                  <div className="grid md:grid-cols-2 gap-12 items-center w-full relative z-10">
                    <div className="text-left">
                      <div className={`inline-block mb-4 px-2 py-1 rounded border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 text-xs font-mono uppercase tracking-widest ${products[activeProduct].color}`}>
                        {products[activeProduct].tagline}
                      </div>
                      <h3 className="text-3xl font-semibold mb-4 text-zinc-900 dark:text-white tracking-tight">{products[activeProduct].description}</h3>
                      <ul className="space-y-3">
                        {products[activeProduct].features.map((feature) => (
                          <li key={feature} className="flex items-center text-zinc-600 dark:text-zinc-400 text-sm">
                            <div className="w-1 h-1 rounded-full bg-indigo-500 mr-3" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Illustration Container */}
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeProduct}
                        initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
                        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
                        transition={{ duration: 0.4 }}
                        className="w-full h-full flex items-center justify-center p-4 rounded-xl border border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/[0.02]"
                      >
                        {products[activeProduct].illustration}
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  {/* Bg Glow */}
                  <div className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/2 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px] opacity-50 pointer-events-none" />
                </div>
              </div>

            </motion.div>
          </div>
        </div>
      </section>

      {/* Feature Deep Dive Sections */}
      <div className="space-y-24 py-16 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-indigo-100/20 dark:via-indigo-950/5 to-transparent pointer-events-none" />

        {/* Recruiting */}
        <section id="products" className="container mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <div className="flex items-center gap-2 mb-6">
                <IconRecruiting />
                <span className="text-xs font-mono text-blue-600 dark:text-blue-400 uppercase tracking-widest">Recruiting Module</span>
              </div>
              <h2 className="text-4xl font-bold tracking-tighter mb-6 text-zinc-900 dark:text-white">AI-Powered Precision Hiring.</h2>
              <p className="text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6">
                Identify top talent in seconds with 95% match accuracy. Eliminate bias, automate scheduling, and cut time-to-hire by 60% with our intelligent recruiting engine.
              </p>
              <ul className="mb-8 space-y-2">
                <li className="flex items-center text-sm text-zinc-600 dark:text-zinc-400">
                  <div className="w-1 h-1 rounded-full bg-blue-500 mr-3" />
                  Deep Skill Analysis & Validation
                </li>
                <li className="flex items-center text-sm text-zinc-600 dark:text-zinc-400">
                  <div className="w-1 h-1 rounded-full bg-blue-500 mr-3" />
                  Automated Interview Scheduling
                </li>
                <li className="flex items-center text-sm text-zinc-600 dark:text-zinc-400">
                  <div className="w-1 h-1 rounded-full bg-blue-500 mr-3" />
                  Bias Elimination Protocols
                </li>
              </ul>
              <Link href="https://app.seemplifyai.com" className="text-sm font-medium text-zinc-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center group">
                Explore SmartHR Recruiting <span className="ml-2 group-hover:translate-x-1 transition-transform">→</span>
              </Link>
            </div>
            <div className="glass rounded-2xl p-8 transform rotate-1 hover:rotate-0 transition-transform duration-700">
              <HiringPipelineFlow />
            </div>
          </div>
        </section>

        {/* Leave */}
        <section className="container mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div className="order-2 md:order-1 glass rounded-2xl p-8 transform -rotate-1 hover:rotate-0 transition-transform duration-700">
              <LeaveApprovalFlow />
            </div>
            <div className="order-1 md:order-2">
              <div className="flex items-center gap-2 mb-6">
                <IconCalendar />
                <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Leave Module</span>
              </div>
              <h2 className="text-4xl font-bold tracking-tighter mb-6 text-zinc-900 dark:text-white">Autonomous time-off.</h2>
              <p className="text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed mb-8">
                Self-service requests that sync instantly with team calendars. Rules-based approvals and automatic balance calculations.
              </p>
              <Link href="https://leave.seemplifyai.com" className="text-sm font-medium text-zinc-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors flex items-center">
                Explore Leave <span className="ml-2">→</span>
              </Link>
            </div>
          </div>
        </section>

        {/* Performance */}
        <section className="container mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            <div>
              <div className="flex items-center gap-2 mb-6">
                <IconPerformance />
                <span className="text-xs font-mono text-purple-600 dark:text-purple-400 uppercase tracking-widest">Performance Module</span>
              </div>
              <h2 className="text-4xl font-bold tracking-tighter mb-6 text-zinc-900 dark:text-white">Continuous calibration.</h2>
              <p className="text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed mb-8">
                Move beyond annual reviews. Continuous feedback loops, OKR tracking, and 360-degree assessments that actually drive improvement.
              </p>
              <Link href="https://performance.seemplifyai.com" className="text-sm font-medium text-zinc-900 dark:text-white hover:text-purple-600 dark:hover:text-purple-400 transition-colors flex items-center">
                Explore Performance <span className="ml-2">→</span>
              </Link>
            </div>
            <div className="glass rounded-2xl p-8 transform rotate-1 hover:rotate-0 transition-transform duration-700">
              <PerformanceCycleFlow />
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="py-20 border-t border-zinc-200 dark:border-white/5 bg-zinc-100 dark:bg-[#050505] relative z-10 transition-colors duration-300">
        <div className="container mx-auto px-6 text-center">
          <div className="mb-8">
            <SeemplifyLogo size="md" />
          </div>
          <p className="text-zinc-500 text-sm mb-8">
            &copy; 2025 Seemplify AI. Engineered for growth.
          </p>
          <div className="flex justify-center gap-8 text-sm text-zinc-500 dark:text-zinc-400">
            <Link href="/privacy-policy" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Terms</Link>
            <Link href="mailto:hello@seemplifyai.com" className="hover:text-zinc-900 dark:hover:text-white transition-colors">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
