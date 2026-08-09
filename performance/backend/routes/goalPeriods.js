const express = require('express');
const GoalPeriod = require('../models/GoalPeriod');
const OKR = require('../models/OKR');
const { requirePermission } = require('../middleware/rbac');
const { getActor, resolveOrganizationId } = require('../services/goalPermissionService');

const router = express.Router();

async function recordEvent(event) {
  try {
    // Optional until the shared transactional outbox is introduced.
    // eslint-disable-next-line global-require, import/no-unresolved
    const outboxService = require('../services/outboxService');
    if (outboxService && typeof outboxService.recordEvent === 'function') {
      await outboxService.recordEvent(event);
    }
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') {
      console.warn('Goal period event recording failed:', error.message);
    }
  }
}

function periodEvent(req, period, eventType, payload = {}) {
  return recordEvent({
    eventType,
    aggregateType: 'goal_period',
    aggregateId: String(period._id),
    organizationId: period.organizationId,
    actor: getActor(req),
    occurredAt: new Date(),
    payload
  });
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function cancelPeriodCheckInReminders(period) {
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    const { cancelRemindersForTarget } = require('../services/reminderScheduler');
    if (typeof cancelRemindersForTarget !== 'function') return;
    const goals = await OKR.find({
      organizationId: period.organizationId,
      periodId: period._id
    }).select('_id');
    for (let index = 0; index < goals.length; index += 25) {
      const batch = goals.slice(index, index + 25);
      await Promise.all(batch.map((goal) => cancelRemindersForTarget({
        organizationId: period.organizationId,
        targetType: 'goal_check_in',
        targetId: String(goal._id),
        reason: 'goal_period_closed'
      })));
    }
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') {
      console.warn('Goal-period reminder cancellation failed:', error.message);
    }
  }
}

function startOfUtcMonth(year, monthOneBased) {
  return new Date(Date.UTC(year, monthOneBased - 1, 1, 0, 0, 0, 0));
}

function addUtcMonths(date, months) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    1,
    0,
    0,
    0,
    0
  ));
}

// Static routes must remain before /:periodId.
router.get('/current', requirePermission('goal_period:view'), async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'No active organization selected' });
    }
    const now = new Date();
    const period = await GoalPeriod.findOne({
      organizationId,
      startDate: { $lte: now },
      endDate: { $gte: now },
      status: { $in: ['open', 'upcoming'] }
    }).sort({ startDate: 1 });
    return res.json({ success: true, data: period });
  } catch (error) {
    console.error('Get current goal period error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch current goal period' });
  }
});

router.get('/upcoming', requirePermission('goal_period:view'), async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'No active organization selected' });
    }
    const periods = await GoalPeriod.find({
      organizationId,
      endDate: { $gte: new Date() },
      status: { $in: ['draft', 'upcoming', 'open'] }
    }).sort({ startDate: 1 });
    return res.json({ success: true, data: periods, count: periods.length });
  } catch (error) {
    console.error('Get upcoming goal periods error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch upcoming goal periods' });
  }
});

