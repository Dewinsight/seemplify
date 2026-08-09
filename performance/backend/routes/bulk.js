const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');

const Appraisal = require('../models/Appraisal');
const AppraisalCycle = require('../models/AppraisalCycle');
const OKR = require('../models/OKR');
const { requireHRAdmin } = require('../middleware/rbac');
const { requireOrganizationFeature } = require('../services/organizationFeatureService');
const { recordEvent } = require('../services/outboxService');
const { cancelRemindersForTarget } = require('../services/reminderScheduler');

const router = express.Router();
const canonicalAppraisalsEnabled = requireOrganizationFeature('canonicalAppraisals');

const ALLOWED_GOAL_STATUSES = new Set(['closed', 'cancelled']);
const MAX_BULK_ITEMS = 1000;

function organizationId(req) {
  return String(
    req.currentOrganization?.id
      || req.currentOrganization?._id
      || req.session?.currentOrganizationId
      || ''
  ).trim();
}

function requireOrganization(req, res) {
  const id = organizationId(req);
  if (!id) {
    res.status(403).json({
      success: false,
      error: 'Select an organization before performing a bulk operation.'
    });
    return null;
  }
  return id;
}

function validIds(values) {
  return Array.isArray(values)
    && values.length > 0
    && values.length <= MAX_BULK_ITEMS
    && values.every((value) => mongoose.isValidObjectId(value));
}

function actor(req) {
  const user = req.session?.user || {};
  return {
    userId: String(user.id || user.sub || user._id || '').trim(),
    name: user.name || user.displayName || user.email || 'HR administrator',
    email: user.email
  };
}

async function cancelGoalReminders(orgId, goalId, reason) {
  const targetTypes = [
    'goal_submission',
    'goal_assignment',
    'goal_approval',
    'goal_changes',
    'goal_change_request',
    'goal_check_in'
  ];
  await Promise.all(targetTypes.map((targetType) => cancelRemindersForTarget({
    organizationId: orgId,
    targetType,
    targetId: String(goalId),
    reason
  })));
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  // Prevent spreadsheet formula execution when an exported CSV is opened.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(rows, columns) {
  return [
    columns.map((column) => csvCell(column.label)).join(','),
    ...rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(','))
  ].join('\r\n');
}

function sendCsv(res, filename, rows, columns) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(`\uFEFF${csv(rows, columns)}`);
}

/**
 * Legacy bulk writers are intentionally unavailable after the canonical goal
 * and appraisal cutover. Their replacements preserve version history,
 * approvals, acknowledgement and immutable appraisal snapshots.
 */
router.post('/okrs/import', requireHRAdmin, (req, res) => res.status(410).json({
  success: false,
  error: 'The legacy goal importer is retired. Use POST /api/okrs/bulk-assign with a stable idempotency key.'
}));

router.post('/reviews/create', requireHRAdmin, (req, res) => res.status(410).json({
  success: false,
  error: 'The legacy review creator is retired. Launch the canonical appraisal cycle with POST /api/appraisals/cycles/:cycleId/launch.'
}));

/**
 * Retained as a compatibility endpoint for HR clean-up jobs. It is tenant
 * scoped, audit-attributed and limited to terminal states so it cannot bypass
 * the normal approval/acknowledgement workflow.
 */
router.put('/okrs/status', requireHRAdmin, async (req, res) => {
  try {
    const orgId = requireOrganization(req, res);
    if (!orgId) return;
    const { okrIds, status } = req.body || {};
    if (!validIds(okrIds) || !ALLOWED_GOAL_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        error: `Provide 1-${MAX_BULK_ITEMS} valid goal IDs and a status of closed or cancelled.`
      });
    }

    const now = new Date();
    const update = {
      $set: {
        status,
        'lifecycle.state': status,
        ...(status === 'closed'
          ? { 'lifecycle.closedAt': now }
          : { 'lifecycle.cancelledAt': now }),
        updatedBy: actor(req)
      }
    };
    const result = await OKR.updateMany(
      { _id: { $in: okrIds }, organizationId: orgId },
      update,
      { runValidators: true }
    );

    await Promise.all(okrIds.map((goalId) => (
      cancelGoalReminders(orgId, goalId, `Goal ${status} by HR`)
    )));

    return res.json({
      success: true,
      data: { matched: result.matchedCount, modified: result.modifiedCount },
      message: `Updated ${result.modifiedCount} goals.`
    });
  } catch (error) {
    console.error('Bulk goal status update failed:', error);
    return res.status(500).json({ success: false, error: 'Bulk goal update failed.' });
  }
});

