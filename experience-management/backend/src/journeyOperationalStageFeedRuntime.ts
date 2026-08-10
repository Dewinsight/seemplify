import { config } from './config.js';
import { createDatabase } from './databaseAdapter.js';
import { JourneyOperationalStageFeedRepository } from './journeyOperationalStageFeedRepository.js';
import { JourneyOperationalStageFeedWorker } from './journeyOperationalStageFeedWorker.js';
import { JourneyOperationalStageFeedRetentionWorker,
  purgeExpiredJourneyOperationalStageFeed } from './journeyOperationalStageFeedRetention.js';

type Settings = { enabled: boolean; databaseProvider: string; pollMs: number; batchSize: number; leaseMs: number;
  retentionPollMs: number; spaceIds: readonly string[]; postgres: typeof config.journeyOperationalStageFeedWorkerPostgres };
export type JourneyOperationalStageFeedRuntime = { start(): void; stop(timeoutMs?: number): Promise<boolean> };

const defaults = (): Settings => ({ enabled: config.journeyOperationalStageFeedWorkerEnabled,
  databaseProvider: config.databaseProvider, pollMs: config.journeyOperationalStageFeedWorkerPollMs,
  batchSize: config.journeyOperationalStageFeedWorkerBatchSize, leaseMs: config.journeyOperationalStageFeedWorkerLeaseMs,
  retentionPollMs: config.journeyOperationalStageFeedRetentionPollMs,
  spaceIds: config.journeyOperationalStageFeedWorkerSpaceIds, postgres: config.journeyOperationalStageFeedWorkerPostgres });

export function validateJourneyOperationalStageFeedConfiguration(input: Settings) {
  if (!input.enabled) return;
  if (input.databaseProvider !== 'postgres') throw new Error('The durable operational stage feed requires PostgreSQL.');
  if (!input.spaceIds.length || input.spaceIds.length > 100 || new Set(input.spaceIds).size !== input.spaceIds.length
    || input.spaceIds.some((id) => !id || id.length > 128)) {
    throw new Error('The operational stage feed requires an explicit bounded tenant scope.');
  }
}

export function createJourneyOperationalStageFeedRuntime(dependencies: { settings?: Settings;
  createWorkerDatabase?: typeof createDatabase } = {}): JourneyOperationalStageFeedRuntime | null {
  const settings = dependencies.settings || defaults(); validateJourneyOperationalStageFeedConfiguration(settings);
  if (!settings.enabled) return null;
  const runtime = (dependencies.createWorkerDatabase || createDatabase)({ databaseProvider: 'postgres', databasePath: '',
    postgres: settings.postgres });
  try {
    const repository = new JourneyOperationalStageFeedRepository(runtime);
    if (!repository.available()) throw new Error('Runtime 52 operational stage feed schema is unavailable.');
    const worker = new JourneyOperationalStageFeedWorker(repository, undefined, { intervalMs: settings.pollMs,
      batchSize: settings.batchSize, leaseMs: settings.leaseMs, spaceIds: settings.spaceIds });
    const retention = new JourneyOperationalStageFeedRetentionWorker((afterSpaceId, asOf) =>
      purgeExpiredJourneyOperationalStageFeed({ runtime, repository, spaceIds: settings.spaceIds, afterSpaceId, asOf }),
    settings.retentionPollMs);
    return { start: () => { worker.start(); retention.start(); }, stop: async(timeoutMs = 8_000) => {
      worker.stop(); retention.stop(); const [workerDrained, retentionDrained] = await Promise.all([
        worker.drain(timeoutMs), retention.drain(timeoutMs)]); runtime.close(); return workerDrained && retentionDrained; } };
  } catch (error) { runtime.close(); throw error; }
}
