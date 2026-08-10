import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, '..');
const operationsDirectory = path.join(workspaceRoot, 'docs', 'journey-management', 'operations');
const outputJsonPath = path.join(operationsDirectory, 'latest-phase2-release-gate-report.json');
const outputMarkdownPath = path.join(operationsDirectory, 'latest-phase2-release-gate-report.md');
const generatedAt = new Date().toISOString();

const commands = {
  sourceParity: ['npx', ['tsx', '--test',
    'backend/test/journey-metric-calculations.test.ts',
    'backend/test/journey-operational-measures.test.ts',
    'backend/test/journey-native-metric-sources.test.ts']],
  accessDeletionCitation: ['npx', ['tsx', '--test',
    'backend/test/journey-research-hub.test.ts',
    'backend/test/journey-evidence-lifecycle.test.ts',
    'backend/test/journey-metrics-persistence.test.ts']],
  freshnessRebuildLoad: ['npx', ['tsx', 'scripts/probe-phase2-metric-load.mts']]
};

function run(command, args) {
  const before = performance.now();
  const result = spawnSync(command, args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024
  });
  return {
    ok: result.status === 0,
    status: result.status,
    durationMs: Math.round((performance.now() - before) * 100) / 100,
    command: [command, ...args].join(' '),
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim()
  };
}

function lastJsonLine(output) {
  for (const line of output.split(/\r?\n/u).reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object') return value;
    } catch { /* test output is intentionally ignored */ }
  }
  return null;
}

function testSummary(output) {
  const read = (label) => {
    const match = output.match(new RegExp(`# ${label} (\\d+)`, 'u'));
    return match ? Number(match[1]) : null;
  };
  return { tests: read('tests'), pass: read('pass'), fail: read('fail'), skipped: read('skipped') };
}

const executions = Object.fromEntries(Object.entries(commands).map(([id, [command, args]]) => [id, run(command, args)]));
const probe = lastJsonLine(executions.freshnessRebuildLoad.stdout);
const approvalPath = process.env.PHASE2_RELEASE_APPROVAL_FILE
  ? path.resolve(workspaceRoot, process.env.PHASE2_RELEASE_APPROVAL_FILE) : null;
let approval = null;
try {
  approval = approvalPath && existsSync(approvalPath) ? JSON.parse(readFileSync(approvalPath, 'utf8')) : null;
} catch { approval = null; }
const approvalIdentityValid = approval?.version === 'phase2-release-approval/v1'
  && approval?.decision === 'approved'
  && typeof approval?.approvedBy === 'string' && approval.approvedBy.trim().length >= 3
  && Number.isFinite(Date.parse(approval?.approvedAt || ''))
  && typeof approval?.loadProfileId === 'string' && approval.loadProfileId.trim().length >= 3;
const loadProfileRatified = approvalIdentityValid
  && approval?.profile?.rows === probe?.profile?.rows
  && approval?.profile?.rebuildBudgetMs === probe?.profile?.rebuildBudgetMs;
const sloApprovalRecorded = approvalIdentityValid
  && Number.isFinite(approval?.slo?.analyticsFreshnessSeconds)
  && approval.slo.analyticsFreshnessSeconds <= 60
  && Number.isFinite(approval?.slo?.rebuildP95Ms)
  && approval.slo.rebuildP95Ms <= probe?.profile?.rebuildBudgetMs;
const componentStatuses = {
  sourceParity: executions.sourceParity.ok,
  accessDeletionCitation: executions.accessDeletionCitation.ok,
  freshnessRebuildCandidate: executions.freshnessRebuildLoad.ok && probe?.ok === true
    && probe?.assertions?.candidateBudgetPassed === true,
  metricMetadata: executions.accessDeletionCitation.ok && probe?.assertions?.metadataComplete === true,
  loadProfileRatified,
  sloApprovalRecorded
};
const executableProofPassed = componentStatuses.sourceParity
  && componentStatuses.accessDeletionCitation
  && componentStatuses.freshnessRebuildCandidate
  && componentStatuses.metricMetadata;
