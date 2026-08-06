#!/usr/bin/env node

/**
 * Process-isolated HTTP host for the PostgreSQL ingestion qualification gate.
 * It runs the real Express application and authentication bootstrap without
 * starting unrelated AI, campaign, mail, social, or indexing workers.
 */
import { app } from '../backend/dist/app.js';
import { bootstrapAdminAccount } from '../backend/dist/auth.js';
import { config } from '../backend/dist/config.js';
import { db } from '../backend/dist/database.js';
import { journeyStageProcessingRunner } from '../backend/dist/journeyStageProcessing.js';

bootstrapAdminAccount();
const stageProcessingEnabled = process.env.JOURNEY_POSTGRES_GATE_STAGE_PROCESSING === 'true'
  && db.provider === 'postgres' && config.postgres.runtimeSchemaVersion >= 18;
if (stageProcessingEnabled) journeyStageProcessingRunner.start();

const server = app.listen(config.port, config.host, () => {
  const ready = { event: 'journey_postgres_ingest_server_ready', port: config.port, provider: db.provider };
  if (process.send) process.send(ready);
  else process.stdout.write(`${JSON.stringify(ready)}\n`);
});

let stopping = false;
async function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  const forced = setTimeout(() => process.exit(1), 10_000);
  forced.unref();
  if (stageProcessingEnabled) {
    journeyStageProcessingRunner.stop();
    await journeyStageProcessingRunner.drain(8_000);
  }
  await new Promise((resolve) => server.close(resolve));
  clearTimeout(forced);
  db.close();
  const stopped = { event: 'journey_postgres_ingest_server_stopped', reason };
  if (process.send) process.send(stopped);
  else process.stdout.write(`${JSON.stringify(stopped)}\n`);
  process.exit(0);
}

process.on('message', (message) => {
  if (message && typeof message === 'object' && message.type === 'shutdown') void shutdown('ipc');
});
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
