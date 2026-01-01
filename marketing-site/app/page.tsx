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
  Target,
  Briefcase,
  ChevronRight,
  Play,
  Workflow,
  Layers,
  Globe,
  Lock,
  MessageSquare,
  PieChart,
  Award,
  FileText,
  UserCheck,
  CalendarCheck,
  ClipboardCheck,
  LineChart,
  Mail,
  Building2,
  Search,
  Filter,
  Video,
  Bell,
  FileSearch,
  Megaphone,
  Send,
  ListChecks,
  Timer,
  Wallet,
  Receipt,
  Calculator,
  UserPlus,
  GitBranch,
  MessageCircle,
  Star,
} from 'lucide-react'

const IDP_URL = 'https://auth.seemplifyai.com'

// Services data with accurate descriptions
const services = [
  {
    id: 'smarthr',
    title: 'SmartHR Recruiting',
    subtitle: 'Applicant Tracking System',
    description: 'A complete recruiting platform to source, track, and hire the best candidates. From job posting to offer letter.',
    icon: Users,
    color: 'from-blue-500 to-cyan-400',
    bgColor: 'bg-blue-500/10',
    features: [
      { icon: Megaphone, text: 'Job Posting & Distribution' },
      { icon: GitBranch, text: 'Customizable Pipelines' },
      { icon: CalendarCheck, text: 'Interview Scheduling' },
      { icon: Video, text: 'AI Notetaker Integration' },
      { icon: FileSearch, text: 'CV Parsing & Screening' },
      { icon: ClipboardCheck, text: 'Feedback & Scorecards' },
    ],
    image: 'https://images.unsplash.com/photo-1600880292203-757bb62b4baf?auto=format&fit=crop&w=800&q=80',
    url: 'https://app.seemplifyai.com',
  },
  {
    id: 'leave',
    title: 'Leave Management',
    subtitle: 'Time-Off & Attendance',
    description: 'Simplify leave requests, approvals, and balance tracking. Keep your team organized with clear visibility.',
    icon: Calendar,
    color: 'from-green-500 to-emerald-400',
    bgColor: 'bg-green-500/10',
    features: [
      { icon: Send, text: 'Easy Leave Requests' },
      { icon: CheckCircle, text: 'Manager Approvals' },
      { icon: PieChart, text: 'Balance Tracking' },
      { icon: Calendar, text: 'Team Calendar View' },
      { icon: ListChecks, text: 'Custom Leave Policies' },
      { icon: Bell, text: 'Notifications & Alerts' },
    ],
    image: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=800&q=80',
    url: 'https://leave.seemplifyai.com',
  },
  {
    id: 'performance',
    title: 'Performance Management',
    subtitle: 'Reviews, OKRs & Feedback',
    description: 'Drive growth with structured reviews, goal tracking, and continuous feedback. Build high-performing teams.',
    icon: TrendingUp,
    color: 'from-purple-500 to-pink-400',
    bgColor: 'bg-purple-500/10',
    features: [
      { icon: Target, text: 'OKRs & Goal Setting' },
      { icon: Star, text: '360° Reviews' },
      { icon: MessageCircle, text: 'Continuous Feedback' },
      { icon: Users, text: 'One-on-Ones' },
      { icon: LineChart, text: 'Development Plans' },
      { icon: BarChart3, text: 'Analytics & Reports' },
    ],
    image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=800&q=80',
    url: 'https://performance.seemplifyai.com',
  },
  {
    id: 'payroll',
    title: 'Payroll',
    subtitle: 'Compensation & Payments',
    description: 'Streamline payroll processing with automated calculations, compliance tools, and detailed payslips.',
    icon: DollarSign,
    color: 'from-amber-500 to-orange-400',
    bgColor: 'bg-amber-500/10',
    features: [
      { icon: Calculator, text: 'Payroll Processing' },
      { icon: Receipt, text: 'Payslip Generation' },
      { icon: Shield, text: 'Tax Compliance' },
      { icon: Wallet, text: 'Compensation Management' },
      { icon: Timer, text: 'Scheduled Runs' },
      { icon: FileText, text: 'Detailed Reports' },
    ],
    image: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=800&q=80',
    url: 'https://payroll.seemplifyai.com',
  },
]

