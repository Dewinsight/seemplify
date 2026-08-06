"use client";

import { usePathname } from 'next/navigation';
import { AuthProvider } from '@/context/AuthContext';
import { UserProvider } from '@/context/UserContext';
import { OrganizationProvider } from '@/context/OrganizationContext';
import { TutorialProvider } from '@/context/TutorialContext';
import { BrandProvider } from '@/context/BrandContext';
import BrandTitle from '@/components/BrandTitle';
import { TutorialRenderer } from '@/components/tutorial/TutorialRenderer';
import AppShell from '@/components/AppShell';
import { InactivityWarning } from '@/components/InactivityWarning';
import { AiRuntimeGateDialog } from '@/components/AiRuntimeGateDialog';
import { FeatureFlagsProvider } from '@/context/FeatureFlagsContext';

interface ConditionalProvidersProps {
  children: React.ReactNode;
}

export default function ConditionalProviders({ children }: ConditionalProvidersProps) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith('/admin');
  const isPublicRoute = pathname?.startsWith('/public');

  console.log('🔀 ConditionalProviders:', { pathname, isAdminRoute, isPublicRoute });

  // BrandProvider always wraps everything so branding is available on every route
  if (isAdminRoute || isPublicRoute) {
    console.log('🚀 Admin or Public route detected - skipping regular providers');
    return (
      <FeatureFlagsProvider>
        <BrandProvider><BrandTitle />{children}</BrandProvider>
      </FeatureFlagsProvider>
    );
  }

  return (
    <FeatureFlagsProvider>
      <BrandProvider>
        <BrandTitle />
        <AuthProvider>
          <UserProvider>
            <OrganizationProvider>
              <TutorialProvider>
                <AppShell>{children}</AppShell>
                <InactivityWarning />
                <AiRuntimeGateDialog />
                <TutorialRenderer />
              </TutorialProvider>
            </OrganizationProvider>
          </UserProvider>
        </AuthProvider>
      </BrandProvider>
    </FeatureFlagsProvider>
  );
}
