"use client";

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAdmin } from '@/context/AdminContext';

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

export default function AdminProtectedRoute({ children }: AdminProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAdmin();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    console.log('🛡️ AdminProtectedRoute effect:', { 
      isLoading, 
      isAuthenticated, 
      pathname,
      isAdminLoginPage: pathname === '/admin/login'
    });
    
    if (isLoading) return;

    const isAdminLoginPage = pathname === '/admin/login';
    const isPasswordResetRoute = pathname?.startsWith('/admin/forgot-password') ||
                                pathname?.startsWith('/admin/reset-password');

    // Skip protection for password reset routes
    if (isPasswordResetRoute) {
      console.log('🔓 Password reset route - skipping protection');
      return;
    }

    if (!isAuthenticated && !isAdminLoginPage) {
      console.log('🚫 Not authenticated, redirecting to admin login');
      router.push('/admin/login');
    } else if (isAuthenticated && isAdminLoginPage) {
      console.log('✅ Authenticated on login page, redirecting to dashboard');
      router.push('/admin/dashboard');
    } else {
      console.log('✅ AdminProtectedRoute: Allowing access');
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  const isAdminLoginPage = pathname === '/admin/login';
  const isPasswordResetRoute = pathname?.startsWith('/admin/forgot-password') ||
                              pathname?.startsWith('/admin/reset-password');

  // Allow password reset routes without authentication
  if (isPasswordResetRoute) {
    return <>{children}</>;
  }

  if (!isAuthenticated && !isAdminLoginPage) {
    return null;
  }

  return <>{children}</>;
}
