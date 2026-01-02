'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, CheckCircle, Zap, BarChart3, Users, Shield, Calendar, Briefcase,
  FileCheck, ChartPie, Award, Cpu, Sparkles, Target, Menu, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import SeemplifyLogo, { SeemplifyIcon, SeemplifyRecruiterLogo } from '@/components/SeemplifyLogo';

// Minimal Geometric Icons matching marketing site
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

export default function LandingPage() {
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeProduct, setActiveProduct] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-rotate products
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveProduct(prev => (prev + 1) % 3);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const products = [
    {
      title: 'AI Matching',
      tagline: 'Find Talent',
      description: 'Advanced AI algorithms match candidates with 95% accuracy.',
      icon: <Zap className="w-6 h-6" />,
      color: 'text-blue-400',
      features: ['Deep skill analysis', 'Bias elimination', 'Predictive modeling'],
    },
    {
      title: 'Smart Scheduling',
      tagline: 'Save Time',
      description: 'Automated interview scheduling with calendar integration.',
      icon: <Calendar className="w-6 h-6" />,
      color: 'text-emerald-400',
      features: ['Calendar sync', 'Time zone support', 'Automated reminders'],
    },
    {
      title: 'Analytics',
      tagline: 'Drive Insights',
      description: 'Comprehensive analytics and reporting for data-driven decisions.',
      icon: <BarChart3 className="w-6 h-6" />,
      color: 'text-purple-400',
      features: ['Real-time metrics', 'Custom reports', 'Pipeline analytics'],
    },
  ];

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-indigo-500/30">
      <div className="bg-noise" />

      {/* Ambient Lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[1000px] h-[1000px] bg-indigo-900/20 rounded-full blur-[120px] opacity-20" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[800px] h-[800px] bg-violet-900/20 rounded-full blur-[120px] opacity-20" />
      </div>

      {/* Header */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-[#050505]/80 backdrop-blur-xl border-b border-white/[0.08]' : ''
        }`}>
        <nav className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center space-x-3 group">
              <SeemplifyIcon size="md" />
              <div>
                <span className="text-lg font-semibold tracking-tight text-white/90">Seemplify</span>
                <span className="ml-1.5 text-lg font-light text-blue-400">Recruiter</span>
              </div>
            </Link>

            <div className="hidden lg:flex items-center space-x-8">
              <a href="#features" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">Features</a>
              <a href="#ai-matching" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">AI Matching</a>
              <a href="#how-it-works" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">How It Works</a>
            </div>

            <div className="hidden md:flex items-center space-x-4">
              <Link href="/login" className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">
                Sign In
              </Link>
              <Link href="/signup" className="px-4 py-2 bg-white text-black rounded text-sm font-medium hover:bg-zinc-200 transition-colors">
                Get Started
              </Link>
            </div>

            {/* Mobile Toggle */}
            <button className="lg:hidden p-2 text-zinc-400" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </nav>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-[#050505]/95 backdrop-blur-md z-40 lg:hidden"
                onClick={() => setIsMobileMenuOpen(false)}
              />
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 right-0 bottom-0 w-80 max-w-[85vw] bg-[#050505]/98 backdrop-blur-lg border-l border-white/[0.08] z-50 lg:hidden overflow-y-auto"
              >
                <div className="flex justify-end p-4">
                  <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-white hover:bg-white/10 rounded-lg">
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <nav className="px-6 pb-6">
                  <ul className="space-y-4">
                    {['Features', 'AI Matching', 'How It Works'].map((item) => (
                      <li key={item}>
                        <a
                          href={`#${item.toLowerCase().replace(/\s+/g, '-')}`}
                          className="block py-3 text-lg text-zinc-300 hover:text-white transition-colors border-b border-white/[0.08]"
                          onClick={() => setIsMobileMenuOpen(false)}
                        >
                          {item}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-col space-y-3 mt-8">
                    <Button
                      variant="outline"
                      className="w-full border-zinc-800 text-zinc-300 hover:text-white hover:bg-white/5"
                      onClick={() => { setIsMobileMenuOpen(false); router.push('/login'); }}
                    >
                      Sign In
                    </Button>
                    <Button
                      className="w-full bg-white text-black hover:bg-zinc-200"
                      onClick={() => { setIsMobileMenuOpen(false); router.push('/signup'); }}
                    >
                      Get Started
                    </Button>
                  </div>
                </nav>
              </motion.div>
            </>
          )}
        </AnimatePresence>
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
              className="inline-flex items-center px-3 py-1 rounded-full border border-white/10 bg-white/5 backdrop-blur-md mb-8"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-2 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              <span className="text-xs font-medium text-zinc-300 tracking-wide uppercase">AI-Powered Recruitment</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="text-5xl md:text-7xl font-bold tracking-tighter mb-8 bg-gradient-to-br from-white via-white to-zinc-500 bg-clip-text text-transparent"
            >
              Transform your<br />hiring process.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="text-lg md:text-xl text-zinc-400 max-w-xl mx-auto mb-12 leading-relaxed font-light"
            >
              Leverage AI-driven insights to find the perfect candidates faster than ever before.
              Designed for modern hiring teams.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="flex flex-col sm:flex-row gap-4 justify-center mb-24"
            >
              <Link
                href="/signup"
                className="inline-flex items-center justify-center px-8 py-3 bg-white text-black rounded-lg font-medium hover:bg-zinc-200 transition-all duration-300"
              >
                Start Free Trial
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center px-8 py-3 border border-zinc-800 rounded-lg font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition-all duration-300"
              >
                Sign In
              </Link>
            </motion.div>

            {/* Product Showcase */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="relative"
            >
              <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto mb-6">
                {products.map((product, index) => (
                  <button
                    key={product.title}
                    onClick={() => setActiveProduct(index)}
                    className={`group p-4 rounded-xl border transition-all duration-300 text-left relative overflow-hidden ${activeProduct === index
                      ? 'border-zinc-700 bg-zinc-900/50'
                      : 'border-transparent hover:border-zinc-800 hover:bg-zinc-900/20'
                      }`}
                  >
                    <div className={`mb-3 ${activeProduct === index ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300'}`}>
                      {product.icon}
                    </div>
                    <div className="text-sm font-medium text-zinc-200">{product.title}</div>

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
              <div className="glass-card rounded-2xl p-1 border border-white/5">
                <div className="rounded-xl bg-black/40 p-8 md:p-12 overflow-hidden relative min-h-[300px] flex items-center">

                  <div className="grid md:grid-cols-2 gap-12 items-center w-full relative z-10">
                    <div className="text-left">
                      <div className={`inline-block mb-4 px-2 py-1 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-widest ${products[activeProduct].color}`}>
                        {products[activeProduct].tagline}
                      </div>
                      <h3 className="text-3xl font-semibold mb-4 text-white tracking-tight">{products[activeProduct].description}</h3>
                      <ul className="space-y-3">
                        {products[activeProduct].features.map((feature) => (
                          <li key={feature} className="flex items-center text-zinc-400 text-sm">
                            <div className="w-1 h-1 rounded-full bg-indigo-500 mr-3" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Stats visualization */}
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeProduct}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.05 }}
                        transition={{ duration: 0.4 }}
                        className="w-full h-full flex items-center justify-center p-4 rounded-xl border border-white/5 bg-white/[0.02]"
                      >
                        <div className="text-center">
                          <div className={`text-6xl font-bold mb-2 ${products[activeProduct].color}`}>
                            {activeProduct === 0 ? '95%' : activeProduct === 1 ? '60%' : '3x'}
                          </div>
                          <div className="text-zinc-500 text-sm">
                            {activeProduct === 0 ? 'Match Accuracy' : activeProduct === 1 ? 'Time Saved' : 'Faster Hiring'}
                          </div>
                        </div>
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

      {/* Features Section */}
      <section id="features" className="relative z-10 container mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center px-3 py-1 rounded-full border border-white/10 bg-white/5 mb-6"
          >
            <Sparkles className="w-4 h-4 mr-2 text-indigo-400" />
            <span className="text-xs font-medium text-zinc-300 uppercase tracking-wide">Core Features</span>
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-5xl font-bold tracking-tighter mb-6 gradient-text"
          >
            Why Choose Seemplify?
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-zinc-400 text-lg max-w-2xl mx-auto"
          >
            Our comprehensive platform combines cutting-edge AI with powerful tools
            to streamline your recruitment process.
          </motion.p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              icon: <Cpu className="w-6 h-6" />,
              title: "AI Candidate Matching",
              description: "Advanced algorithms match candidates with 95% accuracy, reducing time-to-hire.",
              color: "text-blue-400",
            },
            {
              icon: <Calendar className="w-6 h-6" />,
              title: "Smart Scheduling",
              description: "Automated interview scheduling with calendar integration across time zones.",
              color: "text-emerald-400",
            },
            {
              icon: <ChartPie className="w-6 h-6" />,
              title: "Analytics Dashboard",
              description: "Comprehensive analytics and reporting for data-driven recruitment decisions.",
              color: "text-purple-400",
            },
            {
              icon: <Users className="w-6 h-6" />,
              title: "Team Collaboration",
              description: "Seamless collaboration with integrated feedback and transparent workflows.",
              color: "text-amber-400",
            },
            {
              icon: <Briefcase className="w-6 h-6" />,
              title: "Pipeline Management",
              description: "Visual pipeline tracking to monitor candidates through every hiring stage.",
              color: "text-pink-400",
            },
            {
              icon: <Shield className="w-6 h-6" />,
              title: "Secure & Compliant",
              description: "Enterprise-grade security with built-in compliance and data protection.",
              color: "text-indigo-400",
            },
          ].map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group glass-card rounded-xl p-6 border border-white/[0.06] hover:border-white/[0.1] transition-all duration-300"
            >
              <div className={`w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center mb-4 ${feature.color} group-hover:bg-white/10 transition-colors`}>
                {feature.icon}
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
              <p className="text-zinc-400 text-sm leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* AI Matching Section */}
      <section id="ai-matching" className="relative z-10 container mx-auto px-6 py-24">
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <div className="flex items-center gap-2 mb-6">
              <IconRecruiting />
              <span className="text-xs font-mono text-blue-400 uppercase tracking-widest">AI Technology</span>
            </div>
            <h2 className="text-4xl font-bold tracking-tighter mb-6 gradient-text">Real-Time AI Matching.</h2>
            <p className="text-lg text-zinc-400 leading-relaxed mb-8">
              Our proprietary AI analyzes thousands of data points to identify the perfect candidates,
              delivering unprecedented match accuracy and reducing time-to-hire by up to 60%.
            </p>
            <ul className="space-y-4 mb-8">
              {[
                'Deep Skill Analysis & Validation',
                'Predictive Performance Modeling',
                'Bias Elimination Protocols'
              ].map((item) => (
                <li key={item} className="flex items-center text-zinc-400">
                  <div className="w-1 h-1 rounded-full bg-blue-500 mr-3" />
                  {item}
                </li>
              ))}
            </ul>
            <Button
              onClick={() => router.push('/signup')}
              className="bg-white text-black hover:bg-zinc-200"
            >
              Try AI Matching <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="glass rounded-2xl p-8"
          >
            <div className="space-y-4">
              {[
                { label: 'Technical Skills', value: 98, color: 'bg-blue-500' },
                { label: 'Culture Fit', value: 92, color: 'bg-purple-500' },
                { label: 'Experience Match', value: 95, color: 'bg-emerald-500' },
              ].map((stat, index) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 + index * 0.1 }}
                >
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-zinc-300">{stat.label}</span>
                    <span className="text-sm text-zinc-400">{stat.value}%</span>
                  </div>
                  <div className="w-full bg-zinc-800 rounded-full h-2">
                    <motion.div
                      className={`${stat.color} h-2 rounded-full`}
                      initial={{ width: 0 }}
                      whileInView={{ width: `${stat.value}%` }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.4 + index * 0.1, duration: 0.8 }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="relative z-10 container mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl font-bold tracking-tighter mb-6 gradient-text"
          >
            How It Works
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-zinc-400 text-lg max-w-2xl mx-auto"
          >
            Get started in minutes with our streamlined onboarding process.
          </motion.p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              step: '01',
              title: 'Create Your Account',
              description: 'Sign up and configure your company profile in under 5 minutes.',
            },
            {
              step: '02',
              title: 'Post Your Jobs',
              description: 'Create job listings with our AI-assisted job description builder.',
            },
            {
              step: '03',
              title: 'Find Top Talent',
              description: 'Let our AI match the best candidates and schedule interviews automatically.',
            },
          ].map((item, index) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.15 }}
              className="relative"
            >
              <div className="text-6xl font-bold text-zinc-800 mb-4">{item.step}</div>
              <h3 className="text-xl font-semibold text-white mb-2">{item.title}</h3>
              <p className="text-zinc-400">{item.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 container mx-auto px-6 py-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-card rounded-2xl p-12 md:p-16 text-center border border-white/[0.06] relative overflow-hidden"
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />

          <div className="relative z-10">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tighter mb-6 gradient-text">
              Ready to Transform Your Hiring?
            </h2>
            <p className="text-zinc-400 text-lg mb-8 max-w-2xl mx-auto">
              Join thousands of companies using Seemplify Recruiter to find and hire the best talent.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-zinc-400 mb-8">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span>14-day free trial</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span>No credit card required</span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-500" />
                <span>Enterprise security</span>
              </div>
            </div>
            <Button
              onClick={() => router.push('/signup')}
              className="bg-white text-black hover:bg-zinc-200 h-12 px-8 text-base"
            >
              Start Free Trial <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="py-20 border-t border-white/5 bg-[#050505] relative z-10">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
            <div className="space-y-4">
              <div className="flex items-center">
                <SeemplifyIcon size="lg" />
                <div className="ml-3">
                  <span className="text-white text-xl font-semibold tracking-tight">Seemplify</span>
                  <span className="ml-1.5 text-xl font-light text-blue-400">Recruiter</span>
                </div>
              </div>
              <p className="text-zinc-500 text-sm leading-relaxed">
                AI-powered recruitment platform for modern hiring teams.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Product</h4>
              <ul className="space-y-3 text-sm">
                <li><a href="#features" className="text-zinc-400 hover:text-white transition-colors">Features</a></li>
                <li><a href="#ai-matching" className="text-zinc-400 hover:text-white transition-colors">AI Matching</a></li>
                <li><Link href="/public/jobs" className="text-zinc-400 hover:text-white transition-colors">Browse Jobs</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Company</h4>
              <ul className="space-y-3 text-sm">
                <li><span className="text-zinc-500">About</span></li>
                <li><span className="text-zinc-500">Contact</span></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Legal</h4>
              <ul className="space-y-3 text-sm">
                <li><Link href="/terms" className="text-zinc-400 hover:text-white transition-colors">Terms of Service</Link></li>
                <li><Link href="/privacy" className="text-zinc-400 hover:text-white transition-colors">Privacy Policy</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row items-center justify-between text-sm">
            <p className="text-zinc-500">&copy; 2025 Seemplify. All rights reserved.</p>
            <div className="flex items-center space-x-2 text-zinc-500 mt-4 md:mt-0">
              <Shield className="w-3.5 h-3.5" />
              <span>Enterprise-grade security</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
