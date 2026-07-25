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
    return {
      ...parsed,
      byEngineModel: parsed.byEngineModel || {},
      byEngineModelActivity: parsed.byEngineModelActivity || {}
    };
  } catch {
    return { byEngineModel: {}, byEngineModelActivity: {} };
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

function activityApprovalKey(engine, model, activity) {
  return `${engine}:${model}:${activity}`;
}

function activityApprovalFor(engine, model, activity, approvals = readApprovals()) {
  const global = approvalFor(engine, model, approvals);
  const profile = approvals.byEngineModelActivity?.[activityApprovalKey(engine, model, activity)];
  if (
    global.approved
    && profile?.sustainedValidated === true
    && Number.isInteger(Number(profile.concurrency))
    && Number(profile.concurrency) >= 1
  ) {
    return {
      approved: true,
      concurrency: Math.min(
        global.concurrency,
        normalizeConcurrency(profile.concurrency)
      ),
      candidateConcurrency: normalizeConcurrency(
        profile.candidateConcurrency ?? profile.concurrency
      ),
      profile,
      global
    };
  }
  return {
    approved: false,
    concurrency: 1,
    candidateConcurrency: normalizeConcurrency(
      profile?.candidateConcurrency ?? profile?.concurrency ?? 1
    ),
    profile: profile || null,
    global
  };
}

function activityConcurrencyDecision({
  engine,
  model,
  activity,
  requested,
  approvals = readApprovals()
}) {
  const requestedConcurrency = normalizeConcurrency(requested);
  const approval = activityApprovalFor(engine, model, activity, approvals);
  return {
    engine,
    model,
    activity,
    requestedConcurrency,
    approvedConcurrency: approval.concurrency,
    candidateConcurrency: approval.candidateConcurrency,
    effectiveConcurrency: Math.min(requestedConcurrency, approval.concurrency),
    allowed: requestedConcurrency <= approval.concurrency,
    sustainedValidated: approval.approved,
    globalApprovedConcurrency: approval.global.concurrency,
    globalSustainedValidated: approval.global.approved
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

function recordActivityApproval({
  engine,
  model,
  activity,
  concurrency,
  reportFile,
  measuredAt = new Date().toISOString(),
  sustainedValidated = false,
  candidateConcurrency = concurrency,
  approvalPath = approvalFile
}) {
  const approvals = readApprovals(approvalPath);
  const key = activityApprovalKey(engine, model, activity);
  const existing = approvals.byEngineModelActivity[key];
  if (sustainedValidated !== true && existing?.sustainedValidated === true) {
    return existing;
  }
  const global = approvalFor(engine, model, approvals);
  const requested = sustainedValidated ? normalizeConcurrency(concurrency) : 1;
  const approval = {
    engine,
    model,
    activity,
    concurrency: sustainedValidated && global.approved
      ? Math.min(requested, global.concurrency)
      : 1,
    candidateConcurrency: normalizeConcurrency(candidateConcurrency),
    sustainedValidated: sustainedValidated === true && global.approved,
    globalConcurrencyAtApproval: global.concurrency,
    approvedAt: measuredAt,
    reportFile
  };
  approvals.byEngineModelActivity[key] = approval;
  fs.mkdirSync(path.dirname(approvalPath), { recursive: true });
  const temporary = `${approvalPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(approvals, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, approvalPath);
  return approval;
}

module.exports = {
  activityApprovalFor,
  activityApprovalKey,
  activityConcurrencyDecision,
  approvalFile,
  approvalFor,
  assertConcurrencyApproved,
  concurrencyDecision,
  normalizeConcurrency,
  readApprovals,
  recordActivityApproval,
  recordApproval
};
