const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const candidateController = require('../controllers/candidateController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization, requirePermission } = require('../middleware/organizationMiddleware');
const { requireCredits } = require('../middleware/creditsMiddleware');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');
const queueUpload = require('../middleware/cvQueueUploadHandler');
const mongoose = require('mongoose');
const Job = require('../models/Job');
const publicApplicationCapability = require('../services/publicApplicationCapabilityService');
const requirePublicFeedbackAccess = require('../middleware/publicFeedbackAccess');

// Ensure uploads directory exists
const uploadsDir = 'uploads/';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory');
}

// Configure multer for file uploads with detailed logging
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = 'resume-' + uniqueSuffix + path.extname(file.originalname);
    cb(null, filename);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/jpg',
    'image/tiff'
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    console.error('❌ File type rejected:', file.mimetype);
    cb(new Error(`File type not allowed: ${file.mimetype}. Only PDF, Word documents, and images are allowed.`), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  },
  fileFilter: fileFilter
});

function opaqueRateKey(req, ...parts) {
  return crypto.createHash('sha256')
    .update([ipKeyGenerator(req.ip || req.socket?.remoteAddress || ''), ...parts].join('|'))
    .digest('hex');
}

// These pre-multipart abuse limits use the process-local store for the current
// single-instance PM2 deployment. Configure a shared Redis-backed rate-limit
// store before horizontally scaling the recruiter API.
const publicApplicationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PUBLIC_APPLICATION_IP_JOB_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => opaqueRateKey(req, req.body?.jobId || ''),
  handler: (_req, res) => res.status(429).json({
    code: 'PUBLIC_APPLICATION_RATE_LIMITED',
    msg: 'Too many application attempts. Please try again later.'
  })
});

const publicCvUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PUBLIC_CV_UPLOAD_IP_APPLICATION_LIMIT || 8),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => opaqueRateKey(
    req,
    req.get('X-Public-Job-Id') || '',
    req.get('X-Public-Candidate-Id') || ''
  ),
  handler: (_req, res) => res.status(429).json({
    code: 'PUBLIC_CV_UPLOAD_RATE_LIMITED',
    msg: 'Too many CV upload attempts. Please try again later.'
  })
});

async function publicCvPreflight(req, res, next) {
  try {
    const contentLength = Number(req.get('Content-Length') || 0);
    if (contentLength > 11 * 1024 * 1024) {
      return res.status(413).json({ code: 'CV_FILE_TOO_LARGE', msg: 'CV uploads are limited to 10MB' });
    }
    const jobId = req.get('X-Public-Job-Id');
    const candidateId = req.get('X-Public-Candidate-Id');
    const token = req.get('X-Public-Application-Token');
    if (!mongoose.isValidObjectId(jobId) || !mongoose.isValidObjectId(candidateId) || !token) {
      return res.status(403).json({
        code: 'PUBLIC_APPLICATION_CAPABILITY_INVALID',
        msg: 'This public application session is invalid or has expired'
      });
    }
    const job = await Job.findOne({ _id: jobId, isPublic: true, status: 'active' })
      .select('_id organization shortlist.candidate')
      .lean();
    if (!job) {
      return res.status(403).json({ code: 'PUBLIC_JOB_NOT_PUBLIC', msg: 'This job is not accepting public applications' });
    }
    await publicApplicationCapability.verify({
      candidateId,
      jobId,
      organizationId: job.organization,
      token
    });
    if (!(job.shortlist || []).some((entry) => String(entry.candidate) === String(candidateId))) {
      return res.status(403).json({
        code: 'PUBLIC_APPLICATION_NOT_COMMITTED',
        msg: 'Submit the public application before uploading its CV'
      });
    }
    req.publicCvContext = { jobId: String(jobId), candidateId: String(candidateId) };
    return next();
  } catch (error) {
    return res.status(error.statusCode || 403).json({
      code: error.code || 'PUBLIC_APPLICATION_CAPABILITY_INVALID',
      msg: error.message || 'This public application session is invalid or has expired'
    });
  }
}

