'use client';

import React, { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface ProtectedRouteProps {
  children: ReactNode;
}

const ProtectedRoute = ({ children }: ProtectedRouteProps): React.ReactElement | null => {
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) {
      return; // Wait for loading to complete
    }

    const isAuthPage = pathname === '/login' || pathname === '/signup';
    const isPublicPage = pathname === '/' || 
                       pathname.startsWith('/public/') || 
                       pathname === '/terms' || 
                       pathname === '/privacy' || 
                       pathname === '/cookies';
    const isAdminPage = pathname.startsWith('/admin');
    const isOrgSetupPage = pathname.startsWith('/organization/');

    // Skip protection for admin routes - they have their own auth
    if (isAdminPage) {
      return;
    }

    // Handle authentication flow
    if (!isAuthenticated && !isAuthPage && !isPublicPage) {
      // Not authenticated and not on public page - go to login
      router.push('/login');
    } else if (isAuthenticated && isAuthPage) {
      // Authenticated but on login page - go to organization check
      router.push('/organization/check');
    }
    
    // Note: The organization check page will handle organization setup flow
    // based on whether the user has organizations or invitations
  }, [isAuthenticated, isLoading, pathname, router]);

  if (isLoading) {
    // You can return a loading spinner or a similar component here
    return <div>Loading...</div>;
  }

  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const isPublicPage = pathname === '/' || 
                     pathname.startsWith('/public/') || 
                     pathname === '/terms' || 
                     pathname === '/privacy' || 
                     pathname === '/cookies';
  const isAdminPage = pathname.startsWith('/admin');

  // Allow admin pages to render - they have their own auth
  if (isAdminPage) {
    return <>{children}</>;
  }

  if (!isAuthenticated && !isAuthPage && !isPublicPage) {
    // This case should ideally be handled by the useEffect redirect,
    // but as a fallback, don't render children.
    // Or, you could return a loading/redirecting indicator.
    return null;
  }

  if (isAuthenticated && isAuthPage) {
    // Don't show login page if already authenticated
    return null;
  }
  
  // If authenticated but needs organization setup, we'll let the AppShell
  // handle the redirect to the organization check page

  return <>{children}</>;
};

export default ProtectedRoute;