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
              <div className="flex items-center gap-4 mb-6">
                <div className="flex flex-shrink-0 items-center">
                  <Image
                    src="/akwa-arise-combined-logo.png"
                    alt="Government of Akwa Ibom State · ARISE"
                    width={280}
                    height={80}
                    className="h-14 w-auto max-w-[min(100%,320px)] object-contain lg:h-16 xl:h-[4.5rem]"
                  />
                </div>
                <div>
                  <h1 className="text-base lg:text-lg xl:text-xl font-extrabold text-green-900 leading-tight">
                    Govt. of Akwa Ibom State
                  </h1>
                  <p className="text-[11px] lg:text-xs text-green-700/70 mb-2">The Land of Promise · Nigeria</p>
                  <div className="flex items-center gap-2 bg-white/60 border border-green-100 rounded-lg px-2 py-1">
                    <span className="text-[10px] lg:text-xs text-slate-500 whitespace-nowrap">Powered by</span>
                    <Image src="/jetstone-logo.png" alt="Jetstone Education" width={100} height={22} className="object-contain h-4 lg:h-5 w-auto" />
                  </div>
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
                    <h1 className="text-xl lg:text-2xl xl:text-3xl font-bold text-white">{brand.loginHeading || brand.name}</h1>
                    <p className="text-xs lg:text-sm text-slate-300">{brand.loginSubheading || brand.tagline}</p>
                  </div>
                )}
              </div>
            )}
            
            <div className="max-w-md">
              <h2 className={`text-2xl lg:text-3xl xl:text-4xl 2xl:text-5xl font-bold mb-3 lg:mb-4 leading-tight ${textColor}`}>
                Join our
                <span className={`block bg-clip-text text-transparent bg-gradient-to-r ${accentGrad}`}>
                  smart platform
                </span>
              </h2>
              <p className={`text-sm lg:text-base xl:text-lg leading-relaxed ${textMuted}`}>
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

          {/* Desktop Secondary Logo */}
          {/* Desktop Secondary Logo — hide for Jetstone */}
          {brand.secondaryLogo && !jet && (
            <div className="absolute bottom-8 left-8 xl:bottom-12 xl:left-12 flex items-center gap-3 opacity-80">
              <span className={`text-sm font-medium ${textMuted}`}>In partnership with</span>
              <Image src={brand.secondaryLogo} alt="Partner Logo" width={48} height={48} className="object-contain" />
            </div>
          )}
        </div>

        {/* Right Side - Signup Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md">
            {/* Mobile Logo */}
            <div className="lg:hidden flex justify-center mb-8">
              {jet ? (
                <div className="flex items-center justify-center">
                  <Image
                    src="/akwa-arise-combined-logo.png"
                    alt="Government of Akwa Ibom State · ARISE"
                    width={260}
                    height={72}
                    className="h-12 w-auto max-w-[280px] object-contain"
                  />
                </div>
              ) : brand.useImageLogo && brand.logo ? (
                <div className="flex items-center">
                  <Image src={brand.logo} alt={brand.name} width={200} height={48} className="object-contain h-12 w-auto" />
                </div>
              ) : (
                <div className={`w-14 h-14 bg-gradient-to-br ${brand.gradient} rounded-xl flex items-center justify-center shadow-2xl`}>
                  <span className={`font-extrabold text-xl tracking-tighter ${textColor}`}>{brand.shortName}</span>
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

            {/* Enhanced Signup Card */}
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
                    <CardDescription className={`text-base ${textMuted}`}>
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
                      <p className={`text-sm ${textMuted}`}>
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
                            className={`w-full text-white py-6 rounded-lg font-medium text-base flex items-center justify-center gap-2 transition-all duration-300 border-0 shadow-lg hover:shadow-xl ${btnGrad}`}
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

                        <p className={`mt-6 text-center text-sm ${textMuted}`}>
                          Already have an account?{" "}
                          <Link
                            href="/login"
                            className={`font-medium transition-colors ${jet ? 'text-green-700 hover:text-green-600' : 'text-blue-400 hover:text-blue-300'}`}
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

            {/* Mobile Secondary Logo — hide for Jetstone */}
            {brand.secondaryLogo && !jet && (
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
