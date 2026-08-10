"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Building, ArrowRight, Sparkles, Users, Zap, Shield, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { BrandedLoadingScreen } from '@/components/BrandedLoadingScreen';

export default function SignupSuccessPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [countdown, setCountdown] = useState(10);
  const [manualRedirect, setManualRedirect] = useState(false);
  const [isValidSignupSuccess, setIsValidSignupSuccess] = useState<boolean | null>(null);
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
  
  // Check for signup session validity
  useEffect(() => {
    const checkSignupSession = () => {
      if (typeof window === 'undefined') return;
      
      // Check if we have the signup success flag
      const signupSuccess = sessionStorage.getItem('signupSuccess');
      const signupTime = sessionStorage.getItem('signupTime');
      const hasJwtToken = localStorage.getItem('jwt');
      const hasRefreshToken = localStorage.getItem('refreshToken');
      
      // Consider valid if either:
      // 1. We have the signupSuccess flag from the signup flow OR
      // 2. We have auth tokens AND we're coming directly from the signup page
      const isValid = Boolean(
        (signupSuccess === 'true' && hasJwtToken) || 
        (hasJwtToken && document.referrer.includes('/signup'))
      );
      
      console.log('Signup success validity check:', {
        signupSuccess,
        signupTime: signupTime ? new Date(parseInt(signupTime)).toISOString() : null,
        hasJwtToken: !!hasJwtToken,
        hasRefreshToken: !!hasRefreshToken,
        referrer: document.referrer,
        isValid
      });
      
      setIsValidSignupSuccess(isValid);
      
      // Don't remove signup flags yet, just mark that we've validated them
      // This allows potential API calls to still work without triggering redirect
    };
    
    // Check immediately and again after a short delay
    // (to handle page refreshes and navigation)
    checkSignupSession();
    const delayedCheck = setTimeout(checkSignupSession, 200);
    return () => clearTimeout(delayedCheck);
  }, []);
  
  // Handle redirection for invalid sessions
  useEffect(() => {
    // Only redirect if we've determined it's not a valid signup success
    // and we're not still loading authentication status
    if (isValidSignupSuccess === false && !isLoading) {
      console.log('Invalid signup session, redirecting to login');
      router.push('/login');
    }
    
    // If it's a valid signup and we also have auth context, make sure we're authenticated
    if (isValidSignupSuccess && !isLoading && !isAuthenticated) {
      console.log('Valid signup but not authenticated in context, checking tokens');
      const hasJwtToken = localStorage.getItem('jwt');
      
      if (!hasJwtToken) {
        console.log('No JWT token found, redirecting to login');
        router.push('/login');
      }
    }
  }, [isValidSignupSuccess, isLoading, isAuthenticated, router]);
  
  // Countdown for automatic redirect
  useEffect(() => {
    if (!manualRedirect) {
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            // Redirect to login page after countdown
            window.location.href = '/login';
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      
      return () => clearInterval(timer);
    }
  }, [manualRedirect]);
  
  // Clean up signup flow flags when leaving success page
  useEffect(() => {
    return () => {
      // This will run when the component unmounts (user leaves the page)
      if (typeof window !== 'undefined') {
        console.log('Cleaning up signup flow flags');
        sessionStorage.removeItem('inSignupFlow');
        sessionStorage.removeItem('signupSuccess');
      }
    };
  }, []);
  
  // Handle manual redirect
  const handleContinue = () => {
    setManualRedirect(true);
    
    // Clean up signup flow flags
    sessionStorage.removeItem('inSignupFlow');
    sessionStorage.removeItem('signupSuccess');
    
    // Redirect to login page instead of organization check
    window.location.href = '/login';
  };
  
  // Only show loading if we haven't determined validity yet
  // OR if we're still loading auth and haven't determined the session is invalid
  if ((isValidSignupSuccess === null && isLoading) || 
      (isValidSignupSuccess !== false && isLoading)) {
    return (
      <BrandedLoadingScreen
        message="Preparing your new Recruiter account…"
        stages={[{ label: 'Verifying account setup', icon: ShieldCheck }]}
      />
    );
  }
  
  // If we've determined it's not valid and we're not still checking
  if (isValidSignupSuccess === false && !isLoading) {
    // Let the redirect effect handle this
    return (
      <BrandedLoadingScreen
        message="Taking you to the secure sign-in page…"
        stages={[{ label: 'Redirecting to sign in', icon: ShieldCheck }]}
      />
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
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-green-500/20 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000"></div>
      
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
      
      <div className="relative z-10 flex h-screen items-center justify-center p-6">
        <motion.div 
          className="w-full max-w-lg"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Card className="bg-white/15 backdrop-blur-2xl border-white/30 shadow-2xl overflow-hidden relative">
            <div className="absolute inset-0 bg-gradient-to-r from-green-500/10 via-blue-500/10 to-purple-500/10 rounded-lg animate-pulse opacity-30"></div>
            
            <CardHeader className="text-center pb-6 relative z-10">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="mx-auto bg-gradient-to-br from-green-400 to-green-600 rounded-full p-3 mb-4 shadow-lg"
              >
                <CheckCircle2 className="h-10 w-10 text-white" />
              </motion.div>
              
              <motion.div
                initial={{ y: -10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.3 }}
              >
                <CardTitle className="text-2xl font-bold text-white flex items-center justify-center gap-2">
                  Account Created Successfully!
                  <motion.div
                    animate={{ rotate: [0, 10, 0] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <Sparkles className="h-5 w-5 text-yellow-400" />
                  </motion.div>
                </CardTitle>
              </motion.div>
              
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.4 }}
              >
                <CardDescription className="text-slate-300 text-base mt-2">
                  Congratulations! You've taken the first step toward smarter recruiting.
                </CardDescription>
              </motion.div>
            </CardHeader>
            
            <CardContent className="space-y-6 px-6 relative z-10">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="bg-white/10 p-5 rounded-lg border border-white/20"
              >
                <h3 className="text-lg font-medium mb-3 flex items-center gap-2 text-white">
                  <Building className="h-5 w-5 text-blue-400" />
                  Next Steps
                </h3>
                <p className="text-slate-300 mb-4">
                  Your next steps to get started with the platform:
                </p>
                <ul className="space-y-3 text-slate-200">
                  {[
                    "Login with your new credentials",
                    "Create or join an organization after login",
                    "Set up your profile information"
                  ].map((item, i) => (
                    <motion.li 
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: 0.6 + (i * 0.1) }}
                      className="flex items-center gap-2"
                    >
                      <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                      {item}
                    </motion.li>
                  ))}
                </ul>
              </motion.div>
              
              {!manualRedirect && (
                <motion.div 
                  className="text-center text-slate-300 text-sm bg-white/5 rounded-lg py-2 px-4 border border-white/10"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.8 }}
                >
                  Redirecting in <span className="font-medium text-white">{countdown}</span> seconds...
                </motion.div>
              )}
            </CardContent>
            
            <CardFooter className="px-6 pt-1 pb-6 relative z-10">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.9 }}
                className="w-full"
              >
                <Button 
                  onClick={handleContinue}
                  className="w-full bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 text-white py-6 rounded-lg font-medium text-base flex items-center justify-center gap-2 transition-all duration-300 border-0 shadow-lg hover:shadow-xl"
                >
                  Continue to Login
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </motion.div>
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