/**
 * Queue canonical appraisal reminders through the durable outbox. The route
 * reports queued work, never claims that an email was delivered synchronously.
 */
router.post('/reviews/remind', requireHRAdmin, canonicalAppraisalsEnabled, async (req, res) => {
  try {
    const orgId = requireOrganization(req, res);
    if (!orgId) return;
    const { cycleId, reminderType } = req.body || {};
    if (!mongoose.isValidObjectId(cycleId)) {
      return res.status(400).json({ success: false, error: 'A valid appraisal cycle ID is required.' });
    }
    if (!['self_review', 'manager_review'].includes(reminderType)) {
      return res.status(400).json({ success: false, error: 'reminderType must be self_review or manager_review.' });
    }
    const idempotencyKey = String(req.headers['idempotency-key'] || req.body?.idempotencyKey || '').trim();
    if (!idempotencyKey || idempotencyKey.length > 128) {
      return res.status(400).json({ success: false, error: 'A stable Idempotency-Key of at most 128 characters is required.' });
    }

    const cycle = await AppraisalCycle.findOne({ _id: cycleId, organizationId: orgId }).lean();
    if (!cycle) return res.status(404).json({ success: false, error: 'Appraisal cycle not found.' });

    const selfReminder = reminderType === 'self_review';
    const statuses = selfReminder
      ? ['self_assessment_pending', 'self_assessment_in_progress']
      : ['self_assessment_submitted', 'manager_review_pending', 'manager_review_in_progress'];
    const appraisals = await Appraisal.find({
      organizationId: orgId,
      cycleId,
      status: { $in: statuses }
    }).select('_id employee manager deadlines').lean();

    let queued = 0;
    const errors = [];
    for (let index = 0; index < appraisals.length; index += 20) {
      await Promise.all(appraisals.slice(index, index + 20).map(async (appraisal) => {
        const recipient = selfReminder ? appraisal.employee : appraisal.manager;
        if (!recipient?.userId) {
          errors.push({ appraisalId: String(appraisal._id), error: 'Recipient identity is missing.' });
          return;
        }
        const eventType = selfReminder
          ? 'appraisal.self_assessment_due'
          : 'appraisal.manager_review_due';
        const dueAt = selfReminder
          ? appraisal.deadlines?.selfAssessmentDue
          : appraisal.deadlines?.managerReviewDue;
        const eventId = `manual-reminder:${orgId}:${cycleId}:${reminderType}:${appraisal._id}:${crypto
          .createHash('sha256')
          .update(idempotencyKey)
          .digest('hex')}`;
        try {
          await recordEvent({
            eventId,
            eventType,
            aggregateType: 'appraisal',
            aggregateId: String(appraisal._id),
            organizationId: orgId,
            actor: actor(req),
            recipients: [recipient],
            payload: {
              dueAt,
              deepLink: `/appraisals/${appraisal._id}`,
              manualReminder: true
            }
          });
          queued += 1;
        } catch (error) {
          errors.push({ appraisalId: String(appraisal._id), error: error.message });
        }
      }));
    }

    return res.status(errors.length && !queued ? 500 : 202).json({
      success: errors.length === 0,
      data: { queued, totalFound: appraisals.length, failed: errors.length, errors },
      message: `Queued ${queued} reminder${queued === 1 ? '' : 's'} for durable delivery.`
    });
  } catch (error) {
    console.error('Bulk appraisal reminder failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to queue appraisal reminders.' });
  }
});

/**
 * Historical delete compatibility now performs a recoverable cancellation.
 */
router.delete('/okrs', requireHRAdmin, async (req, res) => {
  req.body = { ...(req.body || {}), status: 'cancelled' };
  // Express does not provide safe internal re-dispatch, so keep this endpoint
  // explicit and tenant scoped.
  try {
    const orgId = requireOrganization(req, res);
    if (!orgId) return;
    const { okrIds } = req.body;
    if (!validIds(okrIds)) {
      return res.status(400).json({ success: false, error: `Provide 1-${MAX_BULK_ITEMS} valid goal IDs.` });
    }
    const now = new Date();
    const result = await OKR.updateMany(
      { _id: { $in: okrIds }, organizationId: orgId },
      {
        $set: {
          status: 'cancelled',
          'lifecycle.state': 'cancelled',
          'lifecycle.cancelledAt': now,
          updatedBy: actor(req)
        }
      },
      { runValidators: true }
    );
    await Promise.all(okrIds.map((goalId) => (
      cancelGoalReminders(orgId, goalId, 'Goal cancelled by HR')
    )));
    return res.json({
      success: true,
      data: { cancelled: result.modifiedCount, matched: result.matchedCount },
      message: `Cancelled ${result.modifiedCount} goals. Historical records were retained.`
    });
  } catch (error) {
    console.error('Bulk goal cancellation failed:', error);
    return res.status(500).json({ success: false, error: 'Bulk goal cancellation failed.' });
  }
});

