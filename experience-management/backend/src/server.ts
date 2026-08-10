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
import { journeyStageIntelligenceRetentionWorker } from './journeyStageIntelligenceRetentionWorker.js';
import { journeyStageReprojectionRunner } from './journeyStageReprojection.js';
import { createJourneyActionWorkerRuntime } from './journeyActionWorkerRuntime.js';
import { journeyStageSurveyFeedWorker } from './journeyStageSurveyFeedWorker.js';
import { journeyStageSurveyFeedRetentionWorker } from './journeyStageSurveyFeedRetention.js';
import { createJourneyEventStageIntelligenceWorker } from './journeyEventStageIntelligenceWorker.js';
import { createJourneyPrivacyPropagationRuntime } from './journeyPrivacyPropagationRuntime.js';
import { createJourneyConnectorWorkerRuntime } from './journeyConnectorWorkerRuntime.js';
import { createJourneyOperationalStageFeedRuntime } from './journeyOperationalStageFeedRuntime.js';
import { createJourneyEventRetentionRuntime } from './journeyEventRetentionRuntime.js';
import { JourneyEvidenceMonitorWorker } from './journeyEvidenceMonitorWorker.js';
import { JourneyCollaborationEmailWorker } from './journeyCollaborationEmailWorker.js';

// Validate the optional durable worker before any background loop starts. A
// disabled worker is a safe no-processing state; a configured worker must be
// fully scoped and authenticated or startup fails closed.
const journeyActionWorkerRuntime=await createJourneyActionWorkerRuntime();
const journeyEventIntelligenceWorker=createJourneyEventStageIntelligenceWorker();
const journeyPrivacyPropagationRuntime=createJourneyPrivacyPropagationRuntime();
const journeyConnectorWorkerRuntime=await createJourneyConnectorWorkerRuntime();
const journeyOperationalStageFeedRuntime=createJourneyOperationalStageFeedRuntime();
const journeyEventRetentionRuntime=createJourneyEventRetentionRuntime();
const journeyEvidenceMonitorWorker=config.journeyEvidenceMonitorEnabled
  ?new JourneyEvidenceMonitorWorker(config.journeyEvidenceMonitorPollMs,config.journeyEvidenceMonitorBatchSize):null;
