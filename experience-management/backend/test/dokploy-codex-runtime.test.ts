import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');

test('the Dokploy runtime provides native Codex TLS and sandbox prerequisites', () => {
  const runtimeStage = dockerfile.slice(dockerfile.indexOf('FROM node:24-bookworm-slim AS runtime'));
  assert.match(runtimeStage, /apt-get install -y --no-install-recommends ca-certificates bubblewrap/u);
  assert.ok(
    runtimeStage.indexOf('apt-get install') < runtimeStage.indexOf('USER node'),
    'system packages must be installed before the runtime drops root privileges'
  );
});
