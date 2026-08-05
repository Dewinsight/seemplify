import { createContext, useContext, type ReactNode } from 'react';
import type { AuthSession, SubscriptionFeatures } from '@/types';

const AuthSessionContext = createContext<AuthSession | null>(null);

export function AuthSessionProvider({ session, children }: { session: AuthSession | null; children: ReactNode }) {
  return <AuthSessionContext.Provider value={session}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession() {
  return useContext(AuthSessionContext);
}

export function sessionFeatureEnabled(
  session: AuthSession | null,
  feature: keyof SubscriptionFeatures
) {
  if (!session) return false;
  return session.subscription ? session.subscription.features[feature] === true : true;
}

export function useSessionFeature(feature: keyof SubscriptionFeatures) {
  return sessionFeatureEnabled(useAuthSession(), feature);
}
