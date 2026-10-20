'use strict';
const express = require('express');
const shared = require('../services/sharedAIAccountService');
module.exports = () => {
  const router = express.Router();
  router.post('/disconnect', async (req, res) => {
    try { return res.json({ success: true, data: await shared.request('meetings/disconnectCalendar', shared.identityFromRequest(req)) }); }
    catch (error) { return res.status(error.statusCode || 503).json({ success: false, error: error.message || 'Calendar disconnect failed.', code: error.code }); }
  });
  router.post('/connect', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const result = await shared.request('meetings/connectCalendar', shared.identityFromRequest(req), { provider: req.body.provider, returnPath: req.body.returnPath });
      if (!/^pmcal_proof_[A-Za-z0-9_-]{20}$/.test(result.cookieName || '') || !/^[A-Za-z0-9_-]{43}$/.test(result.browserProof || '')) throw new Error('The calendar service did not establish a secure browser connection.');
      res.cookie(result.cookieName, result.browserProof, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/interviews/oauth/callback', maxAge: 20 * 60_000, ...(process.env.NODE_ENV === 'production' ? { domain: '.seemplifyai.com' } : {}) });
      return res.json({ success: true, data: { authUrl: result.authUrl } });
    } catch (error) { return res.status(error.statusCode || 503).json({ success: false, error: error.message || 'Calendar connection could not be started.', code: error.code }); }
  });
  return router;
};
