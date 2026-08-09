'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization, requirePermission } = require('../middleware/organizationMiddleware');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');

const router = express.Router();
const replacementUploadsDir = path.join(process.cwd(), 'uploads');
fs.mkdirSync(replacementUploadsDir, { recursive: true });
const replacementUpload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, replacementUploadsDir),
    filename: (_request, file, callback) => callback(
      null,
      `cv-replacement-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`
    )
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const allowed = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/tiff'
    ]);
    return allowed.has(file.mimetype)
      ? callback(null, true)
      : callback(new Error('Only PDF, Word, JPEG, PNG, or TIFF CV files are allowed'));
  }
});

function fail(response, error, fallback) {
  return response.status(Number(error?.statusCode) || 500).json({
    code: error?.code || 'CV_INGESTION_REQUEST_FAILED',
    msg: error?.message || fallback
  });
}

router.get('/jobs', authMiddleware, requireOrganization, requirePermission('manage_candidates'), async (request, response) => {
  try {
    return response.json(await cvAnalysisQueue.listOrganizationHistory(
      request.user.currentOrganization,
      request.query
    ));
  } catch (error) {
    return fail(response, error, 'CV processing jobs could not be loaded');
  }
});

router.get('/jobs/:jobId', authMiddleware, requireOrganization, requirePermission('manage_candidates'), async (request, response) => {
  try {
    const job = await cvAnalysisQueue.getOrganizationJobDetail(
      request.user.currentOrganization,
      request.params.jobId
    );
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

router.post(
  '/jobs/:jobId/retry',
  authMiddleware,
  requireOrganization,
  requirePermission('manage_candidates'),
  async (request, response) => {
    try {
      const result = await cvAnalysisQueue.retryFailedJob(request.params.jobId, {
        organizationId: request.user.currentOrganization,
        stage: request.body?.stage,
        requestedBy: {
          type: 'user',
          id: request.user.id,
          name: request.user.name,
          email: request.user.email
        }
      });
      const job = await cvAnalysisQueue.getOrganizationJobDetail(
        request.user.currentOrganization,
        result.job.publicId
      );
      return response.status(202).json({
        job,
        queueAvailable: result.queueAvailable,
        requestedStage: result.requestedStage,
        effectiveStage: result.effectiveStage,
        requestedAt: result.requestedAt
      });
    } catch (error) {
      return fail(response, error, 'CV processing could not be retried');
    }
  }
);

router.post(
  '/jobs/:jobId/replace',
  authMiddleware,
  requireOrganization,
  requirePermission('manage_candidates'),
  replacementUpload.single('resume'),
  async (request, response) => {
    try {
      const result = await cvAnalysisQueue.replaceFailedJob(request, request.params.jobId);
      return response.status(202).json({
        job: await cvAnalysisQueue.getOrganizationJobDetail(
          request.user.currentOrganization,
          result.job.publicId
        ),
        priorJobId: result.priorJobId,
        replacement: true,
        duplicate: result.duplicate === true,
        queueAvailable: result.queueAvailable !== false
      });
    } catch (error) {
      return fail(response, error, 'Corrected CV could not be accepted');
    }
  }
);

module.exports = router;
