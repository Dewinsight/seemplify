import {
  createBrowserJourneySdk,
  createLocalStorageQueueStorage
} from '@seemplify/journey-browser-sdk';

// Phase 5A sample only. No durable Seemplify ingestion endpoint exists yet.
const journey = createBrowserJourneySdk({
  writeKey: 'jpk_dev.replace_me.00000000000000000000000000000000',
  endpoint: 'https://ingest.example.com',
  environment: 'development',
  consent: {
    analytics: 'granted',
    source: 'example_cmp',
    updatedAt: new Date().toISOString()
  },
  storage: createLocalStorageQueueStorage(window.localStorage),
  queue: {
    maxEvents: 500,
    maxBytes: 512 * 1024,
    maxAgeMs: 24 * 60 * 60 * 1_000
  },
  automaticContext: {
    page: true,
    locale: true,
    device: true
  },
  privacy: {
    denyPropertyNames: ['email_body', 'survey_answer', 'ai_prompt']
  }
});

void journey.track('onboarding_started', { entry_point: 'welcome' });

// A consent management platform can withdraw collection immediately.
async function withdrawAnalyticsConsent() {
  await journey.consent({
    analytics: 'denied',
    source: 'example_cmp',
    updatedAt: new Date().toISOString()
  });
}

// A sign-out should purge queued facts and local identity state.
async function signOut() {
  await journey.reset();
}

export { journey, signOut, withdrawAnalyticsConsent };
