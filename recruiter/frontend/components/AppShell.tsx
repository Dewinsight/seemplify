"use client";

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { usePathname } from 'next/navigation';
import TopNavbar from '@/components/TopNavbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { FeatureUnavailable } from '@/components/FeatureUnavailable';
import { useFeatureFlags } from '@/context/FeatureFlagsContext';
import { getFeatureForPath } from '@/lib/platformFeatures';
import { Loader2 } from 'lucide-react';
import './authenticated-shell.css';
// Organization setup modal replaced by page-based flow

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const { needsOrganizationSetup, isLoading: orgLoading, organizations, hasInitialized, getUserPendingInvitations } = useOrganization();
  const { isLoading: featuresLoading, isFeatureEnabled } = useFeatureFlags();
  const pathname = usePathname();
  const routeFeature = getFeatureForPath(pathname);
  // State for modal removed - now using page-based flow

  // Public routes that don't need authentication
  const isPublicRoute = pathname === '/' || // Root path (landing page) is public
                       pathname?.startsWith('/login') ||
                       pathname?.startsWith('/admin') ||
                       pathname?.startsWith('/signup') ||
                       pathname?.startsWith('/public/feedback') || // Explicitly include public feedback routes
                       pathname?.startsWith('/public') ||
                       pathname?.startsWith('/forgot-password') ||
                       pathname?.startsWith('/reset-password') ||
                       pathname === '/terms' ||
                       pathname === '/privacy' ||
                       pathname === '/cookies';
  
  // Admin routes have their own authentication flow
  const isAdminRoute = pathname?.startsWith('/admin');

  // Check if user needs organization setup and redirect if needed
  useEffect(() => {
    const organizationSetupPage = pathname?.startsWith('/organization/');
    const isInvitationsPage = pathname === '/settings/invitations';
    const isSettingsPage = pathname?.startsWith('/settings/');
    
    // Only redirect if:
    // 1. User is authenticated
    // 2. Organization context has fully initialized
    // 3. User has no organizations
    // 4. Not on public or admin route
    // 5. Not already on organization setup or check page
    // 6. Not on invitations page
    // 7. Not on any settings page (including organization settings)
    const shouldRedirectToSetup = isAuthenticated && 
                               hasInitialized && 
                               !orgLoading && 
                               needsOrganizationSetup && 
                               organizations.length === 0 &&
                               !isPublicRoute && 
                               !isAdminRoute &&
                               !organizationSetupPage &&
                               !isInvitationsPage &&
                               !isSettingsPage;
    
    if (shouldRedirectToSetup) {
      // Redirect to organization check page which will handle the setup flow
      console.log('🔄 User needs organization setup, redirecting to check page');
      window.location.href = '/organization/check';
    }
  }, [isAuthenticated, needsOrganizationSetup, orgLoading, hasInitialized, organizations.length, isPublicRoute, isAdminRoute, pathname]);

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  // If public or admin route, just render children (admin has its own auth)
  if (isPublicRoute || isAdminRoute) {
    return <>{children}</>;
  }

  return (
    <>
      <ProtectedRoute>
        {isAuthenticated ? (
          <div className="recruiter-auth-shell relative flex min-h-screen flex-col">
            <TopNavbar />
            <main className="recruiter-auth-shell__main flex-1 lg:pt-0">
              {routeFeature && featuresLoading ? (
                <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Checking feature availability...
                </div>
              ) : routeFeature && !isFeatureEnabled(routeFeature) ? (
                <FeatureUnavailable feature={routeFeature} />
              ) : children}
            </main>
          </div>
        ) : (
          children
        )}
      </ProtectedRoute>
      {/* Organization Setup Modal removed - now using page-based flow */}
      
    </>
  );
}
