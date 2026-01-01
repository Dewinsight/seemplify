'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { handleAuthCallback, isAuthenticated } from '@/lib/api';

export default function Home() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for SSO callback (access token in URL hash)
    const hasNewToken = handleAuthCallback();
    
    if (hasNewToken) {
      // SSO successful - redirect to dashboard
      console.log('✅ SSO callback processed, redirecting to dashboard');
      router.push('/dashboard');
      return;
    }

    // Check if already authenticated
    if (isAuthenticated()) {
      console.log('✅ Already authenticated, redirecting to dashboard');
      router.push('/dashboard');
      return;
    }

    // Not authenticated - redirect to login
    console.log('🔒 Not authenticated, redirecting to login');
    router.push('/login');
  }, [router]);

  // Show loading while processing
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0f' }}>
      <div className="text-center">
        <div className="relative mx-auto mb-6 w-16 h-16">
          <div className="absolute inset-0 bg-gradient-to-tr from-amber-500 to-orange-400 rounded-2xl opacity-20 blur-xl animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 rounded-full border-[3px] border-amber-500/20 border-t-amber-500 animate-spin" />
          </div>
        </div>
        <p className="text-white/50 text-sm">Loading...</p>
      </div>
    </div>
  );
}
