'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { handleAuthCallback, isAuthenticated, authApi } from '@/lib/api';
import PageGuide from '@/components/PageGuide';
import { resolveIdpUrl } from '@/lib/runtimeConfig';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hubUrl = resolveIdpUrl();
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const error = searchParams.get('error');

  // Mouse tracking for interactive background
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Check for auth callback (access token in URL hash) or existing session
  useEffect(() => {
    const hasNewToken = handleAuthCallback();
    if (hasNewToken) {
      router.push('/');
      return;
    }
    if (isAuthenticated()) {
      router.replace('/');
      return;
    }
    if (!error) {
      setIsProcessing(true);
      authApi.login();
      return;
    }
    setIsLoading(false);
  }, [error, router]);

  const handleLogin = () => {
    setIsProcessing(true);
    authApi.login();
  };

  // Loading/Processing State
  if (isLoading || isProcessing) {
    return (
      <div className="min-h-screen relative overflow-hidden flex items-center justify-center" style={{ background: '#0a0a0f' }}>
        {/* Deep background layers */}
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(251, 146, 60, 0.15), transparent)' }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 60% 40% at 50% 120%, rgba(245, 158, 11, 0.1), transparent)' }} />
        
        {/* Noise texture */}
        <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")' }} />

        <div className="relative z-10 text-center">
          <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-3xl p-14 shadow-2xl">
            <div className="w-20 h-20 mx-auto mb-8 relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-amber-500 to-orange-400 rounded-2xl opacity-20 blur-2xl animate-pulse" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full border-[3px] border-amber-500/20 border-t-amber-500 animate-spin" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>

            <h2 className="text-2xl font-semibold text-white mb-3 tracking-tight">
              {isProcessing ? 'Redirecting...' : 'Signing In'}
            </h2>

            <p className="text-white/50 text-sm font-medium">
              {isProcessing
                ? 'Connecting to Identity Provider'
                : 'Completing secure authentication'}
            </p>

            <div className="mt-8 h-1 bg-white/[0.06] rounded-full overflow-hidden w-48 mx-auto">
              <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full animate-[shimmer_1.5s_ease-in-out_infinite]" style={{ width: '40%' }} />
            </div>
          </div>
        </div>

        <style jsx>{`
          @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(350%); }
          }
        `}</style>
        <PageGuide />
      </div>
    );
  }

  // Main Login Page
  return (
    <div className="min-h-screen relative overflow-hidden" style={{ background: '#0a0a0f' }}>
      {/* ===== BACKGROUND LAYERS ===== */}
      
      {/* Base gradient */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 100% 80% at 50% -30%, rgba(251, 146, 60, 0.12), transparent 70%)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 50% at 0% 50%, rgba(234, 88, 12, 0.08), transparent 50%)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 60% 40% at 100% 80%, rgba(245, 158, 11, 0.06), transparent 50%)' }} />
      
      {/* Interactive spotlight following mouse */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-300"
        style={{
          background: `radial-gradient(800px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(251, 146, 60, 0.06), transparent 40%)`
        }}
      />
      
      {/* Floating ambient orbs */}
      <div className="absolute top-20 left-[15%] w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(251, 146, 60, 0.08) 0%, transparent 70%)', filter: 'blur(60px)', animation: 'float1 20s ease-in-out infinite' }} />
      <div className="absolute bottom-20 right-[10%] w-[400px] h-[400px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(234, 88, 12, 0.06) 0%, transparent 70%)', filter: 'blur(50px)', animation: 'float2 25s ease-in-out infinite' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(245, 158, 11, 0.04) 0%, transparent 60%)', filter: 'blur(80px)', animation: 'float3 30s ease-in-out infinite' }} />
      
      {/* Subtle grid pattern */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.5) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px'
        }}
      />
      
      {/* Noise texture for depth */}
      <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.8\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")' }} />

      {/* ===== MAIN CONTENT ===== */}
      <div className="relative z-10 flex min-h-screen">
        
        {/* Left Side - Brand & Features */}
        <div className="hidden lg:flex lg:w-[55%] flex-col justify-center px-12 xl:px-20 2xl:px-28">
          
          {/* Brand Header */}
          <div className="mb-12">
            <div className="flex items-center gap-4 mb-10">
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl blur-xl opacity-40 group-hover:opacity-60 transition-opacity" />
                <div className="relative w-14 h-14 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight">SmartHR Payroll</h1>
                <p className="text-white/40 text-sm font-medium">Compensation Management</p>
              </div>
            </div>

            <h2 className="text-4xl xl:text-5xl 2xl:text-6xl font-bold text-white leading-[1.1] tracking-tight mb-6">
              Effortless payroll,
              <br />
              <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 bg-clip-text text-transparent">
                accurate results.
              </span>
            </h2>
            <p className="text-white/50 text-lg xl:text-xl leading-relaxed max-w-xl font-medium">
              Streamline salary processing, generate detailed payslips, and manage compensation — all in one secure platform.
            </p>
          </div>

          {/* Feature Cards */}
          <div className="grid gap-4">
            {[
              {
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                ),
                title: "Automated Payroll",
                description: "Process salaries with automatic tax calculations"
              },
              {
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                ),
                title: "Digital Payslips",
                description: "Detailed breakdowns of earnings & deductions"
              },
              {
                icon: (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                ),
                title: "Role-Based Access",
                description: "Secure permissions for HR, managers & employees"
              }
            ].map((feature, index) => (
              <div
                key={index}
                className="group flex items-center gap-5 p-5 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] hover:border-white/[0.1] transition-all duration-300"
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center text-amber-500 group-hover:scale-105 transition-transform duration-300">
                  {feature.icon}
                </div>
                <div>
                  <h3 className="text-white font-semibold text-base mb-1">{feature.title}</h3>
                  <p className="text-white/40 text-sm">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Side - Login Form */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 lg:px-12">
          
          {/* Mobile Logo */}
          <div className="lg:hidden flex flex-col items-center mb-10">
            <div className="relative mb-4">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl blur-xl opacity-40" />
              <div className="relative w-16 h-16 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg">
                <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <h1 className="text-xl font-bold text-white">SmartHR Payroll</h1>
          </div>

          <div className="w-full max-w-[400px]">
            
            {/* Login Card */}
            <div className="relative">
              {/* Card glow */}
              <div className="absolute -inset-px bg-gradient-to-b from-amber-500/20 via-transparent to-transparent rounded-3xl blur-sm" />
              
              <div className="relative bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-3xl p-8 shadow-2xl">
                
                {/* Header */}
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">
                    Welcome back
                  </h2>
                  <p className="text-white/40 text-sm">
                    Sign in to access your payroll dashboard
                  </p>
                </div>

                {/* Error Display */}
                {error && (
                  <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm font-medium">
                    {decodeURIComponent(error)}
                  </div>
                )}

                {/* SSO Info */}
                <div className="mb-6 p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                      <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-white/70 text-sm font-medium">Single Sign-On</p>
                      <p className="text-white/40 text-xs">Secure authentication via your IdP</p>
                    </div>
                  </div>
                </div>

                {/* Login Button */}
                <button
                  onClick={handleLogin}
                  className="group relative w-full overflow-hidden rounded-xl py-4 px-6 font-semibold text-white transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                >
                  {/* Button gradient background */}
                  <div className="absolute inset-0 bg-gradient-to-r from-amber-500 to-orange-500" />
                  <div className="absolute inset-0 bg-gradient-to-r from-amber-600 to-orange-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  {/* Button shine effect */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.1) 45%, transparent 50%)' }} />
                  
                  {/* Button content */}
                  <span className="relative flex items-center justify-center gap-3">
                    <span>Continue with Identity Provider</span>
                    <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </span>
                </button>
              </div>
            </div>

            {/* App Hub Link */}
            <a
              href={hubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-6 flex items-center gap-4 w-full rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 transition-all hover:bg-white/[0.04] hover:border-white/[0.1]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.05]">
                <svg className="h-5 w-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-white/80">SmartHR Hub</span>
                <span className="block text-xs text-white/40">Access all applications</span>
              </span>
              <svg className="h-4 w-4 text-white/30 group-hover:text-white/60 group-hover:translate-x-0.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </a>

            {/* Security Badge */}
            <div className="mt-8 flex items-center justify-center gap-2 text-white/30 text-xs">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>Enterprise-grade security & encryption</span>
            </div>
          </div>
        </div>
      </div>

      {/* CSS Animations */}
      <style jsx>{`
        @keyframes float1 {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(30px, -30px); }
        }
        @keyframes float2 {
          0%, 100% { transform: translate(0, 0); }
          50% { transform: translate(-20px, 20px); }
        }
        @keyframes float3 {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-50%, -50%) scale(1.1); }
        }
      `}</style>
      <PageGuide />
    </div>
  );
}
