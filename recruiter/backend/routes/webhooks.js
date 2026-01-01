const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { verifyNylasWebhook, logWebhookRequest } = require('../middleware/webhookVerification');
const webhookController = require('../controllers/webhookController');

// IDP Webhook Secret
const IDP_WEBHOOK_SECRET = process.env.IDP_WEBHOOK_SECRET || 'your-webhook-secret-key';

/**
 * Verify IDP webhook signature
 */
function verifyIdpSignature(req, res, next) {
  const signature = req.headers['x-idp-signature'];
  if (!signature) {
    console.warn('IDP Webhook: Missing signature');
    return res.status(401).json({ error: 'Missing signature' });
  }
  
  const expected = crypto.createHmac('sha256', IDP_WEBHOOK_SECRET)
    .update(JSON.stringify(req.body)).digest('hex');
  
  if (signature !== expected) {
    console.warn('IDP Webhook: Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
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
  try {
    const { event, data, timestamp } = req.body;
    console.log(`📥 IDP Webhook received: ${event}`, { userId: data?.userId, timestamp });

    switch (event) {
      case 'team.member.added':
        console.log(`  Team member added: user=${data.userId}, team=${data.teamId}`);
        // Main backend can handle team updates if needed
        break;

      case 'team.member.removed':
        console.log(`  Team member removed: user=${data.userId}, team=${data.teamId}`);
        break;

      case 'team.member.role_changed':
        console.log(`  Team role changed: user=${data.userId}, ${data.oldRole} -> ${data.newRole}`);
        break;

      case 'organization.member.added':
        console.log(`  Org member added: user=${data.userId}, org=${data.organizationId}`);
        break;

      case 'organization.member.removed':
        console.log(`  Org member removed: user=${data.userId}, org=${data.organizationId}`);
        break;

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

    res.json({ received: true, event });
  } catch (error) {
    console.error('IDP Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router; 