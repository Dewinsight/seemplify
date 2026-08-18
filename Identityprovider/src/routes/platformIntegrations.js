import express from 'express'
import { requirePlatformIntegrationService } from '../middleware/platformIntegrationAuth.js'
import { getNylasRuntimeConfiguration } from '../services/nylasPlatformConfigurationService.js'

const router = express.Router()

router.get('/nylas', requirePlatformIntegrationService, async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    return res.json(await getNylasRuntimeConfiguration())
  } catch (error) {
    console.error('Failed to load Nylas platform configuration:', error.message)
    return res.status(503).json({ configured: false, error: 'Nylas platform configuration is unavailable.' })
  }
})

export default router
