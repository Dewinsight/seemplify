const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const candidateController = require('../controllers/candidateController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireOrganization, requirePermission } = require('../middleware/organizationMiddleware');
const { requireCredits, deductCredits } = require('../middleware/creditsMiddleware');

// Ensure uploads directory exists
const uploadsDir = 'uploads/';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Created uploads directory');
}

// Configure multer for file uploads with detailed logging
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log('📁 Multer destination - File:', file.originalname, 'Field:', file.fieldname);
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = 'resume-' + uniqueSuffix + path.extname(file.originalname);
    console.log('📝 Multer filename generated:', filename);
    cb(null, filename);
  }
});

const fileFilter = (req, file, cb) => {
  console.log('🔍 Multer fileFilter invoked:', {
    fieldname: file.fieldname,
    originalname: file.originalname,
    mimetype: file.mimetype,
    encoding: file.encoding
  });

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
    console.log('✅ File type accepted:', file.mimetype);
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

// Logging middleware to track multer processing
const logMulterProcessing = (req, res, next) => {
  console.log('🎯 Route hit: /api/candidates/upload-cv');
  console.log('📋 Request info:', {
    method: req.method,
    contentType: req.headers['content-type'],
    hasFile: !!req.file,
    hasBody: !!req.body,
    bodyKeys: Object.keys(req.body || {})
  });
  next();
};

// @route   POST api/candidates/upload-cv
// @desc    Upload CV, parse, and create candidate
// @access  Private (or Public depending on your requirements)
router.post('/upload-cv',
  authMiddleware,
  requireOrganization,
  requireCredits('uploadCandidate', 'candidate'),
  (req, res, next) => {
    console.log('🔐 Auth passed, processing file upload...');
    next();
  },
  upload.single('resume'),
  (req, res, next) => {
    console.log('📦 After multer - req.file:', req.file ? 'EXISTS' : 'MISSING');
    if (req.file) {
      console.log('✅ File details:', {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
      });
    } else {
      console.error('❌ No file processed by multer!');
      console.error('Request headers:', req.headers);
    }
    next();
  },
  deductCredits,
  candidateController.uploadAndCreateCandidate
);

// @route   POST api/candidates/public/upload-cv
// @desc    Upload CV, parse, and create candidate (public access for job applications)
// @access  Public
router.post('/public/upload-cv',
  (req, res, next) => {
    console.log('🌐 Public CV upload route hit');
    // Set a longer timeout for CV processing
    req.setTimeout(600000); // 10 minutes
    next();
  },
  upload.single('resume'),
  (req, res, next) => {
    console.log('📦 Public route - After multer - req.file:', req.file ? 'EXISTS' : 'MISSING');
    if (req.file) {
      console.log('✅ Public upload file details:', {
        originalname: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      });
    }
    next();
  },
  candidateController.uploadAndCreateCandidate
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

// @route   PUT api/candidates/public/:id
// @desc    Update a candidate (public access for job applications)
// @access  Public
router.put('/public/:id', candidateController.updateCandidate);

// @route   DELETE api/candidates/bulk
// @desc    Bulk delete candidates
// @access  Private
router.delete('/bulk', authMiddleware, requireOrganization, candidateController.bulkDeleteCandidates);

// @route   DELETE api/candidates/:id
// @desc    Delete a candidate
// @access  Private
router.delete('/:id', authMiddleware, requireOrganization, candidateController.deleteCandidate);

// @route   GET api/candidates/:id/accessible-resume-url
// @desc    Get accessible URL for candidate's PDF resume (Free Plan fix)
// @access  Private
router.get('/:id/accessible-resume-url', authMiddleware, requireOrganization, candidateController.getAccessibleResumeUrl);

// @route   GET api/candidates/public/:id/accessible-resume-url
// @desc    Get accessible URL for candidate's PDF resume (Public Access)
// @access  Public
router.get('/public/:id/accessible-resume-url', candidateController.getAccessibleResumeUrl);

// @route   GET api/candidates/:id/embedding-status
// @desc    Check if candidate has embedding in Pinecone
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
// @desc    Get GPT analysis cache statistics for monitoring
// @access  Private
router.get('/cache/stats', authMiddleware, candidateController.getCacheStats);

// @route   GET api/candidates/gpt/status
// @desc    Get GPT system status and configuration
// @access  Private
router.get('/gpt/status', authMiddleware, candidateController.getGPTStatus);

// @route   POST api/candidates/gpt/toggle
// @desc    Emergency toggle for GPT analysis system (admin only)
// @access  Private
router.post('/gpt/toggle', authMiddleware, candidateController.toggleGPTSystem);

module.exports = router;