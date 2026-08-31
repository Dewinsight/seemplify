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
const validationPath = resolve(repositoryRoot, '.github', 'workflows', 'validate-self-hosted-runner-pool.yml');
const inspectionPath = resolve(repositoryRoot, '.github', 'workflows', 'inspect-kvm8-runners.yml');
const retirementPath = resolve(repositoryRoot, '.github', 'workflows', 'retire-legacy-kvm8-runners.yml');
const recoveryPath = resolve(repositoryRoot, '.github', 'workflows', 'recover-kvm8-runner.yml');
const reregistrationPath = resolve(repositoryRoot, '.github', 'workflows', 'reregister-kvm8-runner.yml');
const entrypointPath = resolve(runnerDirectory, 'entrypoint.sh');

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
const validation = readFileSync(validationPath, 'utf8');
const inspection = readFileSync(inspectionPath, 'utf8');
const retirement = readFileSync(retirementPath, 'utf8');
const recovery = readFileSync(recoveryPath, 'utf8');
const reregistration = readFileSync(reregistrationPath, 'utf8');
const entrypoint = readFileSync(entrypointPath, 'utf8');

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
  assert.match(bootstrap, /test -s \/runner\/\.credentials/);
  assert.match(bootstrap, /test -s \/runner\/\.credentials_rsaparams/);
  assert.match(bootstrap, /: > \.env/);
  assert.ok(
    bootstrap.lastIndexOf('test -s /runner/.runner')
      > bootstrap.indexOf(': > .env'),
    'the tokenless restart must be verified after the registration token is removed',
  );
  assert.match(
    bootstrap,
    /retire_legacy_runner_container github-runner-worker-1 kvm8-shared-worker/,
  );
  assert.match(
    bootstrap,
    /retire_legacy_runner_container github-runner-control-1 kvm8-deploy-controller/,
  );
  assert.ok(
    bootstrap.indexOf('grep -Fxq "RUNNER_NAME=$expected_runner_name"')
      < bootstrap.indexOf('docker stop --time 45 "$container"'),
    'legacy retirement must verify the exact runner identity before stopping a container',
  );
  assert.doesNotMatch(bootstrap, /docker volume (?:rm|prune)/);
  assert.ok(
    bootstrap.indexOf("grep -Fq 'Runner.Worker run'")
      < bootstrap.indexOf('docker compose --env-file .env -f compose.yml up -d --build --remove-orphans'),
    'bootstrap must reject active jobs before recreating runner containers',
  );
});

test('entrypoint repairs partial registration without accepting incomplete credentials', () => {
  for (const file of ['.runner', '.credentials', '.credentials_rsaparams']) {
    assert.match(entrypoint, new RegExp(`! -s \\$registration_file`));
    assert.ok(entrypoint.includes(file));
  }
  assert.match(entrypoint, /rm -f -- \.runner \.credentials \.credentials_rsaparams/);
  assert.ok(
    entrypoint.indexOf('rm -f -- .runner .credentials .credentials_rsaparams')
      < entrypoint.indexOf('./config.sh "${config_args[@]}"'),
  );
});

test('live pool validation targets each isolated label and exact cgroup ceiling', () => {
  assert.match(validation, /runs-on: dewinsight-kvm8-seemplify/);
  assert.match(validation, /runs-on: dewinsight-kvm8-workspace/);
  assert.match(validation, /runs-on: dewinsight-kvm8-control/);
  assert.equal((validation.match(/300000 100000/g) || []).length, 2);
  assert.equal((validation.match(/6442450944/g) || []).length, 2);
  assert.match(validation, /50000 100000/);
  assert.match(validation, /1073741824/);
});

test('runner inspection is read-only and covers current and legacy containers', () => {
  for (const container of [
    'github-actions-runner-seemplify-worker-1',
    'github-actions-runner-workspace-worker-1',
    'github-actions-runner-control-1',
    'github-runner-worker-1',
    'github-runner-control-1',
  ]) {
    assert.match(inspection, new RegExp(container));
  }
  assert.doesNotMatch(
    inspection,
    /docker\s+(?:compose\s+)?(?:stop|start|restart|rm|up|down|kill|prune)\b/,
  );
});

test('legacy retirement is identity-guarded and preserves runner volumes', () => {
  assert.match(
    retirement,
    /retire_legacy_runner_container github-runner-worker-1 kvm8-shared-worker/,
  );
  assert.match(
    retirement,
    /retire_legacy_runner_container github-runner-control-1 kvm8-deploy-controller/,
  );
  assert.ok(
    retirement.indexOf('grep -Fxq "RUNNER_NAME=$expected_runner_name"')
      < retirement.indexOf('docker stop --time 45 "$container"'),
  );
  assert.match(retirement, /! docker inspect github-runner-worker-1/);
  assert.match(retirement, /! docker inspect github-runner-control-1/);
  assert.doesNotMatch(retirement, /docker volume (?:rm|prune)|docker system prune/);
});

test('single-runner recovery validates compose and runner identities', () => {
  assert.match(recovery, /type: choice/);
  assert.match(recovery, /container_id=\$\(docker inspect --format '\{\{\.Id\}\}' "\$container"\)/);
  assert.match(recovery, /current_id != "\$container_id"/);
  assert.ok(
    recovery.indexOf('grep -Fxq "RUNNER_NAME=$expected_name"')
      < recovery.indexOf('docker restart --time 45 "$container"'),
  );
  assert.doesNotMatch(recovery, /docker volume (?:rm|prune)|docker system prune/);
});

test('stale registration repair is guarded, scoped, and removes its token', () => {
  assert.match(reregistration, /KVM8_RUNNER_REGISTRATION_TOKEN/);
  assert.match(reregistration, /grep -Fq 'Runner.Worker run'/);
  assert.match(
    reregistration,
    /rm -f -- \/runner\/\.runner \/runner\/\.credentials \/runner\/\.credentials_rsaparams/,
  );
  assert.match(reregistration, /\/opt\/runner-hooks\/cleanup-workspace\.sh/);
  assert.match(reregistration, /: > \.repair\.env/);
  assert.match(reregistration, /tokenless=true/);
  assert.doesNotMatch(reregistration, /docker volume (?:rm|prune)|docker system prune/);
});
