'use strict';
const express = require('express');
const service = require('../services/calendarRecordingConsentService');
const shared = require('../services/sharedAIAccountService');
module.exports = () => {
  const router = express.Router({ mergeParams: true });
  const route = work => async (req, res) => {
    try {
      const actor = shared.identityFromRequest(req);
      if (String(actor.organizationId) !== String(req.meeting.organizationId)) return res.status(404).json({ error: 'Meeting not found.' });
      const meeting = await work(req, actor.sub);
      return res.json({ success: true, data: service.status(meeting, actor.sub) });
    } catch (error) { return res.status(error.statusCode || 503).json({ success: false, error: error.message, code: error.code || 'RECORDING_CONSENT_UNAVAILABLE' }); }
  };
  router.get('/', route(req => service.current(req.meeting)));
  router.post('/', route((req, actor) => service.acknowledge(req.meeting, actor, req.body || {})));
  router.post('/start', route((req, actor) => service.start(req.meeting, actor)));
  return router;
};
