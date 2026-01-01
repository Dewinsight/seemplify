'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TeamIllustration,
  CalendarIllustration,
  ChartIllustration,
  PayrollIllustration,
  WorkflowConnector,
} from '@/components/AnimatedIllustrations'
import SeemplifyLogo, { SeemplifyIcon } from '@/components/SeemplifyLogo'

// Dynamic imports for ReactFlow components (client-side only)
const HiringPipelineFlow = dynamic(() => import('@/components/HiringPipelineFlow'), { 
  ssr: false,
  loading: () => <div className="w-full h-[250px] rounded-2xl bg-slate-900/50 animate-pulse" />
})
const LeaveApprovalFlow = dynamic(() => import('@/components/LeaveApprovalFlow'), { 
  ssr: false,
  loading: () => <div className="w-full h-[180px] rounded-2xl bg-slate-900/50 animate-pulse" />
})
const PerformanceCycleFlow = dynamic(() => import('@/components/PerformanceCycleFlow'), { 
  ssr: false,
  loading: () => <div className="w-full h-64 rounded-2xl bg-slate-900/50 animate-pulse" />
})

const IDP_URL = 'https://auth.seemplifyai.com'

// Custom animated icons
const IconRecruiting = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="recruitGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#6366f1" />
      </linearGradient>
    </defs>
    <circle cx="20" cy="16" r="8" fill="url(#recruitGrad)" />
    <path d="M8 38c0-8 6-14 12-14s12 6 12 14" fill="url(#recruitGrad)" opacity="0.8" />
    <circle cx="36" cy="20" r="6" fill="#22c55e" />
    <path d="M32 22 L35 25 L41 18" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconCalendar = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="calGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#10b981" />
        <stop offset="100%" stopColor="#059669" />
      </linearGradient>
    </defs>
    <rect x="6" y="10" width="36" height="32" rx="4" fill="url(#calGrad2)" opacity="0.2" />
    <rect x="6" y="10" width="36" height="10" rx="4" fill="url(#calGrad2)" />
    <rect x="12" y="26" width="8" height="6" rx="1" fill="url(#calGrad2)" />
    <rect x="28" y="26" width="8" height="6" rx="1" fill="url(#calGrad2)" opacity="0.5" />
    <rect x="12" y="35" width="8" height="6" rx="1" fill="url(#calGrad2)" opacity="0.5" />
    <circle cx="12" cy="6" r="2" fill="#64748b" />
    <circle cx="36" cy="6" r="2" fill="#64748b" />
  </svg>
)

const IconPerformance = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="perfGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#a855f7" />
      </linearGradient>
    </defs>
    <path d="M4 40 L16 28 L24 34 L36 18 L44 24" stroke="url(#perfGrad)" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="44" cy="24" r="4" fill="#ec4899" />
    <path d="M38 10 L44 4 L44 12 L38 10" fill="#ec4899" />
  </svg>
)

const IconPayroll = () => (
  <svg viewBox="0 0 48 48" className="w-12 h-12">
    <defs>
      <linearGradient id="payGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#d97706" />
      </linearGradient>
    </defs>
    <circle cx="24" cy="24" r="18" fill="url(#payGrad)" opacity="0.2" />
    <circle cx="24" cy="24" r="12" fill="url(#payGrad)" />
    <text x="24" y="29" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">$</text>
  </svg>
)

