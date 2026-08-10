const express = require('express');
const { requireHRAdmin } = require('../middleware/rbac');
const PayrollEmployerEntity = require('../models/PayrollEmployerEntity');
const employerEntityService = require('../services/PayrollEmployerEntityService');

const router = express.Router();

function actor(req) {
  return {
    organizationId: req.currentOrganization?.id || req.session?.currentOrganizationId,
    userId: req.session?.user?.sub || req.session?.user?.id,
    name: req.session?.user?.name || '',
  };
}

function respondError(res, error) {
  if (error?.code === 11000) {
    return res.status(409).json({ error: 'A legal employer with this code already exists.', code: 'PAYROLL_EMPLOYER_ENTITY_DUPLICATE' });
  }
  return res.status(error?.statusCode || (error?.name === 'ValidationError' ? 400 : 500)).json({
    error: error?.message || 'Legal employer operation failed.',
    code: error?.code,
    details: error?.details,
  });
}

router.get('/adapter-candidates', requireHRAdmin, (req, res) => {
  res.json({ candidates: employerEntityService.listAdapterCandidates() });
});

router.get('/', requireHRAdmin, async (req, res) => {
  try {
    const current = actor(req);
    const entities = await employerEntityService.list(current.organizationId, { status: req.query.status });
    res.json({ entities });
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/', requireHRAdmin, async (req, res) => {
  try {
    const current = actor(req);
    const entity = await employerEntityService.create(current.organizationId, req.body || {}, current);
    res.status(201).json({ entity });
  } catch (error) {
    respondError(res, error);
  }
});

router.get('/:id', requireHRAdmin, async (req, res) => {
  try {
    const current = actor(req);
    const entity = await employerEntityService.get(req.params.id, current.organizationId);
    if (!entity) return res.status(404).json({ error: 'Legal employer not found.' });
    return res.json({ entity });
  } catch (error) {
    return respondError(res, error);
  }
});

router.put('/:id', requireHRAdmin, async (req, res) => {
  try {
    const current = actor(req);
    const entity = await employerEntityService.update(req.params.id, current.organizationId, req.body || {}, current);
    res.json({ entity });
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/:id/preview', requireHRAdmin, async (req, res) => {
  try {
    const current = actor(req);
    const entity = await PayrollEmployerEntity.findOne({ _id: req.params.id, organizationId: current.organizationId });
    if (!entity) return res.status(404).json({ error: 'Legal employer not found.' });
    const preview = employerEntityService.calculateCandidatePreview(entity, req.body || {});
    return res.json({ entityId: String(entity._id), preview });
  } catch (error) {
    return respondError(res, error);
  }
});

module.exports = router;
