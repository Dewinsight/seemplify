import express from 'express'
import { createPlatformIntegrationServiceAuth, requirePlatformIntegrationService } from '../middleware/platformIntegrationAuth.js'
import { getNylasRuntimeConfiguration } from '../services/nylasPlatformConfigurationService.js'
import {
  canServiceAccessStorageSolution,
  getMediaRuntimeConfiguration,
  getStorageRuntimeConfiguration,
  STORAGE_SOLUTION_ACCESS
} from '../services/mediaPlatformConfigurationService.js'

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

router.get('/cloudinary', createPlatformIntegrationServiceAuth(['workspace', 'identity-provider', 'ai-interview', 'recruiter', 'seemplify-learning']), async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    return res.json(await getMediaRuntimeConfiguration('cloudinary'))
  } catch (error) {
    console.error('Failed to load Cloudinary platform configuration:', error.message)
    return res.status(503).json({ configured: false, error: 'Cloudinary platform configuration is unavailable.' })
  }
})

router.get('/azure-speech', createPlatformIntegrationServiceAuth(['ai-interview', 'recruiter']), async (_req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    return res.json(await getMediaRuntimeConfiguration('azure-speech'))
  } catch (error) {
    console.error('Failed to load Azure Speech platform configuration:', error.message)
    return res.status(503).json({ configured: false, error: 'Azure Speech platform configuration is unavailable.' })
  }
})

router.get('/storage', createPlatformIntegrationServiceAuth([
  'identity-provider', 'recruiter', 'seemplify-learning', 'workspace', 'performance', 'experience-management', 'approver'
]), async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store')
    return res.json(await getStorageRuntimeConfiguration(req.platformIntegrationService))
  } catch (error) {
    console.error('Failed to load storage platform configuration:', error.message)
    return res.status(503).json({ configured: false, error: 'Storage platform configuration is unavailable.' })
  }
})

router.get('/storage/:solution', createPlatformIntegrationServiceAuth(Object.keys(STORAGE_SOLUTION_ACCESS)), async (req, res) => {
  try {
    const solution = String(req.params.solution || '').trim().toLowerCase()
    if (!canServiceAccessStorageSolution(req.platformIntegrationService, solution)) {
      return res.status(403).json({ configured: false, error: 'Storage solution access is not permitted.' })
    }
    res.setHeader('Cache-Control', 'no-store')
    return res.json(await getStorageRuntimeConfiguration(solution))
  } catch (error) {
    console.error('Failed to load solution storage platform configuration:', error.message)
    return res.status(503).json({ configured: false, error: 'Storage platform configuration is unavailable.' })
  }
})

export default router
