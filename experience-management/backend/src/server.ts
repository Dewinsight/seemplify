import { app } from './app.js';
import { aiJobRunner } from './aiJobs.js';
import { config } from './config.js';
import { campaignRunner } from './campaigns.js';
import { bootstrapAdminAccount } from './auth.js';
import { seedXIntegrationForAdmin, xSyncRunner } from './xIntegration.js';
import { esignWorker } from './esign.js';
import { knowledgeJobRunner } from './knowledgeJobs.js';
import { knowledgeBackfillCoordinator } from './knowledgeBackfill.js';
import { stopCodexClients } from './codexAppServer.js';
import { journeyStageProcessingRunner } from './journeyStageProcessing.js';
import { journeyResearchRefreshRunner } from './journeyResearchRefresh.js';
import { journeyMetricRebuildRunner } from './journeyMetricRebuild.js';
import { journeyAssetRetentionWorker } from './journeyAssetRetentionWorker.js';
import { journeySavedViewRetentionWorker } from './journeySavedViewRetentionWorker.js';
import { journeyStageReprojectionRunner } from './journeyStageReprojection.js';

aiJobRunner.start();
campaignRunner.start();
bootstrapAdminAccount();
seedXIntegrationForAdmin();
xSyncRunner.start();
esignWorker.start();
knowledgeJobRunner.start();
knowledgeBackfillCoordinator.start();
journeyStageProcessingRunner.start();
journeyResearchRefreshRunner.start();
journeyMetricRebuildRunner.start();
journeyAssetRetentionWorker.start();
journeySavedViewRetentionWorker.start();
journeyStageReprojectionRunner.start();
const server = app.listen(config.port, config.host, () => {
  console.log(`Seemplify Experience is running at http://${config.host}:${config.port}`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return; shuttingDown = true;
  console.log(`Received ${signal}; stopping Seemplify Experience.`);
  const forceExit = setTimeout(() => process.exit(1), 10_000); forceExit.unref();
  aiJobRunner.stop();
  knowledgeJobRunner.stop();
  knowledgeBackfillCoordinator.stop();
  journeyStageProcessingRunner.stop();
  journeyResearchRefreshRunner.stop();
  journeyMetricRebuildRunner.stop();
  journeyAssetRetentionWorker.stop();
  journeySavedViewRetentionWorker.stop();
  journeyStageReprojectionRunner.stop();
  xSyncRunner.stop();
  const [aiDrained, campaignDrained, esignDrained, knowledgeDrained, backfillDrained, journeyStageDrained, journeyResearchDrained,
    journeyMetricDrained, journeyAssetRetentionDrained, journeySavedViewRetentionDrained, journeyStageReprojectionDrained] = await Promise.all([
    aiJobRunner.drain(8_000), campaignRunner.stop(8_000), esignWorker.stop(8_000), knowledgeJobRunner.drain(8_000),
    knowledgeBackfillCoordinator.drain(8_000), journeyStageProcessingRunner.drain(8_000),
    journeyResearchRefreshRunner.drain(8_000), journeyMetricRebuildRunner.drain(8_000),
    journeyAssetRetentionWorker.drain(8_000), journeySavedViewRetentionWorker.drain(8_000),
    journeyStageReprojectionRunner.drain(8_000)
  ]);
  if (!aiDrained) console.warn('AI worker did not drain before the shutdown deadline; its durable job will recover on restart.');
  if (!campaignDrained) console.warn('Campaign worker did not drain before the shutdown deadline.');
  if (!esignDrained) console.warn('E-sign worker did not drain before the shutdown deadline.');
  if (!knowledgeDrained) console.warn('Knowledge worker did not drain before the shutdown deadline; its durable job will recover on restart.');
  if (!backfillDrained) console.warn('Knowledge backfill did not drain before the shutdown deadline; its cursor will recover on restart.');
  if (!journeyStageDrained) console.warn('Journey stage worker did not drain before shutdown; its fenced lease will recover.');
  if (!journeyResearchDrained) console.warn('Journey research worker did not drain before shutdown; its fenced lease will recover.');
  if (!journeyMetricDrained) console.warn('Journey metric worker did not drain before shutdown; its fenced lease will recover.');
  if (!journeyAssetRetentionDrained) console.warn('Journey asset retention did not drain before shutdown; its durable purge receipt will recover.');
  if (!journeySavedViewRetentionDrained) console.warn('Journey saved-view retention did not drain before shutdown; expired views will be purged on the next pass.');
  if (!journeyStageReprojectionDrained) console.warn('Journey stage reprojection did not drain before shutdown; its fenced lease will recover.');
  await stopCodexClients();
  server.close(() => { clearTimeout(forceExit); process.exit(0); });
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