router.post('/generate-fiscal', requirePermission('goal_period:manage'), async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    const actor = getActor(req);
    const startMonth = Number(req.body?.startMonth || 1);
    const now = new Date();
    const inferredFiscalYear = (now.getUTCMonth() + 1) >= startMonth
      ? now.getUTCFullYear()
      : now.getUTCFullYear() - 1;
    const fiscalYear = req.body?.fiscalYear === undefined
      ? inferredFiscalYear
      : Number(req.body.fiscalYear);
    const years = Math.min(Math.max(Number(req.body?.years) || 2, 1), 2);
    const includeQuarters = req.body?.includeQuarters !== false;

    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'No active organization selected' });
    }
    if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2200) {
      return res.status(400).json({ success: false, error: 'A valid fiscalYear is required' });
    }
    if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
      return res.status(400).json({ success: false, error: 'startMonth must be from 1 to 12' });
    }

    const commonSettings = {
      allowFutureGoalCreation: req.body?.allowFutureGoalCreation !== false,
      requiresManagerApproval: req.body?.requiresManagerApproval !== false,
      managerAssignedRequiresAcknowledgement: req.body?.managerAssignedRequiresAcknowledgement !== false,
      allowEmployeeChangeRequests: req.body?.allowEmployeeChangeRequests !== false
    };

    const planningLeadDays = Math.min(Math.max(Number(req.body?.planningLeadDays) || 30, 0), 365);
    const planningGraceDays = Math.min(Math.max(Number(req.body?.planningGraceDays) || 7, 0), 90);
    const definitions = [];

    for (let yearOffset = 0; yearOffset < years; yearOffset += 1) {
      const generatedYear = fiscalYear + yearOffset;
      const fiscalStart = startOfUtcMonth(generatedYear, startMonth);
      const fiscalEndBoundary = addUtcMonths(fiscalStart, 12);
      const fiscalStatus = fiscalEndBoundary <= now ? 'closed' : (fiscalStart <= now ? 'open' : 'upcoming');
      definitions.push({
        organizationId,
        name: yearOffset === 0 && req.body?.name ? req.body.name : `Fiscal Year ${generatedYear}`,
        code: yearOffset === 0 && req.body?.code ? req.body.code : `FY${generatedYear}`,
        type: 'fiscal_year',
        fiscalYear: generatedYear,
        fiscalYearStartMonth: startMonth,
        startDate: fiscalStart,
        endDate: new Date(fiscalEndBoundary.getTime() - 1),
        planningStartDate: yearOffset === 0 ? normalizeDate(req.body?.planningStartDate) : null,
        planningEndDate: yearOffset === 0 ? normalizeDate(req.body?.planningEndDate) : null,
        status: yearOffset === 0 && req.body?.status ? req.body.status : fiscalStatus,
        checkInCadence: req.body?.checkInCadence || 'monthly',
        timezone: req.body?.timezone || 'UTC',
        settings: commonSettings,
        createdBy: actor,
        updatedBy: actor
      });

      if (includeQuarters) {
        for (let quarter = 1; quarter <= 4; quarter += 1) {
          const quarterStart = addUtcMonths(fiscalStart, (quarter - 1) * 3);
          const quarterEndBoundary = addUtcMonths(quarterStart, 3);
          const planningStartDate = new Date(quarterStart.getTime() - planningLeadDays * 24 * 60 * 60 * 1000);
          const planningEndDate = new Date(quarterStart.getTime() + planningGraceDays * 24 * 60 * 60 * 1000);
          definitions.push({
            organizationId,
            name: `FY${generatedYear} Q${quarter}`,
            code: `FY${generatedYear}-Q${quarter}`,
            type: 'fiscal_quarter',
            fiscalYear: generatedYear,
            fiscalYearStartMonth: startMonth,
            fiscalQuarter: quarter,
            startDate: quarterStart,
            endDate: new Date(quarterEndBoundary.getTime() - 1),
            planningStartDate,
            planningEndDate,
            status: quarterEndBoundary <= now ? 'closed' : (quarterStart <= now ? 'open' : 'upcoming'),
            checkInCadence: req.body?.quarterCheckInCadence || 'monthly',
            timezone: req.body?.timezone || 'UTC',
            settings: commonSettings,
            createdBy: actor,
            updatedBy: actor
          });
        }
      }
    }

    const existing = await GoalPeriod.find({
      organizationId,
      code: { $in: definitions.map((definition) => definition.code) }
    }).select('code');
    const existingCodes = new Set(existing.map((period) => period.code));
    const missingDefinitions = definitions.filter((definition) => !existingCodes.has(definition.code));
    const created = missingDefinitions.length > 0 ? await GoalPeriod.insertMany(missingDefinitions) : [];
    await Promise.all(created.map((period) => periodEvent(req, period, 'goal_period.created', {
      generatedFiscalSet: true
    })));
    const periods = await GoalPeriod.find({
      organizationId,
      code: { $in: definitions.map((definition) => definition.code) }
    }).sort({ startDate: 1, type: 1 });
    return res.status(created.length > 0 ? 201 : 200).json({
      success: true,
      data: periods,
      count: periods.length,
      created: created.length,
      existing: periods.length - created.length,
      quarterCount: periods.filter((period) => period.type === 'fiscal_quarter').length,
      message: created.length > 0
        ? `Created ${created.length} fiscal goal periods and retained ${periods.length - created.length} existing periods`
        : 'Fiscal goal periods already exist; no duplicates were created'
    });
  } catch (error) {
    console.error('Generate fiscal goal periods error:', error);
    const status = error?.code === 11000 ? 409 : 500;
    return res.status(status).json({ success: false, error: status === 409 ? 'Goal period code already exists' : 'Failed to generate fiscal goal periods' });
  }
});

router.get('/', requirePermission('goal_period:view'), async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'No active organization selected' });
    }
    const query = { organizationId };
    if (req.query.status) query.status = req.query.status;
    if (req.query.type) query.type = req.query.type;
    if (req.query.includePast !== 'true') query.endDate = { $gte: new Date() };
    const periods = await GoalPeriod.find(query).sort({ startDate: 1 });
    return res.json({ success: true, data: periods, count: periods.length });
  } catch (error) {
    console.error('List goal periods error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch goal periods' });
  }
});

