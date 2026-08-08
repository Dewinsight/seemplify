"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { getOidcDisplayConfig } from "@/config/oidc.config";
import { getApiBaseUrl, getIdpBaseUrl } from "@/utils/env";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Zap,
  Shield,
  Sparkles,
  LayoutGrid,
  Users,
  BarChart3
} from "lucide-react";
import { useBrandConfig } from "@/context/BrandContext";

export default function LoginPage() {
  const { toast } = useToast();
  const auth = useAuth();
  const brand = useBrandConfig();
  const oidcConfig = getOidcDisplayConfig(brand.id);
  const authShell =
    brand.authShellClass ?? 'bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900';
  const jet = brand.id === 'jetstone';
  const textColor = jet ? 'text-slate-800' : 'text-white';
  const textMuted = jet ? 'text-slate-600' : 'text-slate-300';
  const cardBg = jet ? 'bg-white/60 border-slate-200/50 shadow-xl' : 'bg-white/15 border-white/30 shadow-2xl';
  const featureBg = jet ? 'bg-white/40 border-slate-200/50 hover:bg-white/60' : 'bg-white/5 border-white/10 hover:bg-white/10';
  const linkBg = jet ? 'bg-white/50 border-slate-200/50 hover:bg-white/80 hover:border-slate-300/50' : 'bg-white/10 border-white/20 hover:bg-white/20 hover:border-white/30';
  const accentGrad = jet ? 'from-green-600 to-amber-600' : 'from-blue-400 via-purple-400 to-pink-400';
  const btnGrad = jet ? 'bg-gradient-to-r from-green-700 to-green-900 hover:from-green-800 hover:to-green-950 focus:ring-2 focus:ring-green-400/50' : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 focus:ring-2 focus:ring-blue-400/50';
  const iconGrad = jet ? 'bg-gradient-to-br from-green-500 to-amber-600' : 'bg-gradient-to-br from-blue-400 to-purple-500';
  const orb1 = jet ? 'bg-green-500/18' : 'bg-blue-500/20';
  const orb2 = jet ? 'bg-amber-400/18' : 'bg-purple-500/20';
  const orb3 = jet ? 'bg-yellow-400/14' : 'bg-pink-500/20';
  const particleColor = jet ? 'bg-green-400/40' : 'bg-blue-400/30';
  const mouseGlowColor = jet ? 'rgba(21,128,61,0.14)' : 'rgba(59,130,246,0.15)';
  const [isLoading, setIsLoading] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isProcessingOIDC, setIsProcessingOIDC] = useState(false);

  const startOidcLogin = () => {
    setIsLoading(true)
    const base = getApiBaseUrl()
    const returnTo = encodeURIComponent(window.location.href)
    window.location.href = `${base}/api/auth/oidc/start?returnTo=${returnTo}`
  }

  // Mouse tracking for interactive background
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    console.log('🔐 Login page checking for OIDC tokens:', {
      hasHash: !!hash,
      hashContent: hash ? hash.substring(0, 50) + '...' : 'none',
      hasToken: hash.includes('token=')
    })
    
    if (hash && hash.includes('token=')) {
      setIsProcessingOIDC(true)
      const params = new URLSearchParams(hash.replace('#', ''))
      const token = params.get('token') || ''
      const refreshToken = params.get('refreshToken') || ''
      const expiresIn = params.get('expiresIn') || '10m'
      
      console.log('🎯 Processing OIDC login:', {
        hasToken: !!token,
        hasRefreshToken: !!refreshToken,
        expiresIn: expiresIn
      })
      
      if (token && refreshToken) {
        ;(async () => {
          try {
            console.log('Starting auth login...')
            auth.login(token, refreshToken, expiresIn)
            console.log('Auth login complete, clearing hash...')
            if (typeof window !== 'undefined') {
              window.location.hash = ''
            }
          } catch (error) {
            console.error('❌ OIDC login error:', error)
            setIsProcessingOIDC(false)
            toast({
              title: "Login Error",
              description: "Failed to complete login. Please try again.",
              variant: "destructive",
            })
          }
        })()
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || auth.isLoading || auth.isAuthenticated || isProcessingOIDC || isLoading) {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const hasCallbackToken = window.location.hash.includes('token=')
    if (oidcConfig.enabled && !hasCallbackToken && !params.get('error')) {
      startOidcLogin()
    }
  }, [auth.isAuthenticated, auth.isLoading, isLoading, isProcessingOIDC, oidcConfig.enabled])


  // Show OIDC processing loader
  if (isProcessingOIDC) {
    return (
      <div className={`min-h-screen ${authShell} relative overflow-hidden flex items-center justify-center`}>
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>
        <div className={`absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse pointer-events-none ${orb1}`}></div>
        <div className={`absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse delay-1000 pointer-events-none ${orb2}`}></div>

        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 text-center"
        >
          <div className="bg-white/10 backdrop-blur-2xl border border-white/20 rounded-2xl p-12 shadow-2xl">
            <motion.div
              animate={{
                rotate: 360,
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "linear"
              }}
              className="w-24 h-24 mx-auto mb-6 relative"
            >
              <div className={`absolute inset-0 rounded-full opacity-20 blur-xl ${jet ? 'bg-gradient-to-tr from-green-500 to-amber-500' : 'bg-gradient-to-tr from-blue-500 to-purple-500'}`}></div>
              <div className={`absolute inset-2 border-4 border-transparent rounded-full ${jet ? 'border-t-green-500 border-r-amber-400' : 'border-t-blue-400 border-r-purple-400'}`}></div>
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className={`text-2xl font-bold mb-3 ${textColor}`}
            >
              Completing Sign In
            </motion.h2>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className={`text-sm ${textMuted}`}
            >
              Securely logging you into {brand.name}...
            </motion.p>

            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.6, duration: 1.5 }}
              className={`mt-6 h-1 rounded-full origin-left ${jet ? 'bg-gradient-to-r from-green-500 to-amber-500' : 'bg-gradient-to-r from-blue-500 to-purple-500'}`}
            ></motion.div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={`h-screen ${authShell} relative overflow-hidden`}>
      {/* Animated Background Elements */}
      <div 
        className="absolute inset-0 opacity-30"
        style={{
          background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, ${mouseGlowColor}, transparent ${jet ? '42%' : '40%'})`
        }}
      />
      
      {/* Floating Orbs */}
      <div className={`absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse ${orb1}`}></div>
      <div className={`absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse delay-1000 ${orb2}`}></div>
      <div className={`absolute top-3/4 left-1/3 w-64 h-64 rounded-full blur-3xl animate-pulse delay-2000 ${orb3}`}></div>

      {/* Grid Pattern Overlay */}
      <div 
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }}
      />

      <div className="relative z-10 flex h-screen">
        {/* Left Side - Brand & Features */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-center p-6 lg:p-8 xl:p-12 2xl:p-16 relative">
          {/* Logo and Brand */}
          <div className="mb-6 lg:mb-8 xl:mb-12">
            {jet ? (
              /* Jetstone: state seal + ARISE combined mark + Jetstone sub-brand */
              <div className="flex items-center gap-3 mb-6">
                <div className="flex h-12 shrink-0 items-center">
                  <Image
                    src="/logoakwa.png"
                    alt="Government of Akwa Ibom State"
                    width={280}
                    height={80}
                    className="h-10 w-auto max-w-[220px] bg-transparent object-contain lg:h-12"
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
            ) : (
              <div className="flex items-center mb-6">
                {brand.useImageLogo && brand.logo ? (
                  <div className="flex items-center">
                    <Image src={brand.logo} alt={brand.name} width={240} height={56} className="object-contain h-10 lg:h-12 xl:h-14 w-auto" />
                  </div>
                ) : (
                  <div className="relative">
                    <div className={`w-10 h-10 lg:w-12 lg:h-12 xl:w-14 xl:h-14 bg-gradient-to-br ${brand.gradient} rounded-xl flex items-center justify-center shadow-2xl`}>
                      <span className="font-extrabold text-base lg:text-lg xl:text-xl tracking-tighter text-white">{brand.shortName}</span>
                    </div>
                    <div className={`absolute -top-1 -right-1 w-3 h-3 lg:w-4 lg:h-4 ${brand.colors.pulse} rounded-full border-2 border-slate-900 animate-pulse`}></div>
                  </div>
                )}
                {!(brand.useImageLogo && brand.logo) && (
                  <div className="ml-3 lg:ml-4">
                    <h1 className={`text-xl lg:text-2xl xl:text-3xl font-bold text-white`}>{brand.loginHeading || brand.name}</h1>
                    <p className={`text-xs lg:text-sm text-slate-300`}>{brand.loginSubheading || brand.tagline}</p>
                  </div>
                )}
              </div>
            )}
            
            <div className="max-w-md">
              <h2 className={`text-2xl lg:text-3xl xl:text-4xl 2xl:text-5xl font-bold mb-3 lg:mb-4 leading-tight ${textColor}`}>
                Transform your
                <span className={`block bg-clip-text text-transparent bg-gradient-to-r ${accentGrad}`}>
                  hiring process
                </span>
              </h2>
              <p className={`text-sm lg:text-base xl:text-lg leading-relaxed ${textMuted}`}>
                Leverage AI-driven insights to find the perfect candidates faster than ever before.
              </p>
            </div>
          </div>

          {/* Feature Cards */}
          <div className="space-y-2 lg:space-y-3 xl:space-y-4">
            {[
              {
                icon: <Zap className="w-5 h-5" />,
                title: "AI-Powered Matching",
                description: "Intelligent candidate-job matching with 95% accuracy"
              },
              {
                icon: <BarChart3 className="w-5 h-5" />,
                title: "Smart Analytics",
                description: "Real-time insights and performance metrics"
              },
              {
                icon: <Users className="w-5 h-5" />,
                title: "Team Collaboration",
                description: "Seamless workflow for hiring teams"
              }
            ].map((feature, index) => (
              <div 
                key={index} 
                className={`flex items-center p-2 lg:p-3 xl:p-4 backdrop-blur-sm rounded-lg lg:rounded-xl transition-all duration-300 group ${featureBg}`}
              >
                <div className={`flex-shrink-0 w-8 h-8 lg:w-9 lg:h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform duration-300 ${iconGrad}`}>
                  {feature.icon}
                </div>
                <div className="ml-2 lg:ml-3 xl:ml-4">
                  <h3 className={`font-semibold text-sm lg:text-base ${textColor}`}>{feature.title}</h3>
                  <p className={`text-xs lg:text-sm ${textMuted}`}>{feature.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Secondary Logo — hide for Jetstone (already in header) */}
          {brand.secondaryLogo && !jet && (
            <div className="absolute bottom-8 left-8 xl:bottom-12 xl:left-12 flex items-center gap-3 opacity-80">
              <span className={`text-sm font-medium ${textMuted}`}>In partnership with</span>
              <Image src={brand.secondaryLogo} alt="Partner Logo" width={48} height={48} className="object-contain" />
            </div>
          )}
        </div>

        {/* Right Side - Login Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md">
            {/* Mobile Logo */}
            <div className="lg:hidden flex flex-col items-center mb-8 gap-3">
              {jet ? (
                <div className="flex flex-col items-center gap-2 text-center">
                  <Image
                    src="/logoakwa.png"
                    alt="Government of Akwa Ibom State"
                    width={220}
                    height={56}
                    className="h-10 w-auto max-w-[200px] bg-transparent object-contain"
                  />
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide text-green-950 leading-tight">
                      Office of the Head of Service
                    </p>
                    <p className="text-[9px] font-semibold text-green-800/75">
                      Government of Akwa Ibom State
                    </p>
                  </div>
                </div>
              ) : brand.useImageLogo && brand.logo ? (
                <div className="flex items-center">
                  <Image src={brand.logo} alt={brand.name} width={200} height={48} className="object-contain h-12 w-auto" />
                </div>
              ) : (
                <div className={`w-14 h-14 bg-gradient-to-br ${brand.gradient} rounded-xl flex items-center justify-center shadow-2xl`}>
                  <span className="font-extrabold text-xl tracking-tighter text-white">{brand.shortName}</span>
                </div>
              )}
            </div>

            {/* Floating Particles */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {Array.from({ length: 20 }).map((_, i) => (
                <motion.div
                  key={i}
                  className={`absolute w-1 h-1 rounded-full ${particleColor}`}
                  initial={{ 
                    x: Math.random() * 400, 
                    y: Math.random() * 600,
                    scale: 0
                  }}
                  animate={{
                    y: [Math.random() * 600, Math.random() * 600 - 100],
                    scale: [0, 1, 0],
                    opacity: [0, 1, 0]
                  }}
                  transition={{
                    duration: 3 + Math.random() * 2,
                    repeat: Infinity,
                    delay: Math.random() * 2
                  }}
                />
              ))}
            </div>

            {/* Enhanced Login Card */}
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.5, type: "spring", stiffness: 100 }}
            >
              <Card className={`backdrop-blur-2xl overflow-hidden relative ${cardBg}`}>
                {/* Subtle Animated Border */}
                <div className={`absolute inset-0 rounded-lg animate-pulse opacity-30 ${jet ? 'bg-gradient-to-r from-green-500/12 via-amber-500/12 to-yellow-500/10' : 'bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10'}`}></div>
                
                <CardHeader className="space-y-1 text-center pb-6 relative z-10">
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.5 }}
                  >
                    <CardTitle className={`text-2xl font-bold flex items-center justify-center gap-2 ${textColor}`}>
                      Welcome back
                      <motion.div
                        animate={{ rotate: [0, 10, 0] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <Sparkles className="w-5 h-5 text-yellow-400" />
                      </motion.div>
                    </CardTitle>
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4, duration: 0.5 }}
                  >
                    <CardDescription className={`text-base ${textMuted}`}>
                      Sign in to your {brand.name} account
                    </CardDescription>
                  </motion.div>
                </CardHeader>

                <div className="relative z-10">
                  <CardContent className="space-y-6 px-6">
                    {/* IDP Login Description */}
                    <motion.div
                      className="text-center space-y-3"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.6, duration: 0.5 }}
                    >
                      <p className={`text-sm ${textMuted}`}>
                        Sign in securely using your {oidcConfig.providerName} account
                      </p>
                    </motion.div>
                  </CardContent>

                  <CardFooter className="px-6 pb-6 pt-4">
                    {oidcConfig.enabled && (
                      <motion.div
                        className="w-full"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.8, duration: 0.5 }}
                      >
                        <motion.div
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          transition={{ type: "spring", stiffness: 400 }}
                        >
                          <Button
                            type="button"
                            size="lg"
                            className={`w-full text-white font-semibold h-12 rounded-xl transition-all duration-300 shadow-lg hover:shadow-2xl border-0 focus:outline-none ${btnGrad}`}
                            onClick={startOidcLogin}
                            disabled={isLoading}
                          >
                            <div className="flex items-center justify-center space-x-3">
                              <span>{oidcConfig.buttonText}</span>
                              <motion.div
                                animate={{ x: [0, 4, 0] }}
                                transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 1 }}
                              >
                                <ArrowRight className="w-5 h-5" />
                              </motion.div>
                            </div>
                          </Button>
                        </motion.div>
                      </motion.div>
                    )}
                  </CardFooter>
              </div>
            </Card>
            </motion.div>

            {/* Signup Section Below Card */}
            <motion.div 
              className="mt-4 sm:mt-6 lg:mt-8 text-center"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.4, duration: 0.5 }}
            >
              <motion.div 
                className={`backdrop-blur-sm rounded-xl lg:rounded-2xl border p-3 sm:p-4 lg:p-6 relative overflow-hidden group ${featureBg}`}
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 400 }}
              >
                {/* Animated background gradient */}
                <motion.div
                  className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${jet ? 'bg-gradient-to-r from-teal-500/12 to-cyan-500/12' : 'bg-gradient-to-r from-blue-500/10 to-purple-500/10'}`}
                  animate={{
                    backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
                  }}
                  transition={{ duration: 4, repeat: Infinity }}
                />
                
                <div className="relative z-10">
                  <motion.p 
                    className={`text-sm sm:text-base mb-3 sm:mb-4 ${textMuted}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.6, duration: 0.5 }}
                  >
                    Don't have an account?
                  </motion.p>
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 400 }}
                  >
                    <Link
                      href="/signup"
                      className={`inline-flex items-center justify-center space-x-2 font-semibold px-4 sm:px-6 lg:px-8 py-2 sm:py-2.5 lg:py-3 rounded-lg sm:rounded-xl transition-all duration-300 border group/signup text-sm sm:text-base relative overflow-hidden ${linkBg} ${textColor}`}
                    >
                      {/* Button shine effect */}
                      <motion.div
                        className="absolute inset-0 -top-1 -left-1 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12 group-hover/signup:animate-pulse"
                        animate={{
                          x: ['-100%', '100%'],
                        }}
                        transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
                      />
                      
                      <span className="relative z-10">Sign up for free</span>
                      <motion.div
                        animate={{ x: [0, 3, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity, repeatDelay: 2 }}
                        className="relative z-10"
                      >
                        <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4" />
                      </motion.div>
                    </Link>
                  </motion.div>
                </div>
              </motion.div>
            </motion.div>

            {/* App Hub (View All Apps) */}
            <motion.div
              className="mt-4 sm:mt-5 lg:mt-7"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.35, duration: 0.5 }}
            >
              <motion.a
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                href={getIdpBaseUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className={`group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left shadow-lg shadow-black/10 transition-all focus:outline-none ${linkBg} ${textColor} ${jet ? 'focus:ring-2 focus:ring-teal-400/45' : 'focus:ring-2 focus:ring-blue-400/50'}`}
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-white/15 ${jet ? 'bg-gradient-to-br from-teal-500/35 to-cyan-500/35' : 'bg-gradient-to-br from-blue-500/30 to-purple-500/30'}`}>
                  <LayoutGrid className={`h-5 w-5 ${jet ? 'text-teal-700' : 'text-white'}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-5">Open App Hub</span>
                  <span className={`block truncate text-xs ${textMuted}`}>View all {brand.name} apps and tools</span>
                </span>
                <ArrowRight className={`h-4 w-4 shrink-0 transition-colors ${textMuted} group-hover:${textColor}`} />
              </motion.a>
            </motion.div>

            {/* Security Notice */}
            <motion.div 
              className="mt-3 sm:mt-4 lg:mt-6 flex items-center justify-center space-x-2 text-slate-400 text-xs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.6, duration: 0.5 }}
            >
              <motion.div
                animate={{ 
                  scale: [1, 1.1, 1],
                  rotate: [0, 5, 0]
                }}
                transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
              >
                <Shield className="w-3 h-3 sm:w-4 sm:h-4" />
              </motion.div>
              <motion.span 
                className="text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.8, duration: 0.5 }}
              >
                Your data is protected with enterprise-grade security
              </motion.span>
            </motion.div>

            {/* Mobile Secondary Logo */}
            {brand.secondaryLogo && (
              <motion.div 
                className="lg:hidden mt-10 flex flex-col items-center justify-center gap-2 opacity-80"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 2.0, duration: 0.5 }}
              >
                <span className="text-slate-400 text-xs font-medium">In partnership with</span>
                <Image src={brand.secondaryLogo} alt="Partner Logo" width={40} height={40} className="object-contain" />
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

