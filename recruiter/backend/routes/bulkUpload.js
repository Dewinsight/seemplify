const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform, pipeline } = require('stream');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization, requirePermission } = require('../middleware/organizationMiddleware');
const cvAnalysisQueue = require('../services/cvAnalysisQueueService');
const { BULK_HEARTBEAT_FILE } = require('../services/staleCvUploadSweeper');

const bulkUploadRoot = path.join(__dirname, '..', 'uploads', 'bulk');

function prepareBulkStaging(req, res, next) {
  try {
    fs.mkdirSync(bulkUploadRoot, { recursive: true });
    const directory = path.join(
      bulkUploadRoot,
      `cv-bulk-${Date.now()}-${crypto.randomBytes(12).toString('hex')}`
    );
    fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
    const heartbeatPath = path.join(directory, BULK_HEARTBEAT_FILE);
    fs.writeFileSync(heartbeatPath, '', { mode: 0o600 });
    req.cvBulkStagingDirectory = directory;
    req.cvBulkHeartbeatPath = heartbeatPath;

    let stopped = false;
    const heartbeat = setInterval(() => {
      const at = new Date();
      fs.promises.utimes(heartbeatPath, at, at).catch(() => {});
    }, 30_000);
    heartbeat.unref?.();
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(heartbeat);
      void fs.promises.unlink(heartbeatPath)
        .catch(() => {})
        .then(() => fs.promises.rmdir(directory).catch(() => {}));
    };
    res.once('finish', stop);
    res.once('close', stop);
    next();
  } catch (error) {
    next(error);
  }
}

function aggregateByteLimit() {
  return Math.max(
    10 * 1024 * 1024,
    Number(process.env.CV_BULK_MAX_TOTAL_BYTES || 500 * 1024 * 1024)
  );
}

function createBulkStagingStorage() {
  return {
    _handleFile(req, file, cb) {
    const uploadDir = req.cvBulkStagingDirectory;
    if (!uploadDir) return cb(new Error('Bulk CV staging was not initialized'));
    const at = new Date();
    fs.utimes(req.cvBulkHeartbeatPath, at, at, () => {});
    const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname)}`;
    const filePath = path.join(uploadDir, uniqueName);
    let fileBytes = 0;
    const quota = new Transform({
      transform(chunk, _encoding, callback) {
        fileBytes += chunk.length;
        req.cvBulkStagedBytes = Number(req.cvBulkStagedBytes || 0) + chunk.length;
        if (req.cvBulkStagedBytes > aggregateByteLimit()) {
          const error = new Error('Bulk CV upload exceeds the aggregate staging limit');
          error.code = 'LIMIT_BATCH_SIZE';
          error.statusCode = 413;
          return callback(error);
        }
        return callback(null, chunk);
      }
    });
    pipeline(file.stream, quota, fs.createWriteStream(filePath, { mode: 0o600 }), (error) => {
      if (error) {
        fs.unlink(filePath, () => cb(error));
        return;
      }
      cb(null, {
        destination: uploadDir,
        filename: uniqueName,
        path: filePath,
        size: fileBytes
      });
    });
    },
    _removeFile(_req, file, cb) {
      if (!file?.path) return cb(null);
      fs.unlink(file.path, (error) => cb(error?.code === 'ENOENT' ? null : error));
    }
  };
}

const storage = createBulkStagingStorage();

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

async function removeStagedRequestFiles(req) {
  const files = Array.isArray(req.files) ? req.files : [];
  await Promise.all(files.map((file) => (
    file?.path ? fs.promises.unlink(file.path).catch(() => {}) : Promise.resolve()
  )));
}

function receiveBulkCvFiles(req, res, next) {
  upload.array('resumes', 10000)(req, res, async (error) => {
    if (!error) return next();
    await removeStagedRequestFiles(req);
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({
        code: 'CV_BULK_FILE_COUNT_EXCEEDED',
        msg: 'Too many files. Maximum is 10,000 per batch.'
      });
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        code: 'CV_BULK_FILE_SIZE_EXCEEDED',
        msg: 'File too large. Maximum is 10MB per file.'
      });
    }
    if (error.code === 'LIMIT_BATCH_SIZE') {
      return res.status(413).json({
        code: 'CV_BULK_AGGREGATE_LIMIT_EXCEEDED',
        msg: `Bulk CV upload exceeds the ${aggregateByteLimit()} byte staging limit.`
      });
    }
    return next(error);
  });
}

// POST /api/bulk-upload/cv — Upload up to 10,000 CVs
router.post(
  '/cv',
  authMiddleware,
  requireOrganization,
  requirePermission('manage_candidates'),
  prepareBulkStaging,
  receiveBulkCvFiles,
  async (req, res) => {
    try {
      const files = req.files;
      if (!files || files.length === 0) {
        return res.status(400).json({ msg: 'No files uploaded.' });
      }

      const status = await cvAnalysisQueue.submitBatch(req);
      const organizationId = req.user.currentOrganization?.toString();
      const batchId = status.batchId;

      console.log(`📦 Bulk upload started: ${files.length} files, batch ${batchId}, org ${organizationId}`);

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
      if (error.code === 'LIMIT_BATCH_SIZE') {
        return res.status(413).json({
          code: 'CV_BULK_AGGREGATE_LIMIT_EXCEEDED',
          msg: `Bulk CV upload exceeds the ${aggregateByteLimit()} byte staging limit.`
        });
      }

      if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
      res.status(Number(error.statusCode) || 500).json({
        code: error.code || 'CV_BATCH_SUBMISSION_FAILED',
        msg: error.message || 'Bulk upload failed',
        retryAfterSeconds: error.retryAfterSeconds || undefined
      });
    }
  }
);

// GET /api/bulk-upload/status/:batchId — Poll batch progress
router.get('/status/recent', authMiddleware, requireOrganization, requirePermission('manage_candidates'), async (req, res) => {
  const status = await cvAnalysisQueue.getRecentBatchStatus(
    req.user.currentOrganization?.toString(),
    req.user.id
  );
  if (!status) return res.status(404).json({ msg: 'No recent batch found' });
  return res.json(status);
});

router.get('/status/:batchId', authMiddleware, requireOrganization, requirePermission('manage_candidates'), async (req, res) => {
  const status = await cvAnalysisQueue.getBatchStatus(req.params.batchId, req.user.currentOrganization?.toString());
  if (!status) {
    return res.status(404).json({ msg: 'Batch not found' });
  }
  res.json(status);
});

// Wake the batch immediately and let the shared runtime router decide whether
// this organization uses Local inference or the recruiter's ChatGPT account.
// A route-level ChatGPT check made Local-selected batches impossible to retry.
router.post('/status/:batchId/retry', authMiddleware, requireOrganization, requirePermission('manage_candidates'), async (req, res) => {
  try {
    const organizationId = req.user.currentOrganization?.toString();
    const status = await cvAnalysisQueue.retryBatchNow(
      req.params.batchId,
      organizationId,
      { type: 'user', id: req.user.id, name: 'Bulk upload retry' }
    );
    if (!status) return res.status(404).json({ msg: 'Batch not found' });
    return res.json(status);
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).json({
      msg: error?.message || 'CV analysis could not be retried',
      code: error?.code || 'CV_BATCH_RETRY_FAILED'
    });
  }
});

module.exports = router;
module.exports._createBulkStagingStorageForTests = createBulkStagingStorage;
module.exports._prepareBulkStagingForTests = prepareBulkStaging;
module.exports._receiveBulkCvFilesForTests = receiveBulkCvFiles;
module.exports._bulkUploadRootForTests = bulkUploadRoot;