// Outbound collaboration mail is globally off unless a deployment enables it.
// Without this worker the outbox simply accumulates opted-in rows and nothing
// leaves the service, which is the intended default.
const journeyCollaborationEmailWorker=config.journeyCollaborationEmailWorkerEnabled
  ?new JourneyCollaborationEmailWorker(config.journeyCollaborationEmailWorkerPollMs,
    config.journeyCollaborationEmailWorkerBatchSize,config.mailIdempotencyTtlMinutes*60_000):null;
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
journeyStageIntelligenceRetentionWorker.start();
journeyStageReprojectionRunner.start();
if (config.journeyStageSurveyFeedWorkerEnabled) {
  journeyStageSurveyFeedWorker.start();
  journeyStageSurveyFeedRetentionWorker.start();
}
journeyActionWorkerRuntime?.start();
journeyEventIntelligenceWorker?.start();
journeyPrivacyPropagationRuntime?.start();
journeyConnectorWorkerRuntime?.start();
journeyOperationalStageFeedRuntime?.start();
journeyEventRetentionRuntime?.start();
journeyEvidenceMonitorWorker?.start();
journeyCollaborationEmailWorker?.start();
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
  journeyStageIntelligenceRetentionWorker.stop();
  journeyStageReprojectionRunner.stop();
  journeyStageSurveyFeedWorker.stop();
  journeyStageSurveyFeedRetentionWorker.stop();
  journeyEventIntelligenceWorker?.stop();
  xSyncRunner.stop();
  const [aiDrained, campaignDrained, esignDrained, knowledgeDrained, backfillDrained, journeyStageDrained, journeyResearchDrained,
    journeyMetricDrained, journeyAssetRetentionDrained, journeySavedViewRetentionDrained,
    journeyStageIntelligenceRetentionDrained, journeyStageReprojectionDrained, journeyStageSurveyFeedDrained,
    journeyStageSurveyFeedRetentionDrained,journeyActionWorkerDrained,journeyEventIntelligenceDrained,
    journeyPrivacyPropagationDrained,journeyConnectorWorkerDrained,journeyOperationalStageFeedDrained,journeyEventRetentionDrained,
    journeyEvidenceMonitorDrained,journeyCollaborationEmailDrained] = await Promise.all([
    aiJobRunner.drain(8_000), campaignRunner.stop(8_000), esignWorker.stop(8_000), knowledgeJobRunner.drain(8_000),
    knowledgeBackfillCoordinator.drain(8_000), journeyStageProcessingRunner.drain(8_000),
    journeyResearchRefreshRunner.drain(8_000), journeyMetricRebuildRunner.drain(8_000),
    journeyAssetRetentionWorker.drain(8_000), journeySavedViewRetentionWorker.drain(8_000),
    journeyStageIntelligenceRetentionWorker.drain(8_000),
    journeyStageReprojectionRunner.drain(8_000), journeyStageSurveyFeedWorker.drain(8_000),
    journeyStageSurveyFeedRetentionWorker.drain(8_000),
    journeyActionWorkerRuntime?journeyActionWorkerRuntime.stop(8_000):Promise.resolve(true),
    journeyEventIntelligenceWorker?journeyEventIntelligenceWorker.drain(8_000):Promise.resolve(true),
    journeyPrivacyPropagationRuntime?journeyPrivacyPropagationRuntime.drain(8_000):Promise.resolve(true),
    journeyConnectorWorkerRuntime?journeyConnectorWorkerRuntime.stop(8_000):Promise.resolve(true),
    journeyOperationalStageFeedRuntime?journeyOperationalStageFeedRuntime.stop(8_000):Promise.resolve(true),
    journeyEventRetentionRuntime?journeyEventRetentionRuntime.stop(8_000):Promise.resolve(true),
    journeyEvidenceMonitorWorker?(journeyEvidenceMonitorWorker.stop(),journeyEvidenceMonitorWorker.drain(8_000)):Promise.resolve(true),
    journeyCollaborationEmailWorker?(journeyCollaborationEmailWorker.stop(),journeyCollaborationEmailWorker.drain(8_000)):Promise.resolve(true)
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
  if (!journeyStageIntelligenceRetentionDrained) console.warn('Journey stage intelligence retention did not drain before shutdown; expired facts will be purged on the next pass.');
  if (!journeyStageReprojectionDrained) console.warn('Journey stage reprojection did not drain before shutdown; its fenced lease will recover.');
  if (!journeyStageSurveyFeedDrained) console.warn('Journey stage survey feed did not drain before shutdown; its fenced lease will recover.');
  if (!journeyStageSurveyFeedRetentionDrained) console.warn('Journey stage survey retention did not drain before shutdown; its cursor will resume.');
  if (!journeyActionWorkerDrained) console.warn('Journey action worker did not drain before shutdown; its fenced reservation will recover.');
  if (!journeyEventIntelligenceDrained) console.warn('Journey event intelligence worker did not drain before shutdown; its derived outbox will recover.');
  if (!journeyPrivacyPropagationDrained) console.warn('Journey privacy propagation worker did not drain before shutdown; its fenced claim will recover.');
  if (!journeyConnectorWorkerDrained) console.warn('Journey connector worker did not stop before shutdown; its fenced lease will recover.');
  if (!journeyOperationalStageFeedDrained) console.warn('Journey operational stage feed did not drain before shutdown; its fenced lease will recover.');
  if (!journeyEventRetentionDrained) console.warn('Journey event retention did not drain before shutdown; its fenced checkpoint will recover.');
  if (!journeyEvidenceMonitorDrained) console.warn('Journey evidence monitor did not drain before shutdown; its fenced lease will recover.');
  if (!journeyCollaborationEmailDrained) console.warn('Journey collaboration email worker did not drain before shutdown; its fenced lease will recover.');
  await stopCodexClients();
  server.close(() => { clearTimeout(forceExit); process.exit(0); });
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
