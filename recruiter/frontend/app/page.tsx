'use client';

import './landing-brand.css';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import useSmoothScroll from '@/hooks/useSmoothScroll';
import StickyHeader from '@/components/StickyHeader';
import ActiveLink from '@/components/ActiveLink';
import { 
  ArrowRight, CheckCircle, Zap, BarChart3, Users, Shield, Calendar, Briefcase, 
  FileCheck, ChartPie, Award, Cpu, HeartHandshake, GraduationCap, Sparkles, 
  LineChart, Clock, Target, Star, BadgeCheck, Check, Database, Menu, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import AtsComparisonSection from '@/components/AtsComparisonSection';
import PricingSection from '@/components/PricingSection';
import WorkflowSection from '@/components/WorkflowSection';
import GlassmorphicCard from '@/components/ui/glassmorphic-card';
import ScrollReveal from '@/components/animations/ScrollReveal';
import ShaderBackdrop from '@/components/landing/backdrop/ShaderBackdrop';
import HeroVisual from '@/components/landing/three/HeroVisual';
import TextReveal from '@/components/landing/motion/TextReveal';
import ShimmerButton from '@/components/landing/motion/ShimmerButton';
import Magnetic from '@/components/landing/motion/Magnetic';
import SpotlightCard from '@/components/landing/motion/SpotlightCard';
import BorderBeam from '@/components/landing/motion/BorderBeam';
import SignalStats from '@/components/landing/sections/SignalStats';
import CapabilityMarquee from '@/components/landing/sections/CapabilityMarquee';
import SchedulingSection from '@/components/landing/sections/SchedulingSection';
import {
  BarChartIcon, BriefcaseIcon, CalendarIcon, ChartPieIcon, CpuIcon, ShieldCheckIcon, UsersIcon, ZapIcon,
} from '@/components/landing/icons/AnimatedIcons';
import FAQSection from '@/components/faq/FAQSection';
import ScrollProgress from '@/components/ui/ScrollProgress';
import BackToTop from '@/components/ui/BackToTop';
import HowItWorksSection from '@/components/sections/HowItWorksSection';
import { DynamicLogoIcon } from '@/components/ui/DynamicLogo';
import { useBrandConfig } from '@/context/BrandContext';
import JetstonePortalPage from '@/components/JetstonePortalPage';

export default function LandingPage() {
  const router = useRouter();
  const [isHovering, setIsHovering] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const brand = useBrandConfig(); // Get current brand

  // Initialize smooth scrolling (must run every render — same order as SaaS landing)
  useSmoothScroll();

  // Typing animation for tagline (SaaS landing only; hooks must run before any early return)
  const [typedText, setTypedText] = useState('');
  const fullText = 'Leverage AI-driven insights to find the perfect candidates faster than ever before.';

  useEffect(() => {
    if (brand.id === 'jetstone') return;
    let index = 0;
    const timer = setInterval(() => {
      if (index <= fullText.length) {
        setTypedText(fullText.slice(0, index));
        index++;
      } else {
        clearInterval(timer);
      }
    }, 30);
    return () => clearInterval(timer);
  }, [brand.id]);

  // Render government career portal for Jetstone — not the SaaS marketing page
  if (brand.id === 'jetstone') {
    return <JetstonePortalPage />;
  }

  // The Seemplify brand skin (app/landing-brand.css) re-skins every section below to the main site's system.
  const rootShellClass = brand.landingRootClass ?? 'landing-seemplify min-h-screen overflow-x-hidden relative';

  return (
    <div className={rootShellClass}>
      {/* Scroll Progress Indicator */}
      <ScrollProgress />
      
      {/* GPU mesh-gradient backdrop (Paper Shaders) */}
      <ShaderBackdrop variant="light" />
      
      {/* Back to Top Button */}
      <BackToTop />
      
      {/* Sticky Header */}
      <StickyHeader>
        <div className="container mx-auto px-4 flex justify-between items-center">
          {/* Dynamic Logo */}
          <div className="flex items-center">
            <DynamicLogoIcon size="md" />
          </div>
          
          {/* Desktop Navigation Links */}
          <nav className="hidden xl:flex items-center justify-center">
            <ul className="flex space-x-6">
              <li><ActiveLink href="#features">Features</ActiveLink></li>
              <li><ActiveLink href="#ai-matching">AI Matching</ActiveLink></li>
              <li><ActiveLink href="#how-it-works">How It Works</ActiveLink></li>
              <li><ActiveLink href="#ats-comparison">Why {brand.name}</ActiveLink></li>
              <li><ActiveLink href="#workflow">Workflow</ActiveLink></li>
              <li><ActiveLink href="#interview-tech">Interview Tech</ActiveLink></li>
              <li><ActiveLink href="#pricing">Pricing</ActiveLink></li>
            </ul>
          </nav>
          
          {/* Desktop Action Buttons */}
          <div className="hidden md:flex space-x-4 flex-shrink-0">
            <Button 
              variant="outline" 
              size="sm"
              className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:border-white/30"
              onClick={() => router.push('/login')}
            >
              Login
            </Button>
            <Button 
              size="sm"
              className={`text-white border-0 ${brand.id === 'jetstone' ? 'bg-gradient-to-r from-green-700 to-green-900 hover:from-green-800 hover:to-green-950' : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700'}`}
              onClick={() => router.push('/signup')}
            >
              Sign Up
            </Button>
          </div>
          
          {/* Mobile Menu Button */}
          <button
            className="xl:hidden p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
        
        {/* Mobile Menu Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-slate-900/95 backdrop-blur-md z-40 xl:hidden"
                onClick={() => setIsMobileMenuOpen(false)}
              />
              
              {/* Menu Content */}
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 right-0 bottom-0 w-80 max-w-[85vw] bg-slate-900/98 backdrop-blur-lg border-l border-white/10 z-50 xl:hidden overflow-y-auto"
              >
                {/* Close button */}
                <div className="flex justify-end p-4">
                  <button
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
                    aria-label="Close menu"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                <nav className="px-6 pb-6">
                  <ul className="space-y-4">
                    <li>
                      <a 
                        href="#features" 
                        className="block py-3 text-lg text-slate-300 hover:text-white transition-colors border-b border-white/10"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Features
                      </a>
                    </li>
                    <li>
                      <a 
                        href="#ai-matching" 
                        className="block py-3 text-lg text-slate-300 hover:text-white transition-colors border-b border-white/10"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        AI Matching
                      </a>
                    </li>
                    <li>
                      <a 
                        href="#how-it-works" 
                        className="block py-3 text-lg text-slate-300 hover:text-white transition-colors border-b border-white/10"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        How It Works
                      </a>
                    </li>
                    <li>
                      <a 
                        href="#ats-comparison" 
                        className="block py-3 text-lg text-slate-300 hover:text-white transition-colors border-b border-white/10"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Why {brand.name}
                      </a>
                    </li>
                    <li>
                      <a 
                        href="#workflow" 
                        className="block py-3 text-lg text-slate-300 hover:text-white transition-colors border-b border-white/10"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Workflow
                      </a>
                    </li>
                    <li>
                      <a 
                        href="#interview-tech" 
                        className="block py-3 text-lg text-slate-300 hover:text-white transition-colors border-b border-white/10"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Interview Tech
                      </a>
                    </li>
                    <li>
                      <a 
                        href="#pricing" 
                        className="block py-3 text-lg text-slate-300 hover:text-white transition-colors border-b border-white/10"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Pricing
                      </a>
                    </li>
                  </ul>
                  
                  {/* Mobile Action Buttons */}
                  <div className="flex flex-col space-y-3 mt-8">
                    <Button 
                      variant="outline" 
                      className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20 hover:border-white/30"
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        router.push('/login');
                      }}
                    >
                      Login
                    </Button>
                    <Button 
                      className={`w-full text-white border-0 ${brand.id === 'jetstone' ? 'bg-gradient-to-r from-green-700 to-green-900 hover:from-green-800 hover:to-green-950' : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700'}`}
                      onClick={() => {
                        setIsMobileMenuOpen(false);
                        router.push('/signup');
                      }}
                    >
                      Sign Up
                    </Button>
                  </div>
                </nav>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </StickyHeader>
      
      {/* Spacer for fixed header */}
      <div className="h-24"></div>

      {/* Enhanced Hero Section */}
      <section id="hero" className="relative z-10 container mx-auto px-4 py-20 md:py-32 flex flex-col md:flex-row items-center gap-12">
        <div className="md:w-1/2 mb-8 md:mb-0 space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.21, 0.47, 0.32, 0.98] }}
          >
            <h2 className="text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-black leading-[1.1] tracking-tight">
              <TextReveal text="Transform Your" />
              <span className="block">
                <TextReveal
                  text="Hiring Process"
                  delay={0.2}
                  wordClassName="bg-clip-text text-transparent animate-gradient bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400"
                />
              </span>
            </h2>
          </motion.div>
          
          <motion.p 
            className="text-xl md:text-2xl text-slate-300 max-w-2xl leading-relaxed"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1, ease: [0.21, 0.47, 0.32, 0.98] }}
          >
            Leverage <span className="text-white font-semibold">AI-driven insights</span> to find the perfect candidates faster than ever before. Streamline your recruitment with intelligent automation.
          </motion.p>
          
          <motion.div 
            className="flex flex-col sm:flex-row gap-4"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.21, 0.47, 0.32, 0.98] }}
          >
            <Magnetic>
              <ShimmerButton
                onClick={() => router.push('/signup')}
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
              >
                <span>Get Started Free</span>
                <motion.span
                  className="inline-flex"
                  animate={{ x: isHovering ? 5 : 0 }}
                  transition={{ type: "spring", stiffness: 400 }}
                >
                  <ArrowRight className="h-5 w-5" />
                </motion.span>
              </ShimmerButton>
            </Magnetic>
            
            <Button 
              variant="outline" 
              className="bg-white/5 backdrop-blur-xl border-white/20 text-white hover:bg-white/10 hover:border-white/30 h-14 px-8 text-lg font-semibold transition-all duration-300"
              onClick={() => router.push('/login')}
            >
              Login
            </Button>
          </motion.div>
        </div>
        <motion.div
          className="w-full md:w-1/2"
          // Translate, not scale: the 3D canvas measures its box during this animation.
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
        >
          <div className="relative">
            {/* 3D talent field (R3F) with live chips over it */}
            <HeroVisual />

            {/* Feature cards */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                {
                  icon: <ZapIcon size={20} />,
                  title: "AI-Powered Matching",
                  description: "95% accuracy",
                  color: "from-blue-500 to-cyan-400"
                },
                {
                  icon: <BarChartIcon size={20} />,
                  title: "Smart Analytics",
                  description: "Real-time insights",
                  color: "from-purple-500 to-pink-400"
                },
                {
                  icon: <UsersIcon size={20} />,
                  title: "Team Collaboration",
                  description: "Seamless workflow",
                  color: "from-amber-500 to-orange-400"
                }
              ].map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + (index * 0.2), duration: 0.6 }}
                >
                  <SpotlightCard className="p-4 h-full">
                    <div className={`flex-shrink-0 w-10 h-10 mb-3 bg-gradient-to-br ${feature.color} rounded-lg flex items-center justify-center text-white`}>
                      {feature.icon}
                    </div>
                    <h3 className="text-white font-semibold text-base mb-1">{feature.title}</h3>
                    <p className="text-slate-300 text-sm">{feature.description}</p>
                  </SpotlightCard>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      {/* Results strip + capability marquee */}
      <SignalStats />
      <CapabilityMarquee />

      {/* Enhanced Feature Section with Glass Morphism */}
      <section id="features" className="relative z-10 container mx-auto px-4 py-24 md:py-32">
        <ScrollReveal>
          <div className="text-center mb-20">
            <motion.span 
              className="inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 text-blue-300 text-sm font-semibold mb-6"
              whileHover={{ scale: 1.05 }}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Intelligent HR Solutions
            </motion.span>
            <h2 className={`text-4xl md:text-5xl lg:text-6xl font-black mb-6 bg-clip-text text-transparent leading-tight ${brand.id === 'jetstone' ? 'bg-gradient-to-r from-green-900 via-amber-800 to-green-900' : 'bg-gradient-to-r from-white via-blue-100 to-purple-100'}`}>
              Why Choose {brand.name}?
            </h2>
            <p className="text-slate-300 text-xl md:text-2xl max-w-4xl mx-auto leading-relaxed">
              Our comprehensive platform combines <span className="text-white font-semibold">cutting-edge AI</span> with powerful tools
              to streamline your HR processes and boost organizational efficiency.
            </p>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: <CpuIcon />,
              title: "AI Candidate Matching",
              description: "Advanced algorithms match candidates with 95% accuracy, reducing hiring time and improving quality of hires.",
              gradient: "from-blue-500 to-cyan-400",
              span: "lg:col-span-2",
              featured: true,
              delay: 0.1
            },
            {
              icon: <CalendarIcon />,
              title: "Automated Interviews",
              description: "Smart scheduling system integrates with calendar platforms for effortless interview coordination.",
              gradient: "from-green-500 to-emerald-400",
              span: "",
              featured: false,
              delay: 0.2
            },
            {
              icon: <ChartPieIcon />,
              title: "Analytics Dashboard",
              description: "Gain actionable insights with comprehensive analytics and reporting to optimize recruitment strategy.",
              gradient: "from-purple-500 to-pink-400",
              span: "",
              featured: false,
              delay: 0.3
            },
            {
              icon: <UsersIcon />,
              title: "Team Collaboration",
              description: "Seamless collaboration with integrated feedback systems and transparent workflows throughout hiring.",
              gradient: "from-amber-500 to-orange-400",
              span: "",
              featured: false,
              delay: 0.4
            },
            {
              icon: <BriefcaseIcon />,
              title: "HR Management",
              description: "Complete HR solutions including payroll automation, tax management, and retention tools in one platform.",
              gradient: "from-pink-500 to-rose-400",
              span: "",
              featured: false,
              delay: 0.5
            },
            {
              icon: <ShieldCheckIcon />,
              title: "Secure Compliance",
              description: "Enterprise-grade security with built-in compliance tools to navigate regulations and protect data.",
              gradient: "from-indigo-500 to-blue-400",
              span: "lg:col-span-2",
              featured: true,
              delay: 0.6
            },
          ].map((feature, index) => (
            <ScrollReveal key={index} delay={feature.delay} className={`${feature.span} h-full`}>
              <SpotlightCard className="p-8 h-full">
                <div className="flex items-start mb-5">
                  <div className={`p-3 rounded-xl bg-gradient-to-br ${feature.gradient} mr-4 shadow-lg text-white`}>
                    {feature.icon}
                  </div>
                  <h3 className="text-2xl font-bold text-white group-hover:text-blue-300 transition-colors">
                    {feature.title}
                  </h3>
                </div>
                <p className="text-slate-300 text-lg leading-relaxed">
                  {feature.description}
                </p>
              </SpotlightCard>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* Real-Time AI Matching Section */}
      <section id="ai-matching" className="relative z-10 container mx-auto px-4 py-20">
        {/* Background decoration */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute top-1/4 right-0 w-[300px] h-[300px] bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left side - Interactive dashboard visualization */}
          <motion.div 
            className="relative"
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <div className="relative z-10 rounded-2xl overflow-hidden border border-white/20 shadow-2xl" data-on-photo>
              <Image
                src="https://images.unsplash.com/photo-1551836022-deb4988cc6c0?auto=format&fit=crop&q=80&w=800"
                alt="AI Matching Dashboard"
                width={700}
                height={500}
                className="w-full object-cover rounded-2xl"
                priority
              />
              
              {/* Dashboard overlay elements */}
              <motion.div 
                className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-900/90"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 }}
              />
              
              {/* Floating match rates */}
              <motion.div 
                className="absolute top-5 right-5 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md p-3 rounded-xl shadow-lg border border-white/20"
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5 }}
              >
                <div className="flex items-center space-x-2">
                  <Target className="w-5 h-5 text-green-500" />
                  <div>
                    <div className="text-xs text-gray-500">Match Accuracy</div>
                    <div className="font-medium text-gray-800 dark:text-white">95.8%</div>
                  </div>
                </div>
              </motion.div>
              
              <motion.div 
                className="absolute bottom-24 left-10 bg-white/90 dark:bg-slate-800/90 backdrop-blur-md py-2 px-4 rounded-full shadow-lg border border-white/20"
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.7 }}
              >
                <div className="flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-medium text-gray-800 dark:text-white">Time-to-hire reduced by 62%</span>
                </div>
              </motion.div>
              
              <motion.div 
                className="absolute bottom-10 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue-600 to-purple-600 py-3 px-6 rounded-xl shadow-xl"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.9 }}
              >
                <div className="flex items-center justify-center space-x-2 text-white">
                  <Star className="w-5 h-5 text-yellow-300" />
                  <span className="font-medium">Perfect match found: Sara Chen</span>
                </div>
              </motion.div>
            </div>

            {/* Animated match progress bars */}
            <motion.div 
              className="absolute -bottom-8 -right-8 bg-white/10 backdrop-blur-md p-4 rounded-lg shadow-xl border border-white/20 w-64"
              initial={{ opacity: 0, scale: 0.8, rotate: 3 }}
              whileInView={{ opacity: 1, scale: 1, rotate: 3 }}
              viewport={{ once: true }}
              transition={{ delay: 1.0 }}
            >
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium text-blue-300">Technical Skills</div>
                    <div className="text-sm text-blue-300">98%</div>
                  </div>
                  <div className="w-full bg-gray-700/50 rounded-full h-1.5">
                    <motion.div 
                      className="bg-blue-500 h-1.5 rounded-full" 
                      initial={{ width: 0 }}
                      whileInView={{ width: '98%' }}
                      viewport={{ once: true }}
                      transition={{ delay: 1.2, duration: 1 }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium text-purple-300">Culture Fit</div>
                    <div className="text-sm text-purple-300">92%</div>
                  </div>
                  <div className="w-full bg-gray-700/50 rounded-full h-1.5">
                    <motion.div 
                      className="bg-purple-500 h-1.5 rounded-full" 
                      initial={{ width: 0 }}
                      whileInView={{ width: '92%' }}
                      viewport={{ once: true }}
                      transition={{ delay: 1.3, duration: 1 }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium text-green-300">Experience</div>
                    <div className="text-sm text-green-300">95%</div>
                  </div>
                  <div className="w-full bg-gray-700/50 rounded-full h-1.5">
                    <motion.div 
                      className="bg-green-500 h-1.5 rounded-full" 
                      initial={{ width: 0 }}
                      whileInView={{ width: '95%' }}
                      viewport={{ once: true }}
                      transition={{ delay: 1.4, duration: 1 }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
          
          {/* Right side - Content */}
          <motion.div 
            className="relative z-10"
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.2 }}
          >
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-sm font-medium mb-4">
              <Database className="w-4 h-4 mr-2" />
              Advanced Technology
            </span>
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              Real-Time <span className={`text-transparent bg-clip-text ${brand.id === 'jetstone' ? 'bg-gradient-to-r from-green-700 to-amber-600' : 'bg-gradient-to-r from-blue-400 to-purple-500'}`}>AI Matching</span> Technology
            </h2>
            <p className="text-slate-300 text-lg mb-8">
              Our proprietary AI algorithms analyze thousands of data points to identify the perfect candidates for your open positions, 
              delivering unprecedented match accuracy and reducing time-to-hire by up to 62%.
            </p>
            
            <div className="space-y-6 mb-8">
              {[
                {
                  title: "Deep Skill Analysis",
                  description: "AI-powered parsing of resumes and portfolios to extract and validate technical and soft skills",
                  icon: <BadgeCheck className="w-5 h-5 text-green-400" />,
                  delay: 0.4
                },
                {
                  title: "Predictive Performance Modeling",
                  description: "Machine learning algorithms that predict candidate success based on historical performance data",
                  icon: <LineChart className="w-5 h-5 text-blue-400" />,
                  delay: 0.6
                },
                {
                  title: "Bias Elimination",
                  description: "Advanced techniques to identify and remove unconscious bias from the hiring process",
                  icon: <Shield className="w-5 h-5 text-purple-400" />,
                  delay: 0.8
                },
              ].map((item, index) => (
                <motion.div 
                  key={index}
                  className="flex items-start"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: item.delay }}
                >
                  <div className="flex-shrink-0 p-1 bg-white/10 rounded-lg mr-4">
                    {item.icon}
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-white">{item.title}</h3>
                    <p className="text-slate-300">{item.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
            
            <motion.div 
              className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 backdrop-blur-sm p-4 rounded-xl border border-white/10"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 1.0 }}
            >
              <div className="flex items-center">
                <div className="flex-shrink-0 p-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg mr-4">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="font-semibold text-white mb-1">Industry-Leading Results</div>
                  <p className="text-slate-300 text-sm">
                    {`"${brand.name}'s AI matching technology reduced our time-to-hire by 62% while improving candidate quality."`}
                    <span className="block mt-2 text-blue-400">— Sarah Johnson, Head of Talent Acquisition</span>
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>
      
      {/* Interview scheduling across time zones (3D board) */}
      <SchedulingSection />

      {/* How It Works Section - Redesigned */}
      <HowItWorksSection />
      
      {/* ATS Comparison Section */}
      <div id="ats-comparison">
        <AtsComparisonSection />
      </div>
      
      {/* Workflow Section */}
      <div id="workflow">
        <WorkflowSection />
      </div>

      {/* Pricing Section */}
      <div id="pricing">
        <PricingSection />
      </div>
      
      {/* Interview and Feedback Technology Section */}
      <section id="interview-tech" className="relative z-10 container mx-auto px-4 py-20">
        {/* Background decoration */}
        <div className="absolute top-1/2 right-1/3 w-full max-w-[400px] aspect-square bg-purple-500/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-1/4 left-1/4 w-full max-w-[300px] aspect-square bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>
        
        <motion.div 
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-purple-500/10 text-purple-400 text-sm font-medium mb-4">
            <Calendar className="w-4 h-4 mr-2" />
            Interview Technology
          </span>
          <h2 className={`text-3xl md:text-5xl font-bold mb-6 bg-clip-text text-transparent ${brand.id === 'jetstone' ? 'bg-gradient-to-r from-green-900 to-amber-800' : 'bg-gradient-to-r from-white to-purple-200'}`}>
            Smart Interview Management
          </h2>
          <p className="text-slate-300 text-lg max-w-3xl mx-auto">
            Revolutionize your interviewing process with our comprehensive suite of tools designed to make scheduling,
            conducting, and analyzing interviews effortless and insightful.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Left side - Image with features */}
          <motion.div 
            className="relative"
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <div className="relative z-[1] rounded-2xl overflow-hidden border border-white/20 shadow-2xl" data-on-photo>
              <Image 
                src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&q=80&w=800" 
                alt="Team conducting interview with AI assistance"
                width={700}
                height={500}
                className="w-full h-full object-cover rounded-2xl"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 to-transparent"></div>
              
              {/* Feature highlights overlay */}
              <div className="absolute bottom-0 left-0 right-0 p-6">
                <div className="grid grid-cols-2 gap-4">
                  <motion.div 
                    className="bg-white/10 backdrop-blur-md p-3 rounded-lg border border-white/20"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 }}
                  >
                    <div className="flex items-center mb-2">
                      <Calendar className="w-5 h-5 text-purple-400 mr-2" />
                      <h4 className="text-white font-medium">Smart Scheduling</h4>
                    </div>
                    <p className="text-slate-300 text-xs">Automatically find the perfect time for all participants</p>
                  </motion.div>
                  
                  <motion.div 
                    className="bg-white/10 backdrop-blur-md p-3 rounded-lg border border-white/20"
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.4 }}
                  >
                    <div className="flex items-center mb-2">
                      <Users className="w-5 h-5 text-blue-400 mr-2" />
                      <h4 className="text-white font-medium">Team Collaboration</h4>
                    </div>
                    <p className="text-slate-300 text-xs">Coordinate with hiring teams and share feedback instantly</p>
                  </motion.div>
                </div>
              </div>
            </div>

            {/* Floating feature cards */}
            {/* Feature cards - visible on all devices but positioned differently */}
            <motion.div 
              className="absolute -bottom-10 -left-10 md:-bottom-10 md:-left-10 sm:bottom-4 sm:left-4 xs:bottom-4 xs:left-4 bg-gradient-to-br from-purple-500/10 to-purple-900/20 backdrop-blur-md p-4 rounded-lg shadow-xl border border-white/10 max-w-[240px] z-20"
              initial={{ opacity: 0, scale: 0.8, x: -20 }}
              whileInView={{ opacity: 1, scale: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.6 }}
            >
              <div className="flex items-start">
                <div className="p-2 bg-purple-500/30 rounded-lg mr-3 backdrop-blur-md">
                  <FileCheck className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h4 className="font-medium text-white text-sm">AI Interview Questions</h4>
                  <p className="text-xs text-slate-300 mt-1">
                    Generate tailored questions specific to each role and candidate
                  </p>
                </div>
              </div>
            </motion.div>
            
            <motion.div 
              className="absolute -top-8 -right-8 md:-top-8 md:-right-8 sm:top-4 sm:right-4 xs:top-4 xs:right-4 bg-gradient-to-br from-blue-500/10 to-blue-900/20 backdrop-blur-md p-4 rounded-lg shadow-xl border border-white/10 max-w-[240px] z-20"
              initial={{ opacity: 0, scale: 0.8, x: 20 }}
              whileInView={{ opacity: 1, scale: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.7 }}
            >
              <div className="flex items-start">
                <div className="p-2 bg-blue-500/30 rounded-lg mr-3 backdrop-blur-md">
                  <Cpu className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h4 className="font-medium text-white text-sm">AI Notetaker</h4>
                  <p className="text-xs text-slate-300 mt-1">
                    Auto-transcribe interviews and generate insightful summaries
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
          
          {/* Right side - Features list */}
          <motion.div 
            className="flex flex-col justify-center"
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.2 }}
          >
            <div className="space-y-6">
              {[
                {
                  title: "Intelligent Interview Scheduling",
                  description: "Seamlessly coordinate interviews between candidates and team members across multiple time zones with calendar integration and automated reminders.",
                  icon: <Calendar className="w-6 h-6 text-purple-500" />,
                  delay: 0.3
                },
                {
                  title: "AI Notetaker & Transcription",
                  description: "Our AI joins your interviews to take comprehensive notes, generate transcripts, and provide actionable insights without any manual effort.",
                  icon: <FileCheck className="w-6 h-6 text-blue-500" />,
                  delay: 0.4
                },
                {
                  title: "Multi-Candidate Pipeline",
                  description: "Track candidates through custom interview stages with our visual pipeline board, making it easy to compare progress and make decisions.",
                  icon: <Users className="w-6 h-6 text-green-500" />,
                  delay: 0.5
                },
                {
                  title: "Structured Feedback Collection",
                  description: "Gather standardized feedback from all interviewers with customizable forms that ensure consistent evaluation across candidates.",
                  icon: <BarChart3 className="w-6 h-6 text-amber-500" />,
                  delay: 0.6
                }
              ].map((feature, index) => (
                <motion.div 
                  key={index}
                  className="flex items-start"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: feature.delay }}
                >
                  <div className="flex-shrink-0 p-2 bg-white/10 rounded-lg mr-4">
                    {feature.icon}
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-white">{feature.title}</h3>
                    <p className="text-slate-300 mt-1">{feature.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
            
            <motion.div 
              className="mt-8"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.8 }}
            >
              <Button 
                className="bg-gradient-to-r from-purple-500 to-blue-600 hover:from-purple-600 hover:to-blue-700 text-white border-0"
                onClick={() => router.push('/signup')}
              >
                Experience Smart Interviewing
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* FAQ Section */}
      <FAQSection />

      {/* Enhanced CTA Section */}
      <section id="get-started" className="relative z-10 container mx-auto px-4 py-24">
        <ScrollReveal>
          <GlassmorphicCard variant="elevated" className="p-12 md:p-16 overflow-hidden relative" hover={false}>
            {/* Background animation */}
            <motion.div 
              className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10"
              animate={{ 
                backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
              }}
              transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
              style={{ backgroundSize: '200% 200%' }}
            />
            
            <div className="flex flex-col items-center text-center gap-8 relative z-10">
              <div className="space-y-6 max-w-3xl">
                <h2 className={`text-4xl md:text-5xl lg:text-6xl font-black bg-clip-text text-transparent ${brand.id === 'jetstone' ? 'bg-gradient-to-r from-green-900 via-amber-800 to-green-900' : 'bg-gradient-to-r from-white via-blue-100 to-purple-100'}`}>
                  Ready to Transform Your Hiring?
                </h2>
                <p className="text-slate-200 text-xl md:text-2xl leading-relaxed">
                  Transform your hiring process with AI-powered recruitment tools.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-slate-300">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>14-day free trial</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-400" />
                    <span>No credit card required</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-green-400" />
                    <span>Enterprise-grade security</span>
                  </div>
                </div>
              </div>
              
              <Magnetic>
                <ShimmerButton className="h-14 px-10" onClick={() => router.push('/signup')}>
                  Start Free Trial <ArrowRight className="w-5 h-5" />
                </ShimmerButton>
              </Magnetic>
            </div>
          </GlassmorphicCard>
        </ScrollReveal>
      </section>

      {/* Enhanced Footer - update logo */}
      <footer className="relative z-10 container mx-auto px-4 py-16 border-t border-white/10 mt-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          <div className="space-y-4">
            <div className="flex items-center">
              <DynamicLogoIcon size="md" showPulse={false} />
              <h3 className="ml-3 text-white text-xl font-heading font-bold">{brand.name}</h3>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed">
              Transforming human resources with AI-powered solutions for recruitment, management, and compliance.
            </p>
            <div className="flex space-x-4">
              {/* Social media placeholders - not linked yet */}
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <div className="w-4 h-4 text-white">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M24 4.557a9.83 9.83 0 01-2.828.775 4.932 4.932 0 002.165-2.724 9.864 9.864 0 01-3.127 1.195 4.916 4.916 0 00-8.384 4.482A13.978 13.978 0 011.67 3.15a4.898 4.898 0 001.523 6.574 4.868 4.868 0 01-2.229-.616v.061a4.914 4.914 0 003.933 4.819 4.912 4.912 0 01-2.224.084 4.915 4.915 0 004.6 3.42 9.86 9.86 0 01-6.115 2.107c-.398 0-.79-.023-1.175-.068a13.909 13.909 0 007.548 2.211c9.057 0 14.009-7.503 14.009-14.01 0-.213-.005-.425-.014-.636A9.936 9.936 0 0024 4.557z"/></svg>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <div className="w-4 h-4 text-white">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.454C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/></svg>
                </div>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="font-bold text-white mb-4">Product</h4>
            <ul className="space-y-3">
              <li>
                <span className="text-slate-300">Features</span>
              </li>
              <li>
                <span className="text-slate-300">Pricing</span>
              </li>
              <li>
                <Link href="/public/jobs" className="text-slate-300 hover:text-white transition-colors">Browse Jobs</Link>
              </li>
              <li>
                <span className="text-slate-300">Security</span>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-bold text-white mb-4">Company</h4>
            <ul className="space-y-3">
              <li>
                <span className="text-slate-300">About</span>
              </li>
              <li>
                <span className="text-slate-300">Contact</span>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-bold text-white mb-4">Legal</h4>
            <ul className="space-y-3">
              <li>
                <Link href="/terms" className="text-slate-300 hover:text-white transition-colors">Terms of Service</Link>
              </li>
              <li>
                <Link href="/privacy" className="text-slate-300 hover:text-white transition-colors">Privacy Policy</Link>
              </li>
              <li>
                <Link href="/cookies" className="text-slate-300 hover:text-white transition-colors">Cookies</Link>
              </li>
              <li>
                <Link href="/privacy" className="text-slate-300 hover:text-white transition-colors">Data Processing</Link>
              </li>
              <li>
                <Link href="/terms" className="text-slate-300 hover:text-white transition-colors">Licenses</Link>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between">
          <p className="text-slate-300 text-sm">{brand.footerText || `© 2025 ${brand.name}. All rights reserved.`}</p>
          <div className="flex items-center space-x-4 mt-4 md:mt-0">
            <div className="flex items-center space-x-2 text-slate-400 text-xs">
              <Shield className="w-3 h-3" />
              <span>Enterprise-grade security</span>
            </div>
            <Link href="/privacy" className="text-slate-300 text-sm hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="text-slate-300 text-sm hover:text-white transition-colors">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}