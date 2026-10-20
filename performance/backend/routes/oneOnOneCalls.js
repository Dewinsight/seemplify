'use strict';
const express = require('express');
const OneOnOne = require('../models/OneOnOne');
const shared = require('../services/sharedAIAccountService');
const calls = require('../services/meetingCallService');
const media = require('../services/appraisalMeetingMediaService');
const wrap = action => async (req, res) => { try { await action(req, res); } catch (error) { res.status(error.statusCode || error.status || 503).json({ success: false, error: error.message || 'The call could not be updated.' }); } };

async function notifyScheduled(meeting, onScheduled, actor) {
  if (meeting.appraisalMeeting.lifecycleScheduled) return;
  await onScheduled(meeting, 'one_on_one.scheduled', actor);
  await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.lifecycleScheduled': true } });
}
module.exports = ({ completeMeeting, onScheduled }) => {
  const router = express.Router({ mergeParams: true });
  router.use((req, res, next) => {
    if (req.oneOnOne.appraisalId) return res.status(409).json({ error: 'Open this call from its appraisal.' });
    if (req.oneOnOne.appraisalMeeting?.source !== 'one_on_one') return res.status(409).json({ error: 'This older meeting was scheduled without an integrated call.' });
    req.meeting = req.oneOnOne;
    next();
  });
  router.get('/', (req, res) => res.json({ success: true, data: [calls.publicMeeting(req.meeting)] }));
  router.get('/connection', wrap(async (req, res) => res.json({ success: true, data: await shared.request('meetings/connection', shared.identityFromRequest(req)) })));
  router.post('/reminder', wrap(async (req, res) => {
    if (!req.oneOnOneAccess.isManager && !req.oneOnOneAccess.isHrAdmin) return res.status(403).json({ error: 'Only the organizer or HR can send a reminder.' });
    res.status(202).json({ success: true, data: await require('../services/meetingReminderService').queue(req.meeting, shared.identityFromRequest(req).sub) });
  }));
  router.use('/recording-consent', require('./calendarRecordingConsent')());
  router.use('/native', require('./appraisalNativeCalls')(calls.publicMeeting));
  router.post('/retry', wrap(async (req, res) => {
    if (!req.oneOnOneAccess.isManager && !req.oneOnOneAccess.isHrAdmin) return res.status(403).json({ error: 'Only the organizer or HR can retry a calendar invitation.' });
    if (req.meeting.appraisalMeeting.mode !== 'calendar') return res.status(409).json({ error: 'This is an in-app call.' });
    const meeting = await calls.createCalendar(req.meeting);
    await notifyScheduled(meeting, onScheduled, req.session.user);
    res.json({ success: true, data: calls.publicMeeting(meeting) });
  }));
  router.post('/sync', wrap(async (req, res) => {
    if (req.meeting.status === 'cancelled') return res.status(409).json({ error: 'This meeting was cancelled.' });
    if (req.meeting.appraisalMeeting.mode === 'in_app') {
      if (req.meeting.appraisalMeeting.transcriptionState === 'failed') await OneOnOne.updateOne({ _id: req.meeting._id }, { $set: { 'appraisalMeeting.transcriptionAttempts': 0 } });
      void require('../services/appraisalNativeMediaService').process(req.meeting).catch(() => {});
      return res.status(202).json({ success: true, message: 'Processing queued.' });
    }
    if (!req.meeting.nylas?.eventId) return res.status(409).json({ error: 'Retry the calendar invitation first.' });
    res.json({ success: true, data: calls.publicMeeting(await media.sync(req.meeting)) });
  }));
  router.post('/summary', wrap(async (req, res) => {
    res.json({ success: true, data: calls.publicMeeting(await media.summarize(req.meeting, shared.identityFromRequest(req))) });
  }));
  router.post('/complete', (req, res) => { req.body.sharedNotes = req.body.notes; return completeMeeting(req, res); });
  return router;
};

