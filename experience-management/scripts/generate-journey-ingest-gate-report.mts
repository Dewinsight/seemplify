import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const outputDir = path.join(projectDirectory, 'docs', 'journey-management', 'operations');
const jsonPath = path.join(outputDir, 'latest-ingest-gate-report.json');
const markdownPath = path.join(outputDir, 'latest-ingest-gate-report.md');
const gateScript = path.join(projectDirectory, 'scripts', 'journey-postgres-ingest-security-load.mjs');

function parseLines(output: string) {
  return output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line) as Record<string, unknown>; }
    catch { return null; }
  }).filter((line): line is Record<string, unknown> => Boolean(line));
}

function ensureDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function numberValue(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

if (String(process.env.JOURNEY_POSTGRES_GATE_ALLOW_DOCKER ?? '').trim() !== 'true') {
  console.error(JSON.stringify({
    ok: false,
    reason: 'Set JOURNEY_POSTGRES_GATE_ALLOW_DOCKER=true to run the destructive-isolated Docker ingest gate.',
    jsonPath,
    markdownPath,
    preservedExistingReport: fs.existsSync(jsonPath)
  }));
  process.exit(1);
}

const run = spawnSync(process.execPath, [gateScript], {
  cwd: projectDirectory,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 64 * 1024 * 1024
});

const stdout = String(run.stdout || '');
const stderr = String(run.stderr || '');
const lines = parseLines(stdout);
const complete = [...lines].reverse().find((entry) => entry.event === 'journey_postgres_ingest_gate_complete') || null;
const failed = [...lines].reverse().find((entry) => entry.event === 'journey_postgres_ingest_gate_failed') || null;
const phases = lines.filter((entry) => entry.event === 'journey_postgres_ingest_gate_phase')
  .map((entry) => String(entry.phase || 'unknown'));
const generatedAt = new Date().toISOString();
const ok = run.status === 0 && complete !== null && failed === null;

const report = {
  generatedAt,
  command: `node ${path.relative(projectDirectory, gateScript).replace(/\\/gu, '/')}`,
  ok,
  exitCode: run.status,
  phases,
  result: ok ? complete : failed,
  diagnostics: ok ? null : {
    stderrTail: stderr.trim().split(/\r?\n/u).slice(-20),
    stdoutTail: stdout.trim().split(/\r?\n/u).slice(-50)
  }
};

const result = (ok ? complete : failed) || {};
const latency = (result.latencyMs && typeof result.latencyMs === 'object') ? result.latencyMs as Record<string, unknown> : {};
const traffic = (result.traffic && typeof result.traffic === 'object') ? result.traffic as Record<string, unknown> : {};
const soak = (result.soak && typeof result.soak === 'object') ? result.soak as Record<string, unknown> : {};
const stage = (result.stageProcessing && typeof result.stageProcessing === 'object')
  ? result.stageProcessing as Record<string, unknown> : {};
const reconciliation = (result.reconciliation && typeof result.reconciliation === 'object')
  ? result.reconciliation as Record<string, unknown> : {};
const security = (result.security && typeof result.security === 'object')
  ? result.security as Record<string, unknown> : {};
const informationalTargets = (result.informationalTargets && typeof result.informationalTargets === 'object')
  ? result.informationalTargets as Record<string, unknown> : {};
const blockers = Array.isArray(result.remainingBlockers) ? result.remainingBlockers.map(String) : [];

const markdown = [
  '# Connected-journey PostgreSQL ingest gate report',
  '',
  `Generated at: ${generatedAt}`,
  '',
  `Status: ${ok ? 'passed' : 'failed'}`,
  `Command: \`${report.command}\``,
  '',
  '## Summary',
  '',
  `- Exit code: ${String(run.status)}`,
  `- Runtime schema version: ${String((result.runtime as Record<string, unknown> | undefined)?.runtimeSchemaVersion ?? 'unknown')}`,
  `- Generated load events: ${String(traffic.generatedLoadEvents ?? 'unknown')}`,
  `- Soak duration ms: ${String(soak.durationMs ?? 'unknown')}`,
  `- Request latency p95 ms: ${String(latency.p95 ?? 'unknown')}`,
  `- Candidate batch target status: ${String(informationalTargets.observedAgainstCandidate ?? 'unknown')}`,
  `- Stage processing exercised: ${String(stage.exercised ?? false)}`,
  `- Reconciliation raw/dedupe drift: ${String(reconciliation.rawDedupeDrift ?? 'unknown')}`,
  `- Reconciliation raw/inbox drift: ${String(reconciliation.rawInboxDrift ?? 'unknown')}`,
  `- Reconciliation raw/meter drift: ${String(reconciliation.rawMeterDrift ?? 'unknown')}`,
  '',
  '## Phases',
  '',
  ...phases.map((phase) => `- ${phase}`),
  '',
  '## Security and operational signals',
  '',
  `- Least-privilege runtime role: ${String(security.leastPrivilegeRuntimeRole ?? 'unknown')}`,
  `- Output/log sentinel findings: ${String(security.outputAndLogSentinelFindings ?? 'unknown')}`,
  `- Stored sentinel findings: ${String(security.storedSentinelFindings ?? 'unknown')}`,
  `- Oldest pending queue age ms: ${String((result.queue as Record<string, unknown> | undefined)?.oldestPendingAgeMs ?? 'unknown')}`,
  '',
  '## Remaining blockers',
  '',
  ...(blockers.length ? blockers.map((blocker) => `- ${blocker}`) : ['- None recorded']),
  ''
];

if (!ok && failed) {
  markdown.push('## Failure');
  markdown.push('');
  markdown.push(`- Phase: ${String(failed.phase || 'unknown')}`);
  markdown.push(`- Code: ${String(failed.code || 'GATE_ASSERTION_FAILED')}`);
  markdown.push(`- Message: ${String(failed.message || 'Unknown failure')}`);
  if (failed.diagnostic) markdown.push(`- Diagnostic: ${String(failed.diagnostic)}`);
  markdown.push('');
}

ensureDirectory(jsonPath);
ensureDirectory(markdownPath);
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(markdownPath, `${markdown.join('\n')}\n`);

if (!ok) {
  console.error(JSON.stringify({ ok: false, generatedAt, jsonPath, markdownPath, exitCode: run.status }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    generatedAt,
    jsonPath,
    markdownPath,
    latencyP95Ms: numberValue(latency.p95),
    rawMeterDrift: numberValue(reconciliation.rawMeterDrift),
    stageProcessingExercised: Boolean(stage.exercised)
  }));
}
