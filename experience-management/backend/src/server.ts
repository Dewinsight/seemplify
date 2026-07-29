import { app } from './app.js';
import { aiJobRunner } from './aiJobs.js';
import { config } from './config.js';
import { campaignRunner } from './campaigns.js';
import { bootstrapAdminAccount } from './auth.js';
import { seedXIntegrationForAdmin, xSyncRunner } from './xIntegration.js';

aiJobRunner.start();
campaignRunner.start();
bootstrapAdminAccount();
seedXIntegrationForAdmin();
xSyncRunner.start();
const server = app.listen(config.port, config.host, () => {
  console.log(`Seemplify Experience is running at http://${config.host}:${config.port}`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return; shuttingDown = true;
  console.log(`Received ${signal}; stopping Seemplify Experience.`);
  const forceExit = setTimeout(() => process.exit(1), 10_000); forceExit.unref();
  aiJobRunner.stop();
  xSyncRunner.stop();
  const drained = await campaignRunner.stop(8_000);
  if (!drained) console.warn('Campaign worker did not drain before the shutdown deadline.');
  server.close(() => { clearTimeout(forceExit); process.exit(0); });
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
