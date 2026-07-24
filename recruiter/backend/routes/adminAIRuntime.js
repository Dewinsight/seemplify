const express = require('express');
const { adminAuth, requirePermission } = require('../middleware/adminAuth');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');
const localAIRuntimeHealthService = require('../services/localAIRuntimeHealthService');
const {
  createCredential,
  createQuotaGroup,
  getAuditDetail,
  getLiveOperations,
  getOverview,
  getRequestDetail,
  getRuntimeSettings,
  listAuditEvents,
  listCredentials,
  listRequests,
  revokeCredential,
  rotateCredential,
  runRuntimeTest,
  setCredentialEnabled,
  updateAlerts,
  updateRollout,
  updateRoute,
  writeAudit
} = require('../services/adminAIRuntimeService');

const router = express.Router();
const analyticsAccess = [adminAuth, requirePermission('viewAnalytics')];
const settingsAccess = [adminAuth, requirePermission('systemSettings')];
const secretAccess = [adminAuth, requirePermission('systemSettings')];

function handleError(res, error, fallback) {
  const knownRuntimeError = error?.name === 'AIRuntimeError' && String(error?.code || '').startsWith('AI_');
  if (error instanceof TypeError || knownRuntimeError || [400, 404, 409].includes(error?.statusCode)) {
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

router.get('/live', ...analyticsAccess, async (_req, res) => {
  try {
    res.json(await getLiveOperations());
  } catch (error) {
    handleError(res, error, 'Failed to load live AI runtime operations');
  }
});

router.get('/live/stream', ...analyticsAccess, async (req, res) => {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  let closed = false;
  let sending = false;
  const sendSnapshot = async () => {
    if (closed || sending) return;
    sending = true;
    try {
      const snapshot = await getLiveOperations();
      if (!closed) res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    } catch {
      if (!closed) res.write('event: telemetry-error\ndata: {"message":"Live AI telemetry is temporarily unavailable"}\n\n');
    } finally {
      sending = false;
    }
  };
  const snapshotTimer = setInterval(() => void sendSnapshot(), 3_000);
  const heartbeatTimer = setInterval(() => {
    if (!closed) res.write(': keep-alive\n\n');
  }, 15_000);
  snapshotTimer.unref?.();
  heartbeatTimer.unref?.();
  req.on('close', () => {
    closed = true;
    clearInterval(snapshotTimer);
    clearInterval(heartbeatTimer);
  });
  await sendSnapshot();
});

router.get('/requests', ...analyticsAccess, async (req, res) => {
  try {
    res.json(await listRequests(req.query));
  } catch (error) {
    handleError(res, error, 'Failed to load AI runtime requests');
  }
});

router.get('/requests/:id', ...analyticsAccess, async (req, res) => {
  try {
    res.json(await getRequestDetail(req.params.id));
  } catch (error) {
    handleError(res, error, 'Failed to load AI request detail');
  }
});

router.get('/audit', ...analyticsAccess, async (req, res) => {
  try {
    res.json(await listAuditEvents(req.query));
  } catch (error) {
    handleError(res, error, 'Failed to load AI runtime audit events');
  }
});

router.get('/audit/:id', ...analyticsAccess, async (req, res) => {
  try {
    res.json(await getAuditDetail(req.params.id));
  } catch (error) {
    handleError(res, error, 'Failed to load AI audit detail');
  }
});

router.get('/settings', ...settingsAccess, async (_req, res) => {
  try {
    res.json(await getRuntimeSettings());
  } catch (error) {
    handleError(res, error, 'Failed to load AI runtime settings');
  }
});

router.get('/local/status', ...analyticsAccess, async (_req, res) => {
  try {
    const [runtime, settings] = await Promise.all([
      aiRuntimeService.getLocalRuntimeStatus(),
      aiRuntimeService.getSettings()
    ]);
    res.json({ ...runtime, failover: settings.localFailover });
  } catch (error) {
    handleError(res, error, 'Failed to load local CV runtime status');
  }
});

router.post('/local/health-check', ...settingsAccess, async (_req, res) => {
  try {
    res.json({ success: true, ...(await localAIRuntimeHealthService.checkNow()) });
  } catch (error) {
    handleError(res, error, 'Failed to run local AI health check');
  }
});

router.get('/local/queue', ...analyticsAccess, async (_req, res) => {
  try {
    res.json(await cvAnalysisQueue.adminTelemetry());
  } catch (error) {
    handleError(res, error, 'Failed to load local CV queue status');
  }
});

router.get('/local/queue/stream', ...analyticsAccess, async (req, res) => {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  let closed = false;
  let sending = false;
  let snapshotTimer;
  let heartbeatTimer;
  const close = () => {
    closed = true;
    if (snapshotTimer) clearInterval(snapshotTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  };
  req.on('close', close);

  const sendSnapshot = async () => {
    if (closed || sending) return;
    sending = true;
    try {
      const snapshot = await cvAnalysisQueue.adminTelemetry();
      if (!closed) res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    } catch {
      if (!closed) res.write(`event: telemetry-error\ndata: {"message":"Queue telemetry is temporarily unavailable"}\n\n`);
    } finally {
      sending = false;
    }
  };

  await sendSnapshot();
  if (closed) return;
  snapshotTimer = setInterval(() => void sendSnapshot(), 2_000);
  heartbeatTimer = setInterval(() => {
    if (!closed) res.write(': keep-alive\n\n');
  }, 15_000);
  snapshotTimer.unref?.();
  heartbeatTimer.unref?.();
});

router.get('/local/queue/jobs/:jobId', ...analyticsAccess, async (req, res) => {
  try {
    const job = await cvAnalysisQueue.getAdminJobDetail(req.params.jobId);
    if (!job) return res.status(404).json({ code: 'CV_JOB_NOT_FOUND', msg: 'CV processing job was not found' });
    res.json(job);
  } catch (error) {
    handleError(res, error, 'Failed to load CV processing job');
  }
});

router.post('/local/queue/:action', ...settingsAccess, async (req, res) => {
  try {
    if (!['pause', 'resume'].includes(req.params.action)) {
      return res.status(400).json({ code: 'INVALID_QUEUE_ACTION', msg: 'Action must be pause or resume' });
    }
    const queue = await cvAnalysisQueue.setPaused(req.params.action === 'pause');
    res.json({ success: true, queue });
  } catch (error) {
    handleError(res, error, 'Failed to update local CV queue');
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

router.post('/test', ...settingsAccess, async (req, res) => {
  try {
    res.json(await runRuntimeTest(req.body?.activity, req));
  } catch (error) {
    handleError(res, error, 'AI runtime test failed');
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
