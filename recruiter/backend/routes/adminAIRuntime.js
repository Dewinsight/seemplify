const express = require('express');
const { adminAuth, requirePermission, requireSuperAdmin } = require('../middleware/adminAuth');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const {
  createCredential,
  createQuotaGroup,
  getOverview,
  getRuntimeSettings,
  listAuditEvents,
  listCredentials,
  listRequests,
  revokeCredential,
  rotateCredential,
  setCredentialEnabled,
  updateAlerts,
  updateRollout,
  updateRoute,
  writeAudit
} = require('../services/adminAIRuntimeService');

const router = express.Router();
const analyticsAccess = [adminAuth, requirePermission('viewAnalytics')];
const settingsAccess = [adminAuth, requirePermission('systemSettings')];
const secretAccess = [adminAuth, requireSuperAdmin];

function handleError(res, error, fallback) {
  if (error instanceof TypeError || [400, 404, 409].includes(error?.statusCode)) {
    return res.status(error.statusCode || 400).json({
      code: error.code || 'AI_RUNTIME_VALIDATION_ERROR',
      msg: error.message,
      ...(error.field ? { field: error.field } : {})
    });
  }
  console.error(fallback, error);
  return res.status(error?.statusCode || 500).json({ code: error?.code || 'AI_RUNTIME_ADMIN_ERROR', msg: fallback });
}

router.get('/overview', ...analyticsAccess, async (req, res) => {
  try {
    res.json(await getOverview(req.query));
  } catch (error) {
    handleError(res, error, 'Failed to load AI runtime overview');
  }
});

router.get('/requests', ...analyticsAccess, async (req, res) => {
  try {
    res.json(await listRequests(req.query));
  } catch (error) {
    handleError(res, error, 'Failed to load AI runtime requests');
  }
});

router.get('/audit', ...analyticsAccess, async (req, res) => {
  try {
    res.json(await listAuditEvents(req.query));
  } catch (error) {
    handleError(res, error, 'Failed to load AI runtime audit events');
  }
});

router.get('/settings', ...settingsAccess, async (_req, res) => {
  try {
    res.json(await getRuntimeSettings());
  } catch (error) {
    handleError(res, error, 'Failed to load AI runtime settings');
  }
});

router.get('/credentials', ...settingsAccess, async (_req, res) => {
  try {
    res.json({ items: await listCredentials() });
  } catch (error) {
    handleError(res, error, 'Failed to load Groq credentials');
  }
});

router.post('/credentials', ...secretAccess, async (req, res) => {
  try {
    res.status(201).json({ success: true, ...(await createCredential(req.body || {}, req)) });
  } catch (error) {
    handleError(res, error, 'Failed to create Groq credential');
  }
});

router.post('/credentials/:id/test', ...secretAccess, async (req, res) => {
  try {
    const result = await aiRuntimeService.testCredential(req.params.id, req.body?.model);
    await writeAudit(req, {
      category: 'health', action: 'credential_tested', targetType: 'AIProviderCredential',
      targetId: req.params.id, model: result.model, message: 'Groq credential test succeeded'
    });
    res.json(result);
  } catch (error) {
    try {
      await writeAudit(req, {
        category: 'health', action: 'credential_test_failed', status: 'failed',
        targetType: 'AIProviderCredential', targetId: req.params.id,
        message: `Groq credential test failed: ${String(error.code || 'provider_error')}`
      });
    } catch (auditError) {
      console.error('Failed to audit Groq credential test failure', auditError);
    }
    handleError(res, error, 'Groq credential test failed');
  }
});

router.post('/credentials/:id/rotate', ...secretAccess, async (req, res) => {
  try {
    res.json({ success: true, ...(await rotateCredential(req.params.id, req.body || {}, req)) });
  } catch (error) {
    handleError(res, error, 'Failed to rotate Groq credential');
  }
});

router.patch('/credentials/:id', ...secretAccess, async (req, res) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') throw new TypeError('enabled must be a boolean');
    res.json({ success: true, credential: await setCredentialEnabled(req.params.id, req.body.enabled, req) });
  } catch (error) {
    handleError(res, error, 'Failed to update Groq credential');
  }
});

router.delete('/credentials/:id', ...secretAccess, async (req, res) => {
  try {
    res.json(await revokeCredential(req.params.id, req));
  } catch (error) {
    handleError(res, error, 'Failed to revoke Groq credential');
  }
});

router.post('/models/sync', ...settingsAccess, async (req, res) => {
  try {
    const result = await aiRuntimeService.syncModels(req.body?.credentialId);
    await writeAudit(req, {
      action: 'models_synced', targetType: 'AIRuntimeSettings', targetId: 'global',
      message: `Synchronized Groq model catalog (${result.availableCount} available)`
    });
    res.json({ success: true, ...result });
  } catch (error) {
    handleError(res, error, 'Failed to synchronize Groq models');
  }
});

router.post('/quota-groups', ...settingsAccess, async (req, res) => {
  try {
    res.status(201).json({ success: true, ...(await createQuotaGroup(req.body || {}, req)) });
  } catch (error) {
    handleError(res, error, 'Failed to create Groq quota group');
  }
});

router.put('/routes/:activity', ...settingsAccess, async (req, res) => {
  try {
    res.json({ success: true, ...(await updateRoute(req.params.activity, req.body || {}, req)) });
  } catch (error) {
    handleError(res, error, 'Failed to update AI activity route');
  }
});

router.put('/alerts', ...settingsAccess, async (req, res) => {
  try {
    res.json({ success: true, ...(await updateAlerts(req.body || {}, req)) });
  } catch (error) {
    handleError(res, error, 'Failed to update AI runtime alerts');
  }
});

router.put('/rollout', ...settingsAccess, async (req, res) => {
  try {
    res.json({ success: true, ...(await updateRollout(req.body || {}, req)) });
  } catch (error) {
    handleError(res, error, 'Failed to update the Groq rollout');
  }
});

module.exports = router;
