'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight,
  Users,
  Calendar,
  TrendingUp,
  DollarSign,
  Shield,
  Zap,
  CheckCircle,
  Menu,
  X,
  Sparkles,
  BarChart3,
  Clock,
  Brain,
  Target,
  Briefcase,
  HeartHandshake,
  ChevronRight,
  Play,
  Workflow,
  Layers,
  Rocket,
  Globe,
  Lock,
  RefreshCw,
  MessageSquare,
  PieChart,
  Settings,
  Award,
  Bot,
  FileSearch,
  UserCheck,
  CalendarCheck,
  CircleDollarSign,
  ClipboardCheck,
  LineChart,
  Mail,
  Building2,
} from 'lucide-react'

const IDP_URL = 'https://auth.seemplifyai.com'

// Services data with better descriptions
const services = [
  {
    id: 'smarthr',
    title: 'SmartHR',
    subtitle: 'AI-Powered Recruitment',
    description: 'Stop spending weeks on hiring. Our AI analyzes resumes, matches candidates to your requirements, and schedules interviews automatically.',
    icon: Users,
    color: 'from-blue-500 to-cyan-400',
    bgColor: 'bg-blue-500/10',
    features: [
      { icon: Brain, text: 'AI Resume Screening' },
      { icon: Target, text: '95% Match Accuracy' },
      { icon: CalendarCheck, text: 'Auto Scheduling' },
      { icon: MessageSquare, text: 'Candidate Communication' },
    ],
    image: 'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=800&q=80',
    url: 'https://app.seemplifyai.com',
  },
  {
    id: 'leave',
    title: 'Leave Management',
    subtitle: 'Effortless Time-Off',
    description: 'Say goodbye to spreadsheets and email chains. Employees request time off in seconds, managers approve with one click.',
    icon: Calendar,
    color: 'from-green-500 to-emerald-400',
    bgColor: 'bg-green-500/10',
    features: [
      { icon: Clock, text: 'One-Click Requests' },
      { icon: CheckCircle, text: 'Instant Approvals' },
      { icon: PieChart, text: 'Balance Tracking' },
      { icon: Calendar, text: 'Team Calendar View' },
    ],
    image: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=800&q=80',
    url: 'https://leave.seemplifyai.com',
  },
  {
    id: 'performance',
    title: 'Performance',
    subtitle: 'Growth & Feedback',
    description: 'Build high-performing teams with continuous feedback, clear goals, and AI-powered insights that drive improvement.',
    icon: TrendingUp,
    color: 'from-purple-500 to-pink-400',
    bgColor: 'bg-purple-500/10',
    features: [
      { icon: Target, text: 'Goal Tracking' },
      { icon: RefreshCw, text: '360° Reviews' },
      { icon: LineChart, text: 'Progress Analytics' },
      { icon: Award, text: 'Recognition System' },
    ],
    image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=800&q=80',
    url: 'https://performance.seemplifyai.com',
  },
  {
    id: 'payroll',
    title: 'Payroll',
    subtitle: 'Automated Payments',
    description: 'Run payroll in minutes, not hours. Automatic calculations, tax compliance, and seamless payments every time.',
    icon: DollarSign,
    color: 'from-amber-500 to-orange-400',
    bgColor: 'bg-amber-500/10',
    features: [
      { icon: CircleDollarSign, text: 'Auto Calculations' },
      { icon: Shield, text: 'Tax Compliance' },
      { icon: FileSearch, text: 'Detailed Payslips' },
      { icon: Clock, text: 'Scheduled Runs' },
    ],
    image: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=800&q=80',
    url: 'https://payroll.seemplifyai.com',
  },
]

// How it works steps
const howItWorks = [
  {
    step: '01',
    title: 'Sign Up in Seconds',
    description: 'Create your account and set up your organization. No credit card required to get started.',
    icon: Rocket,
    color: 'from-blue-500 to-cyan-500',
  },
  {
    step: '02',
    title: 'Import Your Team',
    description: 'Add employees manually or import from CSV. Set up departments, roles, and permissions.',
    icon: Users,
    color: 'from-purple-500 to-pink-500',
  },
  {
    step: '03',
    title: 'Configure Your Workflows',
    description: 'Customize approval chains, leave policies, performance cycles, and payroll schedules.',
    icon: Settings,
    color: 'from-green-500 to-emerald-500',
  },
  {
    step: '04',
    title: 'Let AI Do the Work',
    description: 'Watch as AI automates repetitive tasks, surfaces insights, and keeps everything running smoothly.',
    icon: Bot,
    color: 'from-amber-500 to-orange-500',
  },
]

