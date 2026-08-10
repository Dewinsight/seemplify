import crypto from 'node:crypto';

const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
    : (JSON.stringify(value) ?? 'null');
export const sha256 = (value) => crypto.createHash('sha256').update(stable(value)).digest('hex');

export function validatePhase4Approval(approval, expected) {
  const validIdentity = approval?.version === 'phase4-enterprise-load-approval/v1'
    && approval?.decision === 'approved'
    && typeof approval?.approvedBy === 'string' && approval.approvedBy.trim().length >= 3
    && Number.isFinite(Date.parse(approval?.approvedAt || ''))
    && typeof approval?.loadProfileId === 'string' && approval.loadProfileId === expected.profile.id;
  const profileMatches = validIdentity && sha256(approval.profile) === sha256(expected.profile);
  const budgetsMatch = validIdentity && sha256(approval.budgetsMs) === sha256(expected.budgetsMs);
  const fixtureMatches = validIdentity && approval.fixtureSha256 === expected.fixtureSha256;
  return {
    valid: Boolean(validIdentity && profileMatches && budgetsMatch && fixtureMatches),
    validIdentity: Boolean(validIdentity), profileMatches: Boolean(profileMatches),
    budgetsMatch: Boolean(budgetsMatch), fixtureMatches: Boolean(fixtureMatches)
  };
}
