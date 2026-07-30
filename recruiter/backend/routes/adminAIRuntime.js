const express = require('express');
const { adminAuth, requirePermission } = require('../middleware/adminAuth');
const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');
const localAIRuntimeHealthService = require('../services/localAIRuntimeHealthService');
const { LiveSnapshotBroadcaster } = require('../services/aiRuntime/liveSnapshotBroadcaster');
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
const liveOperationsStream = new LiveSnapshotBroadcaster({
  sampler: getLiveOperations,
  intervalMs: 3_000,
  errorMessage: 'Live AI telemetry is temporarily unavailable'
});
const queueTelemetryStream = new LiveSnapshotBroadcaster({
  sampler: () => cvAnalysisQueue.adminTelemetry(),
  intervalMs: 2_000,
  errorMessage: 'Queue telemetry is temporarily unavailable'
});

function handleError(res, error, fallback) {
  const knownRuntimeError = error?.name === 'AIRuntimeError' && String(error?.code || '').startsWith('AI_');
  if (error instanceof TypeError || knownRuntimeError || [400, 403, 404, 409, 410].includes(error?.statusCode)) {
    return res.status(error.statusCode || 400).json({
      code: error.code || 'AI_RUNTIME_VALIDATION_ERROR',
      msg: error.message,
      ...(error.field ? { field: error.field } : {})
    });
  }
  console.error(fallback, error);
  return res.status(error?.statusCode || 500).json({ code: error?.code || 'AI_RUNTIME_ADMIN_ERROR', msg: fallback });
}

function safeTimestamp(value) {
  const timestamp = value ? new Date(value) : null;
  return timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

function localFailoverAuditState(value) {
  if (!value) return null;
  return {
    enabled: value.enabled !== false,
    active: value.active === true,
    status: value.status || 'unknown',
    reason: value.reason || null,
    engine: value.engine || null,
    model: value.model || null,
    checkedAt: safeTimestamp(value.checkedAt)
  };
}

function queueAuditState(value) {
  if (!value) return null;
  return {
    paused: value.paused === true,
    available: value.available !== false,
    workerRunning: value.worker?.running === true,
    concurrency: Math.max(0, Number(value.concurrency ?? value.worker?.concurrency ?? 0)),
    waiting: Math.max(0, Number(value.counts?.waitingTotal ?? value.counts?.waiting ?? 0)),
    active: Math.max(0, Number(value.counts?.active || 0)),
    delayed: Math.max(0, Number(value.counts?.delayed || 0))
  };
}

function operationalErrorCode(error, fallback) {
  return String(error?.code || fallback).slice(0, 120);
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
  liveOperationsStream.subscribe(req, res);
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

router.post('/local/health-check', ...settingsAccess, async (req, res) => {
  let before = null;
  try {
    const settings = await aiRuntimeService.getSettings({ force: true });
    before = localFailoverAuditState(settings.localFailover);
    const result = await localAIRuntimeHealthService.checkNow();
    await writeAudit(req, {
      category: 'health',
      action: 'local_health_check_succeeded',
      targetType: 'AIRuntimeSettings',
      targetId: 'local-managed-runtime',
      model: result.model || undefined,
      message: 'Manual local AI health check succeeded',
      metadata: {
        before,
        after: localFailoverAuditState(result)
      }
    });
    res.json({ success: true, ...result });
  } catch (error) {
    await writeAudit(req, {
      category: 'health',
      action: 'local_health_check_failed',
      status: 'failed',
      targetType: 'AIRuntimeSettings',
      targetId: 'local-managed-runtime',
      message: 'Manual local AI health check failed',
      metadata: {
        before,
        errorCode: operationalErrorCode(error, 'LOCAL_AI_HEALTH_CHECK_FAILED')
      }
    }).catch((auditError) => {
      console.error('Failed to audit manual local AI health check failure', auditError);
    });
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
  queueTelemetryStream.subscribe(req, res);
});

router.get('/local/queue/history', ...analyticsAccess, async (req, res) => {
  try {
    res.json(await cvAnalysisQueue.listAdminHistory(req.query));
  } catch (error) {
    handleError(res, error, 'Failed to load CV processing history');
  }
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

router.post('/local/queue/jobs/:jobId/retry', ...settingsAccess, async (req, res) => {
  try {
    const result = await cvAnalysisQueue.retryFailedJob(req.params.jobId, {
      administrator: true,
      stage: req.body?.stage,
      requestedBy: {
        type: 'admin',
        id: req.admin?._id,
        name: req.admin?.name,
        email: req.admin?.email
      }
    });
    await writeAudit(req, {
      category: 'operations',
      action: 'cv_job_manual_retry_requested',
      targetType: 'CVProcessingJob',
      targetId: result.job.publicId,
      message: `Manual CV ${result.effectiveStage} retry requested`,
      metadata: {
        requestedStage: result.requestedStage,
        effectiveStage: result.effectiveStage,
        queueAvailable: result.queueAvailable,
        organizationId: String(result.job.organization || '')
      }
    });
    res.status(202).json({
      success: true,
      queueAvailable: result.queueAvailable,
      requestedStage: result.requestedStage,
      job: await cvAnalysisQueue.getAdminJobDetail(result.job.publicId)
    });
  } catch (error) {
    await writeAudit(req, {
      category: 'operations',
      action: 'cv_job_manual_retry_failed',
      status: 'failed',
      targetType: 'CVProcessingJob',
      targetId: String(req.params.jobId || '').slice(0, 120),
      message: 'Manual CV retry request failed',
      metadata: {
        requestedStage: String(req.body?.stage || 'failed').slice(0, 40),
        errorCode: operationalErrorCode(error, 'CV_RETRY_FAILED')
      }
    }).catch((auditError) => {
      console.error('Failed to audit manual CV retry failure', auditError);
    });
    handleError(res, error, 'Failed to retry CV processing job');
  }
});

router.post('/local/queue/:action', ...settingsAccess, async (req, res) => {
  let before = null;
  try {
    if (!['pause', 'resume'].includes(req.params.action)) {
      return res.status(400).json({ code: 'INVALID_QUEUE_ACTION', msg: 'Action must be pause or resume' });
    }
    const paused = req.params.action === 'pause';
    before = queueAuditState(await cvAnalysisQueue.adminTelemetry().catch(() => null));
    const queue = await cvAnalysisQueue.setPaused(paused);
    await writeAudit(req, {
      category: 'configuration',
      action: paused ? 'cv_queue_paused' : 'cv_queue_resumed',
      targetType: 'CVProcessingQueue',
      targetId: 'local-cv-dispatch',
      message: `${paused ? 'Paused' : 'Resumed'} local CV queue dispatch`,
      metadata: {
        before,
        after: queueAuditState(queue)
      }
    });
    res.json({ success: true, queue });
  } catch (error) {
    const paused = req.params.action === 'pause';
    await writeAudit(req, {
      category: 'configuration',
      action: paused ? 'cv_queue_pause_failed' : 'cv_queue_resume_failed',
      status: 'failed',
      targetType: 'CVProcessingQueue',
      targetId: 'local-cv-dispatch',
      message: `Failed to ${paused ? 'pause' : 'resume'} local CV queue dispatch`,
      metadata: {
        before,
        requestedPaused: paused,
        errorCode: operationalErrorCode(error, 'CV_QUEUE_CONTROL_FAILED')
      }
    }).catch((auditError) => {
      console.error('Failed to audit local CV queue control failure', auditError);
    });
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
