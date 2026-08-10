import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDirectory, '..');
const operationsDirectory = path.join(workspaceRoot, 'docs', 'journey-management', 'operations');
const outputJsonPath = path.join(operationsDirectory, 'latest-connected-journey-release-gate-report.json');
const outputMarkdownPath = path.join(operationsDirectory, 'latest-connected-journey-release-gate-report.md');
const ingestGateJsonPath = path.join(operationsDirectory, 'latest-ingest-gate-report.json');
const dogfoodJsonPath = path.join(workspaceRoot, 'docs', 'journey-management', 'dogfood', 'latest-activation-report.json');
const runtimeCompatibilityPath = path.join(workspaceRoot, 'backend', 'migrations', 'postgres', 'runtime-compatibility.json');
const generatedAt = new Date().toISOString();
const displayDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC'
}).format(new Date());

function run(command, args, { cwd = workspaceRoot, env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      ...env
    }
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: String(result.stdout ?? '').trim(),
    stderr: String(result.stderr ?? '').trim()
  };
}

function safeReadJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

mkdirSync(operationsDirectory, { recursive: true });

const dockerGateOptIn = process.argv.includes('--allow-docker-gate')
  || String(process.env.JOURNEY_POSTGRES_GATE_ALLOW_DOCKER ?? '').trim() === 'true';

const ingestRefresh = dockerGateOptIn
  ? {
    ...run('npm', ['run', 'report:journey-ingest-gate'], {
      env: {
        JOURNEY_POSTGRES_GATE_ALLOW_DOCKER: 'true'
      }
    }),
    skipped: false,
    skipReason: null
  }
  : {
    ok: true,
    status: null,
    stdout: '',
    stderr: '',
    skipped: true,
    skipReason: 'Disposable Docker ingest gate not opted into; pass --allow-docker-gate (npm run report:journey:release-gate:local) or set JOURNEY_POSTGRES_GATE_ALLOW_DOCKER=true to refresh it. Recorded ingest gate evidence was reused unchanged.'
  };
const dogfoodRefresh = run('npm', ['run', 'report:journey-dogfood']);

const ingestGate = safeReadJson(ingestGateJsonPath);
const dogfood = safeReadJson(dogfoodJsonPath);

const compatibility = safeReadJson(runtimeCompatibilityPath);
const expectedRuntimeSchemaVersion = Number(compatibility?.maximumRuntimeSchemaVersion ?? Number.NaN);
const ingestResult = ingestGate?.result ?? {};
const dogfoodSummary = dogfood?.summary ?? {};
const ingestEvidenceRuntimeSchemaVersion = Number(ingestResult?.runtime?.runtimeSchemaVersion ?? Number.NaN);
const ingestEvidenceCurrent = Number.isFinite(expectedRuntimeSchemaVersion)
  && ingestEvidenceRuntimeSchemaVersion === expectedRuntimeSchemaVersion;
const ingestEvidenceUsable = ingestGate?.ok === true
  && Array.isArray(ingestResult?.remainingBlockers)
  && (!ingestRefresh.skipped || ingestEvidenceCurrent);
const hasIngestBlocker = (code) => !ingestEvidenceUsable || ingestResult.remainingBlockers.includes(code);
const ingestEvidenceNote = ingestEvidenceUsable
  ? null
  : ingestRefresh.skipped
    ? `Reused ingest gate evidence is not usable (ok ${String(ingestGate?.ok ?? 'unknown')}, runtime schema version ${String(ingestResult?.runtime?.runtimeSchemaVersion ?? 'unknown')} against expected ${String(compatibility?.maximumRuntimeSchemaVersion ?? 'unknown')}); treated as open. Refresh with npm run report:journey:release-gate:local.`
    : `Ingest gate did not produce usable blocker evidence (exitCode ${String(ingestGate?.exitCode ?? 'unknown')}); treated as open.`;

