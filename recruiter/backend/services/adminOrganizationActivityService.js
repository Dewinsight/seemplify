const mongoose = require('mongoose');
const UserActivityEvent = require('../models/UserActivityEvent');
const UserSession = require('../models/UserSession');
const User = require('../models/User');
const Organization = require('../models/Organization');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const Interview = require('../models/Interview');
const AIInterview = require('../models/AIInterview');
const OnboardingAuditEvent = require('../models/OnboardingAuditEvent');

const RANGE_DAYS = Object.freeze({ '7d': 7, '30d': 30, '90d': 90 });
const MODULE_LABELS = Object.freeze({
  authentication: 'Authentication',
  platform: 'Platform',
  jobs: 'Jobs',
  candidates: 'Candidates',
  interviews: 'Interviews',
  'ai-interviews': 'AI interviews',
  'ai-assistant': 'AI assistant',
  'people-transitions': 'People transitions',
  'cv-processing': 'CV processing',
  'candidate-enrichment': 'Candidate enrichment',
  organization: 'Organization',
  billing: 'Billing',
  notifications: 'Notifications',
  security: 'Security'
});

function normalizeActivityRange(value) {
  return Object.prototype.hasOwnProperty.call(RANGE_DAYS, value) || value === 'all'
    ? value
    : '30d';
}

function getActivityRangeStart(range, now = new Date()) {
  const normalizedRange = normalizeActivityRange(range);
  if (normalizedRange === 'all') return null;

  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (RANGE_DAYS[normalizedRange] - 1));
  return start;
}

function normalizePagination(pageValue, limitValue) {
  const page = Math.max(1, Number.parseInt(pageValue, 10) || 1);
  const limit = Math.min(100, Math.max(10, Number.parseInt(limitValue, 10) || 25));
  return { page, limit };
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toObjectId(value) {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) return null;
  return new mongoose.Types.ObjectId(String(value));
}