// @route   POST api/candidates/upload-cv
// @desc    Upload CV, parse, and create candidate
// @access  Private (or Public depending on your requirements)
router.post('/upload-cv',
  authMiddleware,
  requireOrganization,
  requirePermission('manage_candidates'),
  requireCredits('uploadCandidate', 'candidate'),
  upload.single('resume'),
  queueUpload('private')
);

// @route   POST api/candidates/public/upload-cv
// @desc    Upload CV, parse, and create candidate (public access for job applications)
// @access  Public
router.post('/public/upload-cv',
  publicCvUploadLimiter,
  publicCvPreflight,
  (req, res, next) => {
    req.setTimeout(600000); // 10 minutes
    next();
  },
  upload.single('resume'),
  (req, res, next) => {
    const context = req.publicCvContext;
    if (!context) return res.status(403).json({ code: 'PUBLIC_APPLICATION_CAPABILITY_INVALID' });
    if (
      (req.body?.jobId && String(req.body.jobId) !== context.jobId)
      || (req.body?.candidateId && String(req.body.candidateId) !== context.candidateId)
    ) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(409).json({
        code: 'PUBLIC_APPLICATION_CONTEXT_MISMATCH',
        msg: 'The uploaded CV does not match this application session'
      });
    }
    req.body = { ...(req.body || {}), jobId: context.jobId, candidateId: context.candidateId };
    next();
  },
  // When the applicant already submitted their application (candidateId
  // present in the body), attach this CV analysis to that candidate instead
  // of creating a new one.
  queueUpload('public', undefined, (req) => ({ linkedCandidateId: req.body?.candidateId }))
);

router.get('/cv-jobs/:jobId', async (req, res) => {
  try {
    const statusToken = req.get('X-CV-Status-Token') || req.query.token;
    const status = await cvAnalysisQueue.getStatus(req.params.jobId, statusToken);
    if (!status) return res.status(404).json({ code: 'CV_JOB_NOT_FOUND', msg: 'CV processing job was not found' });
    return res.json(status);
  } catch (error) {
    return res.status(503).json({ code: 'CV_QUEUE_UNAVAILABLE', msg: error.message });
  }
});

router.post(
  '/cv-jobs/:jobId/retry',
  authMiddleware,
  requireOrganization,
  requirePermission('manage_candidates'),
  async (req, res) => {
    try {
      const result = await cvAnalysisQueue.retryJobNow(req.params.jobId, {
        organizationId: req.user.currentOrganization,
        stage: req.body?.stage,
        requestedBy: {
          type: 'user',
          id: req.user.id,
          name: req.user.name,
          email: req.user.email
        }
      });
      return res.status(202).json({
        ...cvAnalysisQueue.publicState(result.job),
        queueAvailable: result.queueAvailable,
        requestedStage: result.requestedStage
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        code: error.code || 'CV_RETRY_FAILED',
        msg: error.message || 'CV processing could not be retried'
      });
    }
  }
);

// @route   POST api/candidates
// @desc    Create a new candidate manually
// @access  Private
router.post('/', authMiddleware, requireOrganization, candidateController.createCandidateManually);

// @route   GET api/candidates
// @desc    Get all candidates
// @access  Private
router.get('/', authMiddleware, requireOrganization, candidateController.getAllCandidates);

// @route   GET api/candidates/export
// @desc    Export candidates to Excel
// @access  Private
router.get('/export', authMiddleware, requireOrganization, candidateController.exportCandidates);

// @route   GET api/candidates/:id
// @desc    Get a single candidate by ID
// @access  Private
router.get('/:id', authMiddleware, requireOrganization, candidateController.getCandidateById);

// @route   PUT api/candidates/:id
// @desc    Update a candidate
// @access  Private
router.put('/:id', authMiddleware, requireOrganization, candidateController.updateCandidate);

