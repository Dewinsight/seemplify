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
  assert.match(verify, /s\.ready/);
  assert.match(verify, /s\.activeEmbeddingProvider/);
  assert.match(verify, /seemplify-smoke/);
});

test('the production Arango provisioner preserves database grants when updating existing users', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/provision-experience-knowledge-hostinger.yml'), 'utf8');
  const update = source.slice(source.indexOf('if [[ "$status" == 200 ]]'), source.indexOf('else', source.indexOf('if [[ "$status" == 200 ]]')));
  assert.match(update, /--request PATCH --data "\$payload"/);
  assert.doesNotMatch(update, /--request PUT/);
});
