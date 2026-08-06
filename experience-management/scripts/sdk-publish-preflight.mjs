import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadPolicy } from './sdk-package-tools.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, '..');
const repositoryRoot = path.resolve(workspaceRoot, '..');
const runDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
}).format(new Date());

function fail(message) {
  throw new Error(`[sdk-publish-preflight] ${message}`);
}

function parseSemver(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(String(value ?? '').trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
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

const policy = loadPolicy();
const repoBlockers = [];
const externalBlockers = [];
const workstationLimitations = [];
const notes = [];

const publishToolchain = policy.release?.publishToolchain ?? {};
const requiredNode = String(publishToolchain.nodeVersion ?? '').trim();
const requiredNpm = String(publishToolchain.npmVersion ?? '').trim();
if (!requiredNode || !requiredNpm) {
  fail('Qualification policy does not record publishToolchain.nodeVersion and publishToolchain.npmVersion');
}

const workflowTemplate = path.resolve(workspaceRoot, policy.release.workflowTemplate);
if (!existsSync(workflowTemplate)) {
  repoBlockers.push(`workflow template is missing: ${path.relative(workspaceRoot, workflowTemplate).replaceAll('\\', '/')}`);
} else if (workflowTemplate.endsWith('.disabled')) {
  repoBlockers.push(`publish workflow is still disabled: ${path.relative(repositoryRoot, workflowTemplate).replaceAll('\\', '/')}`);
} else {
  notes.push(`publish workflow is enabled at ${path.relative(repositoryRoot, workflowTemplate).replaceAll('\\', '/')}`);
}

const localNode = process.version;
const localNpmResult = run('npm', ['--version']);
const localNpm = localNpmResult.ok ? localNpmResult.stdout : '<unavailable>';
const parsedLocalNode = parseSemver(localNode);
const parsedRequiredNode = parseSemver(requiredNode);
const parsedLocalNpm = parseSemver(localNpm);
const parsedRequiredNpm = parseSemver(requiredNpm);

if (!parsedLocalNode || !parsedRequiredNode || compareSemver(parsedLocalNode, parsedRequiredNode) < 0) {
  workstationLimitations.push(`local Node ${localNode} is below the trusted-publishing floor ${requiredNode}`);
} else {
  notes.push(`local Node ${localNode} satisfies the trusted-publishing floor ${requiredNode}`);
}
if (!localNpmResult.ok || !parsedLocalNpm || !parsedRequiredNpm || compareSemver(parsedLocalNpm, parsedRequiredNpm) < 0) {
  workstationLimitations.push(`local npm ${localNpm} is below the trusted-publishing floor ${requiredNpm}`);
} else {
  notes.push(`local npm ${localNpm} satisfies the trusted-publishing floor ${requiredNpm}`);
}

const branchResult = run('git', ['branch', '--show-current']);
if (!branchResult.ok) {
  repoBlockers.push(`could not determine current branch: ${formatOutcome(branchResult)}`);
} else if (branchResult.stdout !== 'main') {
  repoBlockers.push(`current branch is ${branchResult.stdout}; the publish workflow requires main`);
} else {
  notes.push('current branch is main');
}

const ghAuth = run('gh', ['auth', 'status']);
if (!ghAuth.ok) {
  externalBlockers.push(`GitHub CLI is not authenticated: ${formatOutcome(ghAuth)}`);
} else {
  notes.push('GitHub CLI authentication is available');
}

const npmEnvironment = run('gh', ['api', `repos/michaelegbo/seemplify/environments/${policy.release.environment}`]);
if (!npmEnvironment.ok) {
  repoBlockers.push(`GitHub environment ${policy.release.environment} is not readable via gh api: ${formatOutcome(npmEnvironment)}`);
} else {
  try {
    const environmentPayload = JSON.parse(npmEnvironment.stdout);
    const protectionRules = Array.isArray(environmentPayload.protection_rules)
      ? environmentPayload.protection_rules
      : [];
    const requiredReviewersRule = protectionRules.find((rule) => rule?.type === 'required_reviewers');
    const reviewers = Array.isArray(requiredReviewersRule?.reviewers)
      ? requiredReviewersRule.reviewers
      : [];
    if (!reviewers.length) {
      repoBlockers.push(`GitHub environment ${policy.release.environment} does not currently report any required reviewers`);
    } else {
      notes.push(`GitHub environment ${policy.release.environment} exists with ${reviewers.length} required reviewer(s)`);
    }
  } catch (error) {
    repoBlockers.push(`GitHub environment ${policy.release.environment} returned unreadable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const npmWhoami = run('npm', ['whoami']);
if (!npmWhoami.ok) {
  externalBlockers.push(`npm authentication is unavailable on this machine: ${formatOutcome(npmWhoami)}`);
} else {
  notes.push(`npm whoami returned ${npmWhoami.stdout}`);
}

const scopeName = '@seemplify';
const orgResult = run('npm', ['org', 'ls', 'seemplify']);
if (!orgResult.ok) {
  externalBlockers.push(`npm scope ${scopeName} is not proven ready: ${formatOutcome(orgResult)}`);
} else {
  notes.push(`npm org ls seemplify succeeded:\n${orgResult.stdout}`);
}

const packageName = '@seemplify/journey-event-protocol';
const publishedVersion = run('npm', ['view', `${packageName}@next`, 'version']);
if (!publishedVersion.ok) {
  notes.push(`${packageName} is not published yet on dist-tag next (${formatOutcome(publishedVersion)})`);
} else {
  notes.push(`${packageName} is already published on dist-tag next at ${publishedVersion.stdout}`);
}

console.log('Journey SDK publish preflight');
console.log(`Date: ${runDate}`);
console.log(`Workspace: ${workspaceRoot}`);
console.log('');
console.log('Observed notes:');
for (const note of notes) console.log(`- ${note}`);
console.log('');
if (repoBlockers.length) {
  console.log('Repository/workflow blockers:');
  for (const blocker of repoBlockers) console.log(`- ${blocker}`);
  console.log('');
}
if (externalBlockers.length) {
  console.log('External account/setup blockers:');
  for (const blocker of externalBlockers) console.log(`- ${blocker}`);
  console.log('');
}
if (workstationLimitations.length) {
  console.log('Workstation limitations (do not by themselves prove GitHub Actions publish failure):');
  for (const blocker of workstationLimitations) console.log(`- ${blocker}`);
  console.log('');
}
const blockingCount = repoBlockers.length + externalBlockers.length;
if (blockingCount) {
  fail(`${blockingCount} repository/workflow or external setup blocker(s) prevent an authorised SDK publish path today`);
}
console.log('No blocking conditions remain for the documented SDK publish path.');
