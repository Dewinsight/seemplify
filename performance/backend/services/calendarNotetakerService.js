'use strict';
const OneOnOne = require('../models/OneOnOne');
const shared = require('./sharedAIAccountService');
const POLICY = 'calendar-notetaker-v2';
const closed = meeting => ['completed', 'cancelled', 'no_show', 'rescheduled'].includes(meeting.status);
const open = meeting => !closed(meeting) && Number.isFinite(+meeting.scheduledDate) && +meeting.scheduledDate + Number(meeting.duration) * 60000 > Date.now();
const roleFor = (meeting, actor) => String(meeting.managerId) === actor ? 'manager' : String(meeting.employeeId) === actor ? 'employee' : null;
const stopped = meeting => require('./meetingCallService').recordingRevoked(meeting) || meeting.appraisalMeeting?.recordingState === 'revoked';
const failure = (message, code, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });
function status(meeting, actor) {
  const call = meeting.appraisalMeeting || {}, ownRole = roleFor(meeting, actor);
  const required = call.mode === 'calendar' && Boolean(call.recordingRequested);
  const eligible = required && Boolean(ownRole) && open(meeting) && !stopped(meeting) && Boolean(meeting.nylas?.eventId);
  const state = stopped(meeting) ? 'revoked' : call.recordingState || 'awaiting_start';
  // Keep cached older clients renderable during the rolling release; no consent action is offered.
  return { required, ownRole, state, manager: {}, employee: {}, canAcknowledge: false, canWithdraw: false, windowClosed: required && !open(meeting),
    canStart: eligible && ['awaiting_consent', 'awaiting_start'].includes(state),
    canAddNow: eligible && +meeting.scheduledDate <= Date.now() && ['awaiting_consent', 'awaiting_start', 'scheduled'].includes(state),
    canStop: required && Boolean(ownRole) && !closed(meeting) && !stopped(meeting) && ['scheduled', 'joining', 'attending', 'in_progress', 'scheduling', 'uncertain', 'dispatching'].includes(state),
    cancellationPending: Boolean(call.recordingCancellationPending) };
}
async function current(meeting) {
  const fresh = await OneOnOne.findOne({ _id: meeting._id, organizationId: meeting.organizationId });
  if (!fresh) throw failure('Meeting not found.', 'MEETING_NOT_FOUND', 404);
  return fresh;
}
async function start(meeting, actor, { joinNow = false } = {}) {
  const fresh = await current(meeting), info = status(fresh, actor);
  if (!roleFor(fresh, actor)) throw failure('Only the meeting participants can manage its notetaker.', 'RECORDING_PARTICIPANT_REQUIRED', 403);
  if (!open(fresh)) throw failure('The scheduled recording window has ended.', 'RECORDING_WINDOW_CLOSED');
  if (stopped(fresh)) throw failure('This notetaker was stopped. Schedule a new call to record another discussion.', 'RECORDING_STOPPED');
  if (!(joinNow ? info.canAddNow : info.canStart)) {
    if (!joinNow && ['scheduled', 'joining', 'attending', 'in_progress'].includes(info.state)) return fresh;
    throw failure('Refresh the notetaker status before trying again.', 'RECORDING_NOT_AVAILABLE');
  }
  // This is a system policy request, not an assertion that either participant clicked consent.
  const authorization = { policyVersion: POLICY, requestedBy: actor, requestedAt: new Date() };
  const result = await shared.request('meetings/startRecording', fresh.appraisalMeeting.ownerIdentity,
    { externalId: String(fresh._id), recordingAuthorization: authorization, ...(joinNow ? { joinNow: true } : {}) }, { timeoutMs: 90000 });
  if (!['scheduled', 'joining', 'attending', 'in_progress'].includes(result.recordingState)) throw failure('The provider has not confirmed the notetaker. Refresh its status.', 'RECORDING_NOT_CONFIRMED');
  const saved = await OneOnOne.findOneAndUpdate({ _id: fresh._id, organizationId: fresh.organizationId,
    status: { $nin: ['completed', 'cancelled', 'no_show', 'rescheduled'] }, 'appraisalMeeting.recordingState': { $ne: 'revoked' },
    'appraisalMeeting.recordingConsent.revokedAt': { $exists: false }, 'appraisalMeeting.recordingConsent.manager.revokedAt': { $exists: false }, 'appraisalMeeting.recordingConsent.employee.revokedAt': { $exists: false } },
  { $set: { 'appraisalMeeting.recordingState': result.recordingState, 'appraisalMeeting.recordingPolicyVersion': POLICY, 'appraisalMeeting.recordingAuthorization': authorization } }, { new: true });
  if (!saved) { await shared.request('meetings/stopRecording', fresh.appraisalMeeting.ownerIdentity, { externalId: String(fresh._id) }); throw failure('The call was closed or its notetaker stopped.', 'RECORDING_STOPPED'); }
  return saved;
}
async function stop(meeting, actor) {
  const fresh = await current(meeting);
  if (!roleFor(fresh, actor)) throw failure('Only the meeting participants can manage its notetaker.', 'RECORDING_PARTICIPANT_REQUIRED', 403);
  await OneOnOne.updateOne({ _id: fresh._id, organizationId: fresh.organizationId }, { $set: { 'appraisalMeeting.recordingState': 'revoked', 'appraisalMeeting.recordingConsent.revokedAt': new Date(), 'appraisalMeeting.recordingCancellationPending': true } });
  await shared.request('meetings/stopRecording', fresh.appraisalMeeting.ownerIdentity, { externalId: String(fresh._id) });
  await OneOnOne.updateOne({ _id: fresh._id, organizationId: fresh.organizationId }, { $set: { 'appraisalMeeting.recordingCancellationPending': false } });
  return current(fresh);
}
module.exports = { POLICY, status, current, start, stop };