// @route   POST api/candidates/public
// @desc    Create a candidate immediately from a public job-application form,
//          independent of (and before) any CV upload/parsing
// @access  Public
router.post('/public', publicApplicationLimiter, candidateController.createPublicCandidate);

// @route   DELETE api/candidates/bulk
// @desc    Bulk delete candidates
// @access  Private
router.delete('/bulk', authMiddleware, requireOrganization, candidateController.bulkDeleteCandidates);

// @route   POST api/candidates/bulk-download
// @desc    Download a ZIP with a profile.pdf + CV per selected candidate
// @access  Private
router.post('/bulk-download', authMiddleware, requireOrganization, candidateController.bulkDownloadCandidates);

// @route   DELETE api/candidates/:id
// @desc    Delete a candidate
// @access  Private
router.delete('/:id', authMiddleware, requireOrganization, candidateController.deleteCandidate);

// @route   GET api/candidates/:id/accessible-resume-url
// @desc    Get accessible URL for candidate's PDF resume (Free Plan fix)
// @access  Private
router.get('/:id/accessible-resume-url', authMiddleware, requireOrganization, candidateController.getAccessibleResumeUrl);

// Public resume access is an interview capability, not a candidate-ID lookup.
// The interview must exist and explicitly reference the requested candidate.
router.get(
  '/public/interviews/:interviewId/candidates/:id/accessible-resume-url',
  requirePublicFeedbackAccess,
  candidateController.getAccessibleResumeUrl
);
router.get(
  '/public/interviews/:interviewId/candidates/:id/resume',
  requirePublicFeedbackAccess,
  candidateController.streamPublicFeedbackResume
);

// @route   GET api/candidates/:id/embedding-status
// @desc    Check if candidate has embedding in the vector store (Weaviate)
// @access  Private
router.get('/:id/embedding-status', authMiddleware, requireOrganization, candidateController.checkEmbeddingStatus);

// @route   POST api/candidates/:id/create-embedding
// @desc    Manually trigger embedding creation for candidate
// @access  Private
router.post('/:id/create-embedding', authMiddleware, requireOrganization, candidateController.createEmbedding);

// @route   POST api/candidates/:id/refresh-embedding
// @desc    Refresh embedding with enhanced metadata for candidate
// @access  Private
router.post('/:id/refresh-embedding', authMiddleware, requireOrganization, candidateController.refreshEmbedding);

// @route   POST api/candidates/:id/comments
// @desc    Add a comment/note to a candidate
// @access  Private
router.post('/:id/comments', authMiddleware, requireOrganization, candidateController.addComment);

// @route   DELETE api/candidates/:id/comments/:commentId
// @desc    Delete a comment/note from a candidate
// @access  Private
router.delete('/:id/comments/:commentId', authMiddleware, requireOrganization, candidateController.deleteComment);

// @route   GET api/candidates/cache/stats
// @desc    Get AI analysis cache statistics for monitoring
// @access  Private
router.get('/cache/stats', authMiddleware, candidateController.getCacheStats);

// @route   GET api/candidates/gpt/status
// @desc    Get AI system status and configuration (legacy path)
// @access  Private
router.get('/gpt/status', authMiddleware, candidateController.getGPTStatus);

// @route   GET api/candidates/ai/status
// @desc    Get AI system status and configuration
// @access  Private
router.get('/ai/status', authMiddleware, candidateController.getGPTStatus);

// @route   POST api/candidates/gpt/toggle
// @desc    Emergency toggle for AI analysis system (legacy path)
// @access  Private
router.post('/gpt/toggle', authMiddleware, candidateController.toggleGPTSystem);

// @route   POST api/candidates/ai/toggle
// @desc    Emergency toggle for AI analysis system
// @access  Private
router.post('/ai/toggle', authMiddleware, candidateController.toggleGPTSystem);

module.exports = router;
