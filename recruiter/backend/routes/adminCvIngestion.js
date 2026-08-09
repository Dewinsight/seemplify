'use strict';

const express = require('express');
const { adminAuth, requirePermission } = require('../middleware/adminAuth');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');

const router = express.Router();
const canView = [adminAuth, requirePermission('viewAnalytics')];
const canRetry = [adminAuth, requirePermission('systemSettings')];

function fail(response, error, fallback) {
  return response.status(Number(error?.statusCode) || 500).json({
    code: error?.code || 'CV_INGESTION_ADMIN_REQUEST_FAILED',
    msg: error?.message || fallback
  });
}

router.get('/jobs', ...canView, async (request, response) => {
  try {
    return response.json(await cvAnalysisQueue.listAdminHistory(request.query));
  } catch (error) {
    return fail(response, error, 'CV processing jobs could not be loaded');
  }
});

router.get('/organizations', ...canView, async (request, response) => {
  try {
    return response.json(await cvAnalysisQueue.listAdminOrganizations(request.query));
  } catch (error) {
    return fail(response, error, 'CV processing organizations could not be loaded');
  }
});

router.get('/jobs/:jobId', ...canView, async (request, response) => {
  try {
    const job = await cvAnalysisQueue.getAdminJobDetail(request.params.jobId);
    if (!job) {
      return response.status(404).json({
        code: 'CV_JOB_NOT_FOUND',
        msg: 'CV processing job was not found'
      });
    }
    return response.json(job);
  } catch (error) {
    return fail(response, error, 'CV processing job could not be loaded');
  }
});

router.post('/jobs/:jobId/retry', ...canRetry, async (request, response) => {
  try {
    const result = await cvAnalysisQueue.retryFailedJob(request.params.jobId, {
      administrator: true,
      stage: request.body?.stage,
      requestedBy: {
        type: 'admin',
        id: request.admin?._id,
        name: request.admin?.name,
        email: request.admin?.email
      }
    });
    return response.status(202).json({
      job: await cvAnalysisQueue.getAdminJobDetail(result.job.publicId),
      queueAvailable: result.queueAvailable,
      requestedStage: result.requestedStage,
      effectiveStage: result.effectiveStage,
      requestedAt: result.requestedAt
    });
  } catch (error) {
    return fail(response, error, 'CV processing could not be retried');
  }
});

module.exports = router;