// Subtle ambient shape component - refined and minimal
const AmbientShape = ({ className, delay = 0 }: { className: string; delay?: number }) => (
  <motion.div
    className={`absolute ${className}`}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 2, delay }}
  />
)

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [activeProduct, setActiveProduct] = useState(0)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Auto-rotate products
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveProduct(prev => (prev + 1) % 4)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const products = [
    {
      title: 'SmartHR Recruiting',
      tagline: 'Find & Hire Talent',
      description: 'Post jobs, track candidates, schedule interviews, and make better hiring decisions.',
      icon: <IconRecruiting />,
      illustration: <TeamIllustration />,
      color: 'from-blue-500 to-indigo-600',
      bgGlow: 'bg-blue-500/20',
      features: ['Job posting', 'Pipeline tracking', 'Interview scheduling', 'Feedback collection'],
      url: 'https://app.seemplifyai.com',
    },
    {
      title: 'Leave Management',
      tagline: 'Time-Off Made Simple',
      description: 'Request, approve, and track leave balances. Keep your team calendar organized.',
      icon: <IconCalendar />,
      illustration: <CalendarIllustration />,
      color: 'from-emerald-500 to-green-600',
      bgGlow: 'bg-emerald-500/20',
      features: ['Leave requests', 'Manager approvals', 'Balance tracking', 'Team calendar'],
      url: 'https://leave.seemplifyai.com',
    },
    {
      title: 'Performance',
      tagline: 'Grow Your People',
      description: 'Set goals, gather feedback, and run performance reviews that actually help.',
      icon: <IconPerformance />,
      illustration: <ChartIllustration />,
      color: 'from-purple-500 to-pink-600',
      bgGlow: 'bg-purple-500/20',
      features: ['OKR tracking', '360° feedback', 'Review cycles', 'Development plans'],
      url: 'https://performance.seemplifyai.com',
    },
    {
      title: 'Payroll',
      tagline: 'Pay Day, Easy Way',
      description: 'Process payroll, generate payslips, and stay compliant without the headache.',
      icon: <IconPayroll />,
      illustration: <PayrollIllustration />,
      color: 'from-amber-500 to-orange-600',
      bgGlow: 'bg-amber-500/20',
      features: ['Payroll runs', 'Payslip generation', 'Tax compliance', 'Compensation data'],
      url: 'https://payroll.seemplifyai.com',
    },
  ]

  return (
    <div className="min-h-screen bg-zinc-950 text-white overflow-x-hidden">
      {/* Refined Background - subtle and professional */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {/* Subtle gradient orbs - very soft */}
        <AmbientShape className="top-[-20%] left-[-10%] w-[800px] h-[800px] bg-indigo-500/[0.03] rounded-full blur-[150px]" delay={0} />
        <AmbientShape className="bottom-[-20%] right-[-10%] w-[700px] h-[700px] bg-violet-500/[0.03] rounded-full blur-[150px]" delay={0.5} />

        {/* Minimal grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:80px_80px]" />
      </div>

      {/* Header */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ease-out ${
        scrolled ? 'bg-zinc-900/80 backdrop-blur-2xl border-b border-white/[0.06]' : ''
      }`}>
        <nav className="container mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center space-x-3 group">
              <SeemplifyLogo size="md" animated={false} />
              <span className="text-xl font-semibold tracking-tight">
                Seemplify<span className="font-normal text-zinc-400">AI</span>
              </span>
            </Link>

            {/* Desktop Nav */}
            <div className="hidden lg:flex items-center space-x-10">
              <Link href="#products" className="text-zinc-400 hover:text-white transition-colors duration-300 text-sm font-medium">Products</Link>
              <Link href="#how-it-works" className="text-zinc-400 hover:text-white transition-colors duration-300 text-sm font-medium">How It Works</Link>
              <Link href="#why-us" className="text-zinc-400 hover:text-white transition-colors duration-300 text-sm font-medium">Why Us</Link>
            </div>

            {/* CTA */}
            <div className="hidden md:flex items-center space-x-6">
              <Link href={IDP_URL} className="text-zinc-400 hover:text-white transition-colors duration-300 text-sm font-medium">
                Sign In
              </Link>
              <Link href={IDP_URL} className="px-5 py-2.5 bg-white text-zinc-900 rounded-lg font-medium text-sm hover:bg-zinc-100 transition-colors duration-300">
                Get Started
              </Link>
            </div>

            {/* Mobile menu button */}
            <button className="lg:hidden p-2 text-zinc-400 hover:text-white transition-colors" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                )}
              </svg>
            </button>
          </div>

          {/* Mobile menu */}
          <AnimatePresence>
            {mobileMenuOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="lg:hidden mt-4 pt-4 border-t border-white/[0.06]"
              >
                <div className="flex flex-col space-y-1 pb-4">
                  <Link href="#products" onClick={() => setMobileMenuOpen(false)} className="text-zinc-400 hover:text-white py-3 text-sm font-medium transition-colors">Products</Link>
                  <Link href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="text-zinc-400 hover:text-white py-3 text-sm font-medium transition-colors">How It Works</Link>
                  <Link href={IDP_URL} className="mt-2 px-5 py-3 bg-white text-zinc-900 rounded-lg font-medium text-sm text-center">Get Started</Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative pt-32 pb-16 md:pt-44 md:pb-24">
        <div className="container mx-auto px-6">
          <div className="max-w-4xl mx-auto text-center">
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="inline-flex items-center px-4 py-2 rounded-full bg-zinc-900 border border-zinc-800 mb-10"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-2.5" />
              <span className="text-sm text-zinc-400">HR tools that work together</span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="text-5xl md:text-6xl lg:text-7xl font-semibold leading-[1.08] tracking-tight mb-8"
            >
              Your Team.
              <br />
              <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
                Simplified.
              </span>
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="text-lg md:text-xl text-zinc-400 max-w-xl mx-auto mb-12 leading-relaxed"
            >
              Recruiting. Leave. Performance. Payroll.
              <br className="hidden md:block" />
              One platform to manage your entire team.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col sm:flex-row gap-4 justify-center mb-20"
            >
              <Link
                href={IDP_URL}
                className="group inline-flex items-center justify-center px-7 py-3.5 bg-white text-zinc-900 rounded-lg font-medium hover:bg-zinc-100 transition-all duration-300"
              >
                Start Free
                <svg className="ml-2 w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex items-center justify-center px-7 py-3.5 border border-zinc-800 rounded-lg font-medium text-zinc-300 hover:text-white hover:border-zinc-700 hover:bg-zinc-900/50 transition-all duration-300"
              >
                See How It Works
              </Link>
            </motion.div>

            {/* Product Cards Preview */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="relative"
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
                {products.map((product, index) => (
                  <motion.div
                    key={product.title}
                    className={`p-4 rounded-xl border cursor-pointer transition-all duration-400 ${
                      activeProduct === index
                        ? 'bg-zinc-800/60 border-zinc-700'
                        : 'bg-zinc-900/40 border-zinc-800/60 hover:border-zinc-700/80 hover:bg-zinc-800/30'
                    }`}
                    onClick={() => setActiveProduct(index)}
                    whileHover={{ y: -2 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <div className="mb-3">{product.icon}</div>
                    <h3 className="font-medium text-sm mb-1 text-zinc-200">{product.title.split(' ')[0]}</h3>
                    <p className="text-xs text-zinc-500">{product.tagline}</p>
                  </motion.div>
                ))}
              </div>

              {/* Active Product Showcase */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeProduct}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-6 p-8 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 backdrop-blur-sm"
                >
                  <div className="flex flex-col md:flex-row items-center gap-8">
                    <div className="flex-shrink-0">
                      {products[activeProduct].illustration}
                    </div>
                    <div className="text-left">
                      <div className={`inline-flex items-center px-3 py-1 rounded-md bg-gradient-to-r ${products[activeProduct].color} text-white text-xs font-medium mb-4`}>
                        {products[activeProduct].tagline}
                      </div>
                      <h3 className="text-2xl font-semibold mb-3 text-zinc-100">{products[activeProduct].title}</h3>
                      <p className="text-zinc-400 mb-5 leading-relaxed">{products[activeProduct].description}</p>
                      <div className="flex flex-wrap gap-2">
                        {products[activeProduct].features.map((feature) => (
                          <span key={feature} className="px-3 py-1.5 rounded-md bg-zinc-800/80 text-zinc-400 text-sm">
                            {feature}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Products Deep Dive */}
      <section id="products" className="py-28 relative">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="text-center mb-20"
          >
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight mb-6">
              Four Products.
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">
                One Platform.
              </span>
            </h2>
            <p className="text-lg text-zinc-400 max-w-xl mx-auto leading-relaxed">
              Everything you need to hire, manage, and pay your team — without juggling multiple tools.
            </p>
          </motion.div>

          {/* SmartHR Section with Pipeline Flow */}
          <div className="mb-24">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="grid lg:grid-cols-2 gap-12 items-center"
            >
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <IconRecruiting />
                  <span className="px-3 py-1 rounded-md bg-blue-500/10 text-blue-400 text-sm font-medium">Recruiting</span>
                </div>
                <h3 className="text-3xl font-semibold tracking-tight mb-4 text-zinc-100">Track Every Candidate</h3>
                <p className="text-zinc-400 mb-6 leading-relaxed">
                  From application to offer. See your entire hiring pipeline at a glance, schedule interviews with calendar sync, and collect structured feedback from your team.
                </p>
                <ul className="space-y-3 mb-8">
                  {['Customizable hiring stages', 'Self-service interview scheduling', 'Team feedback & scorecards', 'CV parsing & screening'].map((item) => (
                    <li key={item} className="flex items-center text-zinc-400">
                      <svg className="w-4 h-4 mr-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="https://app.seemplifyai.com" className="inline-flex items-center text-blue-400 hover:text-blue-300 font-medium group transition-colors duration-300">
                  Try SmartHR
                  <svg className="ml-2 w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              </div>
              <div>
                <HiringPipelineFlow />
              </div>
            </motion.div>
          </div>

          {/* Leave Management with Approval Flow */}
          <div className="mb-24">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="grid lg:grid-cols-2 gap-12 items-center"
            >
              <div className="order-2 lg:order-1">
                <LeaveApprovalFlow />
              </div>
              <div className="order-1 lg:order-2">
                <div className="flex items-center gap-3 mb-5">
                  <IconCalendar />
                  <span className="px-3 py-1 rounded-md bg-emerald-500/10 text-emerald-400 text-sm font-medium">Time Off</span>
                </div>
                <h3 className="text-3xl font-semibold tracking-tight mb-4 text-zinc-100">Leave Without the Hassle</h3>
                <p className="text-zinc-400 mb-6 leading-relaxed">
                  Your team requests time off. Managers approve with one click. Balances update automatically. No more spreadsheets or email chains.
                </p>
                <ul className="space-y-3 mb-8">
                  {['One-click approvals', 'Real-time balance tracking', 'Team calendar view', 'Custom leave policies'].map((item) => (
                    <li key={item} className="flex items-center text-zinc-400">
                      <svg className="w-4 h-4 mr-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="https://leave.seemplifyai.com" className="inline-flex items-center text-emerald-400 hover:text-emerald-300 font-medium group transition-colors duration-300">
                  Try Leave Management
                  <svg className="ml-2 w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              </div>
            </motion.div>
          </div>

          {/* Performance with Cycle Flow */}
          <div className="mb-24">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="grid lg:grid-cols-2 gap-12 items-center"
            >
              <div>
                <div className="flex items-center gap-3 mb-5">
                  <IconPerformance />
                  <span className="px-3 py-1 rounded-md bg-purple-500/10 text-purple-400 text-sm font-medium">Growth</span>
                </div>
                <h3 className="text-3xl font-semibold tracking-tight mb-4 text-zinc-100">Reviews That Drive Growth</h3>
                <p className="text-zinc-400 mb-6 leading-relaxed">
                  Set goals. Track progress. Gather 360° feedback. Run review cycles that actually help your people improve.
                </p>
                <ul className="space-y-3 mb-8">
                  {['OKR tracking', '360° feedback', 'One-on-one templates', 'Development plans'].map((item) => (
                    <li key={item} className="flex items-center text-zinc-400">
                      <svg className="w-4 h-4 mr-3 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="https://performance.seemplifyai.com" className="inline-flex items-center text-purple-400 hover:text-purple-300 font-medium group transition-colors duration-300">
                  Try Performance
                  <svg className="ml-2 w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              </div>
              <div className="flex justify-center">
                <PerformanceCycleFlow />
              </div>
            </motion.div>
          </div>

          {/* Payroll */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="grid lg:grid-cols-2 gap-12 items-center"
            >
              <div className="order-2 lg:order-1 flex justify-center">
                <PayrollIllustration />
              </div>
              <div className="order-1 lg:order-2">
                <div className="flex items-center gap-3 mb-5">
                  <IconPayroll />
                  <span className="px-3 py-1 rounded-md bg-amber-500/10 text-amber-400 text-sm font-medium">Payroll</span>
                </div>
                <h3 className="text-3xl font-semibold tracking-tight mb-4 text-zinc-100">Pay Day, Sorted</h3>
                <p className="text-zinc-400 mb-6 leading-relaxed">
                  Run payroll, generate payslips, and stay on top of compliance. All your compensation data in one place.
                </p>
                <ul className="space-y-3 mb-8">
                  {['Automated calculations', 'Payslip generation', 'Tax compliance', 'Compensation reports'].map((item) => (
                    <li key={item} className="flex items-center text-zinc-400">
                      <svg className="w-4 h-4 mr-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="https://payroll.seemplifyai.com" className="inline-flex items-center text-amber-400 hover:text-amber-300 font-medium group transition-colors duration-300">
                  Try Payroll
                  <svg className="ml-2 w-4 h-4 group-hover:translate-x-0.5 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-28 bg-zinc-900/30 relative">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight mb-6">
              How It
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400"> Works</span>
            </h2>
            <p className="text-lg text-zinc-400">Get up and running in minutes, not days.</p>
          </motion.div>

          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { step: '01', title: 'Sign Up', desc: 'Create your account and invite your team. No credit card required.', icon: (
                  <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                )},
                { step: '02', title: 'Configure', desc: 'Set up your departments, leave policies, and workflows.', icon: (
                  <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )},
                { step: '03', title: 'Go Live', desc: 'Start hiring, tracking leave, running reviews, and processing payroll.', icon: (
                  <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                  </svg>
                )},
              ].map((item, index) => (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.5, delay: index * 0.1, ease: [0.16, 1, 0.3, 1] }}
                  className="relative"
                >
                  <div className="p-6 rounded-xl bg-zinc-900/60 border border-zinc-800/80 h-full">
                    <div className="mb-5 p-3 rounded-lg bg-indigo-500/10 w-fit">{item.icon}</div>
                    <div className="text-xs font-medium text-zinc-500 mb-2 tracking-wider">STEP {item.step}</div>
                    <h3 className="text-lg font-semibold mb-2 text-zinc-100">{item.title}</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Why Us */}
      <section id="why-us" className="py-28 relative">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight mb-6">
              Why Teams Choose
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400"> Seemplify</span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {[
              { title: 'All-in-One', desc: 'Stop juggling multiple HR tools. Everything you need in one place.', icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                </svg>
              )},
              { title: 'Fast Setup', desc: 'Get started in minutes. Import your data or start fresh.', icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
              )},
              { title: 'Secure', desc: 'Enterprise-grade security with role-based access controls.', icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              )},
              { title: 'Flexible', desc: 'Start with what you need. Add more as you grow.', icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.96.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z" />
                </svg>
              )},
              { title: 'Affordable', desc: 'Pricing that works for growing teams. No enterprise lock-in.', icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )},
              { title: 'Supported', desc: 'Real humans ready to help when you need it.', icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              )},
            ].map((item, index) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
                className="p-6 rounded-xl bg-zinc-900/40 border border-zinc-800/60 hover:border-zinc-700/80 hover:bg-zinc-800/30 transition-all duration-300"
              >
                <div className="mb-4 text-indigo-400">{item.icon}</div>
                <h3 className="text-base font-semibold mb-2 text-zinc-100">{item.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-28 relative">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl mx-auto text-center p-12 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 relative overflow-hidden"
          >
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-4">Ready to simplify your HR?</h2>
              <p className="text-zinc-400 mb-8">Start your free trial today. No credit card required.</p>
              <Link
                href={IDP_URL}
                className="inline-flex items-center justify-center px-7 py-3.5 bg-white text-zinc-900 rounded-lg font-medium hover:bg-zinc-100 transition-all duration-300"
              >
                Get Started Free
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 border-t border-zinc-800/60 relative">
        <div className="container mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            <div className="md:col-span-1">
              <Link href="/" className="flex items-center space-x-2 mb-4">
                <SeemplifyIcon size="md" />
                <span className="font-semibold">SeemplifyAI</span>
              </Link>
              <p className="text-zinc-500 text-sm">HR tools that work together.</p>
            </div>

            <div>
              <h4 className="font-medium text-zinc-300 mb-4">Products</h4>
              <ul className="space-y-2.5 text-sm text-zinc-500">
                <li><Link href="https://app.seemplifyai.com" className="hover:text-white transition-colors duration-300">SmartHR Recruiting</Link></li>
                <li><Link href="https://leave.seemplifyai.com" className="hover:text-white transition-colors duration-300">Leave Management</Link></li>
                <li><Link href="https://performance.seemplifyai.com" className="hover:text-white transition-colors duration-300">Performance</Link></li>
                <li><Link href="https://payroll.seemplifyai.com" className="hover:text-white transition-colors duration-300">Payroll</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium text-zinc-300 mb-4">Company</h4>
              <ul className="space-y-2.5 text-sm text-zinc-500">
                <li><Link href="#" className="hover:text-white transition-colors duration-300">About</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors duration-300">Blog</Link></li>
                <li><Link href="mailto:hello@seemplifyai.com" className="hover:text-white transition-colors duration-300">Contact</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-medium text-zinc-300 mb-4">Legal</h4>
              <ul className="space-y-2.5 text-sm text-zinc-500">
                <li><Link href="#" className="hover:text-white transition-colors duration-300">Privacy</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors duration-300">Terms</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-zinc-800/60 pt-8 text-center text-sm text-zinc-600">
            © 2025 Seemplify AI. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}
