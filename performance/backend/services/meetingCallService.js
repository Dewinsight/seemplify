'use strict';
const OneOnOne = require('../models/OneOnOne');
const shared = require('./sharedAIAccountService');
const recordingRevoked = meeting => Boolean(meeting.appraisalMeeting?.recordingConsent?.revokedAt || meeting.appraisalMeeting?.recordingConsent?.manager?.revokedAt || meeting.appraisalMeeting?.recordingConsent?.employee?.revokedAt);

function publicMeeting(meeting) {
  const call = meeting.appraisalMeeting;
  const sourceRevoked = recordingRevoked(meeting);
  return { _id: meeting._id, title: meeting.title, scheduledDate: meeting.scheduledDate, startedAt: meeting.actualStartTime, duration: meeting.duration,
    status: meeting.status, stepId: meeting.workflowStepId, mode: call?.mode || 'calendar', conferenceUrl: meeting.nylas?.conferenceUrl,
    integration: call ? { recordingRequested: call.recordingRequested, recordingState: call.recordingState, calendarState: call.calendarState,
      recordingAvailable: !sourceRevoked && Boolean(call.recordingFileId), transcriptionState: call.transcriptionState, recordingUrl: sourceRevoked ? undefined : call.recordingUrl,
      summaryState: call.summaryState, summaryModel: call.summaryModel } : undefined,
    transcript: sourceRevoked ? undefined : meeting.transcript?.content, notes: meeting.sharedNotes, summary: sourceRevoked ? undefined : call?.summary };
}
function failure(message, statusCode = 409) { return Object.assign(new Error(message), { statusCode }); }
function validateLink(value) {
  if (!value) return undefined;
  let url; try { url = new URL(String(value)); } catch { throw failure('Enter a valid meeting link.', 400); }
  if (url.protocol !== 'https:' || url.username || url.password || !['meet.google.com', 'teams.microsoft.com', 'teams.live.com', 'zoom.us'].some(host => url.hostname === host || (host === 'zoom.us' && url.hostname.endsWith('.zoom.us')))) throw failure('Use a Google Meet, Teams or Zoom meeting link.', 400);
  return url.href;
}
async function assertNoLiveCall(meeting) {
  if (meeting.appraisalMeeting?.mode === 'in_app' && await require('../models/AppraisalCall').exists({ meetingId: meeting._id,
    $or: [{ 'manager.seenAt': { $gt: new Date(Date.now() - 30000) } }, { 'employee.seenAt': { $gt: new Date(Date.now() - 30000) } }] })) {
    throw failure('Both participants must leave the call after saving any recording before changing or completing this meeting.');
  }
}
async function isProcessable(meeting) {
  if (meeting.status === 'cancelled') return false;
  if (meeting.appraisalId) return Boolean(await require('../models/Appraisal').exists({ _id: meeting.appraisalId, organizationId: meeting.organizationId, status: { $ne: 'cancelled' } }));
  return meeting.appraisalMeeting?.source === 'one_on_one';
}
async function cancelLateCalendar(meeting, result) {
  let pending = false;
  try { await shared.request('meetings/cancel', meeting.appraisalMeeting.ownerIdentity, { externalId: String(meeting._id) }); }
  catch { pending = true; }
  await OneOnOne.updateOne({ _id: meeting._id, organizationId: meeting.organizationId }, { $set: {
    status: 'cancelled', nylas: { eventId: result.eventId, calendarId: result.calendarId, conferenceUrl: result.conferenceUrl, syncStatus: pending ? 'failed' : 'synced', lastSyncAt: new Date() },
    'appraisalMeeting.calendarState': pending ? 'cancellation_pending' : 'cancelled'
  } });
  if (pending && meeting.appraisalId) await require('../models/Appraisal').updateOne({ _id: meeting.appraisalId, organizationId: meeting.organizationId }, { $set: { 'lifecycle.cleanupPending': true } }).withRemoved();
  throw Object.assign(failure(pending ? 'This review is closed, but its late calendar invitation still needs cancellation. Retry cancellation from the appraisal actions.' : 'This review was closed while its calendar was being scheduled. The late invitation was cancelled.', pending ? 503 : 409), { code: pending ? 'CALENDAR_CANCELLATION_PENDING' : 'APPRAISAL_CLOSED' });
}
async function createCalendar(meeting) {
  if (meeting.nylas?.eventId && meeting.nylas?.conferenceUrl) return meeting;
  if (['completed', 'cancelled', 'no_show'].includes(meeting.status)) throw failure('This meeting is closed.');
  if (+meeting.scheduledDate <= Date.now()) throw failure('The start time has passed. Cancel this attempt and schedule a new meeting.');
  try {
    const result = await shared.request('meetings/create', meeting.appraisalMeeting.ownerIdentity, { externalId: String(meeting._id),
      title: meeting.title, scheduledDate: meeting.scheduledDate, duration: meeting.duration,
      meetingLink: meeting.appraisalMeeting.meetingLink,
      record: meeting.appraisalMeeting.recordingRequested && meeting.appraisalMeeting.recordingPolicyVersion !== 'calendar-recording-v1',
      ...(meeting.appraisalMeeting.recordingPolicyVersion === 'calendar-recording-v1' ? { recordingPolicyVersion: 'calendar-recording-v1', participantSubjects: [String(meeting.managerId), String(meeting.employeeId)] } : {}),
      participants: [meeting.managerInfo, meeting.employeeInfo].map(person => ({ name: person.name, email: person.email })) }, { timeoutMs: 90000 });
    if (!result.eventId || !result.conferenceUrl) throw failure('The calendar has not confirmed a call link. Retry this meeting instead of creating another.', 502);
    const fresh = await OneOnOne.findById(meeting._id);
    if (!fresh || ['cancelled', 'completed', 'no_show'].includes(fresh.status) || !await isProcessable(fresh)) return await cancelLateCalendar(meeting, result);
    const saved = await OneOnOne.updateOne({ _id: meeting._id, organizationId: meeting.organizationId, status: { $nin: ['cancelled', 'completed', 'no_show'] } }, { $set: { nylas: { eventId: result.eventId, calendarId: result.calendarId,
      conferenceUrl: result.conferenceUrl, syncStatus: 'synced', lastSyncAt: new Date() },
      'appraisalMeeting.recordingState': result.recordingState, 'appraisalMeeting.calendarState': result.state || 'scheduled' } });
    if (!saved.matchedCount) return await cancelLateCalendar(meeting, result);
    return OneOnOne.findById(meeting._id);
  } catch (error) {
    if (['APPRAISAL_CLOSED', 'CALENDAR_CANCELLATION_PENDING'].includes(error.code)) throw error;
    await OneOnOne.updateOne({ _id: meeting._id, 'nylas.eventId': { $exists: false } }, { $set: { 'appraisalMeeting.calendarState': 'needs_attention', 'nylas.syncStatus': 'failed' } });
    const confirmed = await OneOnOne.findById(meeting._id);
    if (confirmed?.nylas?.eventId && confirmed?.nylas?.conferenceUrl) return confirmed;
    throw error;
  }
}
module.exports = { publicMeeting, failure, validateLink, assertNoLiveCall, isProcessable, createCalendar, recordingRevoked };
