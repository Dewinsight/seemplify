'use strict';
const express = require('express');
const shared = require('../services/sharedAIAccountService');
module.exports = () => {
  const router = express.Router();
  router.post('/retry', async (req, res) => {
    try {
      const actor = shared.identityFromRequest(req);
      const service = require('../services/calendarNotetakerService');
      const meeting = await service.current(req.meeting);
      const info = service.status(meeting, actor.sub);
      if (String(actor.organizationId) !== String(meeting.organizationId) || !info.ownRole) return res.status(403).json({ error: 'Only meeting participants can retry the notetaker.' });
      if (!info.required || info.windowClosed || info.state === 'revoked') return res.status(409).json({ error: 'This call cannot accept another notetaker.' });
      const authorization = { policyVersion: service.POLICY, requestedBy: actor.sub, requestedAt: new Date() };
      const result = await shared.request('meetings/retryNotetaker', meeting.appraisalMeeting.ownerIdentity, { externalId: String(meeting._id), recordingAuthorization: authorization }, { timeoutMs: 90000 });
      const saved = await require('../models/OneOnOne').findOneAndUpdate({ _id: meeting._id, organizationId: meeting.organizationId, status: { $nin: ['completed', 'cancelled', 'no_show', 'rescheduled'] }, 'appraisalMeeting.recordingState': { $ne: 'revoked' }, 'appraisalMeeting.recordingConsent.revokedAt': { $exists: false }, 'appraisalMeeting.recordingConsent.manager.revokedAt': { $exists: false }, 'appraisalMeeting.recordingConsent.employee.revokedAt': { $exists: false } }, { $set: { 'appraisalMeeting.recordingState': result.recordingState, 'appraisalMeeting.recordingPolicyVersion': service.POLICY, 'appraisalMeeting.recordingAuthorization': authorization } }, { new: true });
      if (!saved) { await shared.request('meetings/stopRecording', meeting.appraisalMeeting.ownerIdentity, { externalId: String(meeting._id) }); return res.status(409).json({ error: 'The call was closed or the notetaker stopped.' }); }
      return res.json({ success: true });
    } catch (error) { return res.status(error.statusCode || 503).json({ error: 'The notetaker could not be retried. Refresh its status before trying again.' }); }
  });
  router.get('/', async (req, res) => {
    try {
      const meeting = req.meeting;
      if (meeting.appraisalMeeting?.mode !== 'calendar') return res.status(409).json({ error: 'This is not a calendar meeting.' });
      if (require('../services/meetingCallService').recordingRevoked(meeting) || meeting.appraisalMeeting?.recordingState === 'revoked') return res.json({ success: true, data: { state: 'revoked', events: [], realtimeTranscript: false } });
      const data = await shared.request('meetings/notetakerStatus', meeting.appraisalMeeting.ownerIdentity, { externalId: String(meeting._id) });
      const current = await require('../services/calendarNotetakerService').current(meeting);
      if (require('../services/meetingCallService').recordingRevoked(current) || current.appraisalMeeting.recordingState === 'revoked') return res.json({ success: true, data: { state: 'revoked', events: [], realtimeTranscript: false } });
      const providerState = { pending: 'scheduled', scheduled: 'scheduled', connecting: 'joining', joining: 'joining', attending: 'attending', in_progress: 'in_progress', failed_entry: 'failed', disconnected: 'disconnected', processing: 'processing' }[data.state];
      if (providerState && ['scheduled', 'joining', 'attending', 'in_progress', 'failed', 'disconnected', 'processing'].includes(current.appraisalMeeting.recordingState)) {
        await require('../models/OneOnOne').updateOne({ _id: current._id, organizationId: current.organizationId, 'appraisalMeeting.recordingState': current.appraisalMeeting.recordingState }, { $set: { 'appraisalMeeting.recordingState': providerState } });
      }
      return res.json({ success: true, data });
    } catch (error) { return res.status(error.statusCode || 503).json({ error: 'Notetaker status could not be checked. Please retry.' }); }
  });
  return router;
};
