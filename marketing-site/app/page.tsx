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
  Star,
  Menu,
  X,
  Sparkles,
  BarChart3,
  Clock,
  Award,
  Brain,
  FileText,
  PieChart,
  Target,
  Briefcase,
  HeartHandshake,
  ChevronRight,
} from 'lucide-react'

const IDP_URL = 'https://auth.seemplifyai.com'

// Services data
const services = [
  {
    id: 'smarthr',
    title: 'SmartHR',
    subtitle: 'AI-Powered Recruitment',
    description: 'Transform your hiring process with AI-driven candidate matching, automated screening, and intelligent interview scheduling.',
    icon: Users,
    color: 'from-blue-500 to-cyan-400',
    features: ['AI Candidate Matching', 'Automated Screening', 'Smart Scheduling', 'Analytics Dashboard'],
    image: 'https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?auto=format&fit=crop&w=800&q=80',
    url: 'https://app.seemplifyai.com',
  },
  {
    id: 'leave',
    title: 'Leave Management',
    subtitle: 'Effortless Time-Off Tracking',
    description: 'Streamline leave requests, approvals, and tracking with an intuitive system that keeps your team organized.',
    icon: Calendar,
    color: 'from-green-500 to-emerald-400',
    features: ['Easy Leave Requests', 'Manager Approvals', 'Calendar Integration', 'Balance Tracking'],
    image: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=800&q=80',
    url: 'https://leave.seemplifyai.com',
  },
  {
    id: 'performance',
    title: 'Performance Management',
    subtitle: 'Data-Driven Growth',
    description: 'Empower your workforce with continuous feedback, goal tracking, and AI-powered performance insights.',
    icon: TrendingUp,
    color: 'from-purple-500 to-pink-400',
    features: ['360° Reviews', 'Goal Setting', 'Real-time Feedback', 'Growth Analytics'],
    image: 'https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=800&q=80',
    url: 'https://performance.seemplifyai.com',
  },
  {
    id: 'payroll',
    title: 'Payroll',
    subtitle: 'Automated Compensation',
    description: 'Simplify payroll processing with automated calculations, tax compliance, and seamless integrations.',
    icon: DollarSign,
    color: 'from-amber-500 to-orange-400',
    features: ['Auto Calculations', 'Tax Compliance', 'Direct Deposits', 'Payslip Generation'],
    image: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=800&q=80',
    url: 'https://payroll.seemplifyai.com',
  },
]

// Stats data
const stats = [
  { value: '95%', label: 'AI Match Accuracy', icon: Brain },
  { value: '62%', label: 'Faster Hiring', icon: Clock },
  { value: '10K+', label: 'Active Users', icon: Users },
  { value: '99.9%', label: 'Uptime', icon: Shield },
]

// Features data
const features = [
  {
    icon: Brain,
    title: 'AI-Powered Intelligence',
    description: 'Leverage machine learning algorithms for smarter decisions across all HR processes.',
  },
  {
    icon: Shield,
    title: 'Enterprise Security',
    description: 'Bank-grade encryption and compliance with GDPR, SOC 2, and industry standards.',
  },
  {
    icon: Zap,
    title: 'Lightning Fast',
    description: 'Real-time processing and instant updates across your entire organization.',
  },
  {
    icon: BarChart3,
    title: 'Advanced Analytics',
    description: 'Comprehensive dashboards and reports for data-driven HR decisions.',
  },
  {
    icon: HeartHandshake,
    title: 'Seamless Integration',
    description: 'Connect with your existing tools including Slack, Teams, and calendar apps.',
  },
  {
    icon: Award,
    title: 'World-Class Support',
    description: '24/7 dedicated support team to help you succeed with our platform.',
  },
]

