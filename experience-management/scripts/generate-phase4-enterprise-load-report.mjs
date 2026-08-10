import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validatePhase4Approval } from './phase4-enterprise-load-governance.mjs';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const operationsDirectory = path.join(workspaceRoot, 'docs', 'journey-management', 'operations');
const outputJsonPath = path.join(operationsDirectory, 'latest-phase4-enterprise-load-report.json');
const outputMarkdownPath = path.join(operationsDirectory, 'latest-phase4-enterprise-load-report.md');

function run(command, args) {
  const before = performance.now();
  const result = spawnSync(command, args, { cwd: workspaceRoot, encoding: 'utf8', shell: process.platform === 'win32',
    env: process.env, maxBuffer: 32 * 1024 * 1024 });
  return { ok: result.status === 0, status: result.status, durationMs: Math.round((performance.now() - before) * 100) / 100,
    command: [command, ...args].join(' '), stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}
function lastJsonLine(output) {
  for (const line of output.split(/\r?\n/u).reverse()) {
    try { const parsed = JSON.parse(line); if (parsed && typeof parsed === 'object') return parsed; } catch { /* continue */ }
  }
  return null;
}
function testSummary(output) {
  const value = (label) => Number(output.match(new RegExp(`# ${label} (\\d+)`, 'u'))?.[1] || 0);
  return { tests: value('tests'), pass: value('pass'), fail: value('fail'), skipped: value('skipped') };
}

const domain = run('npx', ['tsx', '--test', 'backend/test/journey-hierarchy.test.ts', 'backend/test/journey-service-blueprint.test.ts']);
const load = run('npx', ['tsx', 'scripts/probe-phase4-enterprise-load.mts']);
const probe = lastJsonLine(load.stdout);
const approvalPath = process.env.PHASE4_ENTERPRISE_LOAD_APPROVAL_FILE
  ? path.resolve(workspaceRoot, process.env.PHASE4_ENTERPRISE_LOAD_APPROVAL_FILE) : null;
let approval = null;
try { approval = approvalPath && existsSync(approvalPath) ? JSON.parse(readFileSync(approvalPath, 'utf8')) : null; }
catch { approval = null; }
const approvalValidation = probe ? validatePhase4Approval(approval, {
  profile: probe.profile, budgetsMs: probe.budgetsMs, fixtureSha256: probe.fixtureSha256
}) : { valid: false, validIdentity: false, profileMatches: false, budgetsMatch: false, fixtureMatches: false };
const componentStatuses = {
  hierarchyBlueprintDomain: domain.ok,
  deterministicSyntheticProbe: load.ok && probe?.ok === true && probe?.assertions?.deterministicSyntheticFixtures === true,
  candidateBackendBudgets: load.ok && probe?.assertions?.candidateBudgetsPassed === true,
  noProductionData: probe?.assertions?.productionDataUsed === false,
  approvalArtifactValid: approvalValidation.valid
};
const executableProofPassed = componentStatuses.hierarchyBlueprintDomain && componentStatuses.deterministicSyntheticProbe
  && componentStatuses.candidateBackendBudgets && componentStatuses.noProductionData;
const releaseGateEligible = executableProofPassed && componentStatuses.approvalArtifactValid;
const blockers = [
  ...(!componentStatuses.hierarchyBlueprintDomain ? ['PHASE4_DOMAIN_SUITE_FAILED'] : []),
  ...(!componentStatuses.deterministicSyntheticProbe ? ['PHASE4_SYNTHETIC_PROBE_FAILED'] : []),
  ...(!componentStatuses.candidateBackendBudgets ? ['PHASE4_CANDIDATE_BUDGET_FAILED'] : []),
  ...(!componentStatuses.noProductionData ? ['PHASE4_PRODUCTION_DATA_SAFETY_UNPROVEN'] : []),
  ...(!componentStatuses.approvalArtifactValid ? ['PHASE4_LOAD_PROFILE_AND_BUDGETS_NOT_RATIFIED'] : [])
];
const generatedAt = new Date().toISOString();
const limitations = [
  'Measurements are a deterministic single-process SQLite backend characterization on the recorded host, not production capacity certification.',
  'The backend projection serialization measurement is not browser rendering, visual, accessibility, interaction-latency, or device certification.',
  'The probe is bounded and not a sustained soak, concurrency, failover, PostgreSQL query-plan, network, or multi-region exercise.',
  'Release eligibility requires an exact phase4-enterprise-load-approval/v1 artifact matching the profile, budgets, and fixture SHA-256; a fast local run never self-ratifies.',
  'Independent security/privacy, accessibility, operational readiness, and signed Phase 4 release decisions remain separate gates.'
];
const report = {
  version: 'phase4-enterprise-load-report/v1', generatedAt,
  requirementIds: ['P4-02', 'P4-03', 'P4-04', 'P4-05', 'P4-07', 'P4-08', 'X-07', 'X-09'],
  state: releaseGateEligible ? 'release_gate_eligible_pending_signoff' : 'in_progress', executableProofPassed,
  releaseGateEligible, componentStatuses, blockers,
  approval: approvalValidation.valid ? { loadProfileId: approval.loadProfileId, approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt, artifactPath: approvalPath } : null,
  approvalValidation, profile: probe?.profile || null, budgetsMs: probe?.budgetsMs || null,
  fixtureSha256: probe?.fixtureSha256 || null,
  host: probe?.host || { node: process.version, platform: process.platform, arch: process.arch,
    logicalCpuCount: os.cpus().length, totalMemoryBytes: os.totalmem() },
  measured: probe ? { assertions: probe.assertions, artifactBytes: probe.artifactBytes,
    timings: probe.timings, budgetResults: probe.budgetResults } : null,
  executions: {
    domain: { ok: domain.ok, status: domain.status, command: domain.command, durationMs: domain.durationMs,
      summary: testSummary(domain.stdout), error: domain.ok ? null : (domain.stderr || domain.stdout).slice(-4000) },
    load: { ok: load.ok, status: load.status, command: load.command, durationMs: load.durationMs,
      error: load.ok ? null : (load.stderr || load.stdout).slice(-4000) }
  }, limitations
};

const rows = probe?.budgetResults ? Object.entries(probe.budgetResults).map(([name, result]) =>
  `| ${name} | ${result.measuredMs} | ${result.budgetMs} | ${result.passed ? 'pass' : 'fail'} |`).join('\n') : '| Probe unavailable | — | — | fail |';
const markdown = `# Phase 4 enterprise synthetic-load evidence

Generated at: ${generatedAt}

## Result

- Requirements: ${report.requirementIds.join(', ')}
- Executable backend evidence passed: ${executableProofPassed ? 'yes' : 'no'}
- Release-gate eligible: ${releaseGateEligible ? 'yes' : 'no'}
- Profile status: ${approvalValidation.valid ? 'ratified by matching approval artifact' : 'local candidate, unratified'}
- Open blockers: ${blockers.length ? blockers.join(', ') : 'none'}

## Candidate profile

${probe ? `- Hierarchy: ${probe.profile.hierarchy.nodes} nodes, ${probe.profile.hierarchy.links} links, depth ${probe.profile.hierarchy.depth}
- Blueprint: ${probe.profile.blueprint.stages} stages, ${probe.profile.blueprint.elements} elements, ${probe.profile.blueprint.relationships} relationships
- Fixture SHA-256: \`${probe.fixtureSha256}\`
- Production data used: no
- Browser certified: no` : '- Probe did not produce a usable profile.'}

## Backend measurements

| Operation | Measured ms | Candidate budget ms | Result |
| --- | ---: | ---: | --- |
${rows}

Artifact byte sizes and complete host metadata are retained in the JSON report.

## Approval contract

Release eligibility remains false unless \`PHASE4_ENTERPRISE_LOAD_APPROVAL_FILE\` points to an approval containing:

- \`version: phase4-enterprise-load-approval/v1\`
- \`decision: approved\`
- a named approver and exact approval timestamp
- the exact profile and candidate budgets from this report
- the exact fixture SHA-256 from this report

## Limitations

${limitations.map((item) => `- ${item}`).join('\n')}
`;
mkdirSync(operationsDirectory, { recursive: true });
writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(outputMarkdownPath, markdown, 'utf8');
console.log(JSON.stringify({ ok: executableProofPassed, releaseGateEligible, blockers, outputJsonPath, outputMarkdownPath }));
if (!executableProofPassed) process.exitCode = 1;
