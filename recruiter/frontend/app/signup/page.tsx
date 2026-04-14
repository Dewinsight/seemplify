"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { oidcConfig } from "@/config/oidc.config";
import { getApiBaseUrl } from "@/utils/env";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  Shield,
  Users,
  Zap
} from "lucide-react";
import { useBrandConfig } from "@/context/BrandContext";

export default function SignupPage() {
  const brand = useBrandConfig();
  const [isLoading, setIsLoading] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Track mouse movement for the background effect
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      setMousePosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);


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
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-center p-6 lg:p-8 xl:p-12 2xl:p-16 relative">
          {/* Logo and Brand */}
          <div className="mb-6 lg:mb-8 xl:mb-12">
            <div className="flex items-center mb-6">
              {brand.useImageLogo && brand.logo ? (
                <div className="flex items-center">
                  <Image src={brand.logo} alt={brand.name} width={240} height={56} className="object-contain h-10 lg:h-12 xl:h-14 w-auto" />
                </div>
              ) : (
                <div className="relative">
                  <div className={`w-10 h-10 lg:w-12 lg:h-12 xl:w-14 xl:h-14 bg-gradient-to-br ${brand.gradient} rounded-xl flex items-center justify-center shadow-2xl`}>
                    <span className="font-extrabold text-white text-base lg:text-lg xl:text-xl tracking-tighter">{brand.shortName}</span>
                  </div>
                  <div className={`absolute -top-1 -right-1 w-3 h-3 lg:w-4 lg:h-4 ${brand.colors.pulse} rounded-full border-2 border-slate-900 animate-pulse`}></div>
                </div>
              )}
              <div className="ml-3 lg:ml-4">
                <h1 className="text-xl lg:text-2xl xl:text-3xl font-bold text-white">{brand.loginHeading || brand.name}</h1>
                <p className="text-slate-300 text-xs lg:text-sm">{brand.loginSubheading || brand.tagline}</p>
              </div>
            </div>
            
            <div className="max-w-md">
              <h2 className="text-2xl lg:text-3xl xl:text-4xl 2xl:text-5xl font-bold text-white mb-3 lg:mb-4 leading-tight">
                Join our
                <span className="block bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                  smart platform
                </span>
              </h2>
              <p className="text-slate-300 text-sm lg:text-base xl:text-lg leading-relaxed">
                Create your account and start transforming your hiring process today.
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
                icon: <Shield className="w-5 h-5" />,
                title: "Secure Platform",
                description: "Enterprise-grade security for your recruitment data"
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

          {/* Desktop Secondary Logo */}
          {brand.secondaryLogo && (
            <div className="absolute bottom-8 left-8 xl:bottom-12 xl:left-12 flex items-center gap-3 opacity-80">
              <span className="text-slate-400 text-sm font-medium">In partnership with</span>
              <Image src={brand.secondaryLogo} alt="Partner Logo" width={48} height={48} className="object-contain" />
            </div>
          )}
        </div>

        {/* Right Side - Signup Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md">
            {/* Mobile Logo */}
            <div className="lg:hidden flex justify-center mb-8">
              {brand.useImageLogo && brand.logo ? (
                <div className="flex items-center">
                  <Image src={brand.logo} alt={brand.name} width={200} height={48} className="object-contain h-12 w-auto" />
                </div>
              ) : (
                <div className={`w-14 h-14 bg-gradient-to-br ${brand.gradient} rounded-xl flex items-center justify-center shadow-2xl`}>
                  <span className="font-extrabold text-white text-xl tracking-tighter">{brand.shortName}</span>
                </div>
              )}
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

            {/* Enhanced Signup Card */}
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
                      Create Account
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
                      Sign up for your {brand.name} account
          </CardDescription>
                  </motion.div>
        </CardHeader>

                <div className="relative z-10">
                  <CardContent className="space-y-6 px-6">
                    {/* IDP Signup Description */}
                    <motion.div
                      className="text-center space-y-3"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.6, duration: 0.5 }}
                    >
                      <p className="text-slate-300 text-sm">
                        Create your account securely using {oidcConfig.providerName}
                      </p>
                    </motion.div>
                  </CardContent>

                  <CardFooter className="flex flex-col px-6 pt-1 pb-6">
                    {oidcConfig.enabled && (
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.8, duration: 0.5 }}
                        className="w-full"
                      >
                        <motion.div
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          transition={{ type: "spring", stiffness: 400 }}
                        >
                          <Button
                            type="button"
                            className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white py-6 rounded-lg font-medium text-base flex items-center justify-center gap-2 transition-all duration-300 border-0 shadow-lg hover:shadow-xl"
                            disabled={isLoading}
                            onClick={() => {
                              const base = getApiBaseUrl()
                              const returnTo = encodeURIComponent(window.location.href)
                              window.location.href = `${base}/api/auth/oidc/start?returnTo=${returnTo}`
                            }}
                          >
                            <span>{oidcConfig.buttonText.replace('Login', 'Sign up')}</span>
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </motion.div>

                        <p className="mt-6 text-center text-sm text-slate-300">
                          Already have an account?{" "}
                          <Link
                            href="/login"
                            className="font-medium text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            Sign In
                          </Link>
                        </p>
                      </motion.div>
                    )}
                  </CardFooter>
                </div>
              </Card>
            </motion.div>

            {/* Mobile Secondary Logo */}
            {brand.secondaryLogo && (
              <motion.div 
                className="lg:hidden mt-10 flex flex-col items-center justify-center gap-2 opacity-80"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.0, duration: 0.5 }}
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
