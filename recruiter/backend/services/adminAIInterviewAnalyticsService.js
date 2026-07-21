const mongoose = require('mongoose');
const AIInterview = require('../models/AIInterview');
const AIInterviewSession = require('../models/AIInterviewSession');
const Organization = require('../models/Organization');
const User = require('../models/User');
const Job = require('../models/Job');

const INTERVIEW_STATUSES = new Set([
  'scheduled',
  'sending',
  'active',
  'completed',
  'cancelled',
  'expired'
]);
const RANGE_DAYS = Object.freeze({ '7d': 7, '30d': 30, '90d': 90 });
const FAILURE_SESSION_STATUSES = [
  'credit_blocked',
  'credit_error',
  'email_failed',
  'proctor_failed'
];
const ACTIVE_SESSION_STATUSES = ['opened', 'in_progress'];
const AWAITING_SESSION_STATUSES = ['pending_send', 'sending', 'sent'];

function normalizeAnalyticsRange(value) {
  return Object.prototype.hasOwnProperty.call(RANGE_DAYS, value) || value === 'all'
    ? value
    : '30d';
}

function getAnalyticsRangeStart(range, now = new Date()) {
  const normalizedRange = normalizeAnalyticsRange(range);
  if (normalizedRange === 'all') return null;

  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (RANGE_DAYS[normalizedRange] - 1));
  return start;
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toObjectId(value) {
  if (!value || !mongoose.Types.ObjectId.isValid(String(value))) return null;
  return new mongoose.Types.ObjectId(String(value));
}

