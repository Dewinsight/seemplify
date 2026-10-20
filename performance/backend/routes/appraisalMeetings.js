'use strict';
const express = require('express');
const Appraisal = require('../models/Appraisal');
const OneOnOne = require('../models/OneOnOne');
const shared = require('../services/sharedAIAccountService');
const flow = require('../services/appraisalFlowService');

const { publicMeeting } = require('../services/meetingCallService');
function errorResponse(res, error) { return res.status(Number(error.statusCode) || 503).json({ success: false, error: error.message || 'The meeting request failed.', code: error.code || 'MEETING_UNAVAILABLE' }); }

module.exports = function createMeetingRouter({ canManageAppraisal, isAppraisalEmployee, tenantAppraisalIdFilter }) {
  const router = express.Router({ mergeParams: true });
  router.use(async (req, res, next) => {
    try {
      req.appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.appraisalId));
      if (!req.appraisal) return res.status(404).json({ success: false, error: 'Appraisal not found.' });
      req.canManageMeeting = await canManageAppraisal(req, req.appraisal);
      if (!req.canManageMeeting && !isAppraisalEmployee(req, req.appraisal)) return res.status(403).json({ success: false, error: 'Access denied.' });
      if (req.appraisal.status === 'cancelled' && (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.endsWith('/native/state'))) return res.status(409).json({ success: false, error: 'This appraisal was cancelled. Its calls and notes are read-only.' });
      return next();
    } catch (error) { return next(error); }
  });
  router.get('/', async (req, res) => {
    try { return res.json({ success: true, data: (await OneOnOne.find({ organizationId: req.appraisal.organizationId, appraisalId: req.appraisal._id }).sort({ scheduledDate: 1 })).map(publicMeeting) }); }
    catch (error) { return errorResponse(res, error); }
  });
  router.get('/connection', async (req, res) => {
    try { return res.json({ success: true, data: await shared.request('meetings/connection', shared.identityFromRequest(req)) }); }
    catch (error) { return errorResponse(res, error); }
  });
  router.use('/connection', require('./calendarConnection')());
  router.post('/', async (req, res) => {
    try {
      if (!req.canManageMeeting) return res.status(403).json({ success: false, error: 'Only the assigned reviewer or HR can schedule this call.' });
      const appraisal = req.appraisal;
      if (['cancelled', 'employee_acknowledged', 'completed'].includes(appraisal.status)) return res.status(409).json({ success: false, error: 'This appraisal is no longer accepting new meetings.' });
      const step = flow.flowFor(appraisal)?.steps.find(step => step.id === req.body.stepId && step.type === 'oneOnOne');
      if (!step) return res.status(400).json({ success: false, error: 'Choose a one-on-one step from this appraisal.' });
      const mode = req.body.mode === 'in_app' ? 'in_app' : 'calendar';
      if (req.body.mode !== undefined && !['calendar', 'in_app'].includes(req.body.mode)) return res.status(400).json({ error: 'Choose a calendar meeting or an in-app call.' });
      const scheduledDate = new Date(req.body.scheduledDate); const duration = Number(req.body.duration || 30);
      if (mode === 'in_app' && req.body.record && duration > 30) return res.status(400).json({ error: 'Recorded in-app calls support up to 30 minutes. Add another call step for a longer discussion.' });
      if (!Number.isFinite(+scheduledDate) || +scheduledDate <= Date.now() || !Number.isInteger(duration) || duration < 15 || duration > 480) return res.status(400).json({ success: false, error: 'Choose a future time and a duration from 15 to 480 minutes.' });
      if (mode === 'in_app' && req.body.record && req.body.recordingNoticeAccepted !== true) return res.status(400).json({ success: false, error: 'Confirm that you will inform participants before recording.' });
      const identity = shared.identityFromRequest(req);
      let meeting = await OneOnOne.findOne({ appraisalId: appraisal._id, workflowStepId: step.id, organizationId: appraisal.organizationId });
      if (!meeting) {
        try { meeting = await OneOnOne.create({ appraisalId: appraisal._id, workflowStepId: step.id, managerId: appraisal.manager.userId, managerInfo: appraisal.manager, employeeId: appraisal.employee.userId, employeeInfo: appraisal.employee, organizationId: appraisal.organizationId, title: step.label, scheduledDate, duration, meetingType: 'performance_review', meetingFormat: 'video', createdBy: identity.sub, appraisalMeeting: { mode, ownerIdentity: identity, recordingRequested: Boolean(req.body.record), meetingLink: req.body.meetingLink, summaryState: 'not_started', ...require('../services/calendarRecordingConsentService').initial(mode, Boolean(req.body.record)) } }); }
        catch (error) { if (error.code !== 11000) throw error; meeting = await OneOnOne.findOne({ appraisalId: appraisal._id, workflowStepId: step.id, organizationId: appraisal.organizationId }); }
      }
      if ((meeting.appraisalMeeting.mode || 'calendar') !== mode) return res.status(409).json({ error: 'This call step already uses a different meeting type.' });
      if (mode === 'in_app') return res.status(201).json({ success: true, data: publicMeeting(meeting) });
      if (meeting.nylas?.eventId) return res.json({ success: true, data: publicMeeting(meeting) });
      const scheduled = await require('../services/meetingCallService').createCalendar(meeting);
      appraisal.addAuditLog('appraisal_meeting_scheduled', req.session.user, { meetingId: meeting._id, stepId: step.id, recordingRequested: Boolean(req.body.record) }); await appraisal.save();
      return res.status(201).json({ success: true, data: publicMeeting(scheduled) });
    } catch (error) { return errorResponse(res, error); }
  });
  router.param('meetingId', async (req, res, next, id) => {
    try {
      req.meeting = await OneOnOne.findOne({ _id: id, organizationId: req.appraisal.organizationId, appraisalId: req.appraisal._id });
      if (!req.meeting) return res.status(404).json({ success: false, error: 'Meeting not found.' });
      return next();
    } catch (error) { return next(error); }
  });
  router.use('/:meetingId/recording-consent', require('./calendarRecordingConsent')());
  router.use('/:meetingId/native', require('./appraisalNativeCalls')(publicMeeting));
  router.use('/:meetingId/notetaker-status', require('./notetakerStatus')());
  router.post('/:meetingId/reminder', async (req, res) => {
    try {
      if (!req.canManageMeeting) return res.status(403).json({ error: 'Only the reviewer or HR can send a reminder.' });
      if (['completed', 'employee_acknowledged', 'cancelled'].includes(req.appraisal.status)) return res.status(409).json({ error: 'This appraisal is closed.' });
      return res.status(202).json({ success: true, data: await require('../services/meetingReminderService').queue(req.meeting, shared.identityFromRequest(req).sub) });
    } catch (error) { return errorResponse(res, error); }
  });
  router.post('/:meetingId/sync', async (req, res) => {
    try {
      const meeting = req.meeting;
      if (meeting.appraisalMeeting?.mode === 'in_app') {
        if (meeting.appraisalMeeting.transcriptionState === 'failed') await OneOnOne.updateOne({ _id: meeting._id }, { $set: { 'appraisalMeeting.transcriptionAttempts': 0 } });
        void require('../services/appraisalNativeMediaService').process(meeting).catch(() => {});
        return res.status(202).json({ success: true, data: publicMeeting(meeting), message: 'Processing queued. Refresh the call to see progress.' });
      }
      const updated = await require('../services/appraisalMeetingMediaService').sync(meeting);
      return res.json({ success: true, data: publicMeeting(updated) });
    } catch (error) { return errorResponse(res, error); }
  });
  router.post('/:meetingId/transcript', async (req, res) => {
    try {
      if (!req.canManageMeeting) return res.status(403).json({ success: false, error: 'Only the reviewer or HR can add a transcript.' });
      if (req.appraisal.status === 'cancelled') return res.status(409).json({ success: false, error: 'This appraisal was cancelled.' });
      const updated = await require('../services/appraisalMeetingMediaService').saveManualTranscript(req.meeting, req.body.content, shared.identityFromRequest(req).sub);
      req.appraisal.addAuditLog('manual_meeting_transcript_added', req.session.user, { meetingId: req.meeting._id });
      await req.appraisal.save();
      return res.json({ success: true, data: publicMeeting(updated) });
    } catch (error) { return errorResponse(res, error); }
  });
  router.post('/:meetingId/summary', async (req, res) => {
    try {
      const meeting = req.meeting;
      if (!meeting.transcript?.content) return res.status(409).json({ success: false, error: 'Wait for the transcript before creating meeting notes.' });
      const updated = await require('../services/appraisalMeetingMediaService').summarize(meeting, shared.identityFromRequest(req));
      return res.json({ success: true, data: publicMeeting(updated) });
    } catch (error) { return errorResponse(res, error); }
  });
  router.post('/:meetingId/complete', async (req, res) => {
    try {
      if (!req.canManageMeeting) return res.status(403).json({ success: false, error: 'Only the reviewer or HR can complete this step.' });
      const meeting = req.meeting; const appraisal = req.appraisal;
      if (meeting.status === 'completed' && appraisal.completedMeetingSteps?.includes(meeting.workflowStepId)) return res.json({ success: true, data: publicMeeting(meeting) });
      if (meeting.appraisalMeeting?.mode === 'in_app' && await require('../models/AppraisalCall').exists({ meetingId: meeting._id, $or: [{ 'manager.seenAt': { $gt: new Date(Date.now() - 30000) } }, { 'employee.seenAt': { $gt: new Date(Date.now() - 30000) } }] })) return res.status(409).json({ error: 'Both participants must leave the in-app call after saving any recording before completing this step.' });
      if (flow.currentStep(appraisal)?.id !== meeting.workflowStepId) return res.status(409).json({ success: false, error: 'Complete the preceding appraisal steps first.' });
      if (Date.now() < +meeting.scheduledDate) return res.status(409).json({ success: false, error: 'The meeting has not started yet.' });
      const notes = String(req.body.notes || '').trim().slice(0, 10000);
      if (!notes && !meeting.appraisalMeeting?.summary) return res.status(400).json({ success: false, error: 'Add the agreed meeting notes, or generate notes from the transcript.' });
      meeting.status = 'completed'; meeting.actualEndTime = new Date(); meeting.sharedNotes = notes || meeting.appraisalMeeting.summary; await meeting.save();
      appraisal.completedMeetingSteps = [...new Set([...(appraisal.completedMeetingSteps || []), meeting.workflowStepId])];
      appraisal.addAuditLog('appraisal_meeting_completed', req.session.user, { meetingId: meeting._id, stepId: meeting.workflowStepId }); await appraisal.save();
      return res.json({ success: true, data: publicMeeting(meeting), appraisalStatus: appraisal.status });
    } catch (error) { return errorResponse(res, error); }
  });
  return router;
};
