"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { oidcConfig } from "@/config/oidc.config";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Shield,
  Users,
  Zap,
  BarChart3,
  LayoutGrid
} from "lucide-react";
import { SeemplifyRecruiterLogo } from "@/components/SeemplifyLogo";

export default function SignupPage() {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-indigo-500/30 relative overflow-hidden">
      <div className="bg-noise" />

      {/* Ambient Lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[1000px] h-[1000px] bg-indigo-900/20 rounded-full blur-[120px] opacity-20" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[800px] h-[800px] bg-violet-900/20 rounded-full blur-[120px] opacity-20" />
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
              <h2 className="text-4xl xl:text-5xl font-bold tracking-tighter mb-6 bg-gradient-to-br from-white via-white to-zinc-500 bg-clip-text text-transparent">
                Start your hiring<br />transformation.
              </h2>
              <p className="text-lg text-zinc-400 leading-relaxed font-light">
                Create your account and discover AI-powered recruitment tools designed for modern teams.
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
                className="group flex items-center p-4 glass-card rounded-xl border border-white/[0.06] hover:border-white/[0.1] transition-all duration-300"
              >
                <div className={`flex-shrink-0 w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center ${feature.color} group-hover:bg-white/10 transition-colors`}>
                  {feature.icon}
                </div>
                <div className="ml-4">
                  <h3 className="text-white font-medium text-sm">{feature.title}</h3>
                  <p className="text-zinc-500 text-xs">{feature.description}</p>
                </div>
                <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-1 h-1 rounded-full bg-indigo-500" />
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Right Side - Signup Form */}
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

            {/* Signup Card - Glass Card Style */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <div className="glass-card rounded-2xl p-8 border border-white/[0.08]">
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-bold gradient-text tracking-tight mb-2">
                    Create Account
                  </h2>
                  <p className="text-zinc-400 text-sm">
                    Sign up for Seemplify Recruiter
                  </p>
                </div>

                <div className="space-y-6">
                  {/* IDP Signup Description */}
                  <div className="text-center">
                    <p className="text-zinc-500 text-sm">
                      Create your account securely using {oidcConfig.providerName}
                    </p>
                  </div>

                  {/* Signup Button */}
                  {oidcConfig.enabled && (
                    <motion.div
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                    >
                      <Button
                        type="button"
                        className="w-full h-12 bg-white text-black rounded-lg font-medium hover:bg-zinc-200 transition-all duration-300"
                        onClick={() => {
                          const base = process.env.NEXT_PUBLIC_API_BASE_URL || ''
                          const returnTo = encodeURIComponent(window.location.href)
                          window.location.href = `${base}/api/auth/oidc/start?returnTo=${returnTo}`
                        }}
                        disabled={isLoading}
                      >
                        <div className="flex items-center justify-center space-x-2">
                          <span>{oidcConfig.buttonText.replace('Login', 'Sign up')}</span>
                          <ArrowRight className="w-4 h-4" />
                        </div>
                      </Button>
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>

            {/* Login Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="mt-6"
            >
              <div className="glass-card rounded-xl p-6 border border-white/[0.06] text-center">
                <p className="text-zinc-400 text-sm mb-4">
                  Already have an account?
                </p>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center px-6 py-2.5 border border-zinc-800 rounded-lg font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition-all duration-300 text-sm"
                >
                  Sign in
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </div>
            </motion.div>

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
                className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.06] glass-card px-4 py-3 text-left transition-all hover:border-white/[0.1]"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5">
                  <LayoutGrid className="h-5 w-5 text-zinc-400" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-zinc-200">Open App Hub</span>
                  <span className="block truncate text-xs text-zinc-500">View all Seemplify apps</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500 transition-colors group-hover:text-white" />
              </a>
            </motion.div>

            {/* Security Notice */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="mt-6 flex items-center justify-center space-x-2 text-zinc-500 text-xs"
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