function getCreatorName(user) {
  if (!user) return 'Unknown user';
  return user.profile?.displayName
    || `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim()
    || user.email
    || 'Unknown user';
}

function round(value, digits = 0) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function calculateRate(value, total) {
  if (!Number(total)) return 0;
  return round((Number(value || 0) / Number(total)) * 100, 1);
}

function normalizePagination(pageValue, limitValue) {
  const page = Math.max(1, Number.parseInt(pageValue, 10) || 1);
  const limit = Math.min(100, Math.max(10, Number.parseInt(limitValue, 10) || 25));
  return { page, limit };
}

function analyticsDateExpression(field, range) {
  return {
    $dateToString: {
      format: normalizeAnalyticsRange(range) === 'all' ? '%Y-%m' : '%Y-%m-%d',
      date: field,
      timezone: 'UTC'
    }
  };
}

async function resolveSearchIds(search) {
  const term = String(search || '').trim();
  if (!term) return null;

  const regex = new RegExp(escapeRegex(term), 'i');
  const [organizations, creators, jobs] = await Promise.all([
    Organization.find({ name: regex }).select('_id').limit(100).lean(),
    User.find({
      $or: [
        { email: regex },
        { 'profile.displayName': regex },
        { 'profile.firstName': regex },
        { 'profile.lastName': regex }
      ]
    }).select('_id').limit(100).lean(),
    Job.find({ title: regex }).select('_id').limit(100).lean()
  ]);

  return {
    regex,
    organizationIds: organizations.map((item) => item._id),
    creatorIds: creators.map((item) => item._id),
    jobIds: jobs.map((item) => item._id)
  };
}

async function buildInterviewMatch(filters = {}, now = new Date()) {
  const range = normalizeAnalyticsRange(filters.range);
  const match = {};
  const start = getAnalyticsRangeStart(range, now);

  if (start) match.createdAt = { $gte: start, $lte: now };

  const organizationId = toObjectId(filters.organizationId);
  if (organizationId) match.organization = organizationId;

  const creatorId = toObjectId(filters.creatorId);
  if (creatorId) match.createdBy = creatorId;

  if (INTERVIEW_STATUSES.has(filters.status)) match.status = filters.status;

  const searchIds = await resolveSearchIds(filters.search);
  if (searchIds) {
    match.$or = [
      { title: searchIds.regex },
      { organization: { $in: searchIds.organizationIds } },
      { createdBy: { $in: searchIds.creatorIds } },
      { job: { $in: searchIds.jobIds } }
    ];
  }

  return { match, range, start, end: now };
}

function sessionTotalsProjection() {
  return {
    _id: null,
    sessions: { $sum: 1 },
    completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
    active: { $sum: { $cond: [{ $in: ['$status', ACTIVE_SESSION_STATUSES] }, 1, 0] } },
    awaiting: { $sum: { $cond: [{ $in: ['$status', AWAITING_SESSION_STATUSES] }, 1, 0] } },
    failed: { $sum: { $cond: [{ $in: ['$status', FAILURE_SESSION_STATUSES] }, 1, 0] } },
    averageScore: {
      $avg: {
        $cond: [
          { $eq: ['$scoring.status', 'completed'] },
          '$scoring.overallScore',
          null
        ]
      }
    },
    averageDurationMs: {
      $avg: {
        $cond: [
          { $and: [{ $ne: ['$startedAt', null] }, { $ne: ['$completedAt', null] }] },
          { $subtract: ['$completedAt', '$startedAt'] },
          null
        ]
      }
    },
    creditsCharged: {
      $sum: { $cond: ['$credits.charged', { $ifNull: ['$credits.cost', 0] }, 0] }
    },
    creditsRefunded: {
      $sum: { $cond: ['$credits.refunded', { $ifNull: ['$credits.cost', 0] }, 0] }
    },
    proctorFailures: { $sum: { $cond: [{ $eq: ['$status', 'proctor_failed'] }, 1, 0] } },
    emailFailures: { $sum: { $cond: [{ $eq: ['$status', 'email_failed'] }, 1, 0] } }
  };
}

function sessionBreakdownProjection(groupField) {
  return {
    _id: groupField,
    sessions: { $sum: 1 },
    completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
    failed: { $sum: { $cond: [{ $in: ['$status', FAILURE_SESSION_STATUSES] }, 1, 0] } },
    averageScore: {
      $avg: {
        $cond: [
          { $eq: ['$scoring.status', 'completed'] },
          '$scoring.overallScore',
          null
        ]
      }
    },
    creditsCharged: {
      $sum: { $cond: ['$credits.charged', { $ifNull: ['$credits.cost', 0] }, 0] }
    }
  };
}

function mergeTrendRows(interviewRows = [], createdRows = [], completedRows = []) {
  const points = new Map();
  const ensurePoint = (key) => {
    if (!points.has(key)) {
      points.set(key, {
        date: key,
        interviews: 0,
        candidates: 0,
        completed: 0
      });
    }
    return points.get(key);
  };

  interviewRows.forEach((row) => {
    const point = ensurePoint(row._id);
    point.interviews = Number(row.count || 0);
  });
  createdRows.forEach((row) => {
    const point = ensurePoint(row._id);
    point.candidates = Number(row.count || 0);
  });
  completedRows.forEach((row) => {
    const point = ensurePoint(row._id);
    point.completed = Number(row.count || 0);
  });

  return Array.from(points.values()).sort((left, right) => left.date.localeCompare(right.date));
}

function formatSessionTotals(row = {}) {
  const sessions = Number(row.sessions || 0);
  const completed = Number(row.completed || 0);
  return {
    sessions,
    completed,
    active: Number(row.active || 0),
    awaiting: Number(row.awaiting || 0),
    failed: Number(row.failed || 0),
    completionRate: calculateRate(completed, sessions),
    averageScore: round(row.averageScore, 1),
    averageDurationMinutes: row.averageDurationMs == null
      ? null
      : round(Number(row.averageDurationMs) / 60000, 1),
    creditsCharged: round(row.creditsCharged || 0, 1) || 0,
    creditsRefunded: round(row.creditsRefunded || 0, 1) || 0,
    proctorFailures: Number(row.proctorFailures || 0),
    emailFailures: Number(row.emailFailures || 0)
  };
}

async function getAdminAIInterviewAnalytics(filters = {}) {
  const now = new Date();
  const { match, range, start, end } = await buildInterviewMatch(filters, now);
  const trendDate = analyticsDateExpression('$createdAt', range);

  const [interviewFacet] = await AIInterview.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [{
          $group: {
            _id: null,
            interviews: { $sum: 1 },
            candidateSlots: { $sum: { $ifNull: ['$candidateCount', 0] } },
            estimatedCredits: { $sum: { $ifNull: ['$costEstimate.totalCredits', 0] } },
            estimatedBackendCostUsd: {
              $sum: { $ifNull: ['$costEstimate.estimatedBackendCostUsd', 0] }
            }
          }
        }],
        statuses: [
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ],
        trend: [
          { $group: { _id: trendDate, count: { $sum: 1 } } },
          { $sort: { _id: 1 } }
        ],
        distinctOrganizations: [
          { $group: { _id: '$organization' } },
          { $count: 'count' }
        ],
        distinctCreators: [
          { $group: { _id: '$createdBy' } },
          { $count: 'count' }
        ],
        organizations: [
          {
            $group: {
              _id: '$organization',
              interviews: { $sum: 1 },
              candidateSlots: { $sum: { $ifNull: ['$candidateCount', 0] } }
            }
          },
          { $sort: { interviews: -1 } },
          { $limit: 25 }
        ],
        creators: [
          {
            $group: {
              _id: '$createdBy',
              interviews: { $sum: 1 },
              organizations: { $addToSet: '$organization' },
              candidateSlots: { $sum: { $ifNull: ['$candidateCount', 0] } }
            }
          },
          { $sort: { interviews: -1 } },
          { $limit: 25 }
        ]
      }
    }
  ]);

  const matchingInterviewIds = await AIInterview.find(match).distinct('_id');
  const emptySessionFacet = {
    totals: [],
    statuses: [],
    createdTrend: [],
    completedTrend: [],
    organizations: [],
    creators: [],
    candidates: []
  };

  const [sessionFacet = emptySessionFacet] = matchingInterviewIds.length
    ? await AIInterviewSession.aggregate([
      { $match: { aiInterview: { $in: matchingInterviewIds } } },
      {
        $facet: {
          totals: [{ $group: sessionTotalsProjection() }],
          statuses: [
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          createdTrend: [
            { $group: { _id: analyticsDateExpression('$createdAt', range), count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
          ],
          completedTrend: [
            { $match: { completedAt: { $ne: null } } },
            { $group: { _id: analyticsDateExpression('$completedAt', range), count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
          ],
          organizations: [
            { $group: sessionBreakdownProjection('$organization') },
            { $sort: { sessions: -1 } },
            { $limit: 25 }
          ],
          creators: [
            { $group: sessionBreakdownProjection('$createdBy') },
            { $sort: { sessions: -1 } },
            { $limit: 25 }
          ],
          candidates: [
            { $group: { _id: '$candidate' } },
            { $count: 'count' }
          ]
        }
      }
    ])
    : [emptySessionFacet];

  const organizationIds = Array.from(new Set([
    ...(interviewFacet?.organizations || []).map((row) => String(row._id)),
    ...(sessionFacet.organizations || []).map((row) => String(row._id))
  ])).map(toObjectId).filter(Boolean);
  const creatorIds = Array.from(new Set([
    ...(interviewFacet?.creators || []).map((row) => String(row._id)),
    ...(sessionFacet.creators || []).map((row) => String(row._id))
  ])).map(toObjectId).filter(Boolean);

  const [organizations, creators] = await Promise.all([
    Organization.find({ _id: { $in: organizationIds } }).select('name').lean(),
    User.find({ _id: { $in: creatorIds } }).select('email profile').lean()
  ]);
  const organizationNames = new Map(organizations.map((item) => [String(item._id), item.name]));
  const creatorDetails = new Map(creators.map((item) => [String(item._id), item]));
  const organizationSessionRows = new Map(
    (sessionFacet.organizations || []).map((item) => [String(item._id), item])
  );
  const creatorSessionRows = new Map(
    (sessionFacet.creators || []).map((item) => [String(item._id), item])
  );

  const organizationBreakdown = (interviewFacet?.organizations || []).map((item) => {
    const session = organizationSessionRows.get(String(item._id)) || {};
    return {
      id: item._id,
      name: organizationNames.get(String(item._id)) || 'Unknown organization',
      interviews: Number(item.interviews || 0),
      candidateSlots: Number(item.candidateSlots || 0),
      sessions: Number(session.sessions || 0),
      completed: Number(session.completed || 0),
      failed: Number(session.failed || 0),
      completionRate: calculateRate(session.completed, session.sessions),
      averageScore: round(session.averageScore, 1),
      creditsCharged: round(session.creditsCharged || 0, 1) || 0
    };
  });

  const creatorBreakdown = (interviewFacet?.creators || []).map((item) => {
    const session = creatorSessionRows.get(String(item._id)) || {};
    const creator = creatorDetails.get(String(item._id));
    return {
      id: item._id,
      name: getCreatorName(creator),
      email: creator?.email || '',
      organizationCount: item.organizations?.length || 0,
      interviews: Number(item.interviews || 0),
      candidateSlots: Number(item.candidateSlots || 0),
      sessions: Number(session.sessions || 0),
      completed: Number(session.completed || 0),
      failed: Number(session.failed || 0),
      completionRate: calculateRate(session.completed, session.sessions),
      averageScore: round(session.averageScore, 1),
      creditsCharged: round(session.creditsCharged || 0, 1) || 0
    };
  });

  const twoHoursAgo = new Date(now.getTime() - (2 * 60 * 60 * 1000));
  const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  const nextTwentyFourHours = new Date(now.getTime() + (24 * 60 * 60 * 1000));
  const overdueInterviewIds = matchingInterviewIds.length
    ? await AIInterview.find({
      _id: { $in: matchingInterviewIds },
      'schedule.sendAt': { $lt: now },
      status: { $nin: ['completed', 'cancelled', 'expired'] }
    }).distinct('_id')
    : [];

  const [staleSessions, overdueInvites, recentFailures, scoringFailures, scheduledNext24Hours] = await Promise.all([
    matchingInterviewIds.length
      ? AIInterviewSession.countDocuments({
        aiInterview: { $in: matchingInterviewIds },
        status: 'in_progress',
        lastActivityAt: { $lt: twoHoursAgo }
      })
      : 0,
    overdueInterviewIds.length
      ? AIInterviewSession.countDocuments({
        aiInterview: { $in: overdueInterviewIds },
        status: { $in: ['pending_send', 'sending'] }
      })
      : 0,
    matchingInterviewIds.length
      ? AIInterviewSession.countDocuments({
        aiInterview: { $in: matchingInterviewIds },
        status: { $in: FAILURE_SESSION_STATUSES },
        updatedAt: { $gte: twentyFourHoursAgo }
      })
      : 0,
    matchingInterviewIds.length
      ? AIInterviewSession.countDocuments({
        aiInterview: { $in: matchingInterviewIds },
        'scoring.status': 'failed'
      })
      : 0,
    AIInterview.countDocuments({
      ...match,
      status: 'scheduled',
      'schedule.sendAt': { $gte: now, $lte: nextTwentyFourHours }
    })
  ]);

  const interviewTotals = interviewFacet?.totals?.[0] || {};
  const sessionTotals = formatSessionTotals(sessionFacet.totals?.[0]);

  return {
    generatedAt: now,
    range: {
      key: range,
      start,
      end,
      interval: range === 'all' ? 'month' : 'day'
    },
    totals: {
      interviews: Number(interviewTotals.interviews || 0),
      candidates: Number(sessionFacet.candidates?.[0]?.count || 0),
      organizations: Number(interviewFacet?.distinctOrganizations?.[0]?.count || 0),
      creators: Number(interviewFacet?.distinctCreators?.[0]?.count || 0),
      candidateSlots: Number(interviewTotals.candidateSlots || 0),
      estimatedCredits: round(interviewTotals.estimatedCredits || 0, 1) || 0,
      estimatedBackendCostUsd: round(interviewTotals.estimatedBackendCostUsd || 0, 2) || 0,
      ...sessionTotals
    },
    monitoring: {
      staleSessions: Number(staleSessions || 0),
      overdueInvites: Number(overdueInvites || 0),
      failuresLast24Hours: Number(recentFailures || 0),
      scoringFailures: Number(scoringFailures || 0),
      scheduledNext24Hours: Number(scheduledNext24Hours || 0)
    },
    interviewStatuses: interviewFacet?.statuses || [],
    sessionStatuses: sessionFacet.statuses || [],
    trend: mergeTrendRows(
      interviewFacet?.trend,
      sessionFacet.createdTrend,
      sessionFacet.completedTrend
    ),
    organizations: organizationBreakdown,
    creators: creatorBreakdown
  };
}

async function getAdminAIInterviewFilters() {
  const [organizationIds, creatorIds] = await Promise.all([
    AIInterview.distinct('organization'),
    AIInterview.distinct('createdBy')
  ]);
  const [organizations, creators] = await Promise.all([
    Organization.find({ _id: { $in: organizationIds } }).select('name').sort({ name: 1 }).lean(),
    User.find({ _id: { $in: creatorIds } }).select('email profile').sort({ email: 1 }).lean()
  ]);

  return {
    organizations: organizations.map((item) => ({ id: item._id, name: item.name })),
    creators: creators.map((item) => ({
      id: item._id,
      name: getCreatorName(item),
      email: item.email
    })),
    statuses: Array.from(INTERVIEW_STATUSES)
  };
}

async function listAdminAIInterviews(filters = {}) {
  const { page, limit } = normalizePagination(filters.page, filters.limit);
  const { match } = await buildInterviewMatch(filters);
  const [interviews, total] = await Promise.all([
    AIInterview.find(match)
      .populate('organization', 'name')
      .populate('job', 'title status')
      .populate('createdBy', 'email profile')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AIInterview.countDocuments(match)
  ]);

  const interviewIds = interviews.map((item) => item._id);
  const sessionRows = interviewIds.length
    ? await AIInterviewSession.aggregate([
      { $match: { aiInterview: { $in: interviewIds } } },
      { $group: { ...sessionTotalsProjection(), _id: '$aiInterview' } }
    ])
    : [];
  const sessionsByInterview = new Map(sessionRows.map((item) => [String(item._id), item]));

  return {
    interviews: interviews.map((item) => ({
      id: item._id,
      title: item.title,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      schedule: item.schedule,
      candidateCount: item.candidateCount,
      organization: item.organization
        ? { id: item.organization._id, name: item.organization.name }
        : null,
      creator: item.createdBy
        ? {
          id: item.createdBy._id,
          name: getCreatorName(item.createdBy),
          email: item.createdBy.email
        }
        : null,
      job: item.job
        ? { id: item.job._id, title: item.job.title, status: item.job.status }
        : null,
      voice: item.voice ? {
        id: item.voice.voiceId,
        name: item.voice.displayName || item.voice.name,
        tier: item.voice.tierLabel || item.voice.tier
      } : null,
      estimatedCredits: round(item.costEstimate?.totalCredits || 0, 1) || 0,
      estimatedBackendCostUsd: round(item.costEstimate?.estimatedBackendCostUsd || 0, 2) || 0,
      sessionSummary: formatSessionTotals(sessionsByInterview.get(String(item._id)))
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
}

async function getAdminAIInterviewDetail(id) {
  const interviewId = toObjectId(id);
  if (!interviewId) return null;

  const interview = await AIInterview.findById(interviewId)
    .populate('organization', 'name industry subscription.plan')
    .populate('job', 'title status')
    .populate('createdBy', 'email profile')
    .populate('cancelledBy', 'email profile')
    .lean();
  if (!interview) return null;

  const sessions = await AIInterviewSession.find({ aiInterview: interviewId })
    .populate('candidate', 'firstName lastName email status')
    .populate('createdBy', 'email profile')
    .sort({ createdAt: 1 })
    .lean();

  const formattedSessions = sessions.map((session) => {
    const durationMs = session.startedAt && session.completedAt
      ? new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime()
      : null;
    return {
      id: session._id,
      status: session.status,
      recipientType: session.recipientType,
      candidate: {
        id: session.candidate?._id || session.candidate,
        name: session.candidateSnapshot?.name
          || `${session.candidateSnapshot?.firstName || ''} ${session.candidateSnapshot?.lastName || ''}`.trim()
          || `${session.candidate?.firstName || ''} ${session.candidate?.lastName || ''}`.trim()
          || session.candidateSnapshot?.email
          || 'Candidate',
        email: session.candidateSnapshot?.email || session.candidate?.email || '',
        applicationStatus: session.candidate?.status || ''
      },
      createdBy: session.createdBy ? {
        id: session.createdBy._id,
        name: getCreatorName(session.createdBy),
        email: session.createdBy.email
      } : null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      sentAt: session.email?.sentAt,
      openedAt: session.status === 'opened' ? session.lastActivityAt : undefined,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      lastActivityAt: session.lastActivityAt,
      durationMinutes: durationMs == null ? null : round(durationMs / 60000, 1),
      progress: {
        currentQuestion: Number(session.currentQuestionIndex || 0) + 1,
        answered: (session.answers || []).filter((answer) => answer.status === 'answered').length,
        skipped: (session.answers || []).filter((answer) => answer.status === 'skipped').length,
        timedOut: (session.answers || []).filter((answer) => answer.status === 'timeout').length,
        messages: session.messages?.length || 0
      },
      scoring: {
        status: session.scoring?.status || 'pending',
        overallScore: session.scoring?.overallScore ?? null,
        recommendation: session.scoring?.recommendation || '',
        summary: session.scoring?.summary || '',
        strengths: session.scoring?.strengths || [],
        concerns: session.scoring?.concerns || [],
        error: session.scoring?.error || ''
      },
      delivery: {
        attempts: session.email?.attempts || 0,
        sentAt: session.email?.sentAt,
        messageId: session.email?.messageId || '',
        lastError: session.email?.lastError || ''
      },
      credits: session.credits || {},
      proctoring: {
        enabled: session.proctoring?.enabled !== false,
        focusViolations: session.proctoring?.focusViolationCount || 0,
        pasteAttempts: session.proctoring?.pasteAttemptCount || 0,
        violationCount: session.proctoring?.violations?.length || 0,
        terminatedAt: session.proctoring?.terminatedAt,
        terminationReason: session.proctoring?.terminationReason || ''
      }
    };
  });
  const sessionTotals = formattedSessions.reduce((totals, session) => {
    totals.sessions += 1;
    if (session.status === 'completed') totals.completed += 1;
    if (ACTIVE_SESSION_STATUSES.includes(session.status)) totals.active += 1;
    if (FAILURE_SESSION_STATUSES.includes(session.status)) totals.failed += 1;
    if (session.scoring.overallScore != null) totals.scores.push(Number(session.scoring.overallScore));
    totals.creditsCharged += session.credits?.charged ? Number(session.credits.cost || 0) : 0;
    return totals;
  }, { sessions: 0, completed: 0, active: 0, failed: 0, scores: [], creditsCharged: 0 });

  return {
    interview: {
      id: interview._id,
      title: interview.title,
      status: interview.status,
      guidelines: interview.guidelines,
      createdAt: interview.createdAt,
      updatedAt: interview.updatedAt,
      schedule: interview.schedule,
      timers: interview.timers,
      questionCount: interview.questionSnapshots?.length || 0,
      candidateCount: interview.candidateCount,
      organization: interview.organization ? {
        id: interview.organization._id,
        name: interview.organization.name,
        industry: interview.organization.industry,
        plan: interview.organization.subscription?.plan
      } : null,
      creator: interview.createdBy ? {
        id: interview.createdBy._id,
        name: getCreatorName(interview.createdBy),
        email: interview.createdBy.email,
        title: interview.createdBy.profile?.title || ''
      } : null,
      job: interview.job ? {
        id: interview.job._id,
        title: interview.job.title,
        status: interview.job.status
      } : null,
      voice: interview.voice || null,
      costEstimate: interview.costEstimate || null,
      cancelledAt: interview.cancelledAt,
      cancellationReason: interview.cancellationReason || '',
      cancelledBy: interview.cancelledBy ? {
        id: interview.cancelledBy._id,
        name: getCreatorName(interview.cancelledBy),
        email: interview.cancelledBy.email
      } : null
    },
    summary: {
      sessions: sessionTotals.sessions,
      completed: sessionTotals.completed,
      active: sessionTotals.active,
      failed: sessionTotals.failed,
      completionRate: calculateRate(sessionTotals.completed, sessionTotals.sessions),
      averageScore: sessionTotals.scores.length
        ? round(sessionTotals.scores.reduce((sum, score) => sum + score, 0) / sessionTotals.scores.length, 1)
        : null,
      creditsCharged: round(sessionTotals.creditsCharged, 1) || 0
    },
    sessions: formattedSessions
  };
}

module.exports = {
  INTERVIEW_STATUSES,
  normalizeAnalyticsRange,
  getAnalyticsRangeStart,
  escapeRegex,
  normalizePagination,
  calculateRate,
  mergeTrendRows,
  formatSessionTotals,
  getAdminAIInterviewAnalytics,
  getAdminAIInterviewFilters,
  listAdminAIInterviews,
  getAdminAIInterviewDetail
};
