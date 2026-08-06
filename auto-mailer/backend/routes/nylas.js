import express from 'express';
import {
  initiateOAuth,
  handleOAuthCallback,
  disconnectEmail,
  getConnectionStatus,
} from '../controllers/nylasController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// OAuth routes
router.get('/connect', authenticateToken, initiateOAuth);
router.get('/callback', handleOAuthCallback);
router.get('/oauth/callback', handleOAuthCallback); // Nylas configured route
router.post('/disconnect', authenticateToken, disconnectEmail);
router.get('/status', authenticateToken, getConnectionStatus);

export default router;