const blockerStatuses = [
  {
    id: 'independent_security_privacy_review',
    title: 'Independent security/privacy review',
    open: hasIngestBlocker('INDEPENDENT_SECURITY_PRIVACY_REVIEW_PENDING'),
    evidence: ingestEvidenceNote ?? 'Connected-journey ingest gate still records INDEPENDENT_SECURITY_PRIVACY_REVIEW_PENDING.'
  },
  {
    id: 'ratified_hardware_load_profile',
    title: 'Ratified hardware and load profile',
    open: hasIngestBlocker('RATIFIED_HARDWARE_AND_LOAD_PROFILE_PENDING'),
    evidence: ingestEvidenceNote ?? `Current local request latency p95 is ${String(ingestResult?.latencyMs?.p95 ?? 'unknown')} ms against an unratified candidate.`
  },
  {
    id: 'multi_node_failover',
    title: 'Multi-node production PostgreSQL failover',
    open: hasIngestBlocker('MULTI_NODE_PRODUCTION_POSTGRES_FAILOVER_NOT_EXERCISED'),
    evidence: ingestEvidenceNote ?? 'Connected-journey ingest gate still records MULTI_NODE_PRODUCTION_POSTGRES_FAILOVER_NOT_EXERCISED.'
  },
  {
    id: 'sustained_recovery_live_traffic_soak',
    title: 'Sustained recovery and live-traffic soak',
    open: hasIngestBlocker('SUSTAINED_RECOVERY_AND_LIVE_TRAFFIC_SOAK_PENDING'),
    evidence: ingestEvidenceNote ?? 'Bounded local soak exists, but the gate still records SUSTAINED_RECOVERY_AND_LIVE_TRAFFIC_SOAK_PENDING.'
  },
  {
    id: 'signed_slo_capacity_approval',
    title: 'Signed SLO and capacity approval',
    open: hasIngestBlocker('SIGNED_SLO_AND_CAPACITY_APPROVAL_PENDING'),
    evidence: ingestEvidenceNote ?? 'Connected-journey ingest gate still records SIGNED_SLO_AND_CAPACITY_APPROVAL_PENDING.'
  },
  {
    id: 'dogfood_chatgpt_runtime_activity',
    title: 'Dogfood ChatGPT/runtime activity',
    open: Number(dogfoodSummary.withChatGptConnected ?? 0) === 0 || Number(dogfoodSummary.withChatGptSelected ?? 0) === 0 || Number(dogfoodSummary.withJourneyCreated ?? 0) === 0,
    evidence: `Dogfood summary currently shows audited ChatGPT connected=${Number(dogfoodSummary.withChatGptConnected ?? 0)}, audited ChatGPT selected=${Number(dogfoodSummary.withChatGptSelected ?? 0)}, stored ChatGPT runtime preference=${Number(dogfoodSummary.withStoredChatGptPreference ?? 0)}, Codex runtime homes=${Number(dogfoodSummary.withCodexRuntimeHome ?? 0)}, Codex auth files=${Number(dogfoodSummary.withCodexAuthFile ?? 0)}, journey created=${Number(dogfoodSummary.withJourneyCreated ?? 0)}.`
  }
];

const openBlockers = blockerStatuses.filter((item) => item.open);
const finiteOrNull = (value) => Number.isFinite(value) ? value : null;

const report = {
  ok: ingestRefresh.ok && dogfoodRefresh.ok && ingestEvidenceUsable,
  generatedAt,
  displayDate,
  inputs: {
    ingestRefresh: {
      ok: ingestRefresh.ok,
      status: ingestRefresh.status,
      skipped: ingestRefresh.skipped,
      skipReason: ingestRefresh.skipReason
    },
    dogfoodRefresh: {
      ok: dogfoodRefresh.ok,
      status: dogfoodRefresh.status
    }
  },
  summary: {
    gateOpen: openBlockers.length > 0,
    openBlockerCount: openBlockers.length,
    ingestEvidenceUsable,
    ingestEvidenceRefreshed: !ingestRefresh.skipped,
    ingestEvidenceRuntimeSchemaVersion: finiteOrNull(ingestEvidenceRuntimeSchemaVersion),
    stageProcessingExercised: Boolean(ingestResult?.stageProcessing?.exercised),
    requestLatencyP95Ms: finiteOrNull(Number(ingestResult?.latencyMs?.p95 ?? Number.NaN)),
    generatedLoadEvents: finiteOrNull(Number(ingestResult?.traffic?.generatedLoadEvents ?? Number.NaN)),
    chatGptConnected: Number(dogfoodSummary.withChatGptConnected ?? 0),
    chatGptSelected: Number(dogfoodSummary.withChatGptSelected ?? 0),
    journeyCreated: Number(dogfoodSummary.withJourneyCreated ?? 0)
  },
  blockerStatuses
};

const markdown = `# Connected-journey release-gate report

Generated at: ${generatedAt}

## Summary

- Date: ${displayDate}
- Gate open: ${report.summary.gateOpen ? 'yes' : 'no'}
- Open blocker count: ${report.summary.openBlockerCount}
- Ingest gate evidence refreshed this run: ${report.summary.ingestEvidenceRefreshed ? 'yes' : `no (${ingestRefresh.skipReason})`}
- Ingest gate evidence usable: ${report.summary.ingestEvidenceUsable ? 'yes' : 'no'}
- Ingest gate evidence runtime schema version: ${report.summary.ingestEvidenceRuntimeSchemaVersion ?? 'unavailable'}
- Stage processing exercised: ${report.summary.stageProcessingExercised}
- Request latency p95 ms: ${report.summary.requestLatencyP95Ms ?? 'unavailable'}
- Generated load events: ${report.summary.generatedLoadEvents ?? 'unavailable'}
- Dogfood ChatGPT connected: ${report.summary.chatGptConnected}
- Dogfood ChatGPT selected: ${report.summary.chatGptSelected}
- Dogfood journey created: ${report.summary.journeyCreated}

## Blocker statuses

${blockerStatuses.map((item) => `### ${item.title}

- ID: ${item.id}
- Open: ${item.open ? 'yes' : 'no'}
- Evidence: ${item.evidence}
`).join('\n')}
`;

writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(outputMarkdownPath, markdown, 'utf8');

console.log(JSON.stringify({
  ok: true,
  generatedAt,
  outputJsonPath,
  outputMarkdownPath,
  openBlockers: openBlockers.length
}));
