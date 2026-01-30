"use client";

import { usePathname } from 'next/navigation';
import { AuthProvider } from '@/context/AuthContext';
import { UserProvider } from '@/context/UserContext';
import { OrganizationProvider } from '@/context/OrganizationContext';
import { TutorialProvider } from '@/context/TutorialContext';
import { BrandProvider } from '@/context/BrandContext';
import { TutorialRenderer } from '@/components/tutorial/TutorialRenderer';
import AppShell from '@/components/AppShell';
import { InactivityWarning } from '@/components/InactivityWarning';

interface ConditionalProvidersProps {
  children: React.ReactNode;
}

export default function ConditionalProviders({ children }: ConditionalProvidersProps) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith('/admin');
  const isPublicRoute = pathname?.startsWith('/public');
  const isOidcRoute = pathname?.startsWith('/oidc');
  const isLoginRoute = pathname?.startsWith('/login');
  const isSignupRoute = pathname?.startsWith('/signup');

  console.log('🔀 ConditionalProviders:', { pathname, isAdminRoute, isPublicRoute, isOidcRoute });

  // For admin, public, oidc, login, and signup routes, skip all the regular providers and just render children
  // These routes need to be lightweight to handle authentication flows quickly
  if (isAdminRoute || isPublicRoute || isOidcRoute || isLoginRoute || isSignupRoute) {
    console.log('🚀 Lightweight route detected - skipping regular providers');
    return <>{children}</>;
  }

  // For regular routes, use all the providers and AppShell
  return (
    <BrandProvider>
      <AuthProvider>
        <UserProvider>
          <OrganizationProvider>
            <TutorialProvider>
              <AppShell>{children}</AppShell>
              <InactivityWarning />
              <TutorialRenderer />
            </TutorialProvider>
          </OrganizationProvider>
        </UserProvider>
      </AuthProvider>
    </BrandProvider>
  );
}
