import AppLaunchActivity from '../models/AppLaunchActivity.js'
import Subscription from '../models/Subscription.js'
import { Organization } from '../models/Organization.js'
import { getAppById } from '../config/hubApps.js'

const DAY_IN_MS = 24 * 60 * 60 * 1000

const WORKFORCE_APPS = [
  {
    appId: 'payroll-management',
    featureKey: 'payrollManagement',
    defaultName: 'Payroll',
    defaultColor: '#f59e0b'
  },
  {
    appId: 'leave-management',
    featureKey: 'leaveManagement',
    defaultName: 'Leave Management',
    defaultColor: '#8b5cf6'
  },
  {
    appId: 'time-attendance',
    featureKey: 'timeAttendance',
    defaultName: 'Time & Attendance',
    defaultColor: '#a855f7'
  }
]

function toPlainObject(value) {
  if (!value) return {}
  return typeof value.toObject === 'function' ? value.toObject() : value
}

function toIdString(value) {
  return value ? String(value) : ''
}

function mapLaunchStatusToBadge(status = '') {
  if (typeof status === 'string' && status.startsWith('launched_')) return 'active'
  if (status === 'blocked_subscription') return 'pending'
  if (status === 'no_session') return 'cancelled'
  return 'rejected'
}

function buildEffectiveFeatures(subscription) {
  const planFeatures = toPlainObject(subscription?.plan?.features)
  const customFeatures = toPlainObject(subscription?.customFeatures)
  const effective = { ...planFeatures }

  Object.entries(customFeatures).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      effective[key] = value
    }
  })

  return effective
}

function formatCompactDate(date) {
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short'
  })
}

function formatGrowth(currentValue, previousValue) {
  if (previousValue > 0) {
    const change = ((currentValue - previousValue) / previousValue) * 100
    return {
      value: change,
      label: `${change >= 0 ? '+' : ''}${change.toFixed(0)}% vs previous 30 days`,
      tone: change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral'
    }
  }

  if (currentValue > 0) {
    return {
      value: 100,
      label: 'New activity vs previous 30 days',
      tone: 'positive'
    }
  }

  return {
    value: 0,
    label: 'No change vs previous 30 days',
    tone: 'neutral'
  }
}

function buildSparkline(days, countsByDay) {
  const maxCount = Math.max(...days.map(day => countsByDay.get(day.key) || 0), 0)

  return days.map((day) => {
    const count = countsByDay.get(day.key) || 0
    return {
      ...day,
      count,
      height: maxCount > 0 ? Math.max(18, Math.round((count / maxCount) * 100)) : 10
    }
  })
}

function createDaySeries(startDate, endDate) {
  const days = []

  for (let time = startDate.getTime(); time <= endDate.getTime(); time += DAY_IN_MS) {
    const date = new Date(time)
    const key = date.toISOString().slice(0, 10)
    days.push({
      key,
      label: formatCompactDate(date)
    })
  }

  return days
}

async function getEntitledOrganizations() {
  const activeSubscriptions = await Subscription.find({
    status: { $in: ['active', 'expired'] },
    $or: [
      { endDate: { $gte: new Date() } },
      { gracePeriodEnd: { $gte: new Date() } }
    ]
  }).populate('plan', 'features')

  const entitledByApp = new Map(WORKFORCE_APPS.map(app => [app.appId, new Set()]))
  const hrSuiteEntitledOrganizations = new Set()

  for (const subscription of activeSubscriptions) {
    const organizationId = toIdString(subscription.organization)
    if (!organizationId) continue

    const effectiveFeatures = buildEffectiveFeatures(subscription)
    let hasAnyWorkforceFeature = false

    for (const app of WORKFORCE_APPS) {
      if (effectiveFeatures[app.featureKey] === true) {
        entitledByApp.get(app.appId).add(organizationId)
        hasAnyWorkforceFeature = true
      }
    }

    if (hasAnyWorkforceFeature) {
      hrSuiteEntitledOrganizations.add(organizationId)
    }
  }

  return {
    entitledByApp,
    hrSuiteEntitledOrganizations: hrSuiteEntitledOrganizations.size
  }
}

