import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsOnMain, requiredMainFiles } from './sdk-landing-preflight.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, '..');
const reportDirectory = path.join(workspaceRoot, 'docs', 'journey-management', 'operations');
const jsonPath = path.join(reportDirectory, 'latest-sdk-publication-readiness-report.json');
const markdownPath = path.join(reportDirectory, 'latest-sdk-publication-readiness-report.md');
const generatedAt = new Date().toISOString();
const displayDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
}).format(new Date());

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

function parseListSection(output, heading, { stopPrefixes = [] } = {}) {
  const lines = output.split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];
  const items = [];
  let current = undefined;
  for (let index = start + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (stopPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
      break;
    }
    if (/^[A-Z][A-Za-z/() -]+:$/u.test(trimmed)) {
      break;
    }
    if (trimmed.startsWith('- ')) {
      if (current) items.push(current);
      current = trimmed.slice(2);
      continue;
    }
    if (!current) {
      break;
    }
    current = `${current} ${trimmed}`;
  }
  if (current) items.push(current);
  return items;
}

function parseScalar(output, label) {
  const line = output.split(/\r?\n/u).find((entry) => entry.startsWith(label));
  return line ? line.slice(label.length).trim() : undefined;
}

function normalizeDeltaLine(line) {
  return line.replace(/^[A-Z? ]+\s+/u, '').replace(/^experience-management[\\/]/u, '').replaceAll('\\', '/');
}

mkdirSync(reportDirectory, { recursive: true });

const branchResult = run('git', ['branch', '--show-current']);
const currentBranch = branchResult.ok ? branchResult.stdout : '<unknown>';

const landingResult = run('npm', ['run', 'preflight:sdk:landing']);
const deltaResult = run('npm', ['run', 'evidence:sdk:delta']);
const publishResult = run('npm', ['run', 'preflight:sdk:publish']);

const missingOnMain = requiredMainFiles.filter((relativePath) => !existsOnMain(relativePath));
const deltaLines = parseListSection(deltaResult.stdout, 'Required SDK publish-state delta:', {
  stopPrefixes: [
    'Required files missing on main:',
    'Committed main...HEAD SDK publish-state diffs:',
    'Working-tree SDK publish-state entries:'
  ]
});
const deltaByFile = Object.fromEntries(deltaLines.map((line) => {
  const [file, ...rest] = line.split(':');
  return [file.replace(/^- /u, '').trim(), rest.join(':').trim()];
}));

const report = {
  generatedAt,
  workspaceRoot,
  currentBranch,
  targetBranch: 'main',
  repoSide: {
    landingPreflightOk: landingResult.ok,
    requiredFilesMissingOnMain: missingOnMain,
    requiredMainFiles,
    deltaCommandOk: deltaResult.ok,
    deltaByFile,
    committedMainHeadDiffs: Number(parseScalar(deltaResult.stdout, 'Committed main...HEAD SDK publish-state diffs:') ?? '0'),
    workingTreeSdkPublishStateEntries: Number(parseScalar(deltaResult.stdout, 'Working-tree SDK publish-state entries:') ?? '0')
  },
  publishPreflight: {
    ok: publishResult.ok,
    repositoryWorkflowBlockers: parseListSection(publishResult.stdout, 'Repository/workflow blockers:'),
    externalSetupBlockers: parseListSection(publishResult.stdout, 'External account/setup blockers:'),
    workstationLimitations: parseListSection(publishResult.stdout, 'Workstation limitations (do not by themselves prove GitHub Actions publish failure):'),
    observedNotes: parseListSection(publishResult.stdout, 'Observed notes:')
  },
  notClaimed: [
    'This report does not prove npm authentication, npm organisation ownership, or trusted-publisher configuration are complete.',
    'This report does not prove the broader connected-journey release gates are complete.',
    'This report does not prove the SDKs are publishable today.'
  ]
};

const markdown = `# SDK publication readiness report

Generated at: ${generatedAt}

## Summary

- Date: ${displayDate}
- Current branch: ${currentBranch}
- Target branch: main
- Repo-side landing preflight: ${landingResult.ok ? 'passed' : 'failed'}
- Required files missing on main: ${missingOnMain.length}
- Committed main...HEAD SDK publish-state diffs: ${report.repoSide.committedMainHeadDiffs}
- Working-tree SDK publish-state entries: ${report.repoSide.workingTreeSdkPublishStateEntries}
- Publish preflight: ${publishResult.ok ? 'passed' : 'failed'}

## Repo-side landing status

${requiredMainFiles.map((relativePath) => `- ${relativePath}: ${missingOnMain.includes(relativePath) ? 'missing on main' : 'present on main'}`).join('\n')}

## Required SDK publish-state delta

${requiredMainFiles.map((relativePath) => `- ${relativePath}: ${deltaByFile[relativePath] ?? 'no current delta reported'}`).join('\n')}

## Publish preflight repository/workflow blockers

${report.publishPreflight.repositoryWorkflowBlockers.length ? report.publishPreflight.repositoryWorkflowBlockers.map((item) => `- ${item}`).join('\n') : '- none'}

## Publish preflight external setup blockers

${report.publishPreflight.externalSetupBlockers.length ? report.publishPreflight.externalSetupBlockers.map((item) => `- ${item}`).join('\n') : '- none'}

## Publish preflight workstation limitations

${report.publishPreflight.workstationLimitations.length ? report.publishPreflight.workstationLimitations.map((item) => `- ${item}`).join('\n') : '- none'}

## Not claimed

${report.notClaimed.map((item) => `- ${item}`).join('\n')}
`;

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(markdownPath, markdown, 'utf8');

console.log(JSON.stringify({
  ok: true,
  generatedAt,
  jsonPath,
  markdownPath,
  requiredFilesMissingOnMain: missingOnMain.length,
  publishPreflightOk: publishResult.ok
}));
