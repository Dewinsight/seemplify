const express = require('express');
const mongoose = require('mongoose');
const PerformanceCheckIn = require('../models/PerformanceCheckIn');
const OKR = require('../models/OKR');
const Appraisal = require('../models/Appraisal');
const { requireAuth } = require('../middleware/rbac');
const {
  requireOrganization,
  tenantFilter,
  getActorId,
  canAccessEmployee,
  assertResourceTenant
} = require('../services/tenantPolicy');

const router = express.Router();
router.use(requireAuth, requireOrganization);

function cleanList(value, limit = 20) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit);
}

function nextDueDate(from, cadence) {
  const due = new Date(from);
  due.setUTCDate(due.getUTCDate() + (cadence === 'fortnightly' ? 14 : 7));
  return due;
}

async function recordEvent(event) {
  try {
    const outbox = require('../services/outboxService');
    if (typeof outbox.recordEvent === 'function') await outbox.recordEvent(event);
  } catch (error) {
    console.warn('Check-in event was not recorded:', error.message);
  }
}

async function resolveEmployeeManager(req, employeeId) {
  const appraisal = await Appraisal.findOne({
    organizationId: req.organizationId,
    'employee.userId': String(employeeId),
    'manager.userId': { $exists: true, $ne: '' }
  }).select('manager').sort({ createdAt: -1 }).lean();
  if (appraisal?.manager?.userId) return appraisal.manager;

  const user = req.session?.user || {};
  const directManager = user.manager || user.reportsTo || user.userinfo?.manager;
  if (directManager?.id || directManager?.userId) {
    return {
      userId: directManager.id || directManager.userId,
      name: directManager.name,
      email: directManager.email
    };
  }
  const teams = user.idpTeams || user.teams || user.userinfo?.teams || [];
  const team = teams.find((candidate) =>
    candidate.managerId && (!candidate.organizationId || String(candidate.organizationId) === req.organizationId)
  );
  return team?.managerId ? {
    userId: team.managerId,
    name: team.managerName,
    email: team.managerEmail
  } : null;
}

router.get('/', async (req, res) => {
  try {
    const employeeId = String(req.query.employeeId || getActorId(req));
    if (!canAccessEmployee(req, employeeId)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const query = tenantFilter(req, { employeeId });
    if (req.query.status) query.status = req.query.status;
    const data = await PerformanceCheckIn.find(query).sort({ periodStart: -1 }).limit(100).lean();
    const visible = data.filter((item) =>
      item.visibility !== 'employee_only' || item.employeeId === getActorId(req) || req.userRole === 'hr_admin'
    );
    res.json({ success: true, data: visible, count: visible.length });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to fetch check-ins' });
  }
});

router.post('/', async (req, res) => {
  try {
    const actorId = getActorId(req);
    const employeeId = String(req.body.employeeId || actorId);
    if (!canAccessEmployee(req, employeeId)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    const periodStart = new Date(req.body.periodStart);
    const periodEnd = new Date(req.body.periodEnd);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd < periodStart) {
      return res.status(400).json({ success: false, error: 'A valid check-in period is required' });
    }
    const goalIds = cleanList(req.body.linkedGoalIds, 30).filter(mongoose.isValidObjectId);
    const matchingGoals = goalIds.length
      ? await OKR.countDocuments(tenantFilter(req, { _id: { $in: goalIds }, ownerId: employeeId }))
      : 0;
    if (matchingGoals !== goalIds.length) {
      return res.status(400).json({ success: false, error: 'Every linked goal must belong to this employee and organization' });
    }
    const cadence = ['weekly', 'fortnightly', 'ad_hoc'].includes(req.body.cadence) ? req.body.cadence : 'weekly';
    const item = await PerformanceCheckIn.create({
      organizationId: req.organizationId,
      employeeId,
      authorId: actorId,
      cadence,
      periodStart,
      periodEnd,
      wins: cleanList(req.body.wins),
      priorities: cleanList(req.body.priorities),
      blockers: cleanList(req.body.blockers),
      supportNeeded: cleanList(req.body.supportNeeded),
      pulse: req.body.pulse,
      linkedGoalIds: goalIds,
      visibility: req.body.visibility === 'employee_only' ? 'employee_only' : 'employee_manager',
      nextDueAt: cadence === 'ad_hoc' ? null : nextDueDate(periodEnd, cadence),
      audit: [{ action: 'created', actorId }]
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    const status = error.code === 11000 ? 409 : error.statusCode || 500;
    res.status(status).json({ success: false, error: status === 409 ? 'A check-in already exists for this period' : error.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const item = assertResourceTenant(req, await PerformanceCheckIn.findById(req.params.id));
    const actorId = getActorId(req);
    const isEmployee = item.employeeId === actorId;
    const isManager = (req.directReports || []).map(String).includes(item.employeeId) || req.userRole === 'hr_admin';
    if (!isEmployee && !isManager) return res.status(403).json({ success: false, error: 'Access denied' });

    if (isManager && !isEmployee) {
      const response = String(req.body.managerResponse || '').trim();
      if (!response) return res.status(400).json({ success: false, error: 'Manager response is required' });
      item.managerResponse = { text: response, authorId: actorId, respondedAt: new Date() };
      item.audit.push({ action: 'manager_responded', actorId });
    } else {
      if (item.status === 'submitted') return res.status(409).json({ success: false, error: 'Submitted check-ins cannot be edited' });
      ['wins', 'priorities', 'blockers', 'supportNeeded'].forEach((field) => {
        if (req.body[field] !== undefined) item[field] = cleanList(req.body[field]);
      });
      if (req.body.pulse !== undefined) item.pulse = req.body.pulse;
      item.audit.push({ action: 'updated', actorId });
    }
    await item.save();
    if (isManager && !isEmployee) {
      await recordEvent({
        organizationId: item.organizationId,
        type: 'performance_check_in.manager_responded',
        aggregateType: 'PerformanceCheckIn',
        aggregateId: String(item._id),
        actorId,
        recipients: [{ userId: item.employeeId }],
        data: { deepLink: `/check-ins?id=${item._id}` }
      });
    }
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to update check-in' });
  }
});

router.post('/:id/submit', async (req, res) => {
  try {
    const item = assertResourceTenant(req, await PerformanceCheckIn.findById(req.params.id));
    const actorId = getActorId(req);
    if (item.employeeId !== actorId) return res.status(403).json({ success: false, error: 'Only the employee can submit this check-in' });
    if (item.status === 'submitted') return res.json({ success: true, data: item });
    if (![...(item.wins || []), ...(item.priorities || []), ...(item.blockers || []), ...(item.supportNeeded || [])].length) {
      return res.status(400).json({ success: false, error: 'Add at least one update before submitting' });
    }
    item.status = 'submitted';
    item.submittedAt = new Date();
    item.audit.push({ action: 'submitted', actorId });
    await item.save();
    const manager = await resolveEmployeeManager(req, item.employeeId);
    await recordEvent({
      organizationId: item.organizationId,
      type: 'performance_check_in.submitted',
      aggregateType: 'PerformanceCheckIn',
      aggregateId: String(item._id),
      actorId,
      recipients: manager?.userId ? [{
        userId: manager.userId,
        name: manager.name,
        email: manager.email,
        channels: manager.email ? ['in_app', 'email'] : ['in_app']
      }] : [],
      data: { employeeId: item.employeeId, deepLink: `/check-ins?id=${item._id}` }
    });
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Failed to submit check-in' });
  }
});

module.exports = router;
