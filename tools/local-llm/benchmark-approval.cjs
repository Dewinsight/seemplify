function orderedAcceptableRuns(runs = []) {
  return [...runs]
    .sort((left, right) => Number(left.concurrency) - Number(right.concurrency))
    .filter((run) => run.acceptable === true);
}

function selectHeadroomConcurrency(runs = []) {
  const acceptable = orderedAcceptableRuns(runs);
  if (!acceptable.length) return 0;
  const highest = acceptable.at(-1);
  if (highest.concurrency <= 1) return 1;
  const lower = acceptable.filter((run) => run.concurrency < highest.concurrency).at(-1);
  return Number(lower?.concurrency || 1);
}

function assessSustainedRun(run, {
  minimumRequests = 12,
  minimumQualityPassRate = 0.98,
  maxP95LatencyMs = 180_000
} = {}) {
  const requests = Number(run?.requests || 0);
  const transportSuccessful = Number(run?.transportSuccessful || 0);
  const qualityPassRate = Number(run?.qualityPassRate || 0);
  return Boolean(
    run
    && requests >= minimumRequests
    && transportSuccessful === requests
    && qualityPassRate >= minimumQualityPassRate
    && Number(run.p95LatencyMs) > 0
    && Number(run.p95LatencyMs) <= maxP95LatencyMs
    && Number(run.timeouts || 0) === 0
    && Number(run.rateLimited || 0) === 0
    && Number(run.outOfMemory || 0) === 0
  );
}

function approvedConcurrency({ discoveryRuns, sustainedRun, acceptance }) {
  const candidate = selectHeadroomConcurrency(discoveryRuns);
  if (!candidate || Number(sustainedRun?.concurrency) !== candidate) {
    return { candidateConcurrency: candidate, concurrency: 1, sustainedValidated: false };
  }
  const sustainedValidated = assessSustainedRun(sustainedRun, acceptance);
  return {
    candidateConcurrency: candidate,
    concurrency: sustainedValidated ? candidate : 1,
    sustainedValidated
  };
}

module.exports = {
  approvedConcurrency,
  assessSustainedRun,
  orderedAcceptableRuns,
  selectHeadroomConcurrency
};
