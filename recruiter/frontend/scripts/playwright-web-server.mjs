import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const port = process.env.RECRUITER_E2E_PORT || '5050';

if (process.env.RECRUITER_E2E_SKIP_BUILD !== '1') {
  const build = spawnSync(process.execPath, [nextBin, 'build'], {
    env: process.env,
    stdio: 'inherit',
  });

  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

const server = spawn(process.execPath, [nextBin, 'start', '-p', port, '-H', '127.0.0.1'], {
  env: process.env,
  stdio: 'inherit',
});

const stop = (signal) => {
  if (!server.killed) server.kill(signal);
};

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
server.on('exit', (code) => process.exit(code ?? 0));