router.post('/', requirePermission('goal_period:manage'), async (req, res) => {
  try {
    const organizationId = resolveOrganizationId(req);
    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'No active organization selected' });
    }
    const period = new GoalPeriod({
      name: req.body?.name,
      code: req.body?.code,
      type: req.body?.type || 'custom',
      fiscalYear: req.body?.fiscalYear,
      fiscalYearStartMonth: req.body?.fiscalYearStartMonth,
      fiscalQuarter: req.body?.fiscalQuarter,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      planningStartDate: req.body?.planningStartDate,
      planningEndDate: req.body?.planningEndDate,
      status: req.body?.status || 'draft',
      checkInCadence: req.body?.checkInCadence || 'monthly',
      checkInIntervalDays: req.body?.checkInIntervalDays,
      timezone: req.body?.timezone || 'UTC',
      settings: req.body?.settings || {},
      organizationId,
      createdBy: getActor(req),
      updatedBy: getActor(req)
    });
    await period.save();
    await periodEvent(req, period, 'goal_period.created');
    return res.status(201).json({ success: true, data: period, message: 'Goal period created successfully' });
  } catch (error) {
    console.error('Create goal period error:', error);
    const status = error?.code === 11000 || error?.name === 'ValidationError' ? 400 : 500;
    return res.status(status).json({ success: false, error: error?.code === 11000 ? 'Goal period code already exists' : (error.message || 'Failed to create goal period') });
  }
});

router.get('/:periodId', requirePermission('goal_period:view'), async (req, res) => {
  try {
    const period = await GoalPeriod.findOne({
      _id: req.params.periodId,
      organizationId: resolveOrganizationId(req)
    });
    if (!period) {
      return res.status(404).json({ success: false, error: 'Goal period not found' });
    }
    return res.json({ success: true, data: period });
  } catch (error) {
    return res.status(error?.name === 'CastError' ? 404 : 500).json({ success: false, error: 'Failed to fetch goal period' });
  }
});

router.put('/:periodId', requirePermission('goal_period:manage'), async (req, res) => {
  try {
    const period = await GoalPeriod.findOne({
      _id: req.params.periodId,
      organizationId: resolveOrganizationId(req)
    });
    if (!period) {
      return res.status(404).json({ success: false, error: 'Goal period not found' });
    }
    const allowedFields = [
      'name', 'code', 'type', 'fiscalYear', 'fiscalYearStartMonth', 'fiscalQuarter',
      'startDate', 'endDate', 'planningStartDate', 'planningEndDate', 'status',
      'checkInCadence', 'checkInIntervalDays', 'timezone', 'settings'
    ];
    const changes = {};
    allowedFields.forEach((field) => {
      if (req.body?.[field] !== undefined) {
        period[field] = req.body[field];
        changes[field] = req.body[field];
      }
    });
    period.updatedBy = getActor(req);
    await period.save();
    if (['closed', 'archived'].includes(period.status)) {
      await cancelPeriodCheckInReminders(period);
    }
    await periodEvent(req, period, 'goal_period.updated', { changes });
    return res.json({ success: true, data: period, message: 'Goal period updated successfully' });
  } catch (error) {
    console.error('Update goal period error:', error);
    return res.status(error?.name === 'ValidationError' ? 400 : 500).json({ success: false, error: error.message || 'Failed to update goal period' });
  }
});

router.post('/:periodId/open', requirePermission('goal_period:manage'), async (req, res) => {
  try {
    const period = await GoalPeriod.findOne({
      _id: req.params.periodId,
      organizationId: resolveOrganizationId(req)
    });
    if (!period) {
      return res.status(404).json({ success: false, error: 'Goal period not found' });
    }
    period.status = 'open';
    period.updatedBy = getActor(req);
    await period.save();
    await periodEvent(req, period, 'goal_period.opened');
    return res.json({ success: true, data: period, message: 'Goal period opened' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to open goal period' });
  }
});

router.post('/:periodId/close', requirePermission('goal_period:manage'), async (req, res) => {
  try {
    const period = await GoalPeriod.findOne({
      _id: req.params.periodId,
      organizationId: resolveOrganizationId(req)
    });
    if (!period) {
      return res.status(404).json({ success: false, error: 'Goal period not found' });
    }
    period.status = 'closed';
    period.updatedBy = getActor(req);
    await period.save();
    await cancelPeriodCheckInReminders(period);
    await periodEvent(req, period, 'goal_period.closed');
    return res.json({ success: true, data: period, message: 'Goal period closed' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to close goal period' });
  }
});

module.exports = router;
