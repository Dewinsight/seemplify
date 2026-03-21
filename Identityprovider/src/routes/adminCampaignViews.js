import express from 'express'
import { requireAdminAuth, setAdminContext } from '../middleware/adminAuth.js'
import CampaignAudience from '../models/CampaignAudience.js'
import CampaignTemplate from '../models/CampaignTemplate.js'
import { getCampaignAnalytics, getCampaignConsoleSummary } from '../services/campaignAnalyticsService.js'
import { CAMPAIGN_AUDIENCE_FIELDS } from '../services/campaignAudienceService.js'
import { ensureSystemCampaignTemplates, getSenderHealthSummary } from '../services/campaignOperationsService.js'

const router = express.Router()

router.use(requireAdminAuth)
router.use(setAdminContext)

router.get('/', async (req, res) => {
  try {
    await ensureSystemCampaignTemplates()
    const [campaigns, audiences, templates, senderHealth] = await Promise.all([
      getCampaignConsoleSummary(50),
      CampaignAudience.find()
        .sort({ updatedAt: -1 })
        .select('name slug description sourceType sourceFileName columnMap importSummary contacts updatedAt')
        .lean(),
      CampaignTemplate.find()
        .sort({ systemTemplate: -1, updatedAt: -1 })
        .lean(),
      getSenderHealthSummary()
    ])

    res.render('admin/campaigns', {
      activePage: 'campaigns',
      campaigns,
      audiences: audiences.map((audience) => ({
        ...audience,
        contactCount: Array.isArray(audience.contacts) ? audience.contacts.length : 0
      })),
      templates,
      senderHealth,
      audienceFields: CAMPAIGN_AUDIENCE_FIELDS,
      user: req.user
    })
  } catch (error) {
    console.error('Campaign console view error:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load the campaign console.'
    })
  }
})

router.get('/:campaignId', async (req, res) => {
  try {
    const analytics = await getCampaignAnalytics(req.params.campaignId)
    if (!analytics) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Campaign not found.'
      })
    }

    res.render('admin/campaign-detail', {
      activePage: 'campaigns',
      analytics,
      user: req.user
    })
  } catch (error) {
    console.error('Campaign detail view error:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load campaign analytics.'
    })
  }
})

export default router
