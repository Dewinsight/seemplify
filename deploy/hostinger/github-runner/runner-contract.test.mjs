import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const runnerDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(runnerDirectory, '..', '..', '..');
const composePath = resolve(runnerDirectory, 'compose.yml');
const bootstrapPath = resolve(repositoryRoot, '.github', 'workflows', 'bootstrap-kvm8-runner.yml');

const composeResult = spawnSync(
  'docker',
  ['compose', '-f', composePath, 'config', '--format', 'json'],
  { encoding: 'utf8' },
);
if (composeResult.status !== 0) {
  throw new Error(composeResult.stderr || 'docker compose config failed');
}
const compose = JSON.parse(composeResult.stdout);
const bootstrap = readFileSync(bootstrapPath, 'utf8');

test('dedicates independent constrained runners to Seemplify, Workspace, and deployment control', () => {
  assert.deepEqual(Object.keys(compose.services).sort(), [
    'control',
    'seemplify-worker',
    'workspace-worker',
  ]);

  const seemplify = compose.services['seemplify-worker'];
  const workspace = compose.services['workspace-worker'];
  const control = compose.services.control;

  assert.equal(seemplify.environment.RUNNER_NAME, 'kvm8-seemplify-worker');
  assert.deepEqual(
    new Set(seemplify.environment.RUNNER_LABELS.split(',')),
    new Set(['dewinsight-kvm8', 'dewinsight-kvm8-seemplify']),
  );
  assert.equal(workspace.environment.RUNNER_NAME, 'kvm8-workspace-worker');
  assert.equal(workspace.environment.RUNNER_LABELS, 'dewinsight-kvm8-workspace');
  assert.equal(control.environment.RUNNER_NAME, 'kvm8-deploy-controller');
  assert.equal(control.environment.RUNNER_LABELS, 'dewinsight-kvm8-control');

  for (const worker of [seemplify, workspace]) {
    assert.equal(worker.cpus, 3);
    assert.equal(worker.mem_limit, String(6 * 1024 ** 3));
    assert.equal(worker.memswap_limit, worker.mem_limit);
    assert.equal(worker.pids_limit, 2048);
    assert.equal(worker.volumes.length, 1);
    assert.equal(worker.volumes[0].target, '/runner');
  }
  assert.equal(control.cpus, 0.5);
  assert.equal(control.mem_limit, String(1024 ** 3));
});

test('bootstrap fails before mutation on insufficient capacity and verifies every runner', () => {
  assert.match(bootstrap, /cpu_count < 8/);
  assert.match(bootstrap, /memory_kib < 24000000/);
  assert.match(bootstrap, /available_kib < 40000000/);
  assert.ok(
    bootstrap.indexOf('KVM8 lacks the required capacity')
      < bootstrap.indexOf('docker compose --env-file .env -f compose.yml up -d --build --remove-orphans'),
  );
  assert.match(bootstrap, /grep -qx seemplify-worker/);
  assert.match(bootstrap, /grep -qx workspace-worker/);
  assert.match(bootstrap, /grep -qx control/);
  assert.match(bootstrap, /exec -T seemplify-worker[\s\\]+test -s \/runner\/\.runner/);
  assert.match(bootstrap, /exec -T workspace-worker[\s\\]+test -s \/runner\/\.runner/);
  assert.match(bootstrap, /: > \.env/);
  assert.ok(
    bootstrap.lastIndexOf('test -s /runner/.runner')
      > bootstrap.indexOf(': > .env'),
    'the tokenless restart must be verified after the registration token is removed',
  );
});
