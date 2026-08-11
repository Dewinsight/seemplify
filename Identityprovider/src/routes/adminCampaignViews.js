import express from 'express'
import { requireAdminAuth, setAdminContext } from '../middleware/adminAuth.js'
import Campaign from '../models/Campaign.js'
import CampaignAudience from '../models/CampaignAudience.js'
import CampaignTemplate from '../models/CampaignTemplate.js'
import { getCampaignAnalytics, getCampaignConsoleSummary, getCampaignHomeSummary } from '../services/campaignAnalyticsService.js'
import { CAMPAIGN_AUDIENCE_FIELDS } from '../services/campaignAudienceService.js'
import { buildCampaignStats, loadCampaignHomeData } from '../services/campaignHomeService.js'
import { ensureSystemCampaignTemplates, getSenderHealthSummary } from '../services/campaignOperationsService.js'

const router = express.Router()

router.use(requireAdminAuth)
router.use(setAdminContext)

function mapAudiences(audiences = []) {
  return audiences.map((audience) => ({
    ...audience,
    contactCount: Array.isArray(audience.contacts) ? audience.contacts.length : 0
  }))
}

function filterCampaigns(campaigns = [], { search = '', status = 'all' } = {}) {
  const needle = String(search || '').trim().toLowerCase()
  const desiredStatus = String(status || 'all').trim().toLowerCase()

  return campaigns.filter((campaign) => {
    const matchesStatus = desiredStatus === 'all' || String(campaign.status || '').trim().toLowerCase() === desiredStatus
    if (!matchesStatus) return false
    if (!needle) return true

    const haystack = [
      campaign.name,
      campaign.status,
      campaign?.sender?.email,
      campaign?.sender?.name,
      campaign?.audience?.name
    ].join(' ').toLowerCase()

    return haystack.includes(needle)
  })
}

async function loadCampaignWorkspaceData(limit = 50) {
  await ensureSystemCampaignTemplates()
  const [campaigns, audiences, templates, senderHealth] = await Promise.all([
    getCampaignConsoleSummary(limit),
    CampaignAudience.find()
      .sort({ updatedAt: -1 })
      .select('name slug description sourceType sourceFileName columnMap importSummary contacts updatedAt')
      .lean(),
    CampaignTemplate.find()
      .sort({ systemTemplate: -1, updatedAt: -1 })
      .lean(),
    getSenderHealthSummary()
  ])

  return {
    campaigns,
    audiences: mapAudiences(audiences),
    templates,
    senderHealth,
    audienceFields: CAMPAIGN_AUDIENCE_FIELDS
  }
}

router.get('/', async (req, res) => {
  try {
    const homeData = await loadCampaignHomeData(getCampaignHomeSummary)

    res.render('admin/campaigns-home', {
      activePage: 'campaigns',
      ...homeData,
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

router.get('/create', async (req, res) => {
  try {
    const workspaceData = await loadCampaignWorkspaceData()

    res.render('admin/campaigns', {
      activePage: 'campaigns',
      ...workspaceData,
      workspaceMode: 'create',
      workspaceTitle: 'Create Campaign',
      workspaceDescription: 'Build a new campaign in its own focused workspace.',
      selectedCampaign: null,
      user: req.user
    })
  } catch (error) {
    console.error('Campaign create view error:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load the campaign workspace.'
    })
  }
})

router.get('/manage', async (req, res) => {
  try {
    const campaigns = await getCampaignConsoleSummary(100)
    const search = String(req.query.search || '').trim()
    const status = String(req.query.status || 'all').trim().toLowerCase()
    const filteredCampaigns = filterCampaigns(campaigns, { search, status })

    res.render('admin/campaign-manage', {
      activePage: 'campaigns',
      campaigns: filteredCampaigns,
      stats: buildCampaignStats(campaigns),
      filters: {
        search,
        status
      },
      totalCampaigns: campaigns.length,
      filteredCount: filteredCampaigns.length,
      user: req.user
    })
  } catch (error) {
    console.error('Campaign manage view error:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load campaigns.'
    })
  }
})

router.get('/editor/:campaignId', async (req, res) => {
  try {
    const [workspaceData, selectedCampaign] = await Promise.all([
      loadCampaignWorkspaceData(),
      Campaign.findById(req.params.campaignId).lean()
    ])

    if (!selectedCampaign) {
      return res.status(404).render('error', {
        title: 'Not Found',
        message: 'Campaign not found.'
      })
    }

    res.render('admin/campaigns', {
      activePage: 'campaigns',
      ...workspaceData,
      workspaceMode: 'edit',
      workspaceTitle: 'Edit Campaign',
      workspaceDescription: 'Update campaign setup, content, audience, and test sends without the campaign manager clutter.',
      selectedCampaign,
      user: req.user
    })
  } catch (error) {
    console.error('Campaign editor view error:', error)
    res.status(500).render('error', {
      title: 'Error',
      message: 'Failed to load the campaign editor.'
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
