'use strict';
const express = require('express');
const mongoose = require('mongoose');
const Appraisal = require('../models/Appraisal');
const service = require('../services/appraisalLifecycleService');
const { resolveAppraisalAccessScope } = require('../services/appraisalAccessService');
module.exports = ({ canManageAppraisal, tenantAppraisalIdFilter, resolveOrganizationId, syncCycleProgress }) => {
  const router = express.Router();
  const wrap = action => async (req, res) => { try { await action(req, res); } catch (error) {
    const status = error.name === 'VersionError' ? 409 : Number(error.statusCode) || 500;
    res.status(status).json({ success: false, error: status === 409 && error.name === 'VersionError' ? 'This appraisal changed. Refresh and try again.' : status === 500 ? 'The appraisal could not be updated. Please retry.' : error.message });
  } };
  router.get('/removed', wrap(async (req, res) => {
    const scope = await resolveAppraisalAccessScope(req);
    if (!scope.canManageAppraisals) return res.status(403).json({ error: 'Only reviewers, HR and organization administrators can manage removed appraisals.' });
    const records = await Appraisal.find({ organizationId: String(resolveOrganizationId(req)), removedAt: { $ne: null } }).withRemoved()
      .select('organizationId employee manager cycleId status removedAt lifecycle launchContext reviewerInitiated createdAt cycleConfigurationSnapshot.cycleName')
      .populate({ path: 'cycleId', match: { organizationId: String(resolveOrganizationId(req)) }, select: 'name' }).sort({ removedAt: -1 });
    const allowed = await Promise.all(records.map(record => canManageAppraisal(req, record)));
    res.json({ success: true, data: records.filter((record, index) => allowed[index]).map(record => ({ _id: record._id, employee: record.employee, manager: record.manager, reviewName: record.cycleConfigurationSnapshot?.cycleName || record.cycleId?.name || 'Performance appraisal', createdAt: record.createdAt, status: record.status, removedAt: record.removedAt, removedBy: record.lifecycle?.removedBy })) });
  }));
  // Explicit per-route loading also keeps removed records inaccessible through ordinary endpoints.
  const load = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).json({ error: 'Appraisal not found.' }); return null; }
    const appraisal = await Appraisal.findOne(tenantAppraisalIdFilter(req, req.params.id)).withRemoved();
    if (!appraisal) { res.status(404).json({ error: 'Appraisal not found.' }); return null; }
    if (!await canManageAppraisal(req, appraisal)) { res.status(403).json({ error: 'You cannot manage this appraisal.' }); return null; }
    return appraisal;
  };
  const permissions = async (req, appraisal) => {
    const scope = await resolveAppraisalAccessScope(req);
    const finished = service.CLOSED.includes(appraisal.status) || Boolean(appraisal.finalRating?.finalizedAt);
    return { canCancel: !appraisal.removedAt && !finished && appraisal.status !== 'cancelled', canRemove: !appraisal.removedAt && (!finished || scope.isHrPlus), canRestore: Boolean(appraisal.removedAt) && (!finished || scope.isHrPlus), cleanupPending: Boolean(appraisal.lifecycle?.cleanupPending), canRetry: !appraisal.removedAt && Boolean(appraisal.lifecycle?.cleanupPending) && (appraisal.status === 'cancelled' || finished) && (!finished || scope.isHrPlus) };
  };
  router.get('/:id', wrap(async (req, res) => { const appraisal = await load(req, res); if (appraisal) res.json({ success: true, data: await permissions(req, appraisal) }); }));
  for (const action of ['cancel', 'remove', 'restore', 'retry']) router.post(`/:id/${action}`, wrap(async (req, res) => {
    const appraisal = await load(req, res); if (!appraisal) return;
    if (req.body.confirm !== true) return res.status(400).json({ error: 'Confirm this appraisal action before continuing.' });
    const scope = await resolveAppraisalAccessScope(req);
    if (action === 'retry' && (service.CLOSED.includes(appraisal.status) || appraisal.finalRating?.finalizedAt) && !scope.isHrPlus) return res.status(403).json({ error: 'Only HR or an organization administrator can manage cancellations for a completed appraisal.' });
    if (action === 'restore' && appraisal.removedAt && !(await permissions(req, appraisal)).canRestore) return res.status(403).json({ error: 'Only HR or an organization administrator can restore a completed appraisal.' });
    if (appraisal.removedAt && !['remove', 'restore'].includes(action)) return res.status(409).json({ error: 'Restore the removed appraisal to history first.' });
    await service[action](appraisal, req, scope.isHrPlus);
    await syncCycleProgress(appraisal.cycleId, appraisal.organizationId);
    res.json({ success: true, data: { _id: appraisal._id, status: appraisal.status, removedAt: appraisal.removedAt, ...await permissions(req, appraisal) } });
  }));
  return router;
};