module.exports.schedule = ({ serializeMeeting, onScheduled }) => wrap(async (req, res) => {
  const { mode, employeeId, requestId } = req.body;
  const scheduledDate = new Date(req.body.scheduledDate); const duration = Number(req.body.duration || 30);
  if (!['in_app', 'calendar'].includes(mode)) throw calls.failure('Choose an in-app call or a calendar meeting.', 400);
  if (req.body.record !== undefined && typeof req.body.record !== 'boolean') throw calls.failure('Choose whether this call will be recorded.', 400);
  const meetingType = req.body.meetingType || 'weekly';
  if (!['weekly', 'biweekly', 'monthly', 'adhoc', 'performance_review', 'career_discussion'].includes(meetingType)) throw calls.failure('Choose a valid meeting type.', 400);
  const meetingLink = mode === 'calendar' ? calls.validateLink(req.body.meetingLink) : undefined;
  if (!/^[a-f0-9-]{36}$/i.test(String(requestId || ''))) throw calls.failure('Refresh the scheduling form and try again.', 400);
  if (!Number.isFinite(+scheduledDate) || +scheduledDate <= Date.now() || !Number.isInteger(duration) || duration < 15 || duration > 480) throw calls.failure('Choose a future time and a duration from 15 to 480 minutes.', 400);
  if (mode === 'in_app' && req.body.record && duration > 30) throw calls.failure('Recorded in-app calls support up to 30 minutes.', 400);
  if (req.body.record && req.body.recordingNoticeAccepted !== true) throw calls.failure('Confirm that you will inform both participants before recording.', 400);
  const identity = shared.identityFromRequest(req);
  const scope = await require('../services/appraisalAccessService').resolveAppraisalAccessScope(req);
  const employee = scope.organizationUsers.find(person => person.userId === String(employeeId));
  if (!scope.canManageAppraisals || !employee || employee.userId === identity.sub) throw calls.failure('Choose another person from the teams you manage.', 403);
  if (mode === 'calendar' && !employee.email) throw calls.failure('This person needs a verified email before a calendar invitation can be sent.');
  const query = { organizationId: scope.organizationId, managerId: identity.sub, callRequestId: requestId };
  let meeting = await OneOnOne.findOne(query); let created = false;
  if (meeting && (meeting.employeeId !== employee.userId || meeting.appraisalMeeting.mode !== mode)) throw calls.failure('This scheduling attempt already belongs to another call. Open that meeting or start a fresh form.');
  if (!meeting) {
    if (mode === 'calendar') {
      const connection = await shared.request('meetings/connection', identity);
      if (!connection.connected) throw calls.failure('Connect your calendar before scheduling a calendar meeting. You can also choose an in-app call.');
    }
    try {
      meeting = await OneOnOne.create({ ...query, employeeId: employee.userId, employeeInfo: { name: employee.name, email: employee.email },
        managerInfo: { name: req.session.user.name || identity.email, email: identity.email }, scheduledDate, duration,
        title: String(req.body.title || `1:1 with ${employee.name}`).trim().slice(0, 300), meetingType, meetingFormat: 'video',
        location: mode === 'in_app' ? 'In-app call' : 'Calendar meeting', createdBy: identity.sub,
        appraisalMeeting: { source: 'one_on_one', mode, ownerIdentity: identity, recordingRequested: Boolean(req.body.record),
          ...require('../services/calendarRecordingConsentService').initial(mode, Boolean(req.body.record)),
          meetingLink,
          summaryState: 'not_started', calendarState: mode === 'calendar' ? 'pending' : undefined } });
      created = true;
    } catch (error) { if (error.code !== 11000) throw error; meeting = await OneOnOne.findOne(query); }
  }
  if (!meeting || meeting.employeeId !== employee.userId || meeting.appraisalMeeting.mode !== mode) throw calls.failure('This scheduling attempt already belongs to another call. Open that meeting or start a fresh form.');
  try { if (mode === 'calendar') meeting = await calls.createCalendar(meeting); }
  catch (error) {
    return res.status(error.statusCode || 503).json({ success: false, error: error.message || 'The calendar has not confirmed the invitation. Open the meeting and retry.', data: { meetingId: String(meeting._id) } });
  }
  await notifyScheduled(meeting, onScheduled, req.session.user);
  res.status(created ? 201 : 200).json({ success: true, data: serializeMeeting(req, meeting) });
});
