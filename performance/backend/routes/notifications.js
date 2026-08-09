const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const NotificationPreference = require('../models/NotificationPreference');
const { requireAuth } = require('../middleware/rbac');
const { defaultPreference } = require('../services/notificationWorker');
const { formatMailAddress } = require('../services/mailClient');
const validator = require('validator');

const router = express.Router();
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const HH_MM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

router.use(requireAuth);

function currentContext(req) {
  const user = req.session?.user || req.user || {};
  const organization = req.currentOrganization
    || user.currentOrganization
    || user.userinfo?.currentOrganization
    || user.userinfo?.current_organization;
  const organizationId = organization?.id
    || organization?._id
    || organization?.organizationId
    || req.session?.currentOrganizationId
    || user.currentOrganizationId
    || (typeof organization === 'string' ? organization : null);
  const userId = user.id || user.sub || user.userinfo?.sub;
  return {
    organizationId: organizationId ? String(organizationId) : '',
    userId: userId ? String(userId) : ''
  };
}

function authenticatedChatRecipient(req) {
  const user = req.session?.user || req.user || {};
  const candidates = [
    user.email,
    user.userinfo?.email,
    user.userinfo?.preferred_username
  ];
  for (const candidate of candidates) {
    try {
      const mailbox = formatMailAddress(candidate);
      if (validator.isEmail(mailbox)) return mailbox;
    } catch (error) {
      // Try the next authenticated identity claim.
    }
  }
  return '';
}

function requireContext(req, res) {
  const context = currentContext(req);
  if (!context.organizationId) {
    res.status(400).json({
      success: false,
      error: 'Select an organization before opening notifications.',
      code: 'ORGANIZATION_CONTEXT_REQUIRED'
    });
    return null;
  }
  if (!context.userId) {
    res.status(401).json({ success: false, error: 'Authenticated user ID is missing.' });
    return null;
  }
  return context;
}

function pageSize(value) {
  const parsed = Number.parseInt(value, 10);
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Number.isFinite(parsed) ? parsed : DEFAULT_PAGE_SIZE));
}

function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(new Date());
    return true;
  } catch (error) {
    return false;
  }
}

router.get('/counts', async (req, res) => {
  try {
    const context = requireContext(req, res);
    if (!context) return;
    const base = { organizationId: context.organizationId, userId: context.userId };
    const [total, unread] = await Promise.all([
      Notification.countDocuments(base),
      Notification.countDocuments({ ...base, readAt: null })
    ]);
    res.json({ success: true, data: { total, unread } });
  } catch (error) {
    console.error('Notification count query failed:', error.message);
    res.status(500).json({ success: false, error: 'Unable to load notification counts.' });
  }
});

router.get('/preferences', async (req, res) => {
  try {
    const context = requireContext(req, res);
    if (!context) return;
    const preference = await NotificationPreference.findOne(context)
      .select('-chat.recipientEmail')
      .lean();
    res.json({ success: true, data: preference || defaultPreference(context.organizationId, context.userId) });
  } catch (error) {
    console.error('Notification preference query failed:', error.message);
    res.status(500).json({ success: false, error: 'Unable to load notification preferences.' });
  }
});

