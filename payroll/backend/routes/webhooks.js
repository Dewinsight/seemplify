'use strict';

const express = require('express');
const sessionStore = require('../services/sessionStore');
const PayrollProfile = require('../models/PayrollProfile');
const { verifyIdpWebhook } = require('../services/idpWebhookSecurity');
const {
  claimIdpWebhookEvent,
  markIdpWebhookProcessed,
  markIdpWebhookFailed,
} = require('../services/idpWebhookReceiptService');

const router = express.Router();

function verifyIdpSignature(req, res, next) {
  const result = verifyIdpWebhook({
    payload: req.body,
    rawBody: req.rawBody,
    eventHeader: req.headers['x-idp-event'],
    deliveryTimestamp: req.headers['x-idp-delivery-timestamp'],
    signature: req.headers['x-idp-signature-v2'],
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, code: result.code });
  }
  return next();
}

function stableSubject(data = {}) {
  return String(data.subject || data.userId || '').trim();
}

router.post('/idp', verifyIdpSignature, async (req, res) => {
  let receiptClaim;
  const { event, data: payloadData = {}, timestamp } = req.body;
  const userId = stableSubject(payloadData);
  const data = { ...payloadData, userId };

  console.log(`Received IDP webhook: ${event}`, {
    userId,
    teamId: data.teamId,
    action: data.action,
    timestamp,
  });

  try {
    receiptClaim = await claimIdpWebhookEvent(req.body);
    if (receiptClaim.duplicate) {
      return res.status(200).json({ received: true, event, eventId: req.body.eventId, duplicate: true });
    }
    if (!receiptClaim.claimed) {
      res.set('Retry-After', '1');
      return res.status(409).json({ error: 'Webhook event is already processing', retryable: true });
    }

    switch (event) {
      case 'team.member.removed':
        await sessionStore.invalidateUserSessions(userId);
        await PayrollProfile.findOneAndUpdate(
          { userId },
          { $set: {
            'employeeInfo.teamId': null,
            'employeeInfo.teamName': null,
            'employeeInfo.managerId': null,
            'employeeInfo.managerName': null,
            'employeeInfo.lastSyncedAt': new Date(),
          } },
        );
        break;

      case 'team.member.added':
        // Delayed grant events must never undo a newer removal. Force a fresh
        // authoritative IdP session instead of applying claims/profile data
        // from the webhook payload.
        await sessionStore.invalidateUserSessions(userId);
        break;

      case 'team.member.role_changed':
        await sessionStore.invalidateUserSessions(userId);
        break;

      case 'team.manager.changed':
        if (data.oldManagerId) await sessionStore.invalidateUserSessions(data.oldManagerId);
        if (data.newManagerId) await sessionStore.invalidateUserSessions(data.newManagerId);
        break;

      case 'organization.member.removed':
      case 'organization.member.role_changed':
      case 'organization.member.app_access_changed':
      case 'organization.member.app_access_updated':
        await sessionStore.invalidateUserSessions(userId);
        break;

      case 'organization.member.added':
        await sessionStore.invalidateUserSessions(userId);
        break;

      case 'user.session.invalidate':
        await sessionStore.invalidateUserSessions(userId);
        break;

      default:
        // Authenticated deployment probes and future event types are no-ops.
        console.log(`Unknown IDP event: ${event}`);
    }

    await markIdpWebhookProcessed(receiptClaim);
    return res.status(200).json({ received: true, event, eventId: req.body.eventId });
  } catch (error) {
    console.error('Webhook processing error:', error);
    if (receiptClaim?.claimed) {
      await markIdpWebhookFailed(receiptClaim, error).catch((receiptError) => {
        console.error('Webhook receipt failure update failed:', receiptError);
      });
    }
    return res.status(500).json({ error: 'Processing failed' });
  }
});

module.exports = router;
