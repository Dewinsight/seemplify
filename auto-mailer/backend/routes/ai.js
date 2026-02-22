import express from 'express';
import {
  generateResponse,
  autoRespondAll,
  analyzeIntent,
  getKnowledgeBase,
} from '../controllers/aiController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// AI routes
router.post('/generate-response/:messageId', generateResponse);
router.post('/auto-respond-all', autoRespondAll);
router.post('/analyze-intent/:messageId', analyzeIntent);
router.get('/knowledge-base', getKnowledgeBase);

export default router;

