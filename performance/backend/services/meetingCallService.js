'use strict';
const OneOnOne = require('../models/OneOnOne');
const shared = require('./sharedAIAccountService');

function publicMeeting(meeting) {
  const call = meeting.appraisalMeeting;
  return { _id: meeting._id, title: meeting.title, scheduledDate: meeting.scheduledDate, startedAt: meeting.actualStartTime, duration: meeting.duration,
    status: meeting.status, stepId: meeting.workflowStepId, mode: call?.mode || 'calendar', conferenceUrl: meeting.nylas?.conferenceUrl,
    integration: call ? { recordingRequested: call.recordingRequested, recordingState: call.recordingState, calendarState: call.calendarState,
      recordingAvailable: Boolean(call.recordingFileId), transcriptionState: call.transcriptionState, recordingUrl: call.recordingUrl,
      summaryState: call.summaryState, summaryModel: call.summaryModel } : undefined,
    transcript: meeting.transcript?.content, notes: meeting.sharedNotes, summary: call?.summary };
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
async function createCalendar(meeting) {
  if (meeting.nylas?.eventId && meeting.nylas?.conferenceUrl) return meeting;
  if (['completed', 'cancelled', 'no_show'].includes(meeting.status)) throw failure('This meeting is closed.');
  if (+meeting.scheduledDate <= Date.now()) throw failure('The start time has passed. Cancel this attempt and schedule a new meeting.');
  try {
    const result = await shared.request('meetings/create', meeting.appraisalMeeting.ownerIdentity, { externalId: String(meeting._id),
      title: meeting.title, scheduledDate: meeting.scheduledDate, duration: meeting.duration,
      meetingLink: meeting.appraisalMeeting.meetingLink, record: meeting.appraisalMeeting.recordingRequested,
      participants: [meeting.managerInfo, meeting.employeeInfo].map(person => ({ name: person.name, email: person.email })) }, { timeoutMs: 90000 });
    if (!result.eventId || !result.conferenceUrl) throw failure('The calendar has not confirmed a call link. Retry this meeting instead of creating another.', 502);
    await OneOnOne.updateOne({ _id: meeting._id }, { $set: { nylas: { eventId: result.eventId, calendarId: result.calendarId,
      conferenceUrl: result.conferenceUrl, syncStatus: 'synced', lastSyncAt: new Date() },
      'appraisalMeeting.recordingState': result.recordingState, 'appraisalMeeting.calendarState': result.state || 'scheduled' } });
    return OneOnOne.findById(meeting._id);
  } catch (error) {
    await OneOnOne.updateOne({ _id: meeting._id, 'nylas.eventId': { $exists: false } }, { $set: { 'appraisalMeeting.calendarState': 'needs_attention', 'nylas.syncStatus': 'failed' } });
    const confirmed = await OneOnOne.findById(meeting._id);
    if (confirmed?.nylas?.eventId && confirmed?.nylas?.conferenceUrl) return confirmed;
    throw error;
  }
}
module.exports = { publicMeeting, failure, validateLink, assertNoLiveCall, isProcessable, createCalendar };