router.get('/export/okrs', requireHRAdmin, async (req, res) => {
  try {
    const orgId = requireOrganization(req, res);
    if (!orgId) return;
    const query = { organizationId: orgId };
    if (req.query.period) query.period = req.query.period;
    if (req.query.status) query.status = req.query.status;
    const goals = await OKR.find(query).sort({ createdAt: -1 }).lean();
    const rows = goals.map((goal) => ({
      id: goal._id,
      type: goal.type,
      ownerId: goal.ownerId,
      period: goal.period,
      status: goal.status,
      acknowledgement: goal.assignment?.acknowledgementStatus || 'not_required',
      origin: goal.creationSource,
      title: goal.title || goal.objectives?.[0]?.title || '',
      progress: goal.scoring?.progress ?? '',
      health: goal.health || 'not_set',
      createdAt: goal.createdAt
    }));
    if (req.query.format === 'csv') {
      return sendCsv(res, 'goals-export.csv', rows, [
        { label: 'ID', value: (row) => row.id },
        { label: 'Type', value: (row) => row.type },
        { label: 'Owner', value: (row) => row.ownerId },
        { label: 'Period', value: (row) => row.period },
        { label: 'Status', value: (row) => row.status },
        { label: 'Acknowledgement', value: (row) => row.acknowledgement },
        { label: 'Origin', value: (row) => row.origin },
        { label: 'Title', value: (row) => row.title },
        { label: 'Progress', value: (row) => row.progress },
        { label: 'Health', value: (row) => row.health },
        { label: 'Created', value: (row) => row.createdAt }
      ]);
    }
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    console.error('Goal export failed:', error);
    return res.status(500).json({ success: false, error: 'Goal export failed.' });
  }
});

router.get('/export/reviews', requireHRAdmin, canonicalAppraisalsEnabled, async (req, res) => {
  try {
    const orgId = requireOrganization(req, res);
    if (!orgId) return;
    const query = { organizationId: orgId };
    if (req.query.cycleId) {
      if (!mongoose.isValidObjectId(req.query.cycleId)) {
        return res.status(400).json({ success: false, error: 'Invalid appraisal cycle ID.' });
      }
      query.cycleId = req.query.cycleId;
    }
    if (req.query.status) query.status = req.query.status;
    const appraisals = await Appraisal.find(query)
      .populate('cycleId', 'name title')
      .sort({ createdAt: -1 })
      .lean();
    const rows = appraisals.map((appraisal) => ({
      id: appraisal._id,
      cycle: appraisal.cycleId?.name || appraisal.cycleId?.title || '',
      employeeId: appraisal.employee?.userId,
      employee: appraisal.employee?.name,
      managerId: appraisal.manager?.userId,
      manager: appraisal.manager?.name,
      status: appraisal.status,
      selfRating: appraisal.selfAssessment?.overallSelfRating ?? '',
      managerRating: appraisal.managerReview?.overallManagerRating ?? '',
      calibratedRating: appraisal.calibration?.calibratedRating ?? '',
      finalRating: appraisal.finalRating?.overall ?? '',
      acknowledgedAt: appraisal.discussion?.employeeAcknowledgedAt || ''
    }));
    if (req.query.format === 'csv') {
      return sendCsv(res, 'appraisals-export.csv', rows, [
        { label: 'ID', value: (row) => row.id },
        { label: 'Cycle', value: (row) => row.cycle },
        { label: 'Employee ID', value: (row) => row.employeeId },
        { label: 'Employee', value: (row) => row.employee },
        { label: 'Manager ID', value: (row) => row.managerId },
        { label: 'Manager', value: (row) => row.manager },
        { label: 'Status', value: (row) => row.status },
        { label: 'Self rating', value: (row) => row.selfRating },
        { label: 'Manager rating', value: (row) => row.managerRating },
        { label: 'Calibrated rating', value: (row) => row.calibratedRating },
        { label: 'Final rating', value: (row) => row.finalRating },
        { label: 'Acknowledged', value: (row) => row.acknowledgedAt }
      ]);
    }
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    console.error('Appraisal export failed:', error);
    return res.status(500).json({ success: false, error: 'Appraisal export failed.' });
  }
});

module.exports = router;
