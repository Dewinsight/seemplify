import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = path.join(root, 'compose', 'docker-compose.dokploy.yml');

test('production compose passes structural validator', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'validate-compose-config.mjs'), '--compose', compose], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});

test('cutover replicas and sending default to off', () => {
  const text = readFileSync(compose, 'utf8');
  assert.match(text, /MAIL_API_SEND_ENABLED:-false/);
  assert.match(text, /MAIL_API_REPLICAS:-0/);
  assert.match(text, /POSTAL_WORKER_REPLICAS:-0/);
  assert.match(text, /MAIL_TUNNEL_REPLICAS:-0/);
  assert.match(text, /RELAY_SMTP_AUTH_MODE:\s*\$\{RELAY_SMTP_AUTH_MODE:-password\}/);
  assert.match(text, /RELAY_SMTP_PASSWORD:\s*\$\{RELAY_SMTP_PASSWORD:-\}/);
  assert.doesNotMatch(text, /RELAY_SMTP_PASSWORD:\s*[A-Za-z0-9]{16}\s*$/m);
});
