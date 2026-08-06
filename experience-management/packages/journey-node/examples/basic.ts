import { createNodeJourneySdk } from '@seemplify/journey-node';

// Phase 5A sample only. No durable Seemplify ingestion endpoint exists yet.
const serverSecret = process.env.SEEMPLIFY_JOURNEY_SERVER_SECRET ?? '';
const endpoint = process.env.SEEMPLIFY_JOURNEY_ENDPOINT ?? '';

const journey = createNodeJourneySdk({
  serverSecret,
  endpoint,
  environment: 'development',
  queue: { maxEvents: 5_000, maxBytes: 4 * 1024 * 1024 },
  batch: { maxEvents: 100, flushIntervalMs: 5_000 },
  retry: { maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 60_000, jitterRatio: 0.2 }
});

await journey.track('survey_published', { survey_id: 'survey_123' }, {
  userId: 'user_123',
  accountId: 'space_456'
});

const result = await journey.close();
if (result.retained > 0) {
  // Report only an operational count through the host's approved telemetry.
  process.exitCode = 1;
}
