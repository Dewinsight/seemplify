"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { oidcConfig } from "@/config/oidc.config";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { tokenManager } from "@/utils/tokenManager";
import {
  ArrowRight,
  Zap,
  Shield,
  Users,
  BarChart3,
  LayoutGrid,
  AlertTriangle,
  Building2,
  LogIn,
  X
} from "lucide-react";
import SeemplifyLogo, { SeemplifyIcon, SeemplifyRecruiterLogo } from "@/components/SeemplifyLogo";

import { ThemeToggle } from "@/components/ui/theme-toggle";

// Staff role access denied error state
interface StaffRoleError {
  type: 'staff_role_denied';
  orgName: string;
  hubUrl: string;
  hasOtherOrgs: boolean;
}

export default function LoginPage() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessingOIDC, setIsProcessingOIDC] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<StaffRoleError | null>(null);

  // Check for error parameters in URL and display appropriate message
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const searchParams = window.location.search;
      console.log('🔍 Login page - checking for error params:', searchParams);
      
      const params = new URLSearchParams(searchParams);
      const errorType = params.get('error');
      
      console.log('🔍 Error type:', errorType);
      
      if (errorType === 'staff_role_denied') {
        // Handle staff role denial with structured data
        const orgName = params.get('orgName') || 'your current organization';
        const hubUrl = params.get('hubUrl') || process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000';
        const hasOtherOrgs = params.get('hasOtherOrgs') === 'true';
        
        console.log('🚫 Staff role denied:', { orgName, hubUrl, hasOtherOrgs });
        
        setStaffError({
          type: 'staff_role_denied',
          orgName,
          hubUrl,
          hasOtherOrgs
        });
        
        // Show toast notification
        toast({
          title: "Access Restricted",
          description: `Your role in "${orgName}" is Staff, which does not have access to Recruiter.`,
          variant: "destructive",
          duration: 10000,
        });
        
        // Clean up URL (delay slightly to ensure state is set)
        setTimeout(() => {
          window.history.replaceState({}, '', window.location.pathname);
        }, 100);
      } else if (errorType) {
        // Handle generic errors
        console.log('❌ Generic error:', errorType);
        setErrorMessage(errorType);
        toast({
          title: "Access Denied",
          description: errorType,
          variant: "destructive",
          duration: 10000,
        });
        
        // Clean up URL
        const url = new URL(window.location.href);
        url.searchParams.delete('error');
        window.history.replaceState({}, '', url.pathname);
      }
    }
  }, []);

  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    const search = typeof window !== 'undefined' ? window.location.search : ''
    // ... existing logging code ...
    const getCookie = (name: string) => {
      if (typeof document === 'undefined') {
        return ''
      }
      const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
      return match ? decodeURIComponent(match[1]) : ''
    }
    const cookieToken = getCookie('dev_jwt')
    const cookieRefresh = getCookie('dev_refreshToken')
    const cookieExpiresIn = getCookie('dev_expiresIn')

    console.log('🔐 Login page checking for OIDC tokens:', {
      hasHash: !!hash,
      hashContent: hash ? hash.substring(0, 50) + '...' : 'none',
      hasToken: hash.includes('token=') || search.includes('token=') || !!cookieToken
    })

    if ((hash && hash.includes('token=')) || (search && search.includes('token=')) || (cookieToken && cookieRefresh)) {
      setIsProcessingOIDC(true)
      const hashParams = new URLSearchParams(hash.replace('#', ''))
      const searchParams = new URLSearchParams(search)
      const token = hashParams.get('token') || searchParams.get('token') || cookieToken || ''
      const refreshToken = hashParams.get('refreshToken') || searchParams.get('refreshToken') || cookieRefresh || ''
      const expiresIn = hashParams.get('expiresIn') || searchParams.get('expiresIn') || cookieExpiresIn || '10m'

      console.log('🎯 Processing OIDC login:', {
        hasToken: !!token,
        hasRefreshToken: !!refreshToken,
        expiresIn: expiresIn
      })

      if (token && refreshToken) {
        try {
          console.log('📝 Starting token initialization...')
          // Store tokens directly using tokenManager (no AuthContext needed)
          tokenManager.initialize(token, refreshToken, expiresIn)

          // Clean up URL and cookies
          if (typeof window !== 'undefined') {
            const url = new URL(window.location.href)
            url.hash = ''
            url.searchParams.delete('token')
            url.searchParams.delete('refreshToken')
            url.searchParams.delete('expiresIn')
            window.history.replaceState({}, '', url.pathname)
            document.cookie = 'dev_jwt=; Max-Age=0; path=/'
            document.cookie = 'dev_refreshToken=; Max-Age=0; path=/'
            document.cookie = 'dev_expiresIn=; Max-Age=0; path=/'

            // Redirect to organization check
            console.log('🔄 Redirecting to organization check...')
            window.location.href = '/organization/check'
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
      }
    }
  }, [])


  // Show OIDC processing loader - Marketing Site Style
  if (isProcessingOIDC) {
    return (
      <div className="min-h-screen bg-background text-foreground relative overflow-hidden flex items-center justify-center">
        <div className="bg-noise z-0" />

        {/* Theme Toggle Positioned Absolute */}
        <div className="absolute top-6 right-6 z-50">
          <ThemeToggle />
        </div>

        {/* Ambient Lighting */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-20%] left-[-10%] w-[1000px] h-[1000px] bg-indigo-500/10 dark:bg-indigo-900/20 rounded-full blur-[120px] opacity-20" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[800px] h-[800px] bg-violet-500/10 dark:bg-violet-900/20 rounded-full blur-[120px] opacity-20" />
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="relative z-10 text-center"
        >
          <div className="glass-card rounded-2xl p-12 border border-border/50 dark:border-white/[0.08] shadow-xl">
            <motion.div
              animate={{
                rotate: 360,
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "linear"
              }}
              className="w-20 h-20 mx-auto mb-8 relative"
            >
              <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full opacity-20 blur-xl"></div>
              <div className="absolute inset-2 border-2 border-transparent border-t-indigo-400 border-r-purple-400 rounded-full"></div>
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-2xl font-bold gradient-text mb-3 tracking-tight"
            >
              Completing Sign In
            </motion.h2>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-muted-foreground text-sm"
            >
              Securely logging you into Seemplify Recruiter...
            </motion.p>

            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.6, duration: 1.5 }}
              className="mt-8 h-[2px] bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full origin-left"
            ></motion.div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-indigo-500/30 relative overflow-hidden transition-colors duration-300">
      <div className="bg-noise z-0" />

      {/* Theme Toggle Positioned Absolute */}
      <div className="absolute top-6 right-6 z-50">
        <ThemeToggle />
      </div>

      {/* Ambient Lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[1000px] h-[1000px] bg-indigo-500/10 dark:bg-indigo-900/20 rounded-full blur-[120px] opacity-20" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[800px] h-[800px] bg-violet-500/10 dark:bg-violet-900/20 rounded-full blur-[120px] opacity-20" />
      </div>

      <div className="relative z-10 flex min-h-screen">
        {/* Left Side - Brand & Features */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-center px-12 xl:px-20 2xl:px-24">
          {/* Logo and Brand */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="mb-12"
          >
            <div className="mb-8">
              <SeemplifyRecruiterLogo size="lg" />
            </div>

            <div className="max-w-lg">
              <h2 className="text-4xl xl:text-5xl font-bold tracking-tighter mb-6 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-600 dark:from-white dark:via-white dark:to-zinc-500 bg-clip-text text-transparent transition-all duration-300">
                Transform your<br />hiring process.
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed font-light">
                Leverage AI-driven insights to find the perfect candidates faster than ever before.
              </p>
            </div>
          </motion.div>

          {/* Feature Cards - Marketing Site Style */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="space-y-3"
          >
            {[
              {
                icon: <Zap className="w-5 h-5" />,
                title: "AI-Powered Matching",
                description: "95% accuracy candidate matching",
                color: "text-blue-400"
              },
              {
                icon: <BarChart3 className="w-5 h-5" />,
                title: "Smart Analytics",
                description: "Real-time insights and metrics",
                color: "text-purple-400"
              },
              {
                icon: <Users className="w-5 h-5" />,
                title: "Team Collaboration",
                description: "Seamless hiring workflow",
                color: "text-emerald-400"
              }
            ].map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + (index * 0.1), duration: 0.5 }}
                className="group flex items-center p-4 glass-card rounded-xl border border-border/50 dark:border-white/[0.06] hover:border-border dark:hover:border-white/[0.1] transition-all duration-300 shadow-sm hover:shadow-md dark:shadow-none"
              >
                <div className={`flex-shrink-0 w-10 h-10 rounded-lg bg-indigo-50 dark:bg-white/5 flex items-center justify-center ${feature.color} group-hover:bg-indigo-100 dark:group-hover:bg-white/10 transition-colors`}>
                  {feature.icon}
                </div>
                <div className="ml-4">
                  <h3 className="text-foreground dark:text-white font-medium text-sm">{feature.title}</h3>
                  <p className="text-muted-foreground text-xs">{feature.description}</p>
                </div>
                <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-1 h-1 rounded-full bg-indigo-500" />
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Right Side - Login Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md">
            {/* Mobile Logo */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="lg:hidden flex justify-center mb-10"
            >
              <SeemplifyRecruiterLogo size="md" />
            </motion.div>

            {/* Login Card - Glass Card Style */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <div className="glass-card rounded-2xl p-8 border border-border/50 dark:border-white/[0.08] shadow-2xl dark:shadow-none">
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-bold text-foreground dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-tr dark:from-white dark:via-white dark:to-white/50 tracking-tight mb-2 transition-all duration-300">
                    Welcome back
                  </h2>
                  <p className="text-slate-600 dark:text-muted-foreground text-sm font-medium">
                    Sign in to Seemplify Recruiter
                  </p>
                </div>

                <div className="space-y-6">
                  {/* Staff Role Access Denied Alert */}
                  {staffError && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">
                            Access Restricted
                          </h3>
                          <p className="text-sm text-amber-700 dark:text-amber-400 mb-3">
                            Your role in <strong className="font-semibold">{staffError.orgName}</strong> is <span className="font-medium">Staff</span>, which does not have access to Recruiter.
                          </p>
                          
                          {staffError.hasOtherOrgs ? (
                            <p className="text-xs text-amber-600 dark:text-amber-500 mb-4">
                              You have other organizations with Recruiter access. Switch to a different organization in the Hub to continue.
                            </p>
                          ) : (
                            <p className="text-xs text-amber-600 dark:text-amber-500 mb-4">
                              Contact your organization administrator to request Recruiter access, or sign in with a different account.
                            </p>
                          )}
                          
                          {/* Action Buttons */}
                          <div className="flex flex-wrap gap-2">
                            {staffError.hasOtherOrgs && (
                              <a
                                href={`${staffError.hubUrl}/organizations`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-lg transition-colors"
                              >
                                <Building2 className="w-3.5 h-3.5" />
                                Switch Organization
                              </a>
                            )}
                            <a
                              href={staffError.hubUrl}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/50 dark:hover:bg-amber-800/50 text-amber-700 dark:text-amber-300 text-xs font-medium rounded-lg transition-colors"
                            >
                              <LayoutGrid className="w-3.5 h-3.5" />
                              Go to Hub
                            </a>
                          </div>
                        </div>
                        <button
                          onClick={() => setStaffError(null)}
                          className="flex-shrink-0 text-amber-400 hover:text-amber-600 dark:text-amber-500 dark:hover:text-amber-300 transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* Generic Error Alert */}
                  {errorMessage && !staffError && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-lg"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0">
                          <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <div className="flex-1">
                          <h3 className="text-sm font-semibold text-red-800 dark:text-red-300 mb-1">Access Denied</h3>
                          <p className="text-sm text-red-700 dark:text-red-400">{errorMessage}</p>
                        </div>
                        <button
                          onClick={() => setErrorMessage(null)}
                          className="flex-shrink-0 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-300 transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* IDP Login Description */}
                  <div className="text-center">
                    <p className="text-muted-foreground text-sm">
                      Sign in securely using your {oidcConfig.providerName} account
                    </p>
                  </div>

                  {/* Login Button */}
                  {oidcConfig.enabled && (
                    <motion.div
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                    >
                      <Button
                        type="button"
                        className="w-full h-12 bg-foreground text-background dark:bg-white dark:text-black rounded-lg font-medium hover:opacity-90 transition-all duration-300 shadow-md"
                        onClick={() => {
                          const envBase =
                            process.env.NEXT_PUBLIC_API_BASE_URL ||
                            process.env.NEXT_PUBLIC_API_URL
                          const hostname = window.location.hostname
                          const derivedBase = hostname.includes('localhost') || hostname.startsWith('127.0.0.1')
                            ? 'http://localhost:5001'
                            : hostname.includes('-dev')
                              ? 'https://api-dev.seemplifyai.com'
                              : 'https://api.seemplifyai.com'
                          const base = envBase || derivedBase
                          const returnTo = encodeURIComponent(window.location.href)
                          window.location.href = `${base}/api/auth/oidc/start?returnTo=${returnTo}`
                        }}
                        disabled={isLoading}
                      >
                        <div className="flex items-center justify-center space-x-2">
                          <span>{oidcConfig.buttonText}</span>
                          <ArrowRight className="w-4 h-4" />
                        </div>
                      </Button>
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Sign up is handled by the IDP; no separate signup page */}

            {/* App Hub */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="mt-4"
            >
              <a
                href={process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex w-full items-center gap-3 rounded-xl border border-border/50 dark:border-white/[0.06] glass-card px-4 py-3 text-left transition-all hover:border-primary/50 dark:hover:border-white/[0.1] shadow-sm hover:shadow-md dark:shadow-none"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-white/5 text-primary/70 dark:text-zinc-400 group-hover:text-primary dark:group-hover:text-zinc-200 transition-colors">
                  <LayoutGrid className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground dark:text-zinc-200">Open App Hub</span>
                  <span className="block truncate text-xs text-muted-foreground">View all Seemplify apps</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary dark:group-hover:text-white" />
              </a>
            </motion.div>

            {/* Security Notice */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="mt-6 flex items-center justify-center space-x-2 text-muted-foreground text-xs"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Enterprise-grade security</span>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
