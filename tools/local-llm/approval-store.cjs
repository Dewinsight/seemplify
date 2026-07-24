const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const approvalFile = path.join(runtimeDir, 'approved-concurrency.json');

function readApprovals() {
  try {
    const parsed = JSON.parse(fs.readFileSync(approvalFile, 'utf8').replace(/^\uFEFF/, ''));
    return { ...parsed, byEngineModel: parsed.byEngineModel || {} };
  } catch {
    return { byEngineModel: {} };
  }
}

function recordApproval({ engine, model, concurrency, reportFile, measuredAt = new Date().toISOString() }) {
  const approvals = readApprovals();
  const approval = {
    engine,
    model,
    concurrency: Math.max(1, Math.min(128, Number(concurrency) || 1)),
    approvedAt: measuredAt,
    reportFile
  };
  approvals.byEngineModel[`${engine}:${model}`] = approval;
  approvals.active = approval;
  const temporary = `${approvalFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(approvals, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, approvalFile);
  return approval;
}

module.exports = { approvalFile, readApprovals, recordApproval };
