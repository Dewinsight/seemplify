const express = require('express');
const router = express.Router();
const { getPlatformFeatureSettings } = require('../services/platformFeatureService');

router.get('/features', async (req, res) => {
  try {
    const { features, updatedAt } = await getPlatformFeatureSettings({ forceRefresh: true });
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json({ features, updatedAt });
  } catch (error) {
    console.error('Failed to load platform feature settings:', error);
    res.status(503).json({
      success: false,
      code: 'FEATURE_SETTINGS_UNAVAILABLE',
      msg: 'Platform feature settings are temporarily unavailable.'
    });
  }
});

module.exports = router;
