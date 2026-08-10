const crypto = require('crypto');
const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const User = require('../models/User');
const Organization = require('../models/Organization');
const { getPresenceReporterBaseUrl } = require('../config/presenceReporterConfig');

const router = express.Router();
const APP_ID = 'recruiter';

async function forward(req, res, pathname, allowedFields) {
  const [user, organization] = await Promise.all([
    User.findById(req.user.id).select('idpSubject').lean(),
    Organization.findById(req.activeOrganization || req.user.currentOrganization).select('idpOrganizationId').lean(),
  ]);
  if (!user?.idpSubject || !organization?.idpOrganizationId) return res.status(409).json({ error: 'Recruiter account is not linked to an IDP subject and organization' });
  const body = { appId: APP_ID, organizationId: String(organization.idpOrganizationId), userId: String(user.idpSubject) };
  for (const field of allowedFields) if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) body[field] = req.body[field];
  const secret = process.env.INTERNAL_SERVICE_SECRET || process.env.PRESENCE_REPORTER_SERVICE_SECRET || '';
  if (!secret && process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Presence service authentication is not configured' });
  const timestamp = new Date().toISOString();
  const signature = secret ? crypto.createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(body)}`).digest('hex') : '';
  const base = getPresenceReporterBaseUrl();
  try {
    const response = await fetch(`${base}${pathname}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-id': APP_ID, 'x-service-timestamp': timestamp, 'x-service-signature': signature ? `sha256=${signature}` : '' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    return res.status(response.status).type(response.headers.get('content-type') || 'application/json').send(await response.text());
  } catch (error) { return res.status(503).json({ error: 'Presence reporting is temporarily unavailable' }); }
}

router.use(authMiddleware, requireOrganization);
router.post('/sessions', (req, res, next) => forward(req, res, '/sessions', ['clientSessionId', 'visible', 'appVersion']).catch(next));
router.post('/sessions/:id/:action', (req, res, next) => {
  if (!/^[a-f0-9]{24}$/i.test(req.params.id) || !['heartbeat', 'activity', 'end'].includes(req.params.action)) return res.status(400).json({ error: 'Invalid presence session operation' });
  return forward(req, res, `/sessions/${req.params.id}/${req.params.action}`, ['visible', 'activityKind', 'featureCode', 'reason']).catch(next);
});

module.exports = router;
