'use strict';
const OneOnOne = require('../models/OneOnOne');
const shared = require('./sharedAIAccountService');
const NOTICE = 'calendar-recording-v1';
const error = (message, code, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });
const closed = meeting => ['completed', 'cancelled', 'no_show', 'rescheduled'].includes(meeting.status);
const windowOpen = meeting => !closed(meeting) && Number.isFinite(+meeting.scheduledDate) && +meeting.scheduledDate + Number(meeting.duration) * 60000 > Date.now();
const roleFor = (meeting, actorId) => String(meeting.managerId) === actorId ? 'manager' : String(meeting.employeeId) === actorId ? 'employee' : null;
const valid = (person, id) => person?.userId === String(id) && person.acceptedAt && !person.revokedAt;
const both = meeting => valid(meeting.appraisalMeeting?.calendarConsent?.manager, meeting.managerId) && valid(meeting.appraisalMeeting?.calendarConsent?.employee, meeting.employeeId);
function initial(mode, recordingRequested) { return mode === 'calendar' && recordingRequested ? { recordingPolicyVersion: 'calendar-notetaker-v2' } : {}; }
function status(meeting, actorId) {
  const call = meeting.appraisalMeeting || {};
  const ownRole = roleFor(meeting, actorId);
  const required = call.mode === 'calendar' && Boolean(call.recordingRequested);
  const supported = call.recordingPolicyVersion === NOTICE;
  const consent = call.calendarConsent || {};
  const revoked = Boolean(consent.manager?.revokedAt || consent.employee?.revokedAt);
  const eligible = required && supported && windowOpen(meeting);
  const person = key => ({ acceptedAt: consent[key]?.acceptedAt || null, revokedAt: consent[key]?.revokedAt || null });
  return { required, noticeVersion: NOTICE, ownRole, manager: person('manager'), employee: person('employee'),
    state: !required ? 'not_requested' : !supported ? 'legacy_unverified' : revoked ? 'revoked' : call.recordingState || 'awaiting_consent',
    canAcknowledge: Boolean(ownRole && eligible && !revoked && !call.recordingConsent && !consent[ownRole]?.acceptedAt),
    canStart: Boolean(ownRole && eligible && !revoked && both(meeting) && !call.recordingConsent),
    canAddNow: Boolean(ownRole && eligible && !revoked && both(meeting) && +meeting.scheduledDate <= Date.now() && ['awaiting_consent', 'scheduled'].includes(call.recordingState)),
    windowClosed: required && !windowOpen(meeting),
    canWithdraw: Boolean(ownRole && supported && consent[ownRole]?.acceptedAt && !consent[ownRole]?.revokedAt),
    cancellationPending: Boolean(call.recordingCancellationPending) };
}
async function current(meeting) {
  const fresh = await OneOnOne.findOne({ _id: meeting._id, organizationId: meeting.organizationId });
  if (!fresh) throw error('Meeting not found.', 'MEETING_NOT_FOUND', 404);
  return fresh;
}
async function start(meeting, actorId, { joinNow = false } = {}) {
  const fresh = await current(meeting);
  if (!roleFor(fresh, actorId)) throw error('Only the two participants can authorize recording.', 'RECORDING_PARTICIPANT_REQUIRED', 403);
  const info = status(fresh, actorId);
  if (info.state === 'scheduled' && both(fresh) && !joinNow) return fresh;
  if (!(joinNow ? info.canAddNow : info.canStart) || !fresh.nylas?.eventId) throw error('Both participants must agree while this meeting is still open.', 'RECORDING_CONSENT_REQUIRED');
  const consent = { noticeVersion: NOTICE, manager: fresh.appraisalMeeting.calendarConsent.manager, employee: fresh.appraisalMeeting.calendarConsent.employee };
  let result;
  try { result = await shared.request('meetings/startRecording', fresh.appraisalMeeting.ownerIdentity, { externalId: String(fresh._id), recordingConsent: consent, ...(joinNow ? { joinNow: true } : {}) }, { timeoutMs: 90000 }); }
  catch (failure) {
    await OneOnOne.updateOne({ _id: fresh._id, organizationId: fresh.organizationId, 'appraisalMeeting.recordingConsent': { $exists: false }, 'appraisalMeeting.calendarConsent.manager.revokedAt': { $exists: false }, 'appraisalMeeting.calendarConsent.employee.revokedAt': { $exists: false } }, { $set: { 'appraisalMeeting.recordingState': 'uncertain' } });
    throw failure;
  }
  if (!['scheduled', 'joining', 'attending', 'in_progress'].includes(result.recordingState)) throw error('The provider has not confirmed recording. Refresh the recording status before retrying.', 'RECORDING_NOT_CONFIRMED');
  const saved = await OneOnOne.findOneAndUpdate({ _id: fresh._id, organizationId: fresh.organizationId,
    status: { $nin: ['completed', 'cancelled', 'no_show', 'rescheduled'] },
    'appraisalMeeting.calendarConsent.manager.revokedAt': { $exists: false }, 'appraisalMeeting.calendarConsent.employee.revokedAt': { $exists: false } },
  { $set: { 'appraisalMeeting.recordingState': result.recordingState,
    'appraisalMeeting.recordingConsent': { ...consent, authorizedAt: new Date() } } }, { new: true });
  if (!saved) {
    await shared.request('meetings/stopRecording', fresh.appraisalMeeting.ownerIdentity, { externalId: String(fresh._id) });
    throw error('Recording consent changed. The recording request was cancelled.', 'RECORDING_CONSENT_REVOKED');
  }
  return saved;
}
async function acknowledge(meeting, actorId, input) {
  const fresh = await current(meeting);
  const role = roleFor(fresh, actorId);
  if (!role) throw error('Only the two participants can give their own recording consent.', 'RECORDING_PARTICIPANT_REQUIRED', 403);
  if (input.noticeVersion !== NOTICE || fresh.appraisalMeeting?.recordingPolicyVersion !== NOTICE) throw error('This meeting has no prospective recording-consent notice. Schedule a new call.', 'RECORDING_NOTICE_REQUIRED');
  if (input.acknowledged === false) {
    const now = new Date();
    await OneOnOne.updateOne({ _id: fresh._id, organizationId: fresh.organizationId }, { $set: {
      [`appraisalMeeting.calendarConsent.${role}.revokedAt`]: now,
      [`appraisalMeeting.recordingConsent.${role}.revokedAt`]: now,
      'appraisalMeeting.recordingConsent.revokedAt': now,
      'appraisalMeeting.recordingState': 'revoked', 'appraisalMeeting.recordingCancellationPending': true } });
    try {
      if (fresh.nylas?.eventId) await shared.request('meetings/stopRecording', fresh.appraisalMeeting.ownerIdentity, { externalId: String(fresh._id) });
      await OneOnOne.updateOne({ _id: fresh._id }, { $set: { 'appraisalMeeting.recordingCancellationPending': false } });
    } catch (failure) { throw error('Consent is withdrawn. Provider cancellation is pending; do not admit the notetaker. Retry withdrawal to confirm cancellation.', 'RECORDING_CANCELLATION_PENDING', 502); }
    return current(fresh);
  }
  if (input.acknowledged !== true || input.recording !== true || input.transcription !== true) throw error('Agree to both recording and transcription, or keep recording off.', 'RECORDING_CONSENT_REQUIRED', 400);
  const info = status(fresh, actorId);
  if (info.state === 'scheduled' && both(fresh)) return fresh;
  if (!info.canAcknowledge && !valid(fresh.appraisalMeeting.calendarConsent?.[role], actorId)) throw error('This recording request is closed or consent was withdrawn. Schedule a new call.', 'RECORDING_WINDOW_CLOSED');
  if (!windowOpen(fresh)) throw error('The scheduled recording window has ended. Schedule a new call to record another discussion.', 'RECORDING_WINDOW_CLOSED');
  await OneOnOne.updateOne({ _id: fresh._id, organizationId: fresh.organizationId,
    'appraisalMeeting.recordingConsent': { $exists: false },
    [`appraisalMeeting.calendarConsent.${role}.acceptedAt`]: { $exists: false },
    'appraisalMeeting.calendarConsent.manager.revokedAt': { $exists: false }, 'appraisalMeeting.calendarConsent.employee.revokedAt': { $exists: false } },
  { $set: { [`appraisalMeeting.calendarConsent.${role}`]: { userId: actorId, acceptedAt: new Date(), recording: true, transcription: true }, 'appraisalMeeting.recordingState': 'awaiting_consent' } });
  const accepted = await current(fresh);
  return both(accepted) && accepted.nylas?.eventId ? start(accepted, actorId) : accepted;
}
module.exports = { NOTICE, initial, status, current, acknowledge, start };
