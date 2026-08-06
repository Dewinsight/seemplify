const express = require('express');
const router = express.Router();
const embeddingController = require('../controllers/embeddingController');
const auth = require('../middleware/authMiddleware');

// Get embedding status overview
// GET /api/embeddings/status
router.get('/status', auth, embeddingController.getEmbeddingStatus);

// Re-embed all jobs (fixes skills parsing issue)
// POST /api/embeddings/re-embed/jobs
router.post('/re-embed/jobs', auth, embeddingController.reEmbedAllJobs);

// Re-embed all candidates
// POST /api/embeddings/re-embed/candidates
router.post('/re-embed/candidates', auth, embeddingController.reEmbedAllCandidates);

// Re-embed everything (jobs and candidates)
// POST /api/embeddings/re-embed/all
router.post('/re-embed/all', auth, embeddingController.reEmbedAll);

// Re-embed a specific job
// POST /api/embeddings/re-embed/job/:id
router.post('/re-embed/job/:id', auth, embeddingController.reEmbedJob);

// Re-embed a specific candidate
// POST /api/embeddings/re-embed/candidate/:id
router.post('/re-embed/candidate/:id', auth, embeddingController.reEmbedCandidate);

module.exports = router; 