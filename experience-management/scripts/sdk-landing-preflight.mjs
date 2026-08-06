import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, '..');
const runDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
}).format(new Date());

export const requiredMainFiles = [
  'packages/SDK-QUALIFICATION.json',
  'packages/SDK-RELEASE.md',
  'packages/SDK-PUBLISH-CHECKLIST.md',
  'scripts/sdk-publish-preflight.mjs'
];

function fail(message) {
  throw new Error(`[sdk-landing-preflight] ${message}`);
}

function run(command, args, { cwd = workspaceRoot } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim()
  };
}

function formatOutcome(outcome) {
  return outcome.stderr || outcome.stdout || `exit ${outcome.status}`;
}

export function existsOnMain(relativePath) {
  const outcome = run('git', ['cat-file', '-e', `main:experience-management/${relativePath}`]);
  return outcome.ok;
}

export function runLandingPreflight() {
  const currentBranch = run('git', ['branch', '--show-current']);
  if (!currentBranch.ok) {
    fail(`could not determine current branch: ${formatOutcome(currentBranch)}`);
  }

  const missingOnMain = requiredMainFiles.filter((relativePath) => !existsOnMain(relativePath));

  console.log('Journey SDK landing preflight');
  console.log(`Date: ${runDate}`);
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Current branch: ${currentBranch.stdout}`);
  console.log('Target branch: main');
  console.log('');
  console.log('Required SDK publish-state files on main:');
  for (const relativePath of requiredMainFiles) {
    console.log(`- ${relativePath}: ${missingOnMain.includes(relativePath) ? 'missing on main' : 'present on main'}`);
  }
  console.log('');

  if (missingOnMain.length) {
    fail(`main is missing ${missingOnMain.length} required SDK publish-state file(s): ${missingOnMain.join(', ')}`);
  }

  console.log('main contains the required SDK publish-state files.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runLandingPreflight();
}