async function getUsageAnalytics(lookback30Start, lookback7Start, previous30Start, appIds) {
  const [overallSummaryRaw, appUsageRaw, dailyTrendRaw, topOrganizationsRaw, recentActivityRaw] = await Promise.all([
    AppLaunchActivity.aggregate([
      {
        $match: {
          appId: { $in: appIds },
          createdAt: { $gte: lookback30Start }
        }
      },
      {
        $group: {
          _id: null,
          successfulLaunches30d: {
            $sum: {
              $cond: [
                { $regexMatch: { input: '$status', regex: /^launched_/ } },
                1,
                0
              ]
            }
          },
          blockedLaunches30d: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'blocked_subscription'] },
                1,
                0
              ]
            }
          },
          activeOrganizationsSet: {
            $addToSet: {
              $cond: [
                { $regexMatch: { input: '$status', regex: /^launched_/ } },
                '$organization',
                null
              ]
            }
          },
          activeUsersSet: {
            $addToSet: {
              $cond: [
                { $regexMatch: { input: '$status', regex: /^launched_/ } },
                '$account',
                null
              ]
            }
          }
        }
      },
      {
        $project: {
          successfulLaunches30d: 1,
          blockedLaunches30d: 1,
          activeOrganizations30d: {
            $size: {
              $setDifference: ['$activeOrganizationsSet', [null]]
            }
          },
          activeUsers30d: {
            $size: {
              $setDifference: ['$activeUsersSet', [null]]
            }
          }
        }
      }
    ]),
    AppLaunchActivity.aggregate([
      {
        $match: {
          appId: { $in: appIds },
          createdAt: { $gte: previous30Start }
        }
      },
      {
        $group: {
          _id: '$appId',
          totalAttempts30d: {
            $sum: {
              $cond: [
                { $gte: ['$createdAt', lookback30Start] },
                1,
                0
              ]
            }
          },
          successfulLaunches30d: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$createdAt', lookback30Start] },
                    { $regexMatch: { input: '$status', regex: /^launched_/ } }
                  ]
                },
                1,
                0
              ]
            }
          },
          launches7d: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$createdAt', lookback7Start] },
                    { $regexMatch: { input: '$status', regex: /^launched_/ } }
                  ]
                },
                1,
                0
              ]
            }
          },
          blockedLaunches30d: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$createdAt', lookback30Start] },
                    { $eq: ['$status', 'blocked_subscription'] }
                  ]
                },
                1,
                0
              ]
            }
          },
          previousSuccessfulLaunches30d: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $lt: ['$createdAt', lookback30Start] },
                    { $gte: ['$createdAt', previous30Start] },
                    { $regexMatch: { input: '$status', regex: /^launched_/ } }
                  ]
                },
                1,
                0
              ]
            }
          },
          activeOrganizationsSet: {
            $addToSet: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$createdAt', lookback30Start] },
                    { $regexMatch: { input: '$status', regex: /^launched_/ } }
                  ]
                },
                '$organization',
                null
              ]
            }
          },
          activeUsersSet: {
            $addToSet: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$createdAt', lookback30Start] },
                    { $regexMatch: { input: '$status', regex: /^launched_/ } }
                  ]
                },
                '$account',
                null
              ]
            }
          },
          lastLaunchAt: { $max: '$createdAt' }
        }
      },
      {
        $project: {
          totalAttempts30d: 1,
          successfulLaunches30d: 1,
          launches7d: 1,
          blockedLaunches30d: 1,
          previousSuccessfulLaunches30d: 1,
          lastLaunchAt: 1,
          activeOrganizations30d: {
            $size: {
              $setDifference: ['$activeOrganizationsSet', [null]]
            }
          },
          activeUsers30d: {
            $size: {
              $setDifference: ['$activeUsersSet', [null]]
            }
          }
        }
      }
    ]),
    AppLaunchActivity.aggregate([
      {
        $match: {
          appId: { $in: appIds },
          createdAt: { $gte: lookback30Start },
          status: /^launched_/
        }
      },
      {
        $group: {
          _id: {
            appId: '$appId',
            day: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt'
              }
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.day': 1 } }
    ]),
    AppLaunchActivity.aggregate([
      {
        $match: {
          appId: { $in: appIds },
          createdAt: { $gte: lookback30Start },
          status: /^launched_/,
          organization: { $ne: null }
        }
      },
      {
        $group: {
          _id: {
            organization: '$organization',
            appId: '$appId'
          },
          launches: { $sum: 1 },
          lastUsedAt: { $max: '$createdAt' }
        }
      },
      {
        $group: {
          _id: '$_id.organization',
          totalLaunches: { $sum: '$launches' },
          appsUsed: { $sum: 1 },
          lastUsedAt: { $max: '$lastUsedAt' },
          appBreakdown: {
            $push: {
              appId: '$_id.appId',
              launches: '$launches'
            }
          }
        }
      },
      { $sort: { totalLaunches: -1, lastUsedAt: -1 } },
      { $limit: 8 }
    ]),
    AppLaunchActivity.find({ appId: { $in: appIds } })
      .sort({ createdAt: -1 })
      .limit(12)
      .populate('organization', 'name')
      .populate('account', 'email profile.name')
      .lean()
  ])

  return {
    overallSummaryRaw: overallSummaryRaw[0] || {},
    appUsageRaw,
    dailyTrendRaw,
    topOrganizationsRaw,
    recentActivityRaw
  }
}

