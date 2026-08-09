const express = require('express');
const router = express.Router();
const { verifyNylasWebhook, logWebhookRequest } = require('../middleware/webhookVerification');
const webhookController = require('../controllers/webhookController');
const {
  applyMemberAppAccessChanged,
  applyMemberRemoved,
  applyIdentityClaimsChanged
} = require('../services/idpAppAccessEventService');
const { resolveIdpWebhookSecrets, verifyIdpWebhook } = require('../services/idpWebhookSecurity');
const {
  claimIdpWebhookEvent,
  markIdpWebhookProcessed,
  markIdpWebhookFailed
} = require('../services/idpWebhookReceiptService');
const IDP_WEBHOOK_SECRETS = resolveIdpWebhookSecrets();

/**
 * Verify IDP webhook signature
 */
function verifyIdpSignature(req, res, next) {
  const signature = req.headers['x-idp-signature-v2'];
  const deliveryTimestamp = req.headers['x-idp-delivery-timestamp'];
  if (!signature) {
    console.warn('IDP Webhook: Missing signature');
    return res.status(401).json({ error: 'Missing signature' });
  }
  
  const verified = verifyIdpWebhook({
    payload: req.body,
    signature,
    deliveryTimestamp,
    secret: IDP_WEBHOOK_SECRETS
  });
  if (!verified.ok) {
    console.warn('IDP Webhook: Invalid signature');
    return res.status(401).json({ error: 'Invalid or stale webhook', code: verified.code });
  }
  next();
}

// Nylas webhook endpoint with security verification
router.post('/nylas', 
  logWebhookRequest,
  verifyNylasWebhook,
  webhookController.handleWebhook
);

// Specific webhook handlers (optional, for more granular control)
router.post('/nylas/grants', 
  logWebhookRequest,
  verifyNylasWebhook,
  webhookController.handleGrantLifecycle
);

router.post('/nylas/calendar', 
  logWebhookRequest,
  verifyNylasWebhook,
  webhookController.handleCalendarEvents
);

router.post('/nylas/scheduler', 
  logWebhookRequest,
  verifyNylasWebhook,
  webhookController.handleSchedulerEvents
);

/**
 * IDP webhook endpoint
 * Receives team/organization membership change notifications from the Identity Provider
 */
router.post('/idp', verifyIdpSignature, async (req, res) => {
  let receiptClaim;
  try {
    receiptClaim = await claimIdpWebhookEvent(req.body);
    if (receiptClaim.duplicate) {
      return res.json({ received: true, event: req.body.event, eventId: req.body.eventId, duplicate: true });
    }
    if (!receiptClaim.claimed) {
      res.set('Retry-After', '1');
      return res.status(409).json({ error: 'Webhook event is already processing', retryable: true });
    }

    const { event, data, timestamp } = req.body;
    console.log(`📥 IDP Webhook received: ${event}`, { userId: data?.userId, timestamp });

    switch (event) {
      case 'team.member.added':
        console.log(`  Team member added: user=${data.userId}, team=${data.teamId}`);
        // Main backend can handle team updates if needed
        break;

      case 'team.member.removed':
        console.log(`  Team member removed: user=${data.userId}, team=${data.teamId}`);
        console.log('  Claims invalidated:', await applyIdentityClaimsChanged(data));
        break;

      case 'team.member.role_changed':
        console.log(`  Team role changed: user=${data.userId}, ${data.oldRole} -> ${data.newRole}`);
        console.log('  Claims invalidated:', await applyIdentityClaimsChanged(data));
        break;

      case 'organization.member.added':
        console.log(`  Org member added: user=${data.userId}, org=${data.organizationId}`);
        break;

      case 'organization.member.removed':
        console.log('  Organization member removed:', await applyMemberRemoved(data));
        break;

      case 'organization.member.role_changed':
        console.log('  Organization role changed:', await applyIdentityClaimsChanged(data));
        break;

      case 'organization.member.app_access_changed': {
        const result = await applyMemberAppAccessChanged(data);
        console.log('  Organization app access updated:', result);
        break;
      }

      case 'team.manager.changed':
        console.log(`  Team manager changed: team=${data.teamId}, ${data.oldManagerId} -> ${data.newManagerId}`);
        break;

      case 'user.session.invalidate':
        console.log(`  Force logout requested: user=${data.userId}, reason=${data.reason}`);
        // Could invalidate local sessions here if main backend has session store
        break;

      default:
        console.log(`  Unknown IDP event: ${event}`);
    }

    await markIdpWebhookProcessed(receiptClaim);
    res.json({ received: true, event, eventId: req.body.eventId });
  } catch (error) {
    console.error('IDP Webhook processing error:', error);
    if (receiptClaim?.claimed) {
      await markIdpWebhookFailed(receiptClaim, error).catch(markError => {
        console.error('IDP Webhook receipt failure update failed:', markError);
      });
    }
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