// Benefits
const benefits = [
  {
    icon: Clock,
    title: 'Save 20+ Hours/Week',
    description: 'Automate repetitive HR tasks and focus on what matters - your people.',
  },
  {
    icon: Brain,
    title: 'AI-Powered Insights',
    description: 'Get actionable recommendations to improve hiring, retention, and performance.',
  },
  {
    icon: Layers,
    title: 'All-in-One Platform',
    description: 'No more juggling multiple tools. Everything HR in one unified experience.',
  },
  {
    icon: Shield,
    title: 'Enterprise Security',
    description: 'Bank-grade encryption, GDPR compliance, and SOC 2 certification.',
  },
  {
    icon: Globe,
    title: 'Work From Anywhere',
    description: 'Cloud-based platform accessible from any device, anytime, anywhere.',
  },
  {
    icon: HeartHandshake,
    title: 'Dedicated Support',
    description: 'Expert onboarding and ongoing support to ensure your success.',
  },
]

// Integration logos (using placeholder SVGs)
const integrations = [
  { name: 'Slack', icon: MessageSquare },
  { name: 'Google', icon: Mail },
  { name: 'Microsoft', icon: Building2 },
  { name: 'Zoom', icon: Play },
  { name: 'Calendar', icon: Calendar },
  { name: 'Analytics', icon: BarChart3 },
]

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [activeService, setActiveService] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Auto-rotate services
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveService((prev) => (prev + 1) % services.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 text-white overflow-x-hidden">
      {/* Animated Background Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Gradient orbs */}
        <motion.div 
          className="absolute top-20 left-10 w-72 h-72 bg-blue-500/20 rounded-full blur-3xl"
          animate={{ 
            x: [0, 50, 0],
            y: [0, 30, 0],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div 
          className="absolute top-1/3 right-10 w-96 h-96 bg-purple-500/15 rounded-full blur-3xl"
          animate={{ 
            x: [0, -30, 0],
            y: [0, 50, 0],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div 
          className="absolute bottom-20 left-1/3 w-80 h-80 bg-pink-500/15 rounded-full blur-3xl"
          animate={{ 
            x: [0, 40, 0],
            y: [0, -30, 0],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        
        {/* Grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      {/* Header */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'bg-slate-900/90 backdrop-blur-xl border-b border-white/10 shadow-lg' : ''
        }`}
      >
        <nav className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center space-x-3 group">
              <motion.div 
                className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/25"
                whileHover={{ scale: 1.05, rotate: 5 }}
                transition={{ type: "spring", stiffness: 400 }}
              >
                <Sparkles className="w-6 h-6 text-white" />
              </motion.div>
              <div>
                <span className="text-xl font-bold tracking-tight">Seemplify</span>
                <span className="text-xl font-light text-purple-400">AI</span>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center space-x-8">
              <Link href="#services" className="text-slate-300 hover:text-white transition-colors font-medium">
                Products
              </Link>
              <Link href="#how-it-works" className="text-slate-300 hover:text-white transition-colors font-medium">
                How It Works
              </Link>
              <Link href="#benefits" className="text-slate-300 hover:text-white transition-colors font-medium">
                Benefits
              </Link>
              <Link href="#pricing" className="text-slate-300 hover:text-white transition-colors font-medium">
                Pricing
              </Link>
            </div>

            {/* CTA Buttons */}
            <div className="hidden md:flex items-center space-x-4">
              <Link
                href={IDP_URL}
                className="px-5 py-2.5 text-slate-300 hover:text-white transition-colors font-medium"
              >
                Sign In
              </Link>
              <Link
                href={IDP_URL}
                className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl font-semibold hover:from-blue-600 hover:to-purple-700 transition-all shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40"
              >
                Start Free Trial
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <button
              className="lg:hidden p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          {/* Mobile Menu */}
          <AnimatePresence>
            {mobileMenuOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="lg:hidden mt-4 pb-4 border-t border-white/10 pt-4"
              >
                <div className="flex flex-col space-y-4">
                  <Link href="#services" className="text-slate-300 hover:text-white py-2" onClick={() => setMobileMenuOpen(false)}>Products</Link>
                  <Link href="#how-it-works" className="text-slate-300 hover:text-white py-2" onClick={() => setMobileMenuOpen(false)}>How It Works</Link>
                  <Link href="#benefits" className="text-slate-300 hover:text-white py-2" onClick={() => setMobileMenuOpen(false)}>Benefits</Link>
                  <Link href={IDP_URL} className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl font-semibold text-center mt-4">
                    Start Free Trial
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </nav>
      </header>

      {/* Hero Section - Enhanced */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 overflow-hidden">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto text-center">
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-purple-500/20 mb-8"
            >
              <Sparkles className="w-4 h-4 text-purple-400 mr-2" />
              <span className="text-sm font-medium text-purple-300">Introducing the Future of HR Management</span>
            </motion.div>

            {/* Main Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-5xl md:text-6xl lg:text-7xl font-black leading-[1.1] mb-8"
            >
              HR That Works
              <span className="block mt-2 bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                While You Sleep
              </span>
            </motion.h1>

            {/* Subtitle */}
            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-xl md:text-2xl text-slate-300 max-w-3xl mx-auto mb-10 leading-relaxed"
            >
              Recruitment, leave, performance, and payroll — all powered by AI. 
              Automate the mundane so you can focus on what matters: <span className="text-white font-semibold">your people</span>.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-4 justify-center mb-16"
            >
              <Link
                href={IDP_URL}
                className="group inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-xl font-semibold text-lg shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/50 transition-all"
              >
                Get Started Free
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="#demo"
                className="inline-flex items-center justify-center px-8 py-4 bg-white/5 backdrop-blur border border-white/10 rounded-xl font-semibold text-lg hover:bg-white/10 transition-all group"
              >
                <Play className="w-5 h-5 mr-2 group-hover:scale-110 transition-transform" />
                Watch Demo
              </Link>
            </motion.div>

            {/* Hero Illustration */}
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="relative max-w-4xl mx-auto"
            >
              {/* Main Dashboard Mockup */}
              <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-purple-500/20 bg-gradient-to-br from-slate-900 to-slate-800">
                <div className="absolute top-0 left-0 right-0 h-8 bg-slate-800 flex items-center px-4 gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <Image
                  src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80"
                  alt="Seemplify Dashboard"
                  width={1200}
                  height={700}
                  className="w-full object-cover mt-8"
                  priority
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent" />
              </div>

              {/* Floating Cards */}
              <motion.div
                initial={{ opacity: 0, x: -50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.8, duration: 0.5 }}
                className="absolute -left-4 md:-left-12 top-1/4 glass rounded-xl p-4 shadow-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                    <UserCheck className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">New Hire</p>
                    <p className="font-semibold text-white">Sarah joined!</p>
                  </div>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1, duration: 0.5 }}
                className="absolute -right-4 md:-right-12 top-1/3 glass rounded-xl p-4 shadow-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-400 to-cyan-500 flex items-center justify-center">
                    <Brain className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">AI Match</p>
                    <p className="font-semibold text-white">95% accuracy</p>
                  </div>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.2, duration: 0.5 }}
                className="absolute left-1/4 -bottom-6 glass rounded-xl p-4 shadow-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center">
                    <ClipboardCheck className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Leave Approved</p>
                    <p className="font-semibold text-white">In 2 seconds</p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Brands/Trust Section */}
      <section className="py-12 relative z-10 border-y border-white/5">
        <div className="container mx-auto px-4">
          <p className="text-center text-slate-500 text-sm mb-8">INTEGRATES WITH YOUR FAVORITE TOOLS</p>
          <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16">
            {integrations.map((integration, index) => (
              <motion.div
                key={integration.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-300 transition-colors"
              >
                <integration.icon className="w-6 h-6" />
                <span className="font-medium">{integration.name}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Services Section - Enhanced with Visual Cards */}
      <section id="services" className="py-24 relative z-10">
        <div className="container mx-auto px-4">
          {/* Section Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-sm font-medium mb-6">
              <Layers className="w-4 h-4 mr-2" />
              Complete HR Suite
            </span>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Everything You Need,
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                Nothing You Don&apos;t
              </span>
            </h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              Four powerful modules that work together seamlessly. Start with what you need, add more as you grow.
            </p>
          </motion.div>

          {/* Service Cards with Interactive Preview */}
          <div className="grid lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
            {services.map((service, index) => (
              <motion.div
                key={service.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="group relative"
              >
                <div className="glass rounded-2xl overflow-hidden hover:border-white/20 transition-all duration-300">
                  {/* Image Header */}
                  <div className="relative h-48 overflow-hidden">
                    <Image
                      src={service.image}
                      alt={service.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent" />
                    
                    {/* Icon Badge */}
                    <div className={`absolute top-4 left-4 p-3 rounded-xl bg-gradient-to-br ${service.color} shadow-lg`}>
                      <service.icon className="w-6 h-6 text-white" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-2xl font-bold mb-1">{service.title}</h3>
                        <p className={`text-sm font-medium bg-gradient-to-r ${service.color} bg-clip-text text-transparent`}>
                          {service.subtitle}
                        </p>
                      </div>
                    </div>
                    
                    <p className="text-slate-400 mb-6">{service.description}</p>

                    {/* Features */}
                    <div className="grid grid-cols-2 gap-3 mb-6">
                      {service.features.map((feature, fIndex) => (
                        <div key={fIndex} className="flex items-center text-sm text-slate-300">
                          <feature.icon className="w-4 h-4 mr-2 text-slate-500" />
                          {feature.text}
                        </div>
                      ))}
                    </div>

                    {/* CTA */}
                    <Link
                      href={service.url}
                      className={`inline-flex items-center px-5 py-2.5 rounded-lg bg-gradient-to-r ${service.color} text-white font-medium group/btn hover:shadow-lg transition-all`}
                    >
                      Explore {service.title}
                      <ChevronRight className="w-4 h-4 ml-1 group-hover/btn:translate-x-1 transition-transform" />
                    </Link>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works - Visual Process */}
      <section id="how-it-works" className="py-24 relative z-10 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-purple-500/5 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm font-medium mb-6">
              <Workflow className="w-4 h-4 mr-2" />
              Simple Setup
            </span>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Up and Running in
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
                Under 10 Minutes
              </span>
            </h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              No complex implementation. No lengthy onboarding. Just sign up and start transforming your HR.
            </p>
          </motion.div>

          {/* Process Steps */}
          <div className="max-w-5xl mx-auto">
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {howItWorks.map((step, index) => (
                <motion.div
                  key={step.step}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.15 }}
                  className="relative"
                >
                  {/* Connector Line */}
                  {index < howItWorks.length - 1 && (
                    <div className="hidden lg:block absolute top-12 left-full w-full h-0.5 bg-gradient-to-r from-white/20 to-transparent -translate-y-1/2 z-0" />
                  )}
                  
                  <div className="glass rounded-2xl p-6 h-full relative z-10 hover:bg-white/10 transition-all group">
                    {/* Step Number */}
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                      <step.icon className="w-6 h-6 text-white" />
                    </div>
                    
                    {/* Step Label */}
                    <span className={`text-xs font-bold bg-gradient-to-r ${step.color} bg-clip-text text-transparent`}>
                      STEP {step.step}
                    </span>
                    
                    <h3 className="text-xl font-bold mt-2 mb-3">{step.title}</h3>
                    <p className="text-slate-400 text-sm">{step.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Visual Process Illustration */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-20 relative"
          >
            <div className="glass rounded-2xl p-8 max-w-4xl mx-auto">
              <div className="grid md:grid-cols-3 gap-8 items-center">
                {/* Before */}
                <div className="text-center">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <X className="w-10 h-10 text-red-400" />
                  </div>
                  <h4 className="font-semibold mb-2">Before Seemplify</h4>
                  <ul className="text-sm text-slate-400 space-y-1">
                    <li>Manual spreadsheets</li>
                    <li>Email chaos</li>
                    <li>Hours of admin work</li>
                    <li>No visibility</li>
                  </ul>
                </div>

                {/* Arrow */}
                <div className="flex justify-center">
                  <motion.div
                    animate={{ x: [0, 10, 0] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center shadow-lg shadow-purple-500/30"
                  >
                    <ArrowRight className="w-8 h-8 text-white" />
                  </motion.div>
                </div>

                {/* After */}
                <div className="text-center">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                    <CheckCircle className="w-10 h-10 text-green-400" />
                  </div>
                  <h4 className="font-semibold mb-2">After Seemplify</h4>
                  <ul className="text-sm text-slate-400 space-y-1">
                    <li>Everything automated</li>
                    <li>One dashboard</li>
                    <li>AI does the work</li>
                    <li>Real-time insights</li>
                  </ul>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Benefits Section */}
      <section id="benefits" className="py-24 relative z-10">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-green-500/10 border border-green-500/20 text-green-300 text-sm font-medium mb-6">
              <Zap className="w-4 h-4 mr-2" />
              Why Choose Us
            </span>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Built Different,
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-400">
                Works Better
              </span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {benefits.map((benefit, index) => (
              <motion.div
                key={benefit.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="glass rounded-2xl p-6 hover:bg-white/10 transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <benefit.icon className="w-6 h-6 text-green-400" />
                </div>
                <h3 className="text-xl font-bold mb-2">{benefit.title}</h3>
                <p className="text-slate-400">{benefit.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Teaser */}
      <section id="pricing" className="py-24 relative z-10">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass rounded-3xl p-8 md:p-16 max-w-4xl mx-auto text-center relative overflow-hidden"
          >
            {/* Background gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10" />
            
            <div className="relative z-10">
              <span className="inline-flex items-center px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm font-medium mb-6">
                <Sparkles className="w-4 h-4 mr-2" />
                Launch Offer
              </span>
              
              <h2 className="text-4xl md:text-5xl font-bold mb-6">
                Start Free,
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-400">
                  Scale When Ready
                </span>
              </h2>
              
              <p className="text-xl text-slate-300 mb-8 max-w-2xl mx-auto">
                Try Seemplify AI free for 14 days. No credit card required. 
                Cancel anytime. See why modern HR teams are switching.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href={IDP_URL}
                  className="group inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl font-semibold text-lg shadow-2xl shadow-orange-500/30 hover:shadow-orange-500/50 transition-all"
                >
                  Start Your Free Trial
                  <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                <Link
                  href="#contact"
                  className="inline-flex items-center justify-center px-8 py-4 bg-white/5 border border-white/10 rounded-xl font-semibold text-lg hover:bg-white/10 transition-all"
                >
                  Talk to Sales
                </Link>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-6 mt-8 text-sm text-slate-400">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>14-day free trial</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>No credit card</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>Full features</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 relative z-10">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center max-w-3xl mx-auto"
          >
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Ready to Transform
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
                Your HR Forever?
              </span>
            </h2>
            <p className="text-xl text-slate-400 mb-10">
              Join forward-thinking companies who are already experiencing the future of HR management.
            </p>
            <Link
              href={IDP_URL}
              className="group inline-flex items-center justify-center px-10 py-5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-xl font-semibold text-lg shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/50 transition-all"
            >
              Get Started Now — It&apos;s Free
              <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 border-t border-white/10 relative z-10">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-5 gap-8 mb-12">
            {/* Brand */}
            <div className="md:col-span-2 space-y-4">
              <Link href="/" className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <div>
                  <span className="text-xl font-bold">Seemplify</span>
                  <span className="text-xl font-light text-purple-400">AI</span>
                </div>
              </Link>
              <p className="text-slate-400 max-w-sm">
                AI-powered HR management for modern teams. Automate recruitment, leave, performance, and payroll.
              </p>
            </div>

            {/* Products */}
            <div>
              <h4 className="font-semibold mb-4">Products</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link href="https://app.seemplifyai.com" className="hover:text-white transition-colors">SmartHR</Link></li>
                <li><Link href="https://leave.seemplifyai.com" className="hover:text-white transition-colors">Leave Management</Link></li>
                <li><Link href="https://performance.seemplifyai.com" className="hover:text-white transition-colors">Performance</Link></li>
                <li><Link href="https://payroll.seemplifyai.com" className="hover:text-white transition-colors">Payroll</Link></li>
              </ul>
            </div>

            {/* Company */}
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link href="#" className="hover:text-white transition-colors">About Us</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Careers</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Blog</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Contact</Link></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link href="#" className="hover:text-white transition-colors">Privacy</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Terms</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Security</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-slate-500 text-sm">
              © 2025 Seemplify AI. All rights reserved.
            </p>
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Lock className="w-4 h-4" />
              <span>Enterprise-grade security</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
