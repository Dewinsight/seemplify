'use strict';

const { invalidateIdentitySession } = require('../services/idpProvisioningService');
const { verifyIdpWebhook } = require('../services/idpWebhookSecurity');

const REMOVAL_EVENTS = new Set([
    'organization.member.removed',
    'organization.member.app_access_changed',
    'organization.member.app_access_updated'
]);
const INVALIDATION_EVENTS = new Set([
    ...REMOVAL_EVENTS,
    'organization.member.added',
    'organization.member.role_changed',
    'team.member.removed',
    'team.member.role_changed',
    'user.session.invalidate'
]);

exports.receive = async (req, res) => {
    const verification = verifyIdpWebhook({
        payload: req.body,
        rawBody: req.rawBody,
        eventHeader: req.headers['x-idp-event'],
        deliveryTimestamp: req.headers['x-idp-delivery-timestamp'],
        signature: req.headers['x-idp-signature-v2']
    });
    if (!verification.ok) return res.status(verification.status).json({ error: verification.error });

    const { event, eventId, data = {} } = req.body;
    try {
        if (INVALIDATION_EVENTS.has(event)) {
            await invalidateIdentitySession({
                subject: data.subject || data.userId,
                organizationId: data.organizationId,
                removeMembership: REMOVAL_EVENTS.has(event)
            });
        }
        return res.json({ received: true, event, eventId });
    } catch (error) {
        console.error('Approver IdP webhook processing failed:', error.message);
        return res.status(500).json({ error: 'Webhook processing failed' });
    }
};
