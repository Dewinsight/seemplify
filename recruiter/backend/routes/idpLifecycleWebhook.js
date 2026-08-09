const crypto = require('crypto');
const express = require('express');
const Organization = require('../models/Organization');
const PeopleTransition = require('../models/CandidateOnboarding');
const OnboardingAuditEvent = require('../models/OnboardingAuditEvent');

const router = express.Router();

function verifySignature(req) {
  const secret = process.env.IDP_WEBHOOK_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'development-webhook-secret');
  if (!secret) return false;
  const received = String(req.get('x-idp-signature') || '').replace(/^sha256=/, '');
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body || {})).digest('hex');
  return /^[a-f0-9]{64}$/i.test(received)
    && crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

function actionForEvent(event, transition) {
  if (transition?.identityAction?.action) return transition.identityAction.action;
  if (event === 'organization.member.deactivated') return 'deactivate';
  if (event === 'organization.member.reactivated') return 'reactivate';
  return 'provision';
}

router.post('/', async (req, res) => {
  if (!verifySignature(req)) return res.status(401).json({ error: 'Invalid IDP webhook signature' });
  const payload = req.body || {};
  const data = payload.data || {};
  const event = payload.event || req.get('x-idp-event');
  const supported = new Set(['organization.member.added', 'organization.member.deactivated', 'organization.member.reactivated', 'organization.member.updated']);
  if (!supported.has(event)) return res.status(202).json({ accepted: true, ignored: true });
  if (event === 'organization.member.updated' && !data.deactivationScheduled) return res.status(202).json({ accepted: true, ignored: true });
  if (!payload.eventId || !payload.organizationId || !payload.occurredAt) return res.status(400).json({ error: 'Invalid IDP event envelope' });

  const organization = await Organization.findOne({ idpOrganizationId: String(payload.organizationId) }).select('_id').lean();
  if (!organization) return res.status(202).json({ accepted: true, organizationFound: false });
  const existingAudit = await OnboardingAuditEvent.findOne({ 'metadata.eventId': payload.eventId }).select('_id').lean();
  if (existingAudit) return res.json({ accepted: true, duplicate: true });

  const identifiers = [payload.subjectId, data.idpSubject, data.userId].filter(Boolean).map(String);
  const expectedActions = event === 'organization.member.deactivated'
    ? ['deactivate']
    : event === 'organization.member.reactivated' ? ['provision', 'reactivate'] : ['provision', 'deactivate'];
  const query = data.transitionId
    ? { _id: data.transitionId, organization: organization._id, 'identityAction.action': { $in: expectedActions } }
    : {
        organization: organization._id,
        'identityAction.status': { $in: ['pending', 'failed'] },
        'identityAction.action': { $in: expectedActions },
        $or: [
          { 'identityAction.idempotencyKey': payload.idempotencyKey },
          { 'identityAction.idpAccountId': { $in: identifiers } },
          { 'subject.idpAccountId': { $in: identifiers } },
        ],
      };
  const transition = await PeopleTransition.findOne(query).sort({ createdAt: -1 });
  if (!transition) return res.status(202).json({ accepted: true, transitionFound: false });

  if (event === 'organization.member.updated' && data.deactivationScheduled) {
    transition.identityAction.status = 'pending';
    transition.identityAction.effectiveAt = data.effectiveExitAt;
  } else {
    const action = actionForEvent(event, transition);
    transition.identityAction.status = 'completed';
    transition.identityAction.completedAt = new Date(payload.occurredAt);
    transition.identityAction.idpAccountId = data.userId || transition.identityAction.idpAccountId;
    transition.identityAction.lastError = '';
    if (action === 'provision') transition.status = 'provisioned';
    if (action === 'deactivate' && ['exit', 'retirement'].includes(transition.processType)) {
      transition.status = 'completed';
      transition.completedAt = new Date(payload.occurredAt);
    }
  }
  await transition.save();
  await OnboardingAuditEvent.create({
    organization: transition.organization,
    onboarding: transition._id,
    candidate: transition.candidate,
    actorType: 'system',
    action: event === 'organization.member.updated' ? 'identity_deactivation_scheduled' : 'identity_lifecycle_completed',
    metadata: { eventId: payload.eventId, event, correlationId: payload.correlationId, subjectId: payload.subjectId },
  });
  return res.status(202).json({ accepted: true, transitionId: transition._id });
});

module.exports = router;