// Testimonials
const testimonials = [
  {
    quote: "Seemplify AI reduced our time-to-hire by 60% while improving candidate quality. It's transformed how we recruit.",
    author: 'Sarah Johnson',
    role: 'Head of Talent Acquisition',
    company: 'TechCorp Global',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80',
  },
  {
    quote: "The integrated HR suite has simplified our operations tremendously. Leave, performance, and payroll all in one place.",
    author: 'Michael Chen',
    role: 'HR Director',
    company: 'Innovation Labs',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80',
  },
  {
    quote: "Best investment we made for our HR department. The AI insights are incredibly accurate and actionable.",
    author: 'Emily Rodriguez',
    role: 'CEO',
    company: 'StartupXYZ',
    avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=150&q=80',
  },
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
      {/* Background decorations */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'bg-slate-900/80 backdrop-blur-lg border-b border-white/10' : ''
        }`}
      >
        <nav className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/" className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold">Seemplify</span>
                <span className="text-xl font-light text-purple-400">AI</span>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-8">
              <Link href="#services" className="text-slate-300 hover:text-white transition-colors">
                Services
              </Link>
              <Link href="#features" className="text-slate-300 hover:text-white transition-colors">
                Features
              </Link>
              <Link href="#testimonials" className="text-slate-300 hover:text-white transition-colors">
                Testimonials
              </Link>
              <Link href="#contact" className="text-slate-300 hover:text-white transition-colors">
                Contact
              </Link>
            </div>

            {/* CTA Buttons */}
            <div className="hidden md:flex items-center space-x-4">
              <Link
                href={IDP_URL}
                className="px-4 py-2 text-slate-300 hover:text-white transition-colors"
              >
                Sign In
              </Link>
              <Link
                href={IDP_URL}
                className="px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg font-medium hover:from-blue-600 hover:to-purple-700 transition-all shadow-lg shadow-purple-500/25"
              >
                Get Started
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2 text-white"
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
                className="md:hidden mt-4 pb-4"
              >
                <div className="flex flex-col space-y-4">
                  <Link href="#services" className="text-slate-300 hover:text-white" onClick={() => setMobileMenuOpen(false)}>
                    Services
                  </Link>
                  <Link href="#features" className="text-slate-300 hover:text-white" onClick={() => setMobileMenuOpen(false)}>
                    Features
                  </Link>
                  <Link href="#testimonials" className="text-slate-300 hover:text-white" onClick={() => setMobileMenuOpen(false)}>
                    Testimonials
                  </Link>
                  <Link
                    href={IDP_URL}
                    className="px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg font-medium text-center"
                  >
                    Get Started
                  </Link>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 md:pt-40 md:pb-32">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Hero Content */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="space-y-8"
            >
              <div className="inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20">
                <Sparkles className="w-4 h-4 text-blue-400 mr-2" />
                <span className="text-sm text-blue-300">AI-Powered HR Platform</span>
              </div>

              <h1 className="text-5xl md:text-6xl lg:text-7xl font-black leading-tight">
                Transform Your
                <span className="block bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  HR Operations
                </span>
              </h1>

              <p className="text-xl text-slate-300 max-w-xl leading-relaxed">
                One platform for all your HR needs. AI-powered recruitment, leave management, 
                performance reviews, and payroll — seamlessly integrated and beautifully simple.
              </p>

              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  href={IDP_URL}
                  className="group inline-flex items-center justify-center px-8 py-4 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-xl font-semibold text-lg shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/50 transition-all"
                >
                  Start Free Trial
                  <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                <Link
                  href="#services"
                  className="inline-flex items-center justify-center px-8 py-4 bg-white/5 backdrop-blur border border-white/10 rounded-xl font-semibold text-lg hover:bg-white/10 transition-all"
                >
                  Explore Services
                </Link>
              </div>

              {/* Trust badges */}
              <div className="flex items-center gap-6 pt-4">
                <div className="flex -space-x-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="w-10 h-10 rounded-full border-2 border-slate-900 overflow-hidden">
                      <Image
                        src={`https://images.unsplash.com/photo-${1507003211169 + i * 10000000}-0a1dd7228f2d?auto=format&fit=crop&w=100&q=80`}
                        alt="User"
                        width={40}
                        height={40}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex items-center">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                    ))}
                  </div>
                  <p className="text-sm text-slate-400">Trusted by 10,000+ HR professionals</p>
                </div>
              </div>
            </motion.div>

            {/* Hero Image */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="relative"
            >
              <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
                <Image
                  src="https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=800&q=80"
                  alt="HR Dashboard"
                  width={800}
                  height={600}
                  className="w-full object-cover"
                  priority
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />

                {/* Floating stats */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.8 }}
                  className="absolute top-6 left-6 glass rounded-xl p-4"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-green-500/20 rounded-lg">
                      <TrendingUp className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Hiring Efficiency</p>
                      <p className="font-bold text-white">+62%</p>
                    </div>
                  </div>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1 }}
                  className="absolute bottom-6 right-6 glass rounded-xl p-4"
                >
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-blue-500/20 rounded-lg">
                      <Brain className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">AI Match Rate</p>
                      <p className="font-bold text-white">95.8%</p>
                    </div>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 relative z-10">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {stats.map((stat, index) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="glass rounded-2xl p-6 text-center"
              >
                <stat.icon className="w-8 h-8 mx-auto mb-3 text-purple-400" />
                <p className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  {stat.value}
                </p>
                <p className="text-slate-400 text-sm mt-1">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section id="services" className="py-20 relative z-10">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-sm font-medium mb-6">
              <Briefcase className="w-4 h-4 mr-2" />
              Our Services
            </span>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Complete HR Suite for
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                Modern Businesses
              </span>
            </h2>
            <p className="text-xl text-slate-300 max-w-3xl mx-auto">
              Everything you need to manage your workforce, from recruitment to retirement, 
              powered by artificial intelligence.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8">
            {services.map((service, index) => (
              <motion.div
                key={service.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="group glass rounded-2xl overflow-hidden hover:border-white/20 transition-all"
              >
                <div className="aspect-video relative overflow-hidden">
                  <Image
                    src={service.image}
                    alt={service.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/50 to-transparent" />
                  <div className={`absolute top-4 left-4 p-3 rounded-xl bg-gradient-to-br ${service.color}`}>
                    <service.icon className="w-6 h-6 text-white" />
                  </div>
                </div>

                <div className="p-6 space-y-4">
                  <div>
                    <h3 className="text-2xl font-bold mb-1">{service.title}</h3>
                    <p className="text-purple-400 text-sm">{service.subtitle}</p>
                  </div>
                  <p className="text-slate-300">{service.description}</p>

                  <div className="grid grid-cols-2 gap-2">
                    {service.features.map((feature) => (
                      <div key={feature} className="flex items-center text-sm text-slate-400">
                        <CheckCircle className="w-4 h-4 text-green-400 mr-2 flex-shrink-0" />
                        {feature}
                      </div>
                    ))}
                  </div>

                  <Link
                    href={service.url}
                    className="inline-flex items-center text-blue-400 hover:text-blue-300 font-medium group/link"
                  >
                    Learn More
                    <ChevronRight className="w-4 h-4 ml-1 group-hover/link:translate-x-1 transition-transform" />
                  </Link>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 relative z-10">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm font-medium mb-6">
              <Zap className="w-4 h-4 mr-2" />
              Why Seemplify AI
            </span>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Built for the Future of
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                Human Resources
              </span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="glass rounded-2xl p-6 hover:bg-white/10 transition-all group"
              >
                <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 w-fit mb-4 group-hover:scale-110 transition-transform">
                  <feature.icon className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                <p className="text-slate-400">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="py-20 relative z-10">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-300 text-sm font-medium mb-6">
              <Star className="w-4 h-4 mr-2" />
              Testimonials
            </span>
            <h2 className="text-4xl md:text-5xl font-bold mb-6">
              Loved by HR Teams
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-400">
                Worldwide
              </span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <motion.div
                key={testimonial.author}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="glass rounded-2xl p-6"
              >
                <div className="flex items-center mb-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                  ))}
                </div>
                <p className="text-slate-300 mb-6 italic">&ldquo;{testimonial.quote}&rdquo;</p>
                <div className="flex items-center">
                  <Image
                    src={testimonial.avatar}
                    alt={testimonial.author}
                    width={48}
                    height={48}
                    className="rounded-full mr-4"
                  />
                  <div>
                    <p className="font-semibold">{testimonial.author}</p>
                    <p className="text-sm text-slate-400">{testimonial.role}</p>
                    <p className="text-sm text-purple-400">{testimonial.company}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section id="contact" className="py-20 relative z-10">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass rounded-3xl p-8 md:p-16 text-center relative overflow-hidden"
          >
            {/* Animated background */}
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 animate-gradient" />
            
            <div className="relative z-10 space-y-8">
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold">
                Ready to Transform
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
                  Your HR Operations?
                </span>
              </h2>
              
              <p className="text-xl text-slate-300 max-w-2xl mx-auto">
                Join thousands of companies using Seemplify AI to streamline their HR processes 
                and unlock the full potential of their workforce.
              </p>

              <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-slate-400">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span>14-day free trial</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-400" />
                  <span>No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-green-400" />
                  <span>Enterprise-grade security</span>
                </div>
              </div>

              <Link
                href={IDP_URL}
                className="inline-flex items-center px-10 py-5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 rounded-xl font-semibold text-lg shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/50 transition-all group"
              >
                Start Your Free Trial
                <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
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
                AI-powered HR management platform transforming how businesses recruit, manage, and grow their workforce.
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
                <li><Link href="#" className="hover:text-white transition-colors">Contact</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Blog</Link></li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link href="#" className="hover:text-white transition-colors">Privacy Policy</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Terms of Service</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">Security</Link></li>
                <li><Link href="#" className="hover:text-white transition-colors">GDPR</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-slate-400 text-sm">
              © 2025 Seemplify AI. All rights reserved.
            </p>
            <div className="flex items-center space-x-4 text-slate-400">
              <Shield className="w-4 h-4" />
              <span className="text-sm">Enterprise-grade security & compliance</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
