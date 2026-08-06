import express from 'express';
import { parseCsv, sendCampaignEmails } from '../controllers/campaignController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);

router.post('/parse-csv', parseCsv);
router.post('/send', sendCampaignEmails);

export default router;