async function updatePreferences(req, res) {
  try {
    const context = requireContext(req, res);
    if (!context) return;
    const body = req.body || {};
    const existingPreference = await NotificationPreference.findOne(context)
      .select('channels.chat eventOverrides')
      .lean();
    const update = { 'channels.inApp': true };
    let chatOptInRequested = false;

    if (body.channels && typeof body.channels.email === 'boolean') {
      update['channels.email'] = body.channels.email;
    }
    if (body.channels?.chat !== undefined) {
      if (typeof body.channels.chat !== 'boolean') {
        return res.status(400).json({ success: false, error: 'channels.chat must be boolean.' });
      }
      update['channels.chat'] = body.channels.chat;
      chatOptInRequested = body.channels.chat;
    }
    if (body.digest) {
      if (body.digest.frequency !== undefined) {
        const frequency = String(body.digest.frequency).toLowerCase();
        if (!['immediate', 'daily', 'weekly', 'off'].includes(frequency)) {
          return res.status(400).json({ success: false, error: 'Unsupported digest frequency.' });
        }
        update['digest.frequency'] = frequency;
      }
      if (body.digest.time !== undefined) {
        if (!HH_MM_PATTERN.test(String(body.digest.time))) {
          return res.status(400).json({ success: false, error: 'Digest time must use HH:mm.' });
        }
        update['digest.time'] = String(body.digest.time);
      }
      if (body.digest.dayOfWeek !== undefined) {
        const day = Number(body.digest.dayOfWeek);
        if (!Number.isInteger(day) || day < 0 || day > 6) {
          return res.status(400).json({ success: false, error: 'Digest dayOfWeek must be 0 to 6.' });
        }
        update['digest.dayOfWeek'] = day;
      }
    }
    if (body.quietHours) {
      if (body.quietHours.enabled !== undefined) {
        if (typeof body.quietHours.enabled !== 'boolean') {
          return res.status(400).json({ success: false, error: 'quietHours.enabled must be boolean.' });
        }
        update['quietHours.enabled'] = body.quietHours.enabled;
      }
      for (const field of ['start', 'end']) {
        if (body.quietHours[field] !== undefined) {
          if (!HH_MM_PATTERN.test(String(body.quietHours[field]))) {
            return res.status(400).json({ success: false, error: `Quiet-hours ${field} must use HH:mm.` });
          }
          update[`quietHours.${field}`] = String(body.quietHours[field]);
        }
      }
    }
    if (body.timezone !== undefined) {
      const timezone = String(body.timezone).trim();
      if (!timezone || timezone.length > 100 || !isValidTimezone(timezone)) {
        return res.status(400).json({ success: false, error: 'Timezone must be a valid IANA timezone.' });
      }
      update.timezone = timezone;
    }
    if (body.eventOverrides !== undefined) {
      if (!Array.isArray(body.eventOverrides) || body.eventOverrides.length > 100) {
        return res.status(400).json({ success: false, error: 'eventOverrides must contain at most 100 entries.' });
      }
      const eventTypes = new Set();
      const overrides = [];
      for (const item of body.eventOverrides) {
        const eventType = String(item?.eventType || '').trim();
        if (!eventType || eventType.length > 160 || eventTypes.has(eventType)) {
          return res.status(400).json({ success: false, error: 'Event override types must be unique and non-empty.' });
        }
        if (item.email !== undefined && typeof item.email !== 'boolean') {
          return res.status(400).json({ success: false, error: 'Event override email values must be boolean.' });
        }
        if (item.chat !== undefined && typeof item.chat !== 'boolean') {
          return res.status(400).json({ success: false, error: 'Event override chat values must be boolean.' });
        }
        eventTypes.add(eventType);
        overrides.push({
          eventType,
          inApp: true,
          email: Boolean(item.email),
          chat: Boolean(item.chat)
        });
        chatOptInRequested = chatOptInRequested || item.chat === true;
      }
      update.eventOverrides = overrides;
    }

    if (chatOptInRequested) {
      const recipientEmail = authenticatedChatRecipient(req);
      if (!recipientEmail) {
        return res.status(400).json({
          success: false,
          error: 'A valid email in your authenticated profile is required to enable chat notifications.',
          code: 'CHAT_IDENTITY_EMAIL_REQUIRED'
        });
      }
      update['chat.recipientEmail'] = recipientEmail;
    }

    const resultingChatEnabled = update['channels.chat'] !== undefined
      ? update['channels.chat']
      : Boolean(existingPreference?.channels?.chat);
    const resultingOverrides = update.eventOverrides !== undefined
      ? update.eventOverrides
      : (existingPreference?.eventOverrides || []);
    const retainChatRecipient = resultingChatEnabled
      || resultingOverrides.some(item => item.chat === true);
    const mutation = {
      $set: update,
      $setOnInsert: { organizationId: context.organizationId, userId: context.userId }
    };
    if (!retainChatRecipient) mutation.$unset = { 'chat.recipientEmail': '' };

    const preference = await NotificationPreference.findOneAndUpdate(
      context,
      mutation,
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    ).select('-chat.recipientEmail');
    res.json({ success: true, data: preference });
  } catch (error) {
    console.error('Notification preference update failed:', error.message);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: 'Notification preferences are invalid.' });
    }
    res.status(500).json({ success: false, error: 'Unable to save notification preferences.' });
  }
}

router.patch('/preferences', updatePreferences);
router.put('/preferences', updatePreferences);

router.patch('/read-all', async (req, res) => {
  try {
    const context = requireContext(req, res);
    if (!context) return;
    const now = new Date();
    const result = await Notification.updateMany(
      { ...context, readAt: null },
      { $set: { readAt: now } }
    );
    res.json({ success: true, data: { updated: result.modifiedCount || 0, readAt: now } });
  } catch (error) {
    console.error('Mark-all-notifications-read failed:', error.message);
    res.status(500).json({ success: false, error: 'Unable to mark notifications as read.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const context = requireContext(req, res);
    if (!context) return;
    const limit = pageSize(req.query.limit);
    const filter = { organizationId: context.organizationId, userId: context.userId };
    if (String(req.query.unread || '').toLowerCase() === 'true') filter.readAt = null;
    if (req.query.category) filter.category = String(req.query.category).slice(0, 80);
    if (req.query.before) {
      if (!mongoose.isValidObjectId(req.query.before)) {
        return res.status(400).json({ success: false, error: 'Invalid notification cursor.' });
      }
      filter._id = { $lt: req.query.before };
    }

    const items = await Notification.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    res.json({
      success: true,
      data: {
        items,
        nextCursor: hasMore && items.length ? String(items[items.length - 1]._id) : null
      },
      count: items.length
    });
  } catch (error) {
    console.error('Notification query failed:', error.message);
    res.status(500).json({ success: false, error: 'Unable to load notifications.' });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const context = requireContext(req, res);
    if (!context) return;
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid notification ID.' });
    }
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, ...context },
      { $set: { readAt: new Date() } },
      { new: true }
    );
    if (!notification) return res.status(404).json({ success: false, error: 'Notification not found.' });
    res.json({ success: true, data: notification });
  } catch (error) {
    console.error('Mark-notification-read failed:', error.message);
    res.status(500).json({ success: false, error: 'Unable to mark notification as read.' });
  }
});

module.exports = router;
