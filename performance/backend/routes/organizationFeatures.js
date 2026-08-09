const express = require('express');
const { requireAuth, requireHRAdmin } = require('../middleware/rbac');
const { getActorId, requireOrganization } = require('../services/tenantPolicy');
const {
  getOrganizationFeatureState,
  updateOrganizationFeatures,
  validateFeaturePatch
} = require('../services/organizationFeatureService');

const router = express.Router();

router.use(requireAuth, requireOrganization, requireHRAdmin);

router.get('/', async (req, res) => {
  try {
    const state = await getOrganizationFeatureState(req.organizationId);
    return res.json({ success: true, data: state });
  } catch (error) {
    console.error('Load organization features failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load organization features.' });
  }
});

router.patch('/', async (req, res) => {
  try {
    const changes = validateFeaturePatch(req.body?.features);
    const state = await updateOrganizationFeatures({
      organizationId: req.organizationId,
      changes,
      actorId: getActorId(req)
    });
    return res.json({ success: true, data: state });
  } catch (error) {
    if (error instanceof TypeError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    console.error('Update organization features failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to update organization features.' });
  }
});

module.exports = router;