// SmartHR detailed features
const recruitingFeatures = [
  {
    category: 'Candidate Sourcing',
    icon: Search,
    features: [
      'Job posting to multiple boards',
      'Careers page builder',
      'CV parsing and screening',
      'Candidate database management',
    ]
  },
  {
    category: 'Applicant Tracking',
    icon: GitBranch,
    features: [
      'Customizable hiring pipelines',
      'Stage-based candidate management',
      'Team collaboration tools',
      'Email templates & automation',
    ]
  },
  {
    category: 'Interview Management',
    icon: Video,
    features: [
      'Self-service scheduling',
      'Calendar integrations',
      'AI meeting notetaker',
      'Structured feedback forms',
    ]
  },
  {
    category: 'Hiring & Analytics',
    icon: BarChart3,
    features: [
      'Offer letter workflows',
      'Hiring analytics & reports',
      'Department management',
      'Multi-currency support',
    ]
  },
]

// Benefits
const benefits = [
  {
    icon: Layers,
    title: 'All-in-One Platform',
    description: 'Recruiting, leave, performance, and payroll in one unified system. No more switching between tools.',
  },
  {
    icon: Workflow,
    title: 'Streamlined Workflows',
    description: 'Customizable pipelines and approval flows that match how your team actually works.',
  },
  {
    icon: BarChart3,
    title: 'Actionable Insights',
    description: 'Built-in analytics and reports to help you make data-driven HR decisions.',
  },
  {
    icon: Shield,
    title: 'Secure & Compliant',
    description: 'Enterprise-grade security with role-based access controls and audit trails.',
  },
  {
    icon: Globe,
    title: 'Work From Anywhere',
    description: 'Cloud-based platform accessible from any device. Your HR data, always available.',
  },
  {
    icon: Zap,
    title: 'Quick Setup',
    description: 'Get started in minutes. Import your data, configure your workflows, and go live.',
  },
]

// Integration logos
const integrations = [
  { name: 'Calendar', icon: Calendar },
  { name: 'Email', icon: Mail },
  { name: 'Video', icon: Video },
  { name: 'Slack', icon: MessageSquare },
  { name: 'Analytics', icon: BarChart3 },
]

