export const CAMPAIGN_AUDIENCE_SUMMARY_PIPELINE = [
  { $sort: { updatedAt: -1 } },
  {
    $project: {
      name: 1,
      slug: 1,
      description: 1,
      sourceType: 1,
      sourceFileName: 1,
      columnMap: 1,
      importSummary: 1,
      createdAt: 1,
      updatedAt: 1,
      contactCount: {
        $size: { $ifNull: ['$contacts', []] }
      }
    }
  }
]

export function loadCampaignAudienceSummaries(CampaignAudienceModel) {
  return CampaignAudienceModel.aggregate(CAMPAIGN_AUDIENCE_SUMMARY_PIPELINE)
}

export async function loadCampaignWorkspaceData({
  syncTemplates,
  loadCampaigns,
  loadAudiences,
  loadTemplates,
  loadSenderHealth,
  logger = console
}) {
  try {
    await syncTemplates()
  } catch (error) {
    logger.error?.('Campaign template sync failed; using persisted templates:', error)
  }

  const senderHealthPromise = loadSenderHealth().catch((error) => {
    logger.error?.('Campaign sender health summary failed; continuing without live health:', error)
    return []
  })

  const [campaigns, audiences, templates, senderHealth] = await Promise.all([
    loadCampaigns(),
    loadAudiences(),
    loadTemplates(),
    senderHealthPromise
  ])

  return {
    campaigns,
    audiences,
    templates,
    senderHealth
  }
}
