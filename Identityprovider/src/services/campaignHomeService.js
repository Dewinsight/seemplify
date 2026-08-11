export function buildCampaignStats(campaigns = []) {
  return campaigns.reduce((summary, campaign) => {
    summary.total += 1
    summary[String(campaign.status || 'draft')] = (summary[String(campaign.status || 'draft')] || 0) + 1
    if (campaign?.sender?.readinessBand === 'green') {
      summary.healthySenders += 1
    }
    return summary
  }, {
    total: 0,
    draft: 0,
    running: 0,
    paused: 0,
    completed: 0,
    healthySenders: 0
  })
}

export async function loadCampaignHomeData(loadCampaigns, limit = 12) {
  if (typeof loadCampaigns !== 'function') {
    throw new TypeError('loadCampaigns must be a function')
  }

  const campaigns = await loadCampaigns(limit)

  return {
    stats: buildCampaignStats(campaigns),
    recentCampaigns: campaigns.slice(0, 6)
  }
}
