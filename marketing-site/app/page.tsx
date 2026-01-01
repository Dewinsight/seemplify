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
          <div className="mb-20">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="grid lg:grid-cols-2 gap-8 items-center"
            >
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <IconRecruiting />
                  <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-sm font-medium">Recruiting</span>
                </div>
                <h3 className="text-3xl font-bold mb-4">Track Every Candidate</h3>
                <p className="text-slate-400 mb-6 text-lg">
                  From application to offer. See your entire hiring pipeline at a glance, schedule interviews with calendar sync, and collect structured feedback from your team.
                </p>
                <ul className="space-y-3 mb-6">
                  {['Customizable hiring stages', 'Self-service interview scheduling', 'Team feedback & scorecards', 'CV parsing & screening'].map((item) => (
                    <li key={item} className="flex items-center text-slate-300">
                      <svg className="w-5 h-5 mr-3 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="https://app.seemplifyai.com" className="inline-flex items-center text-blue-400 hover:text-blue-300 font-medium group">
                  Try SmartHR
                  <svg className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              </div>
              <div>
                <HiringPipelineFlow />
              </div>
            </motion.div>
          </div>

          {/* Leave Management with Approval Flow */}
          <div className="mb-20">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="grid lg:grid-cols-2 gap-8 items-center"
            >
              <div className="order-2 lg:order-1">
                <LeaveApprovalFlow />
                <div className="mt-4 text-center text-sm text-slate-500">
                  Request → Review → Approve → Done
                </div>
              </div>
              <div className="order-1 lg:order-2">
                <div className="flex items-center gap-3 mb-4">
                  <IconCalendar />
                  <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-sm font-medium">Time Off</span>
                </div>
                <h3 className="text-3xl font-bold mb-4">Leave Without the Hassle</h3>
                <p className="text-slate-400 mb-6 text-lg">
                  Your team requests time off. Managers approve with one click. Balances update automatically. No more spreadsheets or email chains.
                </p>
                <ul className="space-y-3 mb-6">
                  {['One-click approvals', 'Real-time balance tracking', 'Team calendar view', 'Custom leave policies'].map((item) => (
                    <li key={item} className="flex items-center text-slate-300">
                      <svg className="w-5 h-5 mr-3 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="https://leave.seemplifyai.com" className="inline-flex items-center text-emerald-400 hover:text-emerald-300 font-medium group">
                  Try Leave Management
                  <svg className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              </div>
            </motion.div>
          </div>

          {/* Performance with Cycle Flow */}
          <div className="mb-20">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="grid lg:grid-cols-2 gap-8 items-center"
            >
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <IconPerformance />
                  <span className="px-3 py-1 rounded-full bg-purple-500/10 text-purple-400 text-sm font-medium">Growth</span>
                </div>
                <h3 className="text-3xl font-bold mb-4">Reviews That Drive Growth</h3>
                <p className="text-slate-400 mb-6 text-lg">
                  Set goals. Track progress. Gather 360° feedback. Run review cycles that actually help your people improve.
                </p>
                <ul className="space-y-3 mb-6">
                  {['OKR tracking', '360° feedback', 'One-on-one templates', 'Development plans'].map((item) => (
                    <li key={item} className="flex items-center text-slate-300">
                      <svg className="w-5 h-5 mr-3 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="https://performance.seemplifyai.com" className="inline-flex items-center text-purple-400 hover:text-purple-300 font-medium group">
                  Try Performance
                  <svg className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
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
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="grid lg:grid-cols-2 gap-8 items-center"
            >
              <div className="order-2 lg:order-1 flex justify-center">
                <PayrollIllustration />
              </div>
              <div className="order-1 lg:order-2">
                <div className="flex items-center gap-3 mb-4">
                  <IconPayroll />
                  <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-sm font-medium">Payroll</span>
                </div>
                <h3 className="text-3xl font-bold mb-4">Pay Day, Sorted</h3>
                <p className="text-slate-400 mb-6 text-lg">
                  Run payroll, generate payslips, and stay on top of compliance. All your compensation data in one place.
                </p>
                <ul className="space-y-3 mb-6">
                  {['Automated calculations', 'Payslip generation', 'Tax compliance', 'Compensation reports'].map((item) => (
                    <li key={item} className="flex items-center text-slate-300">
                      <svg className="w-5 h-5 mr-3 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link href="https://payroll.seemplifyai.com" className="inline-flex items-center text-amber-400 hover:text-amber-300 font-medium group">
                  Try Payroll
                  <svg className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 bg-slate-900/50 relative">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              How It
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400"> Works</span>
            </h2>
            <p className="text-xl text-slate-400">Get up and running in minutes, not days.</p>
          </motion.div>

          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { step: '01', title: 'Sign Up', desc: 'Create your account and invite your team. No credit card required.', icon: '👤' },
                { step: '02', title: 'Configure', desc: 'Set up your departments, leave policies, and workflows.', icon: '⚙️' },
                { step: '03', title: 'Go Live', desc: 'Start hiring, tracking leave, running reviews, and processing payroll.', icon: '🚀' },
              ].map((item, index) => (
                <motion.div
                  key={item.step}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="relative"
                >
                  <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700 h-full">
                    <span className="text-5xl mb-4 block">{item.icon}</span>
                    <div className="text-sm font-mono text-purple-400 mb-2">STEP {item.step}</div>
                    <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                    <p className="text-slate-400">{item.desc}</p>
                  </div>
                  {index < 2 && (
                    <div className="hidden md:block absolute top-1/2 -right-4 z-10">
                      <WorkflowConnector />
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Why Us */}
      <section id="why-us" className="py-24 relative">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Why Teams Choose
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400"> Seemplify</span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              { title: 'All-in-One', desc: 'Stop juggling multiple HR tools. Everything you need in one place.', icon: '📦' },
              { title: 'Fast Setup', desc: 'Get started in minutes. Import your data or start fresh.', icon: '⚡' },
              { title: 'Secure', desc: 'Enterprise-grade security with role-based access controls.', icon: '🔒' },
              { title: 'Flexible', desc: 'Start with what you need. Add more as you grow.', icon: '🧩' },
              { title: 'Affordable', desc: 'Pricing that works for growing teams. No enterprise lock-in.', icon: '💰' },
              { title: 'Supported', desc: 'Real humans ready to help when you need it.', icon: '🤝' },
            ].map((item, index) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
                className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-all"
              >
                <span className="text-3xl mb-4 block">{item.icon}</span>
                <h3 className="text-lg font-bold mb-2">{item.title}</h3>
                <p className="text-slate-400 text-sm">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 relative">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="max-w-3xl mx-auto text-center p-12 rounded-3xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-slate-700 relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-purple-500/5 to-pink-500/5" />
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to simplify your HR?</h2>
              <p className="text-slate-400 mb-8 text-lg">Start your free trial today. No credit card required.</p>
              <Link
                href={IDP_URL}
                className="inline-flex items-center justify-center px-8 py-4 bg-white text-slate-900 rounded-xl font-semibold text-lg hover:bg-slate-100 transition-all shadow-xl"
              >
                Get Started Free
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 border-t border-slate-800 relative">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8 mb-12">
            <div className="md:col-span-1">
              <Link href="/" className="flex items-center space-x-2 mb-4">
                <SeemplifyIcon size="md" />
                <span className="font-bold">SeemplifyAI</span>
              </Link>
              <p className="text-slate-500 text-sm">HR tools that work together.</p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Products</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><Link href="https://app.seemplifyai.com" className="hover:text-white transition-colors">SmartHR Recruiting</Link></li>
                <li><Link href="https://leave.seemplifyai.com" className="hover:text-white transition-colors">Leave Management</Link></li>
                <li><Link href="https://performance.seemplifyai.com" className="hover:text-white transition-colors">Performance</Link></li>
                <li><Link href="https://payroll.seemplifyai.com" className="hover:text-white transition-colors">Payroll</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><Link href="#" className="hover:text-white transition-colors">About</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Blog</Link></li>
                <li><Link href="mailto:hello@seemplifyai.com" className="hover:text-white transition-colors">Contact</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><Link href="#" className="hover:text-white transition-colors">Privacy</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Terms</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-8 text-center text-sm text-slate-600">
            © 2025 Seemplify AI. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}
