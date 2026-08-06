const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization } = require('../middleware/organizationMiddleware');
const bulkUploadService = require('../services/bulkUploadService');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'bulk');
    const fs = require('fs');
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  const allowedExt = ['.pdf', '.doc', '.docx'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.originalname}. Only PDF, DOC, DOCX allowed.`), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 10000 },
  fileFilter,
});

// POST /api/bulk-upload/cv — Upload up to 10,000 CVs
router.post(
  '/cv',
  authMiddleware,
  requireOrganization,
  upload.array('resumes', 10000),
  async (req, res) => {
    try {
      const files = req.files;
      if (!files || files.length === 0) {
        return res.status(400).json({ msg: 'No files uploaded.' });
      }

      const organizationId = req.user.currentOrganization?.toString();
      const userId = req.user.id;
      const batchId = `batch-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      console.log(`📦 Bulk upload started: ${files.length} files, batch ${batchId}, org ${organizationId}`);

      bulkUploadService.initBatchStatus(batchId, files.length, organizationId, userId);
      await bulkUploadService.addBulkUploadJobs(batchId, files, organizationId, userId);

      res.status(202).json({
        msg: `${files.length} CVs queued for processing`,
        batchId,
        totalFiles: files.length,
        statusUrl: `/api/bulk-upload/status/${batchId}`,
      });
    } catch (error) {
      console.error('❌ Bulk upload error:', error);

      // Clean up any uploaded files on error
      if (req.files) {
        const fs = require('fs');
        for (const file of req.files) {
          try { fs.unlinkSync(file.path); } catch (_) {}
        }
      }

      if (error.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ msg: 'Too many files. Maximum is 10,000 per batch.' });
      }
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ msg: 'File too large. Maximum is 10MB per file.' });
      }

      res.status(500).json({ msg: error.message || 'Bulk upload failed' });
    }
  }
);

// GET /api/bulk-upload/status/:batchId — Poll batch progress
router.get('/status/:batchId', authMiddleware, async (req, res) => {
  const status = bulkUploadService.getBatchStatus(req.params.batchId);
  if (!status) {
    return res.status(404).json({ msg: 'Batch not found' });
  }
  res.json(status);
});

module.exports = router;
