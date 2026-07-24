const fs = require('node:fs');
const path = require('node:path');
const { recordApproval } = require('./approval-store.cjs');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const reportFile = path.join(repositoryRoot, '.local-runtime', 'llm', 'codex-model-benchmark.json');
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8').replace(/^\uFEFF/, ''));

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

for (const model of report.models) {
  for (const run of model.runs) {
    for (const result of run.results) {
      if (!result.transportOk || !result.observed) continue;
      const skills = Array.isArray(result.observed.skills)
        ? result.observed.skills.map((value) => String(value).toLowerCase())
        : [];
      result.checks = [
        String(result.observed.firstName || '').toLowerCase() === 'ada',
        String(result.observed.lastName || '').toLowerCase() === 'okafor',
        String(result.observed.email || '').toLowerCase() === 'ada.okafor@example.test',
        ['typescript', 'node.js', 'postgresql'].every((expected) => skills.some((skill) => skill.includes(expected))),
        true
      ];
      result.qualityOk = result.checks.every(Boolean);
      result.ok = result.qualityOk;
    }
    const transportResults = run.results.filter((result) => result.transportOk !== false);
    const qualityResults = run.results.filter((result) => result.qualityOk);
    const latencies = transportResults.map((result) => result.latencyMs);
    run.transportSuccessful = transportResults.length;
    run.transportFailed = run.results.length - transportResults.length;
    run.p50TransportLatencyMs = percentile(latencies, 0.5);
    run.p95TransportLatencyMs = percentile(latencies, 0.95);
    run.transportThroughputPerMinute = Number((transportResults.length / (run.elapsedMs / 60_000)).toFixed(2));
    run.stable = transportResults.length === run.results.length;
    run.successful = qualityResults.length;
    run.failed = run.results.length - qualityResults.length;
    run.qualityPassed = qualityResults.length === run.results.length;
  }
  let discoveryStableConcurrency = 0;
  for (const run of model.runs.sort((left, right) => left.concurrency - right.concurrency)) {
    if (!run.stable) break;
    discoveryStableConcurrency = run.concurrency;
  }
  model.maxTestedStableConcurrency = discoveryStableConcurrency;
  // This legacy finalizer can repair quality fields in old discovery reports,
  // but those reports did not include the separate sustained/headroom gate now
  // required for production approval.
  model.approvedConcurrency = 1;
  model.sustainedValidated = false;
  model.passed = false;
  recordApproval({
    engine: 'codex',
    model: model.model,
    concurrency: 1,
    candidateConcurrency: model.maxTestedStableConcurrency || 1,
    sustainedValidated: false,
    measuredAt: report.generatedAt,
    reportFile
  });
}
report.passed = false;

fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { encoding: 'utf8', mode: 0o600 });
process.stdout.write(`${JSON.stringify({
  reportFile,
  approvals: report.models.map((model) => ({
    model: model.model,
    concurrency: 1,
    sustainedValidated: false
  }))
})}\n`);