export default function HomePage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 text-white overflow-x-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div 
          className="absolute top-20 left-10 w-72 h-72 bg-blue-500/20 rounded-full blur-3xl"
          animate={{ x: [0, 50, 0], y: [0, 30, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div 
          className="absolute top-1/3 right-10 w-96 h-96 bg-purple-500/15 rounded-full blur-3xl"
          animate={{ x: [0, -30, 0], y: [0, 50, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div 
          className="absolute bottom-20 left-1/3 w-80 h-80 bg-pink-500/15 rounded-full blur-3xl"
          animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
      </div>

      {/* Header */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-slate-900/90 backdrop-blur-xl border-b border-white/10 shadow-lg' : ''
      }`}>
        <nav className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center space-x-3 group">
              <motion.div 
                className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/25"
                whileHover={{ scale: 1.05, rotate: 5 }}
              >
                <Sparkles className="w-6 h-6 text-white" />
              </motion.div>
              <div>
                <span className="text-xl font-bold tracking-tight">Seemplify</span>
                <span className="text-xl font-light text-purple-400">AI</span>
              </div>
            </Link>

            <div className="hidden lg:flex items-center space-x-8">
              <Link href="#products" className="text-slate-300 hover:text-white transition-colors font-medium">Products</Link>
              <Link href="#features" className="text-slate-300 hover:text-white transition-colors font-medium">Features</Link>
              <Link href="#benefits" className="text-slate-300 hover:text-white transition-colors font-medium">Why Us</Link>
              <Link href="#pricing" className="text-slate-300 hover:text-white transition-colors font-medium">Pricing</Link>
            </div>

            <div className="hidden md:flex items-center space-x-4">
              <Link href={IDP_URL} className="px-5 py-2.5 text-slate-300 hover:text-white transition-colors font-medium">
                Sign In
              </Link>
              <Link href={IDP_URL} className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl font-semibold hover:from-blue-600 hover:to-purple-700 transition-all shadow-lg shadow-purple-500/25">
                Start Free Trial
              </Link>
            </div>

            <button className="lg:hidden p-2 text-white" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>

          <AnimatePresence>
            {mobileMenuOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="lg:hidden mt-4 pb-4 border-t border-white/10 pt-4"
              >
                <div className="flex flex-col space-y-4">
                  <Link href="#products" className="text-slate-300 hover:text-white py-2" onClick={() => setMobileMenuOpen(false)}>Products</Link>
                  <Link href="#features" className="text-slate-300 hover:text-white py-2" onClick={() => setMobileMenuOpen(false)}>Features</Link>
                  <Link href="#benefits" className="text-slate-300 hover:text-white py-2" onClick={() => setMobileMenuOpen(false)}>Why Us</Link>
                  <Link href={IDP_URL} className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl font-semibold text-center mt-4">
                    Start Free Trial
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 overflow-hidden">
        <div className="container mx-auto px-4">
          <div className="max-w-5xl mx-auto text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-purple-500/20 mb-8"
            >
              <Sparkles className="w-4 h-4 text-purple-400 mr-2" />
              <span className="text-sm font-medium text-purple-300">All-in-One HR Platform</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-5xl md:text-6xl lg:text-7xl font-black leading-[1.1] mb-8"
            >
              Find, Hire, and Manage
              <span className="block mt-2 bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                Your Best People
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xl md:text-2xl text-slate-300 max-w-3xl mx-auto mb-10 leading-relaxed"
            >
              The complete HR platform for growing teams. Recruiting, leave management, 
              performance reviews, and payroll — all in one place.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-4 justify-center mb-16"
            >
              <Link
                href={IDP_URL}
                className="group inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-xl font-semibold text-lg shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/50 transition-all"
              >
                Start Free Trial
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="#products"
                className="inline-flex items-center justify-center px-8 py-4 bg-white/5 backdrop-blur border border-white/10 rounded-xl font-semibold text-lg hover:bg-white/10 transition-all"
              >
                Explore Products
              </Link>
            </motion.div>

            {/* Hero Illustration */}
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="relative max-w-4xl mx-auto"
            >
              <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-purple-500/20 bg-gradient-to-br from-slate-900 to-slate-800">
                <div className="absolute top-0 left-0 right-0 h-8 bg-slate-800 flex items-center px-4 gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <Image
                  src="https://images.unsplash.com/photo-1531973576160-7125cd663d86?auto=format&fit=crop&w=1200&q=80"
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
                transition={{ delay: 0.8 }}
                className="absolute -left-4 md:-left-12 top-1/4 glass rounded-xl p-4 shadow-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
                    <UserPlus className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">New Application</p>
                    <p className="font-semibold text-white">Sarah Chen</p>
                  </div>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1 }}
                className="absolute -right-4 md:-right-12 top-1/3 glass rounded-xl p-4 shadow-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-400 to-cyan-500 flex items-center justify-center">
                    <CalendarCheck className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Interview</p>
                    <p className="font-semibold text-white">Scheduled</p>
                  </div>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.2 }}
                className="absolute left-1/4 -bottom-6 glass rounded-xl p-4 shadow-xl"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center">
                    <CheckCircle className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Leave Request</p>
                    <p className="font-semibold text-white">Approved</p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Integrations Strip */}
      <section className="py-12 relative z-10 border-y border-white/5">
        <div className="container mx-auto px-4">
          <p className="text-center text-slate-500 text-sm mb-8">INTEGRATES WITH YOUR TOOLS</p>
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

      {/* Products Section */}
      <section id="products" className="py-24 relative z-10">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-sm font-medium mb-6">
              <Layers className="w-4 h-4 mr-2" />
              Our Products
            </span>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Everything You Need to
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                Manage Your Team
              </span>
            </h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              Four powerful modules that work together. Start with what you need, add more as you grow.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8 max-w-6xl mx-auto">
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
                  <div className="relative h-48 overflow-hidden">
                    <Image
                      src={service.image}
                      alt={service.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/60 to-transparent" />
                    <div className={`absolute top-4 left-4 p-3 rounded-xl bg-gradient-to-br ${service.color} shadow-lg`}>
                      <service.icon className="w-6 h-6 text-white" />
                    </div>
                  </div>

                  <div className="p-6">
                    <div className="mb-4">
                      <h3 className="text-2xl font-bold mb-1">{service.title}</h3>
                      <p className={`text-sm font-medium bg-gradient-to-r ${service.color} bg-clip-text text-transparent`}>
                        {service.subtitle}
                      </p>
                    </div>
                    
                    <p className="text-slate-400 mb-6">{service.description}</p>

                    <div className="grid grid-cols-2 gap-3 mb-6">
                      {service.features.map((feature, fIndex) => (
                        <div key={fIndex} className="flex items-center text-sm text-slate-300">
                          <feature.icon className="w-4 h-4 mr-2 text-slate-500" />
                          {feature.text}
                        </div>
                      ))}
                    </div>

                    <Link
                      href={service.url}
                      className={`inline-flex items-center px-5 py-2.5 rounded-lg bg-gradient-to-r ${service.color} text-white font-medium group/btn hover:shadow-lg transition-all`}
                    >
                      Learn More
                      <ChevronRight className="w-4 h-4 ml-1 group-hover/btn:translate-x-1 transition-transform" />
                    </Link>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* SmartHR Features Deep Dive */}
      <section id="features" className="py-24 relative z-10 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500/5 rounded-full blur-3xl" />
        
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm font-medium mb-6">
              <Users className="w-4 h-4 mr-2" />
              SmartHR Recruiting
            </span>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Your Complete
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
                Applicant Tracking System
              </span>
            </h2>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              Everything you need to find, evaluate, and hire the best candidates — from sourcing to offer.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {recruitingFeatures.map((category, index) => (
              <motion.div
                key={category.category}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="glass rounded-2xl p-6 hover:bg-white/10 transition-all"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center mb-4">
                  <category.icon className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="text-lg font-bold mb-4">{category.category}</h3>
                <ul className="space-y-2">
                  {category.features.map((feature, fIndex) => (
                    <li key={fIndex} className="flex items-start text-sm text-slate-400">
                      <CheckCircle className="w-4 h-4 mr-2 text-blue-400 mt-0.5 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>

          {/* Feature Highlight */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-16 glass rounded-2xl p-8 max-w-4xl mx-auto"
          >
            <div className="grid md:grid-cols-2 gap-8 items-center">
              <div>
                <h3 className="text-2xl font-bold mb-4">Interview Management Made Simple</h3>
                <p className="text-slate-400 mb-6">
                  Schedule interviews, collect feedback, and make better hiring decisions — all in one place.
                </p>
                <ul className="space-y-3">
                  {[
                    'Self-service scheduling with calendar sync',
                    'Customizable interview stages',
                    'Structured feedback forms and scorecards',
                    'AI notetaker for automatic meeting summaries',
                  ].map((item, index) => (
                    <li key={index} className="flex items-center text-slate-300">
                      <CheckCircle className="w-5 h-5 mr-3 text-green-400" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="relative">
                <Image
                  src="https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=600&q=80"
                  alt="Interview Management"
                  width={600}
                  height={400}
                  className="rounded-xl"
                />
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
              <Award className="w-4 h-4 mr-2" />
              Why Seemplify
            </span>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Built for Growing
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-emerald-400">
                Teams Like Yours
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

      {/* CTA Section */}
      <section id="pricing" className="py-24 relative z-10">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass rounded-3xl p-8 md:p-16 max-w-4xl mx-auto text-center relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10" />
            
            <div className="relative z-10">
              <span className="inline-flex items-center px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm font-medium mb-6">
                <Sparkles className="w-4 h-4 mr-2" />
                Get Started Today
              </span>
              
              <h2 className="text-4xl md:text-5xl font-bold mb-6">
                Ready to Simplify
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-400">
                  Your HR?
                </span>
              </h2>
              
              <p className="text-xl text-slate-300 mb-8 max-w-2xl mx-auto">
                Start your free trial today. No credit card required. 
                Set up in minutes, not days.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href={IDP_URL}
                  className="group inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-500 rounded-xl font-semibold text-lg shadow-2xl shadow-orange-500/30 hover:shadow-orange-500/50 transition-all"
                >
                  Start Free Trial
                  <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                <Link
                  href="mailto:hello@seemplifyai.com"
                  className="inline-flex items-center justify-center px-8 py-4 bg-white/5 border border-white/10 rounded-xl font-semibold text-lg hover:bg-white/10 transition-all"
                >
                  Contact Sales
                </Link>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-6 mt-8 text-sm text-slate-400">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>14-day free trial</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span>Cancel anytime</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 border-t border-white/10 relative z-10">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-5 gap-8 mb-12">
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
                The all-in-one HR platform for modern teams. Recruiting, leave management, performance reviews, and payroll.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Products</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link href="https://app.seemplifyai.com" className="hover:text-white transition-colors">SmartHR Recruiting</Link></li>
                <li><Link href="https://leave.seemplifyai.com" className="hover:text-white transition-colors">Leave Management</Link></li>
                <li><Link href="https://performance.seemplifyai.com" className="hover:text-white transition-colors">Performance</Link></li>
                <li><Link href="https://payroll.seemplifyai.com" className="hover:text-white transition-colors">Payroll</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link href="#" className="hover:text-white transition-colors">About</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Blog</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Careers</Link></li>
                <li><Link href="mailto:hello@seemplifyai.com" className="hover:text-white transition-colors">Contact</Link></li>
              </ul>
            </div>

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
            <p className="text-slate-500 text-sm">© 2025 Seemplify AI. All rights reserved.</p>
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
