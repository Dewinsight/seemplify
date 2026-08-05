import {
  createReactNativeJourneySdk,
  type ReactNativeJourneyRuntime,
  type SecureJourneyStorage
} from '@seemplify/journey-react-native';

// These adapters are application-owned. Bind them to reviewed native secure
// storage, AppState, network and battery modules in the real application.
declare const secureJourneyStorage: SecureJourneyStorage;
declare const journeyRuntime: ReactNativeJourneyRuntime;

// Phase 5E sample only. No durable Seemplify ingestion endpoint exists yet.
const journey = createReactNativeJourneySdk({
  writeKey: 'jpk_dev.replace_me.00000000000000000000000000000000',
  endpoint: 'https://ingest.example.com',
  environment: 'development',
  storage: secureJourneyStorage,
  runtime: journeyRuntime,
  beforeConsent: 'buffer-memory',
  automaticContext: { app: true, device: true, locale: true, timezone: true },
  privacy: { denyPropertyNames: ['email_body', 'survey_answer', 'ai_prompt'] }
});

async function acceptAnalytics() {
  await journey.consent({
    analytics: 'granted',
    source: 'application_privacy_settings',
    updatedAt: new Date().toISOString()
  });
}

async function withdrawAnalytics() {
  await journey.consent({
    analytics: 'denied',
    source: 'application_privacy_settings',
    updatedAt: new Date().toISOString()
  });
}

async function signOut() {
  await journey.reset();
}

export { acceptAnalytics, journey, signOut, withdrawAnalytics };
