"use client";

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAdmin } from '@/context/AdminContext';

interface AdminProtectedRouteProps {
  children: ReactNode;
}

export default function AdminProtectedRoute({ children }: AdminProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAdmin();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const isAdminLoginPage = pathname === '/admin/login';
    const isPasswordResetRoute = pathname?.startsWith('/admin/forgot-password') ||
                                pathname?.startsWith('/admin/reset-password');
    const isAdminSsoPage = pathname === '/admin/sso';
    const isPublicAdminRoute = isAdminLoginPage || isPasswordResetRoute || isAdminSsoPage;

    console.log('AdminProtectedRoute effect:', {
      isLoading,
      isAuthenticated,
      pathname,
      isPublicAdminRoute
    });

    if (isLoading) return;

    if (isPublicAdminRoute) {
      if (isAuthenticated && isAdminLoginPage) {
        console.log('Authenticated on login page, redirecting to dashboard');
        router.push('/admin/dashboard');
      } else {
        console.log('Public admin route, skipping protection');
      }
      return;
    }

    if (!isAuthenticated) {
      console.log('Not authenticated, redirecting to admin login');
      router.push('/admin/login');
    } else {
      console.log('AdminProtectedRoute allowing access');
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
  const isAdminSsoPage = pathname === '/admin/sso';
  const isPublicAdminRoute = isAdminLoginPage || isPasswordResetRoute || isAdminSsoPage;

  if (isPublicAdminRoute) {
    return <>{children}</>;
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
