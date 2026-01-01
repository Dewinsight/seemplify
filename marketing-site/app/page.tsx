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

// Floating shape component
const FloatingShape = ({ className, delay = 0 }: { className: string; delay?: number }) => (
  <motion.div
    className={`absolute ${className}`}
    animate={{
      y: [0, -20, 0],
      rotate: [0, 5, -5, 0],
    }}
    transition={{
      duration: 6,
      delay,
      repeat: Infinity,
      ease: "easeInOut",
    }}
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
    <div className="min-h-screen bg-slate-950 text-white overflow-x-hidden">
      {/* Unique Background Pattern */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {/* Gradient orbs */}
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[100px]" />
        
        {/* Decorative shapes */}
        <FloatingShape className="top-20 left-[10%] w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/10" delay={0} />
        <FloatingShape className="top-40 right-[15%] w-16 h-16 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/10" delay={1} />
        <FloatingShape className="bottom-40 left-[20%] w-24 h-24 rounded-3xl bg-gradient-to-br from-emerald-500/20 to-green-500/20 border border-emerald-500/10" delay={2} />
        <FloatingShape className="bottom-20 right-[10%] w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/10" delay={0.5} />
        
        {/* Grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      {/* Header */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-slate-900/95 backdrop-blur-xl border-b border-white/5 shadow-xl' : ''
      }`}>
        <nav className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center space-x-3 group">
              <motion.div 
                className="relative w-11 h-11"
                whileHover={{ scale: 1.05 }}
              >
                <svg viewBox="0 0 44 44" className="w-full h-full">
                  <defs>
                    <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="50%" stopColor="#8b5cf6" />
                      <stop offset="100%" stopColor="#ec4899" />
                    </linearGradient>
                  </defs>
                  <rect x="2" y="2" width="40" height="40" rx="12" fill="url(#logoGrad)" />
                  <path d="M12 22 L20 22 L24 14 L28 30 L32 22 L32 22" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </motion.div>
              <span className="text-xl font-bold tracking-tight">
                Seemplify<span className="font-light text-purple-400">AI</span>
              </span>
            </Link>

            {/* Desktop Nav */}
            <div className="hidden lg:flex items-center space-x-8">
              <Link href="#products" className="text-slate-300 hover:text-white transition-colors">Products</Link>
              <Link href="#how-it-works" className="text-slate-300 hover:text-white transition-colors">How It Works</Link>
              <Link href="#why-us" className="text-slate-300 hover:text-white transition-colors">Why Us</Link>
            </div>

            {/* CTA */}
            <div className="hidden md:flex items-center space-x-4">
              <Link href={IDP_URL} className="px-4 py-2 text-slate-300 hover:text-white transition-colors">
                Sign In
              </Link>
              <Link href={IDP_URL} className="px-6 py-2.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-xl font-semibold hover:shadow-lg hover:shadow-purple-500/25 transition-all">
                Get Started
              </Link>
            </div>

            {/* Mobile menu button */}
            <button className="lg:hidden p-2" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
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
                className="lg:hidden mt-4 pt-4 border-t border-white/10"
              >
                <div className="flex flex-col space-y-4 pb-4">
                  <Link href="#products" onClick={() => setMobileMenuOpen(false)} className="text-slate-300 hover:text-white py-2">Products</Link>
                  <Link href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="text-slate-300 hover:text-white py-2">How It Works</Link>
                  <Link href={IDP_URL} className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl font-semibold text-center">Get Started</Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-32">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto text-center">
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center px-4 py-2 rounded-full bg-slate-800/50 border border-slate-700 mb-8"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 mr-2 animate-pulse" />
              <span className="text-sm text-slate-300">HR tools that work together</span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-5xl md:text-6xl lg:text-7xl font-black leading-[1.1] mb-8"
            >
              Your Team.
              <br />
              <span className="relative">
                <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  Simplified.
                </span>
                <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" preserveAspectRatio="none">
                  <motion.path
                    d="M0 6 Q75 0 150 6 T300 6"
                    stroke="url(#underlineGrad)"
                    strokeWidth="4"
                    fill="none"
                    strokeLinecap="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ delay: 0.5, duration: 0.8 }}
                  />
                  <defs>
                    <linearGradient id="underlineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="50%" stopColor="#8b5cf6" />
                      <stop offset="100%" stopColor="#ec4899" />
                    </linearGradient>
                  </defs>
                </svg>
              </span>
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xl md:text-2xl text-slate-400 max-w-2xl mx-auto mb-10"
            >
              Recruiting. Leave. Performance. Payroll.
              <br className="hidden md:block" />
              One platform to manage your entire team.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-4 justify-center mb-16"
            >
              <Link
                href={IDP_URL}
                className="group inline-flex items-center justify-center px-8 py-4 bg-white text-slate-900 rounded-xl font-semibold text-lg hover:bg-slate-100 transition-all shadow-xl"
              >
                Start Free
                <svg className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
              <Link
                href="#how-it-works"
                className="inline-flex items-center justify-center px-8 py-4 border border-slate-700 rounded-xl font-semibold text-lg hover:bg-slate-800/50 transition-all"
              >
                See How It Works
              </Link>
            </motion.div>

            {/* Product Cards Preview */}
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="relative"
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
                {products.map((product, index) => (
                  <motion.div
                    key={product.title}
                    className={`p-4 rounded-2xl border transition-all duration-300 cursor-pointer ${
                      activeProduct === index
                        ? 'bg-slate-800/80 border-white/20 scale-105 shadow-xl'
                        : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                    }`}
                    onClick={() => setActiveProduct(index)}
                    whileHover={{ y: -4 }}
                  >
                    <div className="mb-3">{product.icon}</div>
                    <h3 className="font-semibold text-sm mb-1">{product.title.split(' ')[0]}</h3>
                    <p className="text-xs text-slate-500">{product.tagline}</p>
                  </motion.div>
                ))}
              </div>

              {/* Active Product Showcase */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeProduct}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="mt-8 p-8 rounded-3xl bg-slate-900/70 border border-slate-800 backdrop-blur"
                >
                  <div className="flex flex-col md:flex-row items-center gap-8">
                    <div className="flex-shrink-0">
                      {products[activeProduct].illustration}
                    </div>
                    <div className="text-left">
                      <div className={`inline-flex items-center px-3 py-1 rounded-full bg-gradient-to-r ${products[activeProduct].color} text-white text-xs font-medium mb-3`}>
                        {products[activeProduct].tagline}
                      </div>
                      <h3 className="text-2xl font-bold mb-2">{products[activeProduct].title}</h3>
                      <p className="text-slate-400 mb-4">{products[activeProduct].description}</p>
                      <div className="flex flex-wrap gap-2">
                        {products[activeProduct].features.map((feature) => (
                          <span key={feature} className="px-3 py-1 rounded-full bg-slate-800 text-slate-300 text-sm">
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
      <section id="products" className="py-24 relative">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Four Products.
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                One Platform.
              </span>
            </h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
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
                <svg viewBox="0 0 32 32" className="w-8 h-8">
                  <rect width="32" height="32" rx="8" fill="url(#footerLogoGrad)" />
                  <path d="M8 16 L14 16 L17 10 L20 22 L23 16 L24 16" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  <defs>
                    <linearGradient id="footerLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#8b5cf6" />
                    </linearGradient>
                  </defs>
                </svg>
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
