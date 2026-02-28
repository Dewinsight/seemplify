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

  console.log('🔀 ConditionalProviders:', { pathname, isAdminRoute, isPublicRoute });

  // For admin and public routes, skip all the regular providers and just render children
  if (isAdminRoute || isPublicRoute) {
    console.log('🚀 Admin or Public route detected - skipping regular providers');
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
