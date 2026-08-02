'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '@/services/apiConfig';
import {
  DEFAULT_PLATFORM_FEATURES,
  normalizePlatformFeatures,
  type PlatformFeatureFlags,
  type PlatformFeatureKey,
} from '@/lib/platformFeatures';

interface FeatureFlagsContextValue {
  features: PlatformFeatureFlags;
  isLoading: boolean;
  isFeatureEnabled: (feature: PlatformFeatureKey) => boolean;
  refreshFeatures: () => Promise<void>;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | undefined>(undefined);

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const [features, setFeatures] = useState<PlatformFeatureFlags>({ ...DEFAULT_PLATFORM_FEATURES });
  const [isLoading, setIsLoading] = useState(true);

  const refreshFeatures = useCallback(async () => {
    try {
      const response = await apiRequest('/api/platform/features', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Failed to load platform features');
      }
      const data = await response.json();
      setFeatures(normalizePlatformFeatures(data.features));
    } catch (error) {
      console.error('Failed to refresh platform features:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshFeatures();

    const handleFocus = () => refreshFeatures();
    const intervalId = window.setInterval(refreshFeatures, 60_000);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refreshFeatures]);

  const value = useMemo<FeatureFlagsContextValue>(() => ({
    features,
    isLoading,
    isFeatureEnabled: (feature) => !isLoading && features[feature],
    refreshFeatures,
  }), [features, isLoading, refreshFeatures]);

  return (
    <FeatureFlagsContext.Provider value={value}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags() {
  const context = useContext(FeatureFlagsContext);
  if (!context) {
    throw new Error('useFeatureFlags must be used within a FeatureFlagsProvider');
  }
  return context;
}
