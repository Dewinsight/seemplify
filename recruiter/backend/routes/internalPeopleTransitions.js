const crypto = require('crypto');
const express = require('express');
const Organization = require('../models/Organization');
const PeopleTransition = require('../models/CandidateOnboarding');
const OnboardingWorkflowItem = require('../models/OnboardingWorkflowItem');

const router = express.Router();

function verify(req, res, next) {
  const secret = process.env.INTERNAL_SERVICE_SECRET || process.env.IDP_RECRUITER_SERVICE_SECRET || '';
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Internal transition authentication is not configured' });
    return next();
  }
  const timestamp = String(req.get('x-service-timestamp') || '');
  const received = String(req.get('x-service-signature') || '').replace(/^sha256=/, '');
  if (!Number.isFinite(Date.parse(timestamp)) || Math.abs(Date.now() - Date.parse(timestamp)) > 300000) return res.status(401).json({ error: 'Expired service request' });
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(req.body || {})}`).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(received) || !crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'))) return res.status(401).json({ error: 'Invalid service signature' });
  next();
}

router.use(verify);

router.post('/summary', async (req, res) => {
  const idpOrganizationId = String(req.body.idpOrganizationId || '');
  const subjectIds = [...new Set((Array.isArray(req.body.subjectIds) ? req.body.subjectIds : [req.body.subjectId]).filter(Boolean).map(String))].slice(0, 500);
  if (!idpOrganizationId || !subjectIds.length) return res.status(400).json({ error: 'idpOrganizationId and at least one subjectId are required' });
  const organization = await Organization.findOne({ idpOrganizationId }).select('_id').lean();
  if (!organization) return res.json({ organizationFound: false, summaries: [] });
  const transitions = await PeopleTransition.find({
    organization: organization._id,
    'subject.idpAccountId': { $in: subjectIds },
  }).sort({ createdAt: -1 }).lean();
  const transitionIds = transitions.map(item => item._id);
  const workflowItems = await OnboardingWorkflowItem.find({ onboarding: { $in: transitionIds } }).select('onboarding type title status dueAt required').lean();
  const byTransition = new Map();
  for (const item of workflowItems) {
    const key = String(item.onboarding); if (!byTransition.has(key)) byTransition.set(key, []); byTransition.get(key).push(item);
  }
  const frontend = String(process.env.RECRUITER_FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const summaries = subjectIds.map(subjectId => {
    const records = transitions.filter(item => item.subject?.idpAccountId === subjectId);
    const active = records.filter(item => !['completed', 'cancelled'].includes(item.status));
    const items = active.flatMap(item => byTransition.get(String(item._id)) || []);
    const pendingItems = items.filter(item => !['completed', 'skipped'].includes(item.status));
    const latest = records[0];
    return {
      subjectId,
      status: latest?.status || 'not_started',
      processType: latest?.processType || null,
      transitionId: latest?._id || null,
      activeTransitionCount: active.length,
      pendingTaskCount: pendingItems.length,
      pendingDocumentCount: pendingItems.filter(item => item.type === 'document').length,
      pendingSignatureCount: active.reduce((sum, item) => sum + (item.envelopes?.length || 0), 0),
      dueAt: pendingItems.map(item => item.dueAt).filter(Boolean).sort()[0] || null,
      deepLink: `${frontend}/people-transitions/tasks?subjectId=${encodeURIComponent(subjectId)}`,
      transitions: records.slice(0, 20).map(item => ({ id: item._id, title: item.title, processType: item.processType, status: item.status, dueAt: item.dueAt, progress: item.progress })),
    };
  });
  res.json({ organizationFound: true, generatedAt: new Date(), summaries });
});

module.exports = router;
