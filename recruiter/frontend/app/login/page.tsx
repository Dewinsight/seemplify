"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { oidcConfig } from "@/config/oidc.config";
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

export default function LoginPage() {
  const { toast } = useToast();
  const auth = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isProcessingOIDC, setIsProcessingOIDC] = useState(false);

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


  // Show OIDC processing loader
  if (isProcessingOIDC) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden flex items-center justify-center">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-1000 pointer-events-none"></div>

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
              <div className="absolute inset-0 bg-gradient-to-tr from-blue-500 to-purple-500 rounded-full opacity-20 blur-xl"></div>
              <div className="absolute inset-2 border-4 border-transparent border-t-blue-400 border-r-purple-400 rounded-full"></div>
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-2xl font-bold text-white mb-3"
            >
              Completing Sign In
            </motion.h2>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-slate-300 text-sm"
            >
              Securely logging you into SmartHR...
            </motion.p>

            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.6, duration: 1.5 }}
              className="mt-6 h-1 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full origin-left"
            ></motion.div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div 
        className="absolute inset-0 opacity-30"
        style={{
          background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(59, 130, 246, 0.15), transparent 40%)`
        }}
      />
      
      {/* Floating Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
      <div className="absolute top-3/4 left-1/3 w-64 h-64 bg-pink-500/20 rounded-full blur-3xl animate-pulse delay-2000"></div>

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
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-center p-6 lg:p-8 xl:p-12 2xl:p-16">
          {/* Logo and Brand */}
          <div className="mb-6 lg:mb-8 xl:mb-12">
            <div className="flex items-center mb-6">
              <div className="relative">
                <div className="w-10 h-10 lg:w-12 lg:h-12 xl:w-14 xl:h-14 bg-gradient-to-br from-blue-400 to-purple-500 rounded-xl flex items-center justify-center shadow-2xl">
                  <span className="font-extrabold text-white text-base lg:text-lg xl:text-xl tracking-tighter">HR</span>
                </div>
                <div className="absolute -top-1 -right-1 w-3 h-3 lg:w-4 lg:h-4 bg-green-400 rounded-full border-2 border-slate-900 animate-pulse"></div>
              </div>
              <div className="ml-3 lg:ml-4">
                <h1 className="text-xl lg:text-2xl xl:text-3xl font-bold text-white">SmartHR</h1>
                <p className="text-slate-300 text-xs lg:text-sm">AI-Powered Recruitment</p>
              </div>
            </div>
            
            <div className="max-w-md">
              <h2 className="text-2xl lg:text-3xl xl:text-4xl 2xl:text-5xl font-bold text-white mb-3 lg:mb-4 leading-tight">
                Transform your
                <span className="block bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  hiring process
                </span>
              </h2>
              <p className="text-slate-300 text-sm lg:text-base xl:text-lg leading-relaxed">
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
                className="flex items-center p-2 lg:p-3 xl:p-4 bg-white/5 backdrop-blur-sm rounded-lg lg:rounded-xl border border-white/10 hover:bg-white/10 transition-all duration-300 group"
              >
                <div className="flex-shrink-0 w-8 h-8 lg:w-9 lg:h-9 xl:w-10 xl:h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform duration-300">
                  {feature.icon}
                </div>
                <div className="ml-2 lg:ml-3 xl:ml-4">
                  <h3 className="text-white font-semibold text-sm lg:text-base">{feature.title}</h3>
                  <p className="text-slate-300 text-xs lg:text-sm">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>


        </div>

        {/* Right Side - Login Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md">
            {/* Mobile Logo */}
            <div className="lg:hidden flex justify-center mb-8">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-400 to-purple-500 rounded-xl flex items-center justify-center shadow-2xl">
                <span className="font-extrabold text-white text-xl tracking-tighter">HR</span>
              </div>
            </div>

            {/* Floating Particles */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {Array.from({ length: 20 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-1 h-1 bg-blue-400/30 rounded-full"
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
              <Card className="bg-white/15 backdrop-blur-2xl border-white/30 shadow-2xl overflow-hidden relative">
                {/* Subtle Animated Border */}
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 rounded-lg animate-pulse opacity-30"></div>
                
                <CardHeader className="space-y-1 text-center pb-6 relative z-10">
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.5 }}
                  >
                    <CardTitle className="text-2xl font-bold text-white flex items-center justify-center gap-2">
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
                    <CardDescription className="text-slate-300 text-base">
                      Sign in to your SmartHR account
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
                      <p className="text-slate-300 text-sm">
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
                            className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-semibold h-12 rounded-xl transition-all duration-300 shadow-lg hover:shadow-2xl border-0 focus:ring-2 focus:ring-blue-400/50 focus:outline-none"
                            onClick={() => {
                              const base = getApiBaseUrl()
                              const returnTo = encodeURIComponent(window.location.href)
                              window.location.href = `${base}/api/auth/oidc/start?returnTo=${returnTo}`
                            }}
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
                className="bg-white/5 backdrop-blur-sm rounded-xl lg:rounded-2xl border border-white/10 p-3 sm:p-4 lg:p-6 relative overflow-hidden group"
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 400 }}
              >
                {/* Animated background gradient */}
                <motion.div
                  className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  animate={{
                    backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
                  }}
                  transition={{ duration: 4, repeat: Infinity }}
                />
                
                <div className="relative z-10">
                  <motion.p 
                    className="text-slate-300 text-sm sm:text-base mb-3 sm:mb-4"
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
                      className="inline-flex items-center justify-center space-x-2 bg-white/10 hover:bg-white/20 text-white font-semibold px-4 sm:px-6 lg:px-8 py-2 sm:py-2.5 lg:py-3 rounded-lg sm:rounded-xl transition-all duration-300 border border-white/20 hover:border-white/30 group/signup text-sm sm:text-base relative overflow-hidden"
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
                className="group flex w-full items-center gap-3 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-left text-white shadow-lg shadow-black/10 transition-all hover:border-white/30 hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-blue-400/50"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/30 to-purple-500/30 ring-1 ring-white/15">
                  <LayoutGrid className="h-5 w-5 text-white" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-5">Open App Hub</span>
                  <span className="block truncate text-xs text-slate-300">View all SmartHR apps and tools</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-white" />
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
          </div>
        </div>
      </div>
    </div>
  );
}

