'use strict';
const express = require('express');
const service = require('../services/calendarNotetakerService');
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
  router.post('/', (_req, res) => res.status(410).json({ error: 'Per-participant recording permission is no longer required.' }));
  router.post('/stop', route((req, actor) => service.stop(req.meeting, actor)));
  router.post('/start', route((req, actor) => service.start(req.meeting, actor, { joinNow: req.body?.joinNow === true })));
  return router;
};
