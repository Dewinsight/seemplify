import { app } from './app.js';
import { aiJobRunner } from './aiJobs.js';
import { config } from './config.js';

aiJobRunner.start();
const server = app.listen(config.port, config.host, () => {
  console.log(`Seemplify Experience is running at http://${config.host}:${config.port}`);
});

function shutdown(signal: string) {
  console.log(`Received ${signal}; stopping Seemplify Experience.`);
  aiJobRunner.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
