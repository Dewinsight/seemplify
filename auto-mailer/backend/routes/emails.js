import express from 'express';
import {
  getEmails,
  getEmailById,
  sendReply,
  getUnreadCount,
  getThread,
} from '../controllers/emailController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Email routes
router.get('/', getEmails);
router.get('/unread-count', getUnreadCount);
router.get('/thread/:threadId', getThread);
router.get('/:messageId', getEmailById);
router.post('/:messageId/reply', sendReply);

export default router;

