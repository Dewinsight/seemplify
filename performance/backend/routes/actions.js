const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { requireAuth } = require('../middleware/rbac');
const { cancelRemindersForTarget } = require('../services/reminderScheduler');

const router = express.Router();
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

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

function requireContext(req, res) {
  const context = currentContext(req);
  if (!context.organizationId) {
    res.status(400).json({
      success: false,
      error: 'Select an organization before opening the Action Centre.',
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

async function wakeExpiredSnoozes(context, now) {
  await Notification.updateMany(
    {
      organizationId: context.organizationId,
      userId: context.userId,
      isAction: true,
      actionStatus: 'snoozed',
      snoozedUntil: { $lte: now }
    },
    {
      $set: { actionStatus: 'open' },
      $unset: { snoozedUntil: '' }
    }
  );
}

router.get('/counts', async (req, res) => {
  try {
    const context = requireContext(req, res);
    if (!context) return;
    const now = new Date();
    const dueSoon = new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000));
    await wakeExpiredSnoozes(context, now);

    const base = {
      organizationId: context.organizationId,
      userId: context.userId,
      isAction: true
    };
    const [open, unread, overdue, dueSoonCount, snoozed] = await Promise.all([
      Notification.countDocuments({ ...base, actionStatus: 'open' }),
      Notification.countDocuments({ ...base, actionStatus: 'open', readAt: null }),
      Notification.countDocuments({ ...base, actionStatus: 'open', dueAt: { $lt: now } }),
      Notification.countDocuments({
        ...base,
        actionStatus: 'open',
        dueAt: { $gte: now, $lte: dueSoon }
      }),
      Notification.countDocuments({ ...base, actionStatus: 'snoozed', snoozedUntil: { $gt: now } })
    ]);

    res.json({
      success: true,
      data: { open, unread, overdue, dueSoon: dueSoonCount, snoozed }
    });
  } catch (error) {
    console.error('Action count query failed:', error.message);
    res.status(500).json({ success: false, error: 'Unable to load Action Centre counts.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const context = requireContext(req, res);
    if (!context) return;
    const now = new Date();
    await wakeExpiredSnoozes(context, now);

    const limit = pageSize(req.query.limit);
    const filter = {
      organizationId: context.organizationId,
      userId: context.userId,
      isAction: true
    };
    const status = String(req.query.status || 'open').toLowerCase();
    if (status === 'all') {
      // No status predicate.
    } else if (['open', 'snoozed', 'completed', 'dismissed'].includes(status)) {
      filter.actionStatus = status;
      if (status === 'snoozed') filter.snoozedUntil = { $gt: now };
    } else {
      return res.status(400).json({ success: false, error: 'Unsupported action status.' });
    }
    if (req.query.category) filter.category = String(req.query.category).slice(0, 80);
    if (req.query.priority) {
      const priority = String(req.query.priority).toLowerCase();
      if (!['low', 'normal', 'high', 'urgent'].includes(priority)) {
        return res.status(400).json({ success: false, error: 'Unsupported action priority.' });
      }
      filter.priority = priority;
    }
    if (req.query.before) {
      if (!mongoose.isValidObjectId(req.query.before)) {
        return res.status(400).json({ success: false, error: 'Invalid action cursor.' });
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
    console.error('Action Centre query failed:', error.message);
    res.status(500).json({ success: false, error: 'Unable to load Action Centre items.' });
  }
});

async function scopedAction(req, res, update, allowedStatuses = null) {
  const context = requireContext(req, res);
  if (!context) return null;
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ success: false, error: 'Invalid action ID.' });
    return null;
  }
  const scope = {
    _id: req.params.id,
    organizationId: context.organizationId,
    userId: context.userId,
    isAction: true
  };
  const action = await Notification.findOneAndUpdate(
    {
      ...scope,
      ...(allowedStatuses ? { actionStatus: { $in: allowedStatuses } } : {})
    },
    update,
    { new: true, runValidators: true }
  );
  if (!action) {
    if (allowedStatuses && await Notification.exists(scope)) {
      res.status(409).json({
        success: false,
        error: 'This action is already closed and cannot make that transition.',
        code: 'ACTION_ALREADY_CLOSED'
      });
      return null;
    }
    res.status(404).json({ success: false, error: 'Action not found.' });
    return null;
  }
  return { action, context };
}

router.patch('/:id/snooze', async (req, res) => {
  try {
    const until = new Date(req.body?.until);
    const now = new Date();
    const latestAllowed = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000));
    if (Number.isNaN(until.getTime()) || until <= now || until > latestAllowed) {
      return res.status(400).json({
        success: false,
        error: 'Snooze until must be a future date within one year.'
      });
    }
    const result = await scopedAction(req, res, {
      $set: {
        actionStatus: 'snoozed',
        snoozedUntil: until,
        readAt: now
      },
      $unset: { completedAt: '', dismissedAt: '' }
    }, ['open', 'snoozed']);
    if (!result) return;
    res.json({ success: true, data: result.action });
  } catch (error) {
    console.error('Action snooze failed:', error.message);
    res.status(500).json({ success: false, error: 'Unable to snooze this action.' });
  }
});

router.patch('/:id/dismiss', async (req, res) => {
  try {
    const now = new Date();
    const result = await scopedAction(req, res, {
      $set: { actionStatus: 'dismissed', dismissedAt: now, readAt: now },
      $unset: { snoozedUntil: '', completedAt: '' }
    }, ['open', 'snoozed', 'dismissed']);
    if (!result) return;
    res.json({ success: true, data: result.action });
  } catch (error) {
    console.error('Action dismissal failed:', error.message);
    res.status(500).json({ success: false, error: 'Unable to dismiss this action.' });
  }
});

router.patch('/:id/complete', async (req, res) => {
  try {
    const now = new Date();
    const result = await scopedAction(req, res, {
      $set: { actionStatus: 'completed', completedAt: now, readAt: now },
      $unset: { snoozedUntil: '', dismissedAt: '' }
    }, ['open', 'snoozed', 'completed']);
    if (!result) return;

    let remindersCancelled = 0;
    if (result.action.target?.type && result.action.target?.id) {
      const cancellation = await cancelRemindersForTarget({
        organizationId: result.context.organizationId,
        targetType: result.action.target.type,
        targetId: result.action.target.id,
        userId: result.context.userId,
        reason: 'user_completed_action'
      });
      remindersCancelled = cancellation.modifiedCount || 0;
    }
    res.json({ success: true, data: result.action, meta: { remindersCancelled } });
  } catch (error) {
    console.error('Action completion failed:', error.message);
    res.status(500).json({ success: false, error: 'Unable to complete this action.' });
  }
});

module.exports = router;
