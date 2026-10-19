'use strict';
const { DomainError } = require('../../contracts/competency');
// Oral notes remain manually editable, but a session still linked to a call
// must retain both source-recording and assessment-purpose authorization.
async function assertCurrent(ctx, record, evidence) {
  if (!evidence?.source?.oralSessionId) return;
  const oral = await require('../../models/CompetencyOralSession').findOne({ _id: evidence.source.oralSessionId, organizationId: ctx.organizationId, assessmentId: String(record._id) }).lean();
  if (!oral || oral.sourceWithdrawnAt) throw new DomainError(409, 'SOURCE_WITHDRAWN', 'These oral notes are no longer available.');
  if (oral.callType === 'manual') return;
  if (oral.source?.status === 'expired' || (oral.source?.retention?.expiresAt && new Date(oral.source.retention.expiresAt) <= new Date())) throw new DomainError(409, 'SOURCE_WITHDRAWN', 'The linked call source is no longer retained.');
  await require('./oralService').callSource(ctx, record, oral.callType, oral.callId, oral.consent);
}
async function current(ctx, record, evidence) {
  try { await assertCurrent(ctx, record, evidence); return evidence; }
  catch { return { ...evidence, status: 'source_unavailable', text: '', spans: [] }; }
}
module.exports = { assertCurrent, current };
