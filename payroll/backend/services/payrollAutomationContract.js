const crypto = require('crypto');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function totalsSnapshot(run) {
  const summary = run?.summary || {};
  return {
    currency: String(summary.currency || ''),
    totalEmployees: Number(summary.totalEmployees || 0),
    processedCount: Number(summary.processedCount || 0),
    totalGrossPayroll: Number(summary.totalGrossPayroll || 0),
    totalDeductions: Number(summary.totalDeductions || 0),
    totalNetPayroll: Number(summary.totalNetPayroll || 0),
    totalTaxWithheld: Number(summary.totalTaxWithheld || 0),
    totalEmployerContributions: Number(summary.totalEmployerContributions || 0),
    totalEmployerCost: Number(summary.totalEmployerCost || 0),
  };
}

function totalsHash(run) { return crypto.createHash('sha256').update(canonical(totalsSnapshot(run))).digest('hex'); }
function revision(run) { return String(run?.__v ?? 0); }
function exactApprovalMarker(approvalId) { return `[Automation approval:${String(approvalId)}]`; }
function hasExactApproval(run, marker) { return (run?.approvals || []).some(item => String(item?.comments || '').includes(marker)); }
function exactApprovalCompensation(marker) {
  return {
    $set: { status: 'pending_approval' },
    $inc: { currentApprovalLevel: -1 },
    $unset: { approvedAt: '' },
    $pull: { approvals: { comments: marker } },
  };
}

module.exports = { canonical, exactApprovalCompensation, exactApprovalMarker, hasExactApproval, revision, totalsHash, totalsSnapshot };
