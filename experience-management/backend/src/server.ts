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

aiJobRunner.start();
campaignRunner.start();
bootstrapAdminAccount();
seedXIntegrationForAdmin();
xSyncRunner.start();
esignWorker.start();
knowledgeJobRunner.start();
knowledgeBackfillCoordinator.start();
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
  xSyncRunner.stop();
  const [aiDrained, campaignDrained, esignDrained, knowledgeDrained, backfillDrained] = await Promise.all([
    aiJobRunner.drain(8_000), campaignRunner.stop(8_000), esignWorker.stop(8_000), knowledgeJobRunner.drain(8_000),
    knowledgeBackfillCoordinator.drain(8_000)
  ]);
  if (!aiDrained) console.warn('AI worker did not drain before the shutdown deadline; its durable job will recover on restart.');
  if (!campaignDrained) console.warn('Campaign worker did not drain before the shutdown deadline.');
  if (!esignDrained) console.warn('E-sign worker did not drain before the shutdown deadline.');
  if (!knowledgeDrained) console.warn('Knowledge worker did not drain before the shutdown deadline; its durable job will recover on restart.');
  if (!backfillDrained) console.warn('Knowledge backfill did not drain before the shutdown deadline; its cursor will recover on restart.');
  await stopCodexClients();
  server.close(() => { clearTimeout(forceExit); process.exit(0); });
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
