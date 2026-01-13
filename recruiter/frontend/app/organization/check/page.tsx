'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import '@/styles/animations.css';

export default function OrganizationCheckPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const {
    currentOrganization,
    organizations,
    isLoading: orgLoading,
    hasInitialized
  } = useOrganization();
  const [loadingMessage, setLoadingMessage] = useState('Setting up your workspace');
  const [error, setError] = useState<string | null>(null);

  // Main organization check flow
  useEffect(() => {
    const checkOrganizationStatus = async () => {
      // Wait until auth and organization data is loaded
      if (authLoading || orgLoading || !hasInitialized) {
        setLoadingMessage('Loading your account...');
        return;
      }

      // If not authenticated, redirect to login
      if (!isAuthenticated) {
        console.log('🔒 Not authenticated, redirecting to login');
        router.push('/login');
        return;
      }

      try {
        console.log('🏢 Checking organization status...');
        console.log('Organizations:', organizations);
        console.log('Current organization:', currentOrganization);

        // If user has an organization, go straight to dashboard
        if (organizations.length > 0 && currentOrganization) {
          console.log('✅ User has organization, redirecting to dashboard');
          setLoadingMessage('Loading your dashboard...');
          // Small delay to show the message
          await new Promise(resolve => setTimeout(resolve, 500));
          router.push('/dashboard');
          return;
        }

        // No organization found - redirect to IdP to create or join one
        // IdP is the single source of truth for organizations
        const idpUrl = process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000';
        const returnUrl = encodeURIComponent(window.location.origin + '/organization/check');

        console.log('🌐 No organization found, redirecting to IdP for org creation/joining');
        setLoadingMessage('Redirecting to Identity Provider...');
        await new Promise(resolve => setTimeout(resolve, 800));

        // Redirect to IdP organizations page with return URL
        window.location.href = `${idpUrl}/organizations?return_url=${returnUrl}`;

      } catch (err) {
        console.error('❌ Error during organization check:', err);
        setError('Failed to check organization status');
      }
    };

    checkOrganizationStatus();
  }, [
    authLoading,
    orgLoading,
    hasInitialized,
    isAuthenticated,
    currentOrganization,
    organizations,
    router
  ]);

  // Track mouse movement for background effect
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      setMousePosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // Define loading stages and their messages
  const loadingStages = [
    { icon: '🔒', message: 'Verifying your credentials...' },
    { icon: '🏢', message: 'Checking organization details...' },
    { icon: '📋', message: 'Loading your workspace...' },
    { icon: '📬', message: 'Checking for invitations...' },
    { icon: '📊', message: 'Preparing your dashboard...' }
  ];

  // Calculate which loading stage to show based on elapsed time
  const [loadingStage, setLoadingStage] = useState(0);

  useEffect(() => {
    // Create an auto-advancing loading stage effect
    const interval = setInterval(() => {
      setLoadingStage(prev => (prev + 1) % loadingStages.length);
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden flex items-center justify-center">
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

      {/* Floating Particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-blue-400/30 rounded-full animate-float"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDuration: `${3 + Math.random() * 5}s`,
              animationDelay: `${Math.random() * 2}s`
            }}
          ></div>
        ))}
      </div>

      {/* Main Content */}
      <div className="relative z-10 w-full max-w-md px-6">
        {error ? (
          // Enhanced Error Card
          <div className="bg-white/10 backdrop-blur-lg rounded-xl border border-white/20 shadow-2xl p-8 text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <div className="text-3xl">⚠️</div>
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">Something went wrong</h1>
            <p className="text-slate-300 mb-6">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all shadow-lg font-medium"
            >
              Try Again
            </button>
          </div>
        ) : (
          // Enhanced Loading Card
          <div className="bg-white/10 backdrop-blur-lg rounded-xl border border-white/20 shadow-2xl p-8">
            {/* Brand Logo */}
            <div className="mb-8 flex justify-center">
              <div className="relative">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-purple-600 rounded-xl flex items-center justify-center shadow-2xl">
                  <span className="font-extrabold text-white text-2xl tracking-tighter">HR</span>
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-slate-900 animate-pulse"></div>
              </div>
            </div>

            {/* Animated Loading Icon */}
            <div className="mb-8 relative">
              <div className="w-24 h-24 mx-auto relative">
                {/* Inner spinning circle */}
                <div className="absolute inset-0 border-4 border-t-blue-400 border-r-transparent border-b-purple-500 border-l-transparent rounded-full animate-spin"></div>

                {/* Middle pulsing ring */}
                <div className="absolute inset-2 border-2 border-white/20 rounded-full animate-ping opacity-75" style={{ animationDuration: '3s' }}></div>

                {/* Outer glowing ring */}
                <div className="absolute inset-0 border-2 border-blue-400/50 rounded-full animate-pulse"></div>

                {/* Center icon */}
                <div className="absolute inset-0 flex items-center justify-center text-2xl">
                  {loadingStages[loadingStage].icon}
                </div>
              </div>

              {/* Loading Progress Bar */}
              <div className="w-48 h-1 bg-white/10 rounded-full mx-auto mt-6 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
                  style={{
                    width: `${((loadingStage + 1) / loadingStages.length) * 100}%`,
                    transition: 'width 0.5s ease-out'
                  }}
                ></div>
              </div>
            </div>

            {/* Dynamic Message */}
            <div className="text-center">
              <h2 className="text-xl font-medium text-white mb-3">
                {loadingStages[loadingStage].message}
              </h2>
              <p className="text-slate-300 text-sm mb-4">
                {loadingMessage}
              </p>

              {/* Animated Dots */}
              <div className="flex justify-center space-x-2">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}></div>
                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms', animationDuration: '1s' }}></div>
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms', animationDuration: '1s' }}></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
