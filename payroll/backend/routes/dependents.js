const express = require('express');
const PayrollProfile = require('../models/PayrollProfile');
const { requireAuth } = require('../middleware/rbac');
const { normalizeDependent, publicDependent, synchronizeDependentSummary } = require('../services/DependentService');

const router = express.Router();

function actor(req) {
  const user = req.session?.user || {};
  return { userId: String(user.id || user.sub || ''), organizationId: String(req.currentOrganization?.id || req.session?.currentOrganizationId || '') };
}
function fail(res, error, fallback) {
  return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : fallback, code: error.code, ...(error.details || {}) });
}
async function profileFor(req) {
  const current = actor(req);
  if (!current.organizationId) { const error = new Error('No organization selected'); error.statusCode = 400; throw error; }
  const profile = await PayrollProfile.findOne({ organizationId: current.organizationId, userId: current.userId });
  if (!profile) { const error = new Error('Your payroll profile has not been created yet.'); error.statusCode = 404; throw error; }
  return profile;
}
function response(profile) {
  return { dependents: (profile.dependents || []).map(publicDependent), declaration: profile.dependentsDeclaration || { status: 'pending' }, taxDependentCount: Number(profile.taxConfig?.dependents || 0) };
}

router.get('/me', requireAuth, async (req, res) => {
  try { return res.json(response(await profileFor(req))); } catch (error) { return fail(res, error, 'Failed to load dependents'); }
});
router.post('/', requireAuth, async (req, res) => {
  try {
    const profile = await profileFor(req);
    profile.dependents.push({ ...normalizeDependent(req.body), addedAt: new Date(), updatedAt: new Date() });
    synchronizeDependentSummary(profile);
    await profile.save();
    return res.status(201).json({ ...response(profile), message: 'Dependent saved and included in Payroll tax and benefits data.' });
  } catch (error) { return fail(res, error, 'Failed to save dependent'); }
});
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const profile = await profileFor(req);
    const dependent = profile.dependents.id(req.params.id);
    if (!dependent) return res.status(404).json({ error: 'Dependent not found.' });
    const normalized = normalizeDependent(req.body);
    Object.assign(dependent, normalized, { updatedAt: new Date() });
    synchronizeDependentSummary(profile);
    await profile.save();
    return res.json({ ...response(profile), message: 'Dependent updated.' });
  } catch (error) { return fail(res, error, 'Failed to update dependent'); }
});
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const profile = await profileFor(req);
    const dependent = profile.dependents.id(req.params.id);
    if (!dependent) return res.status(404).json({ error: 'Dependent not found.' });
    dependent.deleteOne();
    synchronizeDependentSummary(profile);
    await profile.save();
    return res.json({ ...response(profile), message: 'Dependent removed from Payroll.' });
  } catch (error) { return fail(res, error, 'Failed to remove dependent'); }
});
router.post('/declare-none', requireAuth, async (req, res) => {
  try {
    const profile = await profileFor(req);
    if (profile.dependents?.length) return res.status(409).json({ error: 'Remove existing dependents before declaring none.' });
    const now = new Date();
    profile.dependentsDeclaration = { status: 'none', confirmedAt: now, lastUpdated: now };
    profile.taxConfig = profile.taxConfig || {};
    profile.taxConfig.dependents = 0;
    await profile.save();
    return res.json({ ...response(profile), message: 'No dependents declaration saved.' });
  } catch (error) { return fail(res, error, 'Failed to save dependents declaration'); }
});

module.exports = router;
