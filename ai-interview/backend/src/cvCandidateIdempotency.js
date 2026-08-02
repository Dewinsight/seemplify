const crypto = require('node:crypto');

function deterministicCvCandidateId(publicId) {
  const identity = String(publicId || '').trim();
  if (!identity) throw new TypeError('CV processing job publicId is required');
  return `cand_cv_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

function hasProcessingIdentity(candidate, publicId) {
  const identity = String(publicId || '');
  return candidate?.cvProcessingJobId === identity
    || (Array.isArray(candidate?.cvProcessingJobIds) && candidate.cvProcessingJobIds.includes(identity));
}

function attachProcessingIdentity(candidate, publicId) {
  const identity = String(publicId || '').trim();
  if (!candidate || !identity) throw new TypeError('Candidate and CV processing job publicId are required');
  const identities = new Set(candidate.cvProcessingJobIds || []);
  if (candidate.cvProcessingJobId) identities.add(candidate.cvProcessingJobId);
  identities.add(identity);
  candidate.cvProcessingJobId ||= identity;
  // These values are durable idempotency receipts. Evicting an old receipt
  // would allow a delayed queue replay to apply the same CV result again.
  candidate.cvProcessingJobIds = [...identities];
  return candidate;
}

module.exports = {
  attachProcessingIdentity,
  deterministicCvCandidateId,
  hasProcessingIdentity
};
