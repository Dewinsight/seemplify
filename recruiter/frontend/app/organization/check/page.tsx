'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandedLoadingScreen } from '@/components/BrandedLoadingScreen';
import { useOrganization } from '@/context/OrganizationContext';
import { useAuth } from '@/context/AuthContext';
import { getIdpBaseUrl } from '@/utils/env';

const IDP_REDIRECT_GUARD_KEY = 'organization_check_last_idp_redirect';
const IDP_REDIRECT_COOLDOWN_MS = 15_000;

export default function OrganizationCheckPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const {
    currentOrganization,
    organizations,
    needsOrganizationSetup,
    isLoading: orgLoading,
    hasInitialized,
  } = useOrganization();
  const [loadingMessage, setLoadingMessage] = useState('Setting up your workspace…');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkOrganizationStatus = async () => {
      if (authLoading || orgLoading || !hasInitialized) {
        setLoadingMessage('Loading your account…');
        return;
      }

      if (!isAuthenticated) {
        router.push('/login');
        return;
      }

      try {
        if (organizations.length > 0 && currentOrganization) {
          sessionStorage.removeItem(IDP_REDIRECT_GUARD_KEY);
          setLoadingMessage('Opening your Recruiter dashboard…');
          await new Promise((resolve) => setTimeout(resolve, 500));
          router.push('/dashboard');
          return;
        }

        if (!needsOrganizationSetup) {
          setError('We could not verify your organization access. Please sign in again.');
          return;
        }

        const lastRedirectAt = Number(sessionStorage.getItem(IDP_REDIRECT_GUARD_KEY) || '0');
        const now = Date.now();
        if (lastRedirectAt && now - lastRedirectAt < IDP_REDIRECT_COOLDOWN_MS) {
          setError('Organization setup is still pending. Complete it in the App Hub, then try again.');
          return;
        }

        sessionStorage.setItem(IDP_REDIRECT_GUARD_KEY, String(now));
        setLoadingMessage('Opening the Seemplify App Hub…');
        await new Promise((resolve) => setTimeout(resolve, 1000));

        window.location.href = `${getIdpBaseUrl().replace(/\/$/, '')}/organizations`;
      } catch (caughtError) {
        console.error('Organization access check failed:', caughtError);
        setError('We could not check your organization access.');
      }
    };

    void checkOrganizationStatus();
  }, [
    authLoading,
    orgLoading,
    hasInitialized,
    isAuthenticated,
    currentOrganization,
    organizations,
    needsOrganizationSetup,
    router,
  ]);

  return (
    <BrandedLoadingScreen
      inAppShell
      message={loadingMessage}
      error={error}
      onRetry={() => window.location.reload()}
    />
  );
}
