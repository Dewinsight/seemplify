const express = require('express');
const multer = require('multer');
const path = require('path');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');

const router = express.Router();
const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, 'uploads/cvs/'),
  filename: (_req, file, callback) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    callback(null, `cv-${suffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/tiff'
    ];
    callback(
      allowedTypes.includes(file.mimetype)
        ? null
        : new Error('Only PDF, Word documents, and images are allowed'),
      allowedTypes.includes(file.mimetype)
    );
  }
});

// Public AI-interview uploads require jobId so the durable job has an owning organization.
router.post('/parse', upload.single('cv'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, msg: 'No CV file provided' });
    const result = await cvAnalysisQueue.submitUpload(req, 'ai-interview');
    return res.status(202).json({
      ...cvAnalysisQueue.publicState(result.job),
      statusToken: result.statusToken,
      statusUrl: `/api/cv/jobs/${result.job.publicId}`,
      duplicate: result.duplicate
    });
  } catch (error) {
    console.error('AI-interview CV queue submission failed:', error);
    return res.status(error.statusCode || 500).json({
      code: error.code || 'CV_QUEUE_SUBMISSION_FAILED',
      msg: error.message || 'CV upload could not be queued'
    });
  }
});

router.get('/jobs/:jobId', async (req, res) => {
  try {
    const token = req.get('X-CV-Status-Token') || req.query.token;
    const status = await cvAnalysisQueue.getStatus(req.params.jobId, token);
    if (!status) return res.status(404).json({ code: 'CV_JOB_NOT_FOUND', msg: 'CV processing job was not found' });
    return res.json(status);
  } catch (error) {
    return res.status(503).json({ code: 'CV_QUEUE_UNAVAILABLE', msg: error.message });
  }
});

module.exports = router;