function getUserName(user) {
  if (!user) return 'Unknown user';
  return user.profile?.displayName
    || `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim()
    || user.email
    || 'Unknown user';
}

function calculateRate(value, total) {
  if (!Number(total)) return 0;
  return Math.round((Number(value || 0) / Number(total)) * 1000) / 10;
}

function maxDate(...values) {
  const timestamps = values
    .flat()
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

function createDateMatch(field, start, end) {
  return {
    [field]: {
      ...(start ? { $gte: start } : {}),
      $lte: end
    }
  };
}

function dateBucketExpression(field, range) {
  return {
    $dateToString: {
      format: normalizeActivityRange(range) === 'all' ? '%Y-%m' : '%Y-%m-%d',
      date: field,
      timezone: 'UTC'
    }
  };
}

function getPrimaryOrganizationId(user) {
  const current = user.currentOrganization?._id || user.currentOrganization;
  if (current) return String(current);
  const activeMembership = user.organizationMemberships?.find((membership) => membership.isActive);
  return activeMembership ? String(activeMembership.organization?._id || activeMembership.organization) : null;
}

function rowMatchesSearch(row, search) {
  if (!search) return true;
  const normalized = String(search).trim().toLowerCase();
  if (!normalized) return true;
  return [
    row.name,
    row.email,
    row.organization?.name,
    row.description,
    row.moduleLabel,
    row.path,
    row.ip
  ].some((value) => String(value || '').toLowerCase().includes(normalized));
}

function paginateRows(rows, pageValue, limitValue) {
  const { page, limit } = normalizePagination(pageValue, limitValue);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * limit;
  return {
    rows: rows.slice(offset, offset + limit),
    pagination: { page: safePage, limit, total, totalPages }
  };
}

function mergeMetric(target, source = {}) {
  Object.entries(source).forEach(([key, value]) => {
    if (key === 'lastActiveAt') {
      target.lastActiveAt = maxDate(target.lastActiveAt, value);
    } else if (typeof value === 'number') {
      target[key] = Number(target[key] || 0) + value;
    }
  });
  return target;
}

function mergeActivityTrendRows(rowsBySource, range, start, end) {
  const points = new Map();
  const getPoint = (date) => {
    if (!points.has(date)) {
      points.set(date, {
        date,
        activeUsers: new Set(),
        activeOrganizations: new Set(),
        requests: 0,
        actions: 0,
        failures: 0,
        logins: 0,
        jobs: 0,
        candidates: 0,
        interviews: 0,
        aiInterviews: 0,
        transitions: 0
      });
    }
    return points.get(date);
  };

  if (normalizeActivityRange(range) !== 'all' && start) {
    const cursor = new Date(start);
    while (cursor <= end) {
      getPoint(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  Object.entries(rowsBySource).forEach(([metric, rows]) => {
    rows.forEach((row) => {
      const point = getPoint(row._id);
      if (metric === 'activity') {
        point.requests += Number(row.requests || 0);
        point.actions += Number(row.actions || 0);
        point.failures += Number(row.failures || 0);
        point.logins += Number(row.logins || 0);
      } else {
        if (metric === 'logins') {
          point.logins = Math.max(point.logins, Number(row.count || 0));
        } else {
          point[metric] += Number(row.count || 0);
        }
        if (metric !== 'logins') point.actions += Number(row.count || 0);
      }
      (row.users || []).forEach((id) => id && point.activeUsers.add(String(id)));
      (row.organizations || []).forEach((id) => id && point.activeOrganizations.add(String(id)));
    });
  });

  return [...points.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((point) => ({
      ...point,
      activeUsers: point.activeUsers.size,
      activeOrganizations: point.activeOrganizations.size
    }));
}

function createResourceAggregation({ dateField, organizationField, userField, start, end, organizationId, userId }) {
  const match = createDateMatch(dateField, start, end);
  if (organizationId) match[organizationField] = organizationId;
  if (userId) match[userField] = userId;

  return [
    { $match: match },
    {
      $group: {
        _id: { organization: `$${organizationField}`, user: `$${userField}` },
        count: { $sum: 1 },
        lastActiveAt: { $max: `$${dateField}` }
      }
    }
  ];
}

function createResourceTrendAggregation({ dateField, organizationField, userField, start, end, organizationId, userId, range }) {
  const match = createDateMatch(dateField, start, end);
  if (organizationId) match[organizationField] = organizationId;
  if (userId) match[userField] = userId;

  return [
    { $match: match },
    {
      $group: {
        _id: dateBucketExpression(`$${dateField}`, range),
        count: { $sum: 1 },
        users: { $addToSet: `$${userField}` },
        organizations: { $addToSet: `$${organizationField}` }
      }
    }
  ];
}

function applyResourceRows(rows, metric, organizationMetrics, userMetrics) {
  rows.forEach((row) => {
    const organizationId = row._id?.organization ? String(row._id.organization) : null;
    const userId = row._id?.user ? String(row._id.user) : null;
    const values = { [metric]: Number(row.count || 0), lastActiveAt: row.lastActiveAt };

    if (organizationId) {
      if (!organizationMetrics.has(organizationId)) organizationMetrics.set(organizationId, {});
      mergeMetric(organizationMetrics.get(organizationId), values);
    }
    if (userId) {
      if (!userMetrics.has(userId)) userMetrics.set(userId, {});
      mergeMetric(userMetrics.get(userId), values);
    }
  });
}

async function buildActivityDataset(filters = {}, now = new Date(), options = {}) {
  const includeOverview = options.includeOverview !== false;
  const range = normalizeActivityRange(filters.range);
  const start = getActivityRangeStart(range, now);
  const organizationId = toObjectId(filters.organizationId);
  const userId = toObjectId(filters.userId);
  const userQuery = userId ? { _id: userId } : {};

  if (organizationId) {
    userQuery.$or = [
      { currentOrganization: organizationId },
      {
        organizationMemberships: {
          $elemMatch: { organization: organizationId, isActive: true }
        }
      }
    ];
  }

  const [organizations, users] = await Promise.all([
    Organization.find(organizationId ? { _id: organizationId } : {})
      .select('name isActive createdAt subscription.plan subscription.licenseStatus subscription.creditUsage members')
      .lean(),
    User.find(userQuery)
      .select('email profile role isActive createdAt lastLoginAt loginCount currentOrganization organizationMemberships')
      .lean()
  ]);

  const userIds = users.map((user) => user._id);
  const resourceBase = { start, end: now, organizationId, userId };
  const sessionMatch = {
    user: { $in: userIds },
    $or: [
      createDateMatch('createdAt', start, now),
      createDateMatch('lastActivityAt', start, now)
    ]
  };
  const sessionCreatedMatch = {
    user: { $in: userIds },
    ...createDateMatch('createdAt', start, now)
  };
  const eventMatch = createDateMatch('occurredAt', start, now);
  if (organizationId) eventMatch.organization = organizationId;
  if (userId) eventMatch.user = userId;

  const jobConfig = { ...resourceBase, dateField: 'createdAt', organizationField: 'organization', userField: 'createdBy', range };
  const candidateConfig = { ...resourceBase, dateField: 'createdAt', organizationField: 'organization', userField: 'createdBy', range };
  const interviewConfig = { ...resourceBase, dateField: 'createdAt', organizationField: 'organizationId', userField: 'interviewerId', range };
  const aiInterviewConfig = { ...resourceBase, dateField: 'createdAt', organizationField: 'organization', userField: 'createdBy', range };
  const transitionConfig = { ...resourceBase, dateField: 'createdAt', organizationField: 'organization', userField: 'actorUser', range };

  const [
    eventGroups,
    sessionGroups,
    jobGroups,
    candidateGroups,
    interviewGroups,
    aiInterviewGroups,
    transitionGroups,
    creditGroups,
    moduleGroups,
    activityTrend,
    sessionTrend,
    jobTrend,
    candidateTrend,
    interviewTrend,
    aiInterviewTrend,
    transitionTrend
  ] = await Promise.all([
    UserActivityEvent.aggregate([
      { $match: eventMatch },
      {
        $group: {
          _id: { organization: '$organization', user: '$user' },
          trackedRequests: { $sum: 1 },
          trackedActions: { $sum: { $cond: [{ $in: ['$category', ['action', 'authentication']] }, 1, 0] } },
          trackedLogins: { $sum: { $cond: [{ $eq: ['$category', 'authentication'] }, 1, 0] } },
          failedRequests: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } },
          lastActiveAt: { $max: '$occurredAt' }
        }
      }
    ]),
    UserSession.aggregate([
      { $match: sessionMatch },
      {
        $group: {
          _id: '$user',
          sessions: { $sum: 1 },
          activeSessions: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ['$revoked', true] }, { $gt: ['$expiresAt', now] }] },
                1,
                0
              ]
            }
          },
          lastActiveAt: { $max: { $ifNull: ['$lastActivityAt', '$createdAt'] } },
          ips: { $addToSet: '$ip' },
          devices: { $addToSet: '$userAgent' }
        }
      }
    ]),
    Job.aggregate(createResourceAggregation(jobConfig)),
    Candidate.aggregate(createResourceAggregation(candidateConfig)),
    Interview.aggregate(createResourceAggregation(interviewConfig)),
    AIInterview.aggregate(createResourceAggregation(aiInterviewConfig)),
    OnboardingAuditEvent.aggregate(createResourceAggregation(transitionConfig)),
    Organization.aggregate([
      { $match: organizationId ? { _id: organizationId } : {} },
      { $unwind: { path: '$subscription.creditUsage.transactions', preserveNullAndEmptyArrays: false } },
      {
        $match: {
          ...createDateMatch('subscription.creditUsage.transactions.timestamp', start, now),
          'subscription.creditUsage.transactions.credits': { $gt: 0 },
          'subscription.creditUsage.transactions.action': {
            $nin: ['creditPurchase', 'creditRefund', 'cycleReset']
          },
          ...(userId ? { 'subscription.creditUsage.transactions.performedBy': userId } : {})
        }
      },
      {
        $group: {
          _id: {
            organization: '$_id',
            user: '$subscription.creditUsage.transactions.performedBy'
          },
          creditsUsed: { $sum: '$subscription.creditUsage.transactions.credits' },
          lastActiveAt: { $max: '$subscription.creditUsage.transactions.timestamp' }
        }
      }
    ]),
    includeOverview ? UserActivityEvent.aggregate([
      { $match: eventMatch },
      {
        $group: {
          _id: '$module',
          requests: { $sum: 1 },
          actions: { $sum: { $cond: [{ $eq: ['$category', 'action'] }, 1, 0] } },
          users: { $addToSet: '$user' },
          organizations: { $addToSet: '$organization' },
          failures: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } }
        }
      },
      { $sort: { requests: -1 } }
    ]) : Promise.resolve([]),
    includeOverview ? UserActivityEvent.aggregate([
      { $match: eventMatch },
      {
        $group: {
          _id: dateBucketExpression('$occurredAt', range),
          requests: { $sum: 1 },
          actions: { $sum: { $cond: [{ $eq: ['$category', 'action'] }, 1, 0] } },
          logins: { $sum: { $cond: [{ $eq: ['$category', 'authentication'] }, 1, 0] } },
          failures: { $sum: { $cond: [{ $gte: ['$statusCode', 400] }, 1, 0] } },
          users: { $addToSet: '$user' },
          organizations: { $addToSet: '$organization' }
        }
      }
    ]) : Promise.resolve([]),
    includeOverview ? UserSession.aggregate([
      { $match: sessionCreatedMatch },
      {
        $group: {
          _id: dateBucketExpression('$createdAt', range),
          count: { $sum: 1 },
          users: { $addToSet: '$user' }
        }
      }
    ]) : Promise.resolve([]),
    includeOverview ? Job.aggregate(createResourceTrendAggregation(jobConfig)) : Promise.resolve([]),
    includeOverview ? Candidate.aggregate(createResourceTrendAggregation(candidateConfig)) : Promise.resolve([]),
    includeOverview ? Interview.aggregate(createResourceTrendAggregation(interviewConfig)) : Promise.resolve([]),
    includeOverview ? AIInterview.aggregate(createResourceTrendAggregation(aiInterviewConfig)) : Promise.resolve([]),
    includeOverview ? OnboardingAuditEvent.aggregate(createResourceTrendAggregation(transitionConfig)) : Promise.resolve([])
  ]);

  const userMap = new Map(users.map((user) => [String(user._id), user]));
  sessionTrend.forEach((row) => {
    row.organizations = [...new Set((row.users || [])
      .map((id) => userMap.get(String(id)))
      .map(getPrimaryOrganizationId)
      .filter(Boolean))];
  });

  const organizationMetrics = new Map();
  const userMetrics = new Map();
  const organizationActiveUsers = new Map();
  const registerOrganizationUser = (organizationKey, userKey) => {
    if (!organizationKey || !userKey) return;
    if (!organizationActiveUsers.has(organizationKey)) {
      organizationActiveUsers.set(organizationKey, new Set());
    }
    organizationActiveUsers.get(organizationKey).add(userKey);
  };

  eventGroups.forEach((row) => {
    const organizationKey = row._id.organization ? String(row._id.organization) : null;
    const userKey = row._id.user ? String(row._id.user) : null;
    const values = {
      trackedRequests: Number(row.trackedRequests || 0),
      trackedActions: Number(row.trackedActions || 0),
      trackedLogins: Number(row.trackedLogins || 0),
      failedRequests: Number(row.failedRequests || 0),
      lastActiveAt: row.lastActiveAt
    };
    if (organizationKey) {
      if (!organizationMetrics.has(organizationKey)) organizationMetrics.set(organizationKey, {});
      mergeMetric(organizationMetrics.get(organizationKey), values);
      registerOrganizationUser(organizationKey, userKey);
    }
    if (userKey) {
      if (!userMetrics.has(userKey)) userMetrics.set(userKey, {});
      mergeMetric(userMetrics.get(userKey), values);
    }
  });

  sessionGroups.forEach((row) => {
    const userKey = String(row._id);
    const user = userMap.get(userKey);
    const organizationKey = user ? getPrimaryOrganizationId(user) : null;
    const values = {
      sessions: Number(row.sessions || 0),
      activeSessions: Number(row.activeSessions || 0),
      lastActiveAt: row.lastActiveAt
    };
    if (!userMetrics.has(userKey)) userMetrics.set(userKey, {});
    mergeMetric(userMetrics.get(userKey), {
      ...values,
      ipCount: (row.ips || []).filter(Boolean).length,
      deviceCount: (row.devices || []).filter(Boolean).length
    });
    if (organizationKey) {
      if (!organizationMetrics.has(organizationKey)) organizationMetrics.set(organizationKey, {});
      mergeMetric(organizationMetrics.get(organizationKey), values);
      registerOrganizationUser(organizationKey, userKey);
    }
  });

  [jobGroups, candidateGroups, interviewGroups, aiInterviewGroups, transitionGroups].forEach((rows) => {
    rows.forEach((row) => {
      registerOrganizationUser(
        row._id?.organization ? String(row._id.organization) : null,
        row._id?.user ? String(row._id.user) : null
      );
    });
  });

  applyResourceRows(jobGroups, 'jobs', organizationMetrics, userMetrics);
  applyResourceRows(candidateGroups, 'candidates', organizationMetrics, userMetrics);
  applyResourceRows(interviewGroups, 'interviews', organizationMetrics, userMetrics);
  applyResourceRows(aiInterviewGroups, 'aiInterviews', organizationMetrics, userMetrics);
  applyResourceRows(transitionGroups, 'transitions', organizationMetrics, userMetrics);

  creditGroups.forEach((row) => {
    const organizationKey = String(row._id.organization);
    const userKey = row._id.user ? String(row._id.user) : null;
    const values = {
      creditsUsed: Number(row.creditsUsed || 0),
      lastActiveAt: row.lastActiveAt
    };
    if (!organizationMetrics.has(organizationKey)) organizationMetrics.set(organizationKey, {});
    mergeMetric(organizationMetrics.get(organizationKey), values);
    registerOrganizationUser(organizationKey, userKey);
    if (userKey) {
      if (!userMetrics.has(userKey)) userMetrics.set(userKey, {});
      mergeMetric(userMetrics.get(userKey), values);
    }
  });

  const isActiveInRange = (value) => {
    if (!value) return false;
    return !start || new Date(value) >= start;
  };

  const userRows = users.map((user) => {
    const id = String(user._id);
    const metrics = userMetrics.get(id) || {};
    const primaryOrganizationId = getPrimaryOrganizationId(user);
    const organization = organizations.find((item) => String(item._id) === primaryOrganizationId);
    const businessActions = Number(metrics.jobs || 0)
      + Number(metrics.candidates || 0)
      + Number(metrics.interviews || 0)
      + Number(metrics.aiInterviews || 0)
      + Number(metrics.transitions || 0);
    const lastActiveAt = maxDate(metrics.lastActiveAt, user.lastLoginAt);

    return {
      id,
      name: getUserName(user),
      email: user.email,
      role: user.role,
      isActive: user.isActive !== false,
      joinedAt: user.createdAt,
      lastLoginAt: user.lastLoginAt || null,
      loginCount: Number(user.loginCount || 0),
      lastActiveAt,
      activeInRange: isActiveInRange(lastActiveAt),
      organization: organization
        ? { id: String(organization._id), name: organization.name }
        : primaryOrganizationId
          ? { id: primaryOrganizationId, name: 'Unknown organization' }
          : null,
      membershipCount: (user.organizationMemberships || []).filter((membership) => membership.isActive).length,
      sessions: Math.max(Number(metrics.sessions || 0), Number(metrics.trackedLogins || 0)),
      activeSessions: Number(metrics.activeSessions || 0),
      trackedRequests: Number(metrics.trackedRequests || 0),
      trackedActions: Number(metrics.trackedActions || 0),
      failedRequests: Number(metrics.failedRequests || 0),
      jobs: Number(metrics.jobs || 0),
      candidates: Number(metrics.candidates || 0),
      interviews: Number(metrics.interviews || 0),
      aiInterviews: Number(metrics.aiInterviews || 0),
      transitions: Number(metrics.transitions || 0),
      creditsUsed: Number(metrics.creditsUsed || 0),
      businessActions,
      activityScore: Number(metrics.trackedRequests || 0) + Number(metrics.sessions || 0) + businessActions,
      ipCount: Number(metrics.ipCount || 0),
      deviceCount: Number(metrics.deviceCount || 0)
    };
  }).sort((a, b) => b.activityScore - a.activityScore || new Date(b.lastActiveAt || 0) - new Date(a.lastActiveAt || 0));

  const organizationRows = organizations.map((organization) => {
    const id = String(organization._id);
    const metrics = organizationMetrics.get(id) || {};
    const members = (organization.members || []).filter((member) => member.status === 'active');
    const activeUsers = organizationActiveUsers.get(id)?.size || 0;
    const businessActions = Number(metrics.jobs || 0)
      + Number(metrics.candidates || 0)
      + Number(metrics.interviews || 0)
      + Number(metrics.aiInterviews || 0)
      + Number(metrics.transitions || 0);
    const activityScore = Number(metrics.trackedRequests || 0) + Number(metrics.sessions || 0) + businessActions;

    return {
      id,
      name: organization.name,
      plan: organization.subscription?.plan || 'Unassigned',
      licenseStatus: organization.subscription?.licenseStatus || 'unknown',
      isActive: organization.isActive !== false,
      createdAt: organization.createdAt,
      lastActiveAt: metrics.lastActiveAt || null,
      activeInRange: activityScore > 0 || activeUsers > 0,
      members: members.length,
      activeUsers,
      activationRate: calculateRate(activeUsers, members.length),
      sessions: Math.max(Number(metrics.sessions || 0), Number(metrics.trackedLogins || 0)),
      activeSessions: Number(metrics.activeSessions || 0),
      trackedRequests: Number(metrics.trackedRequests || 0),
      trackedActions: Number(metrics.trackedActions || 0),
      failedRequests: Number(metrics.failedRequests || 0),
      jobs: Number(metrics.jobs || 0),
      candidates: Number(metrics.candidates || 0),
      interviews: Number(metrics.interviews || 0),
      aiInterviews: Number(metrics.aiInterviews || 0),
      transitions: Number(metrics.transitions || 0),
      creditsUsed: Number(metrics.creditsUsed || 0),
      businessActions,
      activityScore
    };
  }).sort((a, b) => b.activityScore - a.activityScore || new Date(b.lastActiveAt || 0) - new Date(a.lastActiveAt || 0));

  const modules = moduleGroups.map((row) => ({
    id: row._id || 'platform',
    name: MODULE_LABELS[row._id] || String(row._id || 'Platform'),
    requests: Number(row.requests || 0),
    actions: Number(row.actions || 0),
    users: (row.users || []).filter(Boolean).length,
    organizations: new Set((row.organizations || []).filter(Boolean).map(String)).size,
    failures: Number(row.failures || 0)
  }));

  const resourceModules = [
    { id: 'jobs', name: MODULE_LABELS.jobs, actions: jobGroups.reduce((sum, row) => sum + Number(row.count || 0), 0) },
    { id: 'candidates', name: MODULE_LABELS.candidates, actions: candidateGroups.reduce((sum, row) => sum + Number(row.count || 0), 0) },
    { id: 'interviews', name: MODULE_LABELS.interviews, actions: interviewGroups.reduce((sum, row) => sum + Number(row.count || 0), 0) },
    { id: 'ai-interviews', name: MODULE_LABELS['ai-interviews'], actions: aiInterviewGroups.reduce((sum, row) => sum + Number(row.count || 0), 0) },
    { id: 'people-transitions', name: MODULE_LABELS['people-transitions'], actions: transitionGroups.reduce((sum, row) => sum + Number(row.count || 0), 0) }
  ];

  resourceModules.forEach((resourceModule) => {
    const existing = modules.find((module) => module.id === resourceModule.id);
    if (existing) existing.businessActions = resourceModule.actions;
    else modules.push({ ...resourceModule, requests: 0, users: 0, organizations: 0, failures: 0, businessActions: resourceModule.actions });
  });
  modules.sort((a, b) => (b.requests + (b.businessActions || 0)) - (a.requests + (a.businessActions || 0)));

  const trend = mergeActivityTrendRows({
    activity: activityTrend,
    logins: sessionTrend,
    jobs: jobTrend,
    candidates: candidateTrend,
    interviews: interviewTrend,
    aiInterviews: aiInterviewTrend,
    transitions: transitionTrend
  }, range, start, now);

  const totals = {
    organizations: organizationRows.length,
    activeOrganizations: organizationRows.filter((row) => row.activeInRange).length,
    inactiveOrganizations: organizationRows.filter((row) => !row.activeInRange).length,
    organizationActivationRate: calculateRate(organizationRows.filter((row) => row.activeInRange).length, organizationRows.length),
    users: userRows.length,
    activeUsers: userRows.filter((row) => row.activeInRange).length,
    inactiveUsers: userRows.filter((row) => !row.activeInRange).length,
    userActivationRate: calculateRate(userRows.filter((row) => row.activeInRange).length, userRows.length),
    sessions: userRows.reduce((sum, row) => sum + row.sessions, 0),
    activeSessions: sessionGroups.reduce((sum, row) => sum + Number(row.activeSessions || 0), 0),
    trackedRequests: eventGroups.reduce((sum, row) => sum + Number(row.trackedRequests || 0), 0),
    failedRequests: eventGroups.reduce((sum, row) => sum + Number(row.failedRequests || 0), 0),
    businessActions: resourceModules.reduce((sum, row) => sum + Number(row.actions || 0), 0),
    jobs: jobGroups.reduce((sum, row) => sum + Number(row.count || 0), 0),
    candidates: candidateGroups.reduce((sum, row) => sum + Number(row.count || 0), 0),
    interviews: interviewGroups.reduce((sum, row) => sum + Number(row.count || 0), 0),
    aiInterviews: aiInterviewGroups.reduce((sum, row) => sum + Number(row.count || 0), 0),
    transitions: transitionGroups.reduce((sum, row) => sum + Number(row.count || 0), 0),
    creditsUsed: organizationRows.reduce((sum, row) => sum + row.creditsUsed, 0)
  };

  return {
    generatedAt: now,
    range: { key: range, start, end: now, interval: range === 'all' ? 'month' : 'day' },
    totals,
    trend,
    modules,
    organizations: organizationRows,
    users: userRows
  };
}

function userOption(user) {
  if (!user) return null;
  return { id: String(user._id), name: getUserName(user), email: user.email };
}

function organizationOption(organization) {
  if (!organization) return null;
  return { id: String(organization._id || organization), name: organization.name || 'Unknown organization' };
}

async function getAdminActivityEvents(filters = {}) {
  const range = normalizeActivityRange(filters.range);
  const end = new Date();
  const start = getActivityRangeStart(range, end);
  const organizationId = toObjectId(filters.organizationId);
  const userId = toObjectId(filters.userId);
  const { page, limit } = normalizePagination(filters.page, filters.limit);
  const fetchLimit = Math.min(500, page * limit + 1);
  const moduleFilter = String(filters.module || 'all');
  const search = String(filters.search || '').trim();

  const userQuery = userId ? { _id: userId } : {};
  if (organizationId) {
    userQuery.$or = [
      { currentOrganization: organizationId },
      { organizationMemberships: { $elemMatch: { organization: organizationId, isActive: true } } }
    ];
  }
  const scopedUsers = await User.find(userQuery).select('_id').lean();
  const scopedUserIds = scopedUsers.map((user) => user._id);

  const eventMatch = createDateMatch('occurredAt', start, end);
  if (organizationId) eventMatch.organization = organizationId;
  if (userId) eventMatch.user = userId;
  if (moduleFilter !== 'all') eventMatch.module = moduleFilter;

  const sessionMatch = { user: { $in: scopedUserIds }, ...createDateMatch('createdAt', start, end) };
  const sourceEnabled = (source) => moduleFilter === 'all' || moduleFilter === source;
  const resourceMatch = (dateField, orgField, actorField) => ({
    ...createDateMatch(dateField, start, end),
    ...(organizationId ? { [orgField]: organizationId } : {}),
    ...(userId ? { [actorField]: userId } : {})
  });

  const [tracked, sessions, jobs, candidates, interviews, aiInterviews, transitions] = await Promise.all([
    UserActivityEvent.find(eventMatch)
      .populate('user', 'email profile')
      .populate('organization', 'name')
      .sort({ occurredAt: -1 })
      .limit(fetchLimit)
      .lean(),
    sourceEnabled('authentication')
      ? UserSession.find(sessionMatch)
        .populate({ path: 'user', select: 'email profile currentOrganization', populate: { path: 'currentOrganization', select: 'name' } })
        .sort({ createdAt: -1 })
        .limit(fetchLimit)
        .lean()
      : [],
    sourceEnabled('jobs')
      ? Job.find(resourceMatch('createdAt', 'organization', 'createdBy')).select('title createdAt createdBy organization').populate('createdBy', 'email profile').populate('organization', 'name').sort({ createdAt: -1 }).limit(fetchLimit).lean()
      : [],
    sourceEnabled('candidates')
      ? Candidate.find(resourceMatch('createdAt', 'organization', 'createdBy')).select('firstName lastName email createdAt createdBy organization').populate('createdBy', 'email profile').populate('organization', 'name').sort({ createdAt: -1 }).limit(fetchLimit).lean()
      : [],
    sourceEnabled('interviews')
      ? Interview.find(resourceMatch('createdAt', 'organizationId', 'interviewerId')).select('title createdAt interviewerId organizationId candidateId').populate('interviewerId', 'email profile').populate('organizationId', 'name').populate('candidateId', 'firstName lastName email').sort({ createdAt: -1 }).limit(fetchLimit).lean()
      : [],
    sourceEnabled('ai-interviews')
      ? AIInterview.find(resourceMatch('createdAt', 'organization', 'createdBy')).select('title createdAt createdBy organization').populate('createdBy', 'email profile').populate('organization', 'name').sort({ createdAt: -1 }).limit(fetchLimit).lean()
      : [],
    sourceEnabled('people-transitions')
      ? OnboardingAuditEvent.find(resourceMatch('createdAt', 'organization', 'actorUser')).select('action actorEmail createdAt actorUser organization').populate('actorUser', 'email profile').populate('organization', 'name').sort({ createdAt: -1 }).limit(fetchLimit).lean()
      : []
  ]);

  const trackedLoginSessionIds = new Set(
    tracked
      .filter((event) => event.category === 'authentication' && event.sessionId)
      .map((event) => event.sessionId)
  );

  const rows = [
    ...tracked.map((event) => ({
      id: `tracked:${event._id}`,
      source: 'tracked',
      category: event.category,
      module: event.module,
      moduleLabel: MODULE_LABELS[event.module] || event.module,
      action: event.action,
      description: `${event.action.charAt(0).toUpperCase()}${event.action.slice(1)} ${MODULE_LABELS[event.module] || event.module}`,
      occurredAt: event.occurredAt,
      actor: userOption(event.user),
      organization: organizationOption(event.organization),
      method: event.method,
      path: event.path,
      statusCode: event.statusCode,
      durationMs: event.durationMs,
      ip: event.ip,
      userAgent: event.userAgent
    })),
    ...sessions.filter((session) => !trackedLoginSessionIds.has(session.accessTokenId)).map((session) => ({
      id: `session:${session._id}`,
      source: 'session',
      category: 'authentication',
      module: 'authentication',
      moduleLabel: MODULE_LABELS.authentication,
      action: 'signed in',
      description: 'Signed in to Seemplify',
      occurredAt: session.createdAt,
      actor: userOption(session.user),
      organization: organizationOption(session.user?.currentOrganization),
      statusCode: session.revoked ? 401 : 200,
      ip: session.ip,
      userAgent: session.userAgent
    })),
    ...jobs.map((job) => ({
      id: `job:${job._id}`,
      source: 'job',
      category: 'action',
      module: 'jobs',
      moduleLabel: MODULE_LABELS.jobs,
      action: 'created',
      description: `Created job: ${job.title || 'Untitled job'}`,
      occurredAt: job.createdAt,
      actor: userOption(job.createdBy),
      organization: organizationOption(job.organization),
      statusCode: 201
    })),
    ...candidates.map((candidate) => {
      const candidateName = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.email || 'Candidate';
      return {
        id: `candidate:${candidate._id}`,
        source: 'candidate',
        category: 'action',
        module: 'candidates',
        moduleLabel: MODULE_LABELS.candidates,
        action: 'added',
        description: `Added candidate: ${candidateName}`,
        occurredAt: candidate.createdAt,
        actor: userOption(candidate.createdBy),
        organization: organizationOption(candidate.organization),
        statusCode: 201
      };
    }),
    ...interviews.map((interview) => {
      const candidateName = interview.candidateId
        ? `${interview.candidateId.firstName || ''} ${interview.candidateId.lastName || ''}`.trim() || interview.candidateId.email
        : null;
      return {
        id: `interview:${interview._id}`,
        source: 'interview',
        category: 'action',
        module: 'interviews',
        moduleLabel: MODULE_LABELS.interviews,
        action: 'scheduled',
        description: `Scheduled interview${candidateName ? ` with ${candidateName}` : interview.title ? `: ${interview.title}` : ''}`,
        occurredAt: interview.createdAt,
        actor: userOption(interview.interviewerId),
        organization: organizationOption(interview.organizationId),
        statusCode: 201
      };
    }),
    ...aiInterviews.map((interview) => ({
      id: `ai-interview:${interview._id}`,
      source: 'ai-interview',
      category: 'action',
      module: 'ai-interviews',
      moduleLabel: MODULE_LABELS['ai-interviews'],
      action: 'created',
      description: `Created AI interview: ${interview.title || 'Untitled interview'}`,
      occurredAt: interview.createdAt,
      actor: userOption(interview.createdBy),
      organization: organizationOption(interview.organization),
      statusCode: 201
    })),
    ...transitions.map((event) => ({
      id: `transition:${event._id}`,
      source: 'transition',
      category: 'action',
      module: 'people-transitions',
      moduleLabel: MODULE_LABELS['people-transitions'],
      action: event.action,
      description: `People transition: ${String(event.action || 'activity').replace(/_/g, ' ')}`,
      occurredAt: event.createdAt,
      actor: userOption(event.actorUser) || (event.actorEmail ? { id: '', name: event.actorEmail, email: event.actorEmail } : null),
      organization: organizationOption(event.organization),
      statusCode: 200
    }))
  ]
    .filter((row) => rowMatchesSearch({ ...row, name: row.actor?.name, email: row.actor?.email }, search))
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));

  const offset = (page - 1) * limit;
  return {
    events: rows.slice(offset, offset + limit),
    pagination: {
      page,
      limit,
      hasMore: rows.length > offset + limit,
      loaded: rows.length
    }
  };
}

async function getAdminActivityAnalytics(filters = {}) {
  const dataset = await buildActivityDataset(filters);
  return {
    ...dataset,
    organizations: dataset.organizations.slice(0, 20),
    users: dataset.users.slice(0, 20),
    recentEvents: []
  };
}

async function listAdminActivityOrganizations(filters = {}) {
  const dataset = await buildActivityDataset(filters, new Date(), { includeOverview: false });
  const rows = dataset.organizations.filter((row) => rowMatchesSearch(row, filters.search));
  return { generatedAt: dataset.generatedAt, range: dataset.range, ...paginateRows(rows, filters.page, filters.limit) };
}

async function listAdminActivityUsers(filters = {}) {
  const dataset = await buildActivityDataset(filters, new Date(), { includeOverview: false });
  const rows = dataset.users.filter((row) => rowMatchesSearch(row, filters.search));
  return { generatedAt: dataset.generatedAt, range: dataset.range, ...paginateRows(rows, filters.page, filters.limit) };
}

async function getAdminActivityFilters() {
  const organizations = await Organization.find({}).select('name').sort({ name: 1 }).lean();
  return {
    organizations: organizations.map(organizationOption),
    modules: Object.entries(MODULE_LABELS).map(([id, name]) => ({ id, name }))
  };
}

async function getAdminOrganizationActivityDetail(id, filters = {}) {
  const organizationId = toObjectId(id);
  if (!organizationId) throw new TypeError('Invalid organization id');
  const dataset = await buildActivityDataset({ ...filters, organizationId: id });
  if (!dataset.organizations.length) return null;
  const events = await getAdminActivityEvents({ ...filters, organizationId: id, page: 1, limit: 30 });
  return {
    generatedAt: dataset.generatedAt,
    range: dataset.range,
    organization: dataset.organizations[0],
    totals: dataset.totals,
    trend: dataset.trend,
    modules: dataset.modules,
    users: dataset.users,
    events: events.events
  };
}

async function getAdminUserActivityDetail(id, filters = {}) {
  const userId = toObjectId(id);
  if (!userId) throw new TypeError('Invalid user id');
  const dataset = await buildActivityDataset({ ...filters, userId: id });
  if (!dataset.users.length) return null;
  const start = getActivityRangeStart(dataset.range.key, dataset.range.end);
  const sessions = await UserSession.find({
    user: userId,
    $or: [
      createDateMatch('createdAt', start, dataset.range.end),
      createDateMatch('lastActivityAt', start, dataset.range.end)
    ]
  }).sort({ lastActivityAt: -1, createdAt: -1 }).limit(30).lean();
  const events = await getAdminActivityEvents({ ...filters, userId: id, page: 1, limit: 40 });

  return {
    generatedAt: dataset.generatedAt,
    range: dataset.range,
    user: dataset.users[0],
    modules: dataset.modules,
    sessions: sessions.map((session) => ({
      id: String(session._id),
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt || session.createdAt,
      expiresAt: session.expiresAt,
      revoked: Boolean(session.revoked),
      revokedAt: session.revokedAt || null,
      reason: session.reason || null,
      ip: session.ip || null,
      userAgent: session.userAgent || null,
      riskSignals: session.riskSignals || []
    })),
    events: events.events
  };
}

module.exports = {
  MODULE_LABELS,
  normalizeActivityRange,
  getActivityRangeStart,
  normalizePagination,
  escapeRegex,
  calculateRate,
  maxDate,
  mergeActivityTrendRows,
  buildActivityDataset,
  getAdminActivityAnalytics,
  getAdminActivityFilters,
  listAdminActivityOrganizations,
  listAdminActivityUsers,
  getAdminActivityEvents,
  getAdminOrganizationActivityDetail,
  getAdminUserActivityDetail
};
