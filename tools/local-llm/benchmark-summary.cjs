const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function compactRun(run) {
  const qualityResults = Array.isArray(run.results)
    ? run.results.filter((result) => result.qualityOk)
    : [];
  const detailRecalls = Array.isArray(run.results)
    ? run.results
      .map((result) => Number(result.quality?.detailRecall))
      .filter(Number.isFinite)
    : [];
  return {
    concurrency: Number(run.concurrency || 0),
    acceptable: Boolean(run.acceptable),
    requests: Number(run.requests || 0),
    transportSuccessful: Number(run.transportSuccessful || 0),
    qualitySuccessful: Number(run.qualitySuccessful ?? qualityResults.length),
    qualityPassRate: Number(run.qualityPassRate || 0),
    averageDetailRecall: Number(run.averageDetailRecall ?? (
      detailRecalls.length
        ? detailRecalls.reduce((total, value) => total + value, 0) / detailRecalls.length
        : 0
    )),
    p50LatencyMs: run.p50LatencyMs == null ? null : Number(run.p50LatencyMs),
    p95LatencyMs: run.p95LatencyMs == null ? null : Number(run.p95LatencyMs),
    throughputPerMinute: Number(run.throughputPerMinute || 0),
    vramPercent: run.vramPercent == null ? null : Number(run.vramPercent),
    timeouts: Number(run.timeouts || 0),
    outOfMemory: Number(run.outOfMemory || 0)
  };
}

function addProfile(profiles, profile) {
  if (!profile.engine || !profile.model || !Array.isArray(profile.runs)) return;
  const runs = profile.runs.map(compactRun).sort((left, right) => left.concurrency - right.concurrency);
  const approvedConcurrency = Math.max(0, Number(profile.approvedConcurrency ?? 0));
  const approvedRun = [...runs]
    .reverse()
    .find((run) => run.acceptable && run.concurrency <= approvedConcurrency) || null;
  profiles.push({
    engine: profile.engine,
    model: profile.model,
    generatedAt: profile.generatedAt || null,
    approvedConcurrency,
    firstUnacceptableConcurrency: profile.firstUnacceptableConcurrency == null
      ? null
      : Number(profile.firstUnacceptableConcurrency),
    approvedRun,
    runs
  });
}

function loadProfiles() {
  const profiles = [];
  const codex = readJson(path.join(runtimeDir, 'codex-model-benchmark.json'));
  for (const model of codex?.models || []) {
    addProfile(profiles, {
      engine: 'codex',
      model: model.model,
      generatedAt: codex.generatedAt,
      approvedConcurrency: model.maxTestedStableConcurrency,
      firstUnacceptableConcurrency: model.firstUnacceptableConcurrency,
      runs: model.runs
    });
  }

  let files = [];
  try {
    files = fs.readdirSync(runtimeDir)
      .filter((name) => /^benchmark-(?:ollama|vllm)-.+\.json$/i.test(name));
  } catch {}
  for (const name of files) {
    const report = readJson(path.join(runtimeDir, name));
    if (!report) continue;
    addProfile(profiles, {
      engine: report.engine,
      model: report.model,
      generatedAt: report.generatedAt,
      approvedConcurrency: report.approvedConcurrency,
      firstUnacceptableConcurrency: report.firstUnacceptableConcurrency,
      runs: report.runs
    });
  }
  return profiles;
}

function recommend(profiles) {
  const candidates = profiles
    .filter((profile) => profile.approvedRun?.acceptable && profile.approvedRun.qualityPassRate >= 0.95)
    .sort((left, right) => {
      const throughput = right.approvedRun.throughputPerMinute - left.approvedRun.throughputPerMinute;
      if (throughput) return throughput;
      const latency = (left.approvedRun.p95LatencyMs ?? Infinity) - (right.approvedRun.p95LatencyMs ?? Infinity);
      if (latency) return latency;
      return right.approvedConcurrency - left.approvedConcurrency;
    });
  const best = candidates[0];
  return best ? {
    engine: best.engine,
    model: best.model,
    approvedConcurrency: best.approvedConcurrency,
    throughputPerMinute: best.approvedRun.throughputPerMinute,
    p95LatencyMs: best.approvedRun.p95LatencyMs,
    qualityPassRate: best.approvedRun.qualityPassRate
  } : null;
}

const profiles = loadProfiles();
process.stdout.write(JSON.stringify({
  generatedAt: new Date().toISOString(),
  profiles,
  recommendation: recommend(profiles)
}));
