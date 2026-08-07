import http from 'node:http';
import { loadConfig } from './config.mjs';
import { Store } from './store.mjs';
import { createApp } from './app.mjs';
import { createLogger } from './logging.mjs';

const SHUTDOWN_GRACE_MS = 10_000;

export async function start(env = process.env) {
  const config = loadConfig(env);
  const logger = createLogger({ release: config.release });
  const store = await Store.open({ dataDir: config.dataDir, limits: config.limits });
  const app = createApp({ config, store, logger });

  const server = http.createServer(app.handler);
  // Keep header parsing tight: slow-header and oversized-header attacks are
  // cheap to mount against a long-lived local service.
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 15_000;
  server.maxHeadersCount = 60;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  logger.info('server.started', {
    component: 'mail-api',
    release: config.release,
    detail: `${config.host}:${config.port}`,
    state: config.sendEnabled ? 'sending-enabled' : 'sending-disabled',
  });

  // Periodic counter snapshot so an unclean stop loses at most one interval.
  const flushTimer = setInterval(() => {
    store.flush().catch((error) => logger.error('store.flush_failed', { error: error.message }));
  }, 30_000);
  flushTimer.unref();

  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    logger.info('server.stopping', { component: 'mail-api', reason: signal });
    clearInterval(flushTimer);
    const forced = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS);
    forced.unref();
    await new Promise((resolve) => server.close(resolve));
    await store.close().catch(() => {});
    clearTimeout(forced);
    logger.info('server.stopped', { component: 'mail-api' });
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  return { server, store, config, app, shutdown };
}

const isEntryPoint = import.meta.url === `file://${process.argv[1]}`
  || import.meta.url.endsWith(String(process.argv[1] || '').replace(/\\/g, '/'));

if (isEntryPoint) {
  start().catch((error) => {
    // Startup failures are configuration failures: report the reason, never
    // the value that caused it.
    process.stderr.write(`${JSON.stringify({ level: 'error', event: 'server.start_failed', reason: error.message })}\n`);
    process.exitCode = 1;
  });
}