const releaseGateEligible = executableProofPassed && loadProfileRatified && sloApprovalRecorded;
const blockers = [
  ...(!loadProfileRatified ? ['PHASE2_LOAD_PROFILE_NOT_RATIFIED'] : []),
  ...(!sloApprovalRecorded ? ['PHASE2_SLO_APPROVAL_NOT_RECORDED'] : []),
  ...(!componentStatuses.sourceParity ? ['SOURCE_PARITY_SUITE_FAILED'] : []),
  ...(!componentStatuses.accessDeletionCitation ? ['ACCESS_DELETION_CITATION_SUITE_FAILED'] : []),
  ...(!componentStatuses.freshnessRebuildCandidate ? ['FRESHNESS_REBUILD_CANDIDATE_FAILED'] : []),
  ...(!componentStatuses.metricMetadata ? ['METRIC_METADATA_SUITE_FAILED'] : [])
];

const report = {
  ok: executableProofPassed,
  generatedAt,
  requirementId: 'P2-11',
  state: releaseGateEligible ? 'release_gate_eligible_pending_signoff' : 'in_progress',
  releaseGateEligible,
  componentStatuses,
  blockers,
  profile: {
    status: loadProfileRatified ? 'ratified_by_approval_artifact' : 'local_candidate_unratified',
    approval: approvalIdentityValid ? { loadProfileId: approval.loadProfileId, approvedBy: approval.approvedBy,
      approvedAt: approval.approvedAt, artifactPath: approvalPath } : null,
    host: { platform: process.platform, arch: process.arch, node: process.version,
      logicalCpuCount: os.cpus().length, totalMemoryBytes: os.totalmem() },
    probe: probe?.profile || null
  },
  measured: probe ? { assertions: probe.assertions, timings: probe.timings } : null,
  executions: Object.fromEntries(Object.entries(executions).map(([id, execution]) => [id, {
    ok: execution.ok,
    status: execution.status,
    durationMs: execution.durationMs,
    command: execution.command,
    summary: id === 'freshnessRebuildLoad' ? null : testSummary(execution.stdout),
    error: execution.ok ? null : (execution.stderr || execution.stdout).slice(-4000)
  }])),
  limitations: [
    'The bundled load probe is a bounded single-process SQLite characterization, not an agreed production load profile.',
    'Ratification and SLO approval require a matching phase2-release-approval/v1 artifact supplied through PHASE2_RELEASE_APPROVAL_FILE; this script never infers either from a fast local run.',
    'The gate does not claim accessibility, independent security/privacy review, multi-node failover, or sustained soak proof.'
  ]
};

const markdown = `# Phase 2 release-gate report

Generated at: ${generatedAt}

## Result

- Requirement: P2-11
- Executable proof passed: ${executableProofPassed ? 'yes' : 'no'}
- Release-gate eligible: ${releaseGateEligible ? 'yes' : 'no'}
- Load profile: ${report.profile.status}
- Open blockers: ${blockers.length ? blockers.join(', ') : 'none'}

## Components

| Component | Result | Evidence |
| --- | --- | --- |
| Source parity | ${componentStatuses.sourceParity ? 'pass' : 'fail'} | ${executions.sourceParity.command} |
| Access, deletion, and citation | ${componentStatuses.accessDeletionCitation ? 'pass' : 'fail'} | ${executions.accessDeletionCitation.command} |
| Freshness and rebuild candidate | ${componentStatuses.freshnessRebuildCandidate ? 'pass' : 'fail'} | ${executions.freshnessRebuildLoad.command} |
| Metric source/window/sample metadata | ${componentStatuses.metricMetadata ? 'pass' : 'fail'} | Persistence suite plus load-probe assertions |

## Candidate measurements

${probe ? `- Rows: ${probe.profile.rows}
- Candidate rebuild budget: ${probe.profile.rebuildBudgetMs} ms
- Initial rebuild: ${probe.timings.initialRebuildMs} ms
- Correction rebuild: ${probe.timings.correctionRebuildMs} ms
- Deletion rebuild: ${probe.timings.deletionRebuildMs} ms
- Initial freshness: ${probe.assertions.initialFreshness}
- Deletion result: revision ${probe.assertions.deletionRevision}, sample ${probe.assertions.deletionSampleSize}` : '- Probe did not produce usable measurements.'}

## Limitations

${report.limitations.map((item) => `- ${item}`).join('\n')}
`;

mkdirSync(operationsDirectory, { recursive: true });
writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(outputMarkdownPath, markdown, 'utf8');

console.log(JSON.stringify({ ok: executableProofPassed, releaseGateEligible, outputJsonPath, outputMarkdownPath,
  blockers, componentStatuses }));
if (!executableProofPassed) process.exitCode = 1;
