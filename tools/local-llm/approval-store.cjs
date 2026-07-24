const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const approvalFile = process.env.LOCAL_LLM_APPROVAL_FILE
  || path.join(runtimeDir, 'approved-concurrency.json');

function normalizeConcurrency(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(128, parsed);
}

function readApprovals(file = approvalFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return { ...parsed, byEngineModel: parsed.byEngineModel || {} };
  } catch {
    return { byEngineModel: {} };
  }
}

function approvalFor(engine, model, approvals = readApprovals()) {
  const profile = approvals.byEngineModel?.[`${engine}:${model}`];
  if (
    profile?.sustainedValidated === true
    && Number.isInteger(Number(profile.concurrency))
    && Number(profile.concurrency) >= 1
  ) {
    return {
      approved: true,
      concurrency: normalizeConcurrency(profile.concurrency),
      profile
    };
  }
  return { approved: false, concurrency: 1, profile: profile || null };
}

function concurrencyDecision({ engine, model, requested, approvals = readApprovals() }) {
  const requestedConcurrency = normalizeConcurrency(requested);
  const approval = approvalFor(engine, model, approvals);
  return {
    engine,
    model,
    requestedConcurrency,
    approvedConcurrency: approval.concurrency,
    effectiveConcurrency: Math.min(requestedConcurrency, approval.concurrency),
    allowed: requestedConcurrency <= approval.concurrency,
    sustainedValidated: approval.approved
  };
}

function assertConcurrencyApproved(input) {
  const decision = concurrencyDecision(input);
  if (!decision.allowed) {
    const error = new Error(
      `Concurrency ${decision.requestedConcurrency} is not approved for `
      + `${decision.engine}/${decision.model}; sustained approval is ${decision.approvedConcurrency}`
    );
    error.code = 'CONCURRENCY_NOT_APPROVED';
    error.status = 409;
    error.details = decision;
    throw error;
  }
  return decision;
}

function recordApproval({
  engine,
  model,
  concurrency,
  reportFile,
  measuredAt = new Date().toISOString(),
  sustainedValidated = false,
  candidateConcurrency = concurrency,
  approvalPath = approvalFile
}) {
  const approvals = readApprovals(approvalPath);
  const key = `${engine}:${model}`;
  const existing = approvals.byEngineModel[key];
  if (sustainedValidated !== true && existing?.sustainedValidated === true) {
    return existing;
  }
  const approval = {
    engine,
    model,
    concurrency: sustainedValidated
      ? normalizeConcurrency(concurrency)
      : 1,
    candidateConcurrency: normalizeConcurrency(candidateConcurrency),
    sustainedValidated: sustainedValidated === true,
    approvedAt: measuredAt,
    reportFile
  };
  approvals.byEngineModel[key] = approval;
  approvals.active = approval;
  fs.mkdirSync(path.dirname(approvalPath), { recursive: true });
  const temporary = `${approvalPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(approvals, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, approvalPath);
  return approval;
}

module.exports = {
  approvalFile,
  approvalFor,
  assertConcurrencyApproved,
  concurrencyDecision,
  normalizeConcurrency,
  readApprovals,
  recordApproval
};