export async function getWorkforceOperationsAnalytics() {
  const now = new Date()
  const appIds = WORKFORCE_APPS.map(app => app.appId)
  const lookback30Start = new Date(now.getTime() - (29 * DAY_IN_MS))
  const lookback7Start = new Date(now.getTime() - (6 * DAY_IN_MS))
  const previous30Start = new Date(now.getTime() - (59 * DAY_IN_MS))
  const daySeries = createDaySeries(lookback30Start, now)

  const [entitlementData, usageData] = await Promise.all([
    getEntitledOrganizations(),
    getUsageAnalytics(lookback30Start, lookback7Start, previous30Start, appIds)
  ])

  const appUsageById = new Map(usageData.appUsageRaw.map(item => [item._id, item]))
  const dailyTrendByApp = new Map(appIds.map(appId => [appId, new Map()]))

  for (const row of usageData.dailyTrendRaw) {
    const appId = row?._id?.appId
    const dayKey = row?._id?.day
    if (!appId || !dayKey || !dailyTrendByApp.has(appId)) continue
    dailyTrendByApp.get(appId).set(dayKey, row.count || 0)
  }

  const appAnalytics = WORKFORCE_APPS.map((app) => {
    const hubApp = getAppById(app.appId)
    const usage = appUsageById.get(app.appId) || {}
    const entitledOrganizations = entitlementData.entitledByApp.get(app.appId)?.size || 0
    const activeOrganizations30d = Number(usage.activeOrganizations30d || 0)
    const successfulLaunches30d = Number(usage.successfulLaunches30d || 0)
    const totalAttempts30d = Number(usage.totalAttempts30d || 0)
    const sparkline = buildSparkline(daySeries, dailyTrendByApp.get(app.appId) || new Map())

    return {
      appId: app.appId,
      name: hubApp?.name || app.defaultName,
      color: hubApp?.color || app.defaultColor,
      entitledOrganizations,
      activeOrganizations30d,
      idleOrganizations: Math.max(entitledOrganizations - activeOrganizations30d, 0),
      activeUsers30d: Number(usage.activeUsers30d || 0),
      launches7d: Number(usage.launches7d || 0),
      successfulLaunches30d,
      totalAttempts30d,
      blockedLaunches30d: Number(usage.blockedLaunches30d || 0),
      adoptionRate30d: entitledOrganizations > 0
        ? Math.round((activeOrganizations30d / entitledOrganizations) * 100)
        : 0,
      successRate30d: totalAttempts30d > 0
        ? Math.round((successfulLaunches30d / totalAttempts30d) * 100)
        : 0,
      lastLaunchAt: usage.lastLaunchAt || null,
      growth: formatGrowth(
        successfulLaunches30d,
        Number(usage.previousSuccessfulLaunches30d || 0)
      ),
      sparkline
    }
  })

  const mostUsedApp = [...appAnalytics]
    .sort((a, b) => b.successfulLaunches30d - a.successfulLaunches30d)[0] || null

  const topOrganizationIds = usageData.topOrganizationsRaw
    .map(item => toIdString(item._id))
    .filter(Boolean)

  const organizations = topOrganizationIds.length > 0
    ? await Organization.find({ _id: { $in: topOrganizationIds } })
      .select('_id name')
      .lean()
    : []

  const organizationNames = new Map(
    organizations.map(org => [toIdString(org._id), org.name || 'Unknown Organization'])
  )

  const topOrganizations = usageData.topOrganizationsRaw.map((item) => {
    const organizationId = toIdString(item._id)
    const appBreakdown = (item.appBreakdown || [])
      .map((entry) => {
        const fallbackApp = WORKFORCE_APPS.find(app => app.appId === entry.appId)
        const label = getAppById(entry.appId)?.name || fallbackApp?.defaultName || entry.appId
        return {
          appId: entry.appId,
          label,
          launches: Number(entry.launches || 0)
        }
      })
      .sort((a, b) => b.launches - a.launches)

    return {
      organizationId,
      organizationName: organizationNames.get(organizationId) || 'Unknown Organization',
      totalLaunches: Number(item.totalLaunches || 0),
      appsUsed: Number(item.appsUsed || 0),
      lastUsedAt: item.lastUsedAt || null,
      appBreakdown,
      breakdownText: appBreakdown.map(entry => `${entry.label} ${entry.launches}`).join(' | ')
    }
  })

  const recentActivity = usageData.recentActivityRaw.map((activity) => ({
    id: toIdString(activity._id),
    appId: activity.appId,
    appName: getAppById(activity.appId)?.name || activity.appName || activity.appId,
    organizationName: activity.organization?.name || 'Unknown Organization',
    accountName: activity.account?.profile?.name || activity.account?.email || 'Unknown User',
    status: activity.status || 'unknown',
    statusLabel: String(activity.status || 'unknown').replace(/_/g, ' '),
    badgeStatus: mapLaunchStatusToBadge(activity.status),
    createdAt: activity.createdAt
  }))

  return {
    summary: {
      entitledOrganizations: entitlementData.hrSuiteEntitledOrganizations,
      activeOrganizations30d: Number(usageData.overallSummaryRaw.activeOrganizations30d || 0),
      activeUsers30d: Number(usageData.overallSummaryRaw.activeUsers30d || 0),
      successfulLaunches30d: Number(usageData.overallSummaryRaw.successfulLaunches30d || 0),
      blockedLaunches30d: Number(usageData.overallSummaryRaw.blockedLaunches30d || 0),
      lookbackLabel: 'Last 30 days',
      lookbackStart: lookback30Start,
      lookbackEnd: now,
      mostUsedAppName: mostUsedApp?.name || 'None',
      averageAdoptionRate: appAnalytics.length > 0
        ? Math.round(appAnalytics.reduce((sum, app) => sum + app.adoptionRate30d, 0) / appAnalytics.length)
        : 0
    },
    apps: appAnalytics,
    topOrganizations,
    recentActivity
  }
}
