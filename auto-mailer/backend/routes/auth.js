import express from 'express';
import { 
  register, 
  login, 
  getProfile, 
  updateProfile, 
  logout 
} from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/register', register);
router.post('/login', login);

// Protected routes
router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, updateProfile);
router.post('/logout', authenticateToken, logout);

export default router;
