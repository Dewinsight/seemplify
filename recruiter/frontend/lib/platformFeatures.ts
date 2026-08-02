export const DEFAULT_PLATFORM_FEATURES = {
  aiInterviews: true,
  aiAssistant: true,
  candidateEnrichment: true,
  bulkCvUpload: true,
  peopleTransitions: true,
} as const;

export type PlatformFeatureKey = keyof typeof DEFAULT_PLATFORM_FEATURES;
export type PlatformFeatureFlags = Record<PlatformFeatureKey, boolean>;

export const PLATFORM_FEATURE_LABELS: Record<PlatformFeatureKey, string> = {
  aiInterviews: 'AI Interviews',
  aiAssistant: 'AI Assistant',
  candidateEnrichment: 'Candidate Enrichment',
  bulkCvUpload: 'Bulk CV Upload',
  peopleTransitions: 'People Transitions',
};

const FEATURE_ROUTE_RULES: Array<{
  feature: PlatformFeatureKey;
  prefixes: string[];
}> = [
  { feature: 'aiInterviews', prefixes: ['/ai-interviews', '/public/ai-interview'] },
  { feature: 'aiAssistant', prefixes: ['/assistant', '/test-ai-matching'] },
  { feature: 'bulkCvUpload', prefixes: ['/bulk-upload'] },
  { feature: 'peopleTransitions', prefixes: ['/people-transitions', '/onboarding', '/my-documents'] },
];

export function normalizePlatformFeatures(
  value?: Partial<Record<PlatformFeatureKey, unknown>> | null
): PlatformFeatureFlags {
  return (Object.keys(DEFAULT_PLATFORM_FEATURES) as PlatformFeatureKey[]).reduce(
    (features, key) => {
      features[key] = typeof value?.[key] === 'boolean'
        ? value[key]
        : DEFAULT_PLATFORM_FEATURES[key];
      return features;
    },
    {} as PlatformFeatureFlags
  );
}

export function getFeatureForPath(pathname?: string | null): PlatformFeatureKey | null {
  if (!pathname) return null;

  const match = FEATURE_ROUTE_RULES.find((rule) =>
    rule.prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );

  return match?.feature || null;
}
