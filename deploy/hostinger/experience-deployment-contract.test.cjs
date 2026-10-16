const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const workflow = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/deploy-experience-hostinger.yml'), 'utf8');

test('the one-off migrator cannot consume the remaining SSH deployment script', () => {
  const command = workflow.split('\n').find((line) => line.includes('SEEMPLIFY_NOMIC_MIGRATION_ONLY=1 experience'));
  assert.ok(command);
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  function simulate(flags) {
    // An interactive child drains the shared SSH stdin even when its program
    // does not read it. The detached-input form must leave the script tail intact.
    const script = `child(){ case "$*" in *--interactive=false*) :;; *) cat >/dev/null;; esac; }\nchild ${flags}\nprintf 'TAIL_EXECUTED\\n'\n`;
    const result = spawnSync(bash, ['-s'], { input: script, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  assert.doesNotMatch(simulate('--rm --no-deps'), /TAIL_EXECUTED/);
  assert.match(simulate(command.includes('--interactive=false') ? '--interactive=false --rm --no-deps' : '--rm --no-deps'), /TAIL_EXECUTED/);
});

test('a separate SSH step verifies current running images and real Nomic readiness', () => {
  const verify = workflow.slice(workflow.indexOf('- name: Verify live Experience independently'));
  assert.match(verify, /hostinger_ssh_stdin/);
  assert.match(verify, /\.State\.Running/);
  assert.match(verify, /org\.opencontainers\.image\.revision/);
  assert.match(verify, /s\.get\("ready"\)/);
  assert.match(verify, /s\.get\("activeEmbeddingProvider"\)/);
  assert.doesNotMatch(verify, /^\s+node /m);
  assert.match(verify, /seemplify-smoke/);
});

test('the production Arango provisioner preserves database grants when updating existing users', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/provision-experience-knowledge-hostinger.yml'), 'utf8');
  const update = source.slice(source.indexOf('if [[ "$status" == 200 ]]'), source.indexOf('else', source.indexOf('if [[ "$status" == 200 ]]')));
  assert.match(update, /--request PATCH --data "\$payload"/);
  assert.doesNotMatch(update, /--request PUT/);
});


test('both deployment owners preflight, back up and migrate Recruiter with detached stdin before recreation', () => {
  const helper = fs.readFileSync(path.join(__dirname, 'migrate-recruiter-nomic.sh'), 'utf8');
  assert.equal((helper.match(/run --interactive=false/g) || []).length, 2);
  assert.ok(helper.indexOf('deployment readiness probe') < helper.indexOf('stop recruiter-backend'));
  assert.ok(helper.indexOf('seemplify-backup') < helper.indexOf('stop recruiter-backend'));
  assert.match(helper, /trap rollback ERR/);
  for (const file of ['deploy-core-hostinger.yml', 'deploy-experience-hostinger.yml', 'deploy-chatgpt-gateway-hostinger.yml']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows', file), 'utf8');
    const migrate = source.indexOf('          /opt/seemplify/deploy/hostinger/migrate-recruiter-nomic.sh');
    assert.ok(migrate > 0 && migrate < source.indexOf('up -d --no-deps --force-recreate recruiter-backend'));
  }
});
