import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { existsOnMain, requiredMainFiles } from './sdk-landing-preflight.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, '..');
const runDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
}).format(new Date());

function fail(message) {
  throw new Error(`[sdk-publish-delta] ${message}`);
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

const currentBranch = run('git', ['branch', '--show-current']);
if (!currentBranch.ok) {
  fail(`could not determine current branch: ${formatOutcome(currentBranch)}`);
}

const status = run('git', ['status', '--short', '--', ...requiredMainFiles]);
if (!status.ok) {
  fail(`could not inspect working-tree state for SDK publish-state files: ${formatOutcome(status)}`);
}

const diff = run('git', ['diff', '--name-status', 'main...HEAD', '--', ...requiredMainFiles]);
if (!diff.ok) {
  fail(`could not compare main...HEAD for SDK publish-state files: ${formatOutcome(diff)}`);
}

const lines = diff.stdout ? diff.stdout.split(/\r?\n/u).filter(Boolean) : [];
const statusLines = status.stdout ? status.stdout.split(/\r?\n/u).filter(Boolean) : [];
const diffByPath = new Map(lines.map((line) => {
  const normalized = line.replace(/^[A-Z]\s+/u, '').replace(/^experience-management[\\/]/u, '').replaceAll('\\', '/');
  return [normalized, line];
}));
const statusByPath = new Map(statusLines.map((line) => {
  const normalized = line.replace(/^[ ?MADRCU!]{2}\s+/u, '').replaceAll('\\', '/');
  return [normalized, line];
}));

console.log('Journey SDK publish delta');
console.log(`Date: ${runDate}`);
console.log(`Workspace: ${workspaceRoot}`);
console.log(`Current branch: ${currentBranch.stdout}`);
console.log('Comparison: main...HEAD');
console.log('');
console.log('Required SDK publish-state delta:');
for (const relativePath of requiredMainFiles) {
  const presentOnMain = existsOnMain(relativePath);
  const workingTreeExists = existsSync(path.join(workspaceRoot, relativePath));
  const branchDelta = diffByPath.get(relativePath);
  const workingTreeStatus = statusByPath.get(relativePath);
  const summary = presentOnMain
    ? branchDelta ?? workingTreeStatus ?? 'present on main; no current SDK publish-state delta'
    : workingTreeExists
      ? workingTreeStatus ?? branchDelta ?? 'missing on main; present only in current working tree'
      : 'missing on main and absent from current working tree';
  console.log(`- ${relativePath}: ${summary}`);
}
console.log('');

const missingOnMain = requiredMainFiles.filter((relativePath) => !existsOnMain(relativePath));
if (!missingOnMain.length && !statusLines.length && !lines.length) {
  console.log('No SDK publish-state delta remains between main and the current working tree.');
} else {
  console.log(`Required files missing on main: ${missingOnMain.length}`);
  console.log(`Committed main...HEAD SDK publish-state diffs: ${lines.length}`);
  console.log(`Working-tree SDK publish-state entries: ${statusLines.length}`);
}
