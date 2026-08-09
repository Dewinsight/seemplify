const express = require('express');
const mongoose = require('mongoose');
const { PerformanceReview } = require('../models/PerformanceReview');
const ReviewCycle = require('../models/ReviewCycle');
const {
  requireAuth,
  requireManager,
  getUserRole,
  getDirectReports
} = require('../middleware/rbac');
const { requireOrganization } = require('../services/tenantPolicy');

const router = express.Router();

function actorId(req) {
  const user = req.session?.user || {};
  return String(user.id || user.sub || user.userId || '');
}

function roleFor(req) {
  return req.userRole || getUserRole(req.session?.user) || 'employee';
}

function directReportsFor(req) {
  return (req.directReports || getDirectReports(req.session?.user || {})).map(String);
}

function isManagerRole(role) {
  return ['team_lead', 'line_manager', 'hr_admin'].includes(role);
}

function formatStatus(status) {
  const labels = {
    draft: 'Draft',
    submitted: 'Self Review Complete',
    'manager-review': 'Manager Review',
    completed: 'Completed'
  };
  return labels[status] || status || 'Draft';
}

function canReadReview(review, req) {
  const userId = actorId(req);
  const role = roleFor(req);
  if (role === 'hr_admin') return true;
  if (String(review.userId) === userId) return true;
  if (!isManagerRole(role)) return false;
  return String(review.managerId) === userId || directReportsFor(req).includes(String(review.userId));
}

function serializeReview(review, req, { detail = false } = {}) {
  const source = typeof review.toObject === 'function' ? review.toObject() : review;
  const cycle = source.cycleId && typeof source.cycleId === 'object' ? source.cycleId : null;
  const base = {
    _id: source._id,
    cycleId: cycle?._id || source.cycleId,
    cycleName: cycle?.title || 'Review Cycle',
    cycleType: cycle?.type,
    status: formatStatus(source.status),
    legacyStatus: source.status,
    type: String(source.userId) === actorId(req) ? 'Self Review' : 'Manager Review',
    userId: source.userId,
    managerId: source.managerId,
    dueDate: cycle?.endDate || null,
    selfEvaluation: source.selfEvaluation,
    managerEvaluation: source.managerEvaluation,
    createdAt: source.createdAt
  };

  if (!detail) return base;
  return {
    ...base,
    // Preserve historical evidence without exposing peer identities through
    // the temporary compatibility API.
    peerReviews: (source.peerReviews || []).map((item) => ({
      status: item.status,
      content: item.content,
      rating: item.rating,
      aiCategorization: item.aiCategorization
    })),
    aiInsights: source.aiInsights
  };
}

async function scopedCycleIds(req) {
  const rows = await ReviewCycle.find({ organizationId: req.organizationId }).select('_id').lean();
  return rows.map((row) => row._id);
}

function reviewVisibilityFilter(req) {
  const userId = actorId(req);
  const role = roleFor(req);
  if (role === 'hr_admin') return {};
  if (!isManagerRole(role)) return { userId };
  const directReports = directReportsFor(req);
  return {
    $or: [
      { userId },
      { managerId: userId },
      ...(directReports.length ? [{ userId: { $in: directReports } }] : [])
    ]
  };
}

router.use(requireAuth, requireOrganization);

// AppraisalCycle/Appraisal is canonical. Authenticate first, then reject every
// mutation so the legacy surface cannot be used for dual writes.
router.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  return res.status(410).json({
    success: false,
    error: 'Legacy reviews are read-only. Use the Appraisals workflow.',
    code: 'LEGACY_REVIEW_READ_ONLY',
    data: { destination: '/api/appraisals' }
  });
});

// Static routes deliberately precede /:id.
router.get('/cycles', async (req, res) => {
  try {
    const cycles = await ReviewCycle.find({ organizationId: req.organizationId })
      .sort({ startDate: -1 })
      .limit(50)
      .lean();
    return res.json({ success: true, data: cycles, count: cycles.length, readOnly: true });
  } catch (error) {
    console.error('Legacy cycle query failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load historical review cycles.' });
  }
});

router.get('/cycles/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid review cycle ID.' });
    }
    const cycle = await ReviewCycle.findOne({
      _id: req.params.id,
      organizationId: req.organizationId
    }).lean();
    if (!cycle) return res.status(404).json({ success: false, error: 'Review cycle not found.' });
    return res.json({ success: true, data: cycle, readOnly: true });
  } catch (error) {
    console.error('Legacy cycle detail query failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load the historical review cycle.' });
  }
});

router.get('/pending', requireManager, async (req, res) => {
  try {
    const cycleIds = await scopedCycleIds(req);
    const rows = await PerformanceReview.find({
      cycleId: { $in: cycleIds },
      managerId: actorId(req),
      'selfEvaluation.submittedAt': { $exists: true },
      'managerEvaluation.submittedAt': { $exists: false }
    })
      .populate('cycleId', 'title type startDate endDate status')
      .sort({ 'selfEvaluation.submittedAt': 1 })
      .limit(100);
    return res.json({
      success: true,
      data: rows.map((row) => serializeReview(row, req)),
      count: rows.length,
      readOnly: true
    });
  } catch (error) {
    console.error('Legacy pending review query failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load historical pending reviews.' });
  }
});

router.get('/direct-reports', requireManager, async (req, res) => {
  try {
    const directReports = directReportsFor(req);
    if (!directReports.length) {
      return res.json({ success: true, data: {}, count: 0, readOnly: true });
    }
    const cycleIds = await scopedCycleIds(req);
    const requestedCycleId = req.query.cycleId ? String(req.query.cycleId) : null;
    if (requestedCycleId && !cycleIds.some((id) => String(id) === requestedCycleId)) {
      return res.status(404).json({ success: false, error: 'Review cycle not found.' });
    }
    const rows = await PerformanceReview.find({
      cycleId: requestedCycleId || { $in: cycleIds },
      userId: { $in: directReports }
    })
      .populate('cycleId', 'title type startDate endDate status')
      .limit(500);
    const grouped = {};
    for (const row of rows) {
      if (!grouped[row.userId]) grouped[row.userId] = [];
      grouped[row.userId].push(serializeReview(row, req));
    }
    return res.json({
      success: true,
      data: grouped,
      count: rows.length,
      directReportCount: directReports.length,
      readOnly: true
    });
  } catch (error) {
    console.error('Legacy direct-report review query failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load historical direct-report reviews.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const cycleIds = await scopedCycleIds(req);
    const query = {
      cycleId: { $in: cycleIds },
      ...reviewVisibilityFilter(req)
    };
    if (req.query.cycleId) {
      const requested = String(req.query.cycleId);
      if (!cycleIds.some((id) => String(id) === requested)) {
        return res.status(404).json({ success: false, error: 'Review cycle not found.' });
      }
      query.cycleId = requested;
    }
    if (req.query.status) {
      const status = String(req.query.status);
      if (!['draft', 'submitted', 'manager-review', 'completed'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Unsupported legacy review status.' });
      }
      query.status = status;
    }
    if (req.query.userId) {
      const requestedUser = String(req.query.userId);
      const role = roleFor(req);
      if (role !== 'hr_admin' && requestedUser !== actorId(req) && !directReportsFor(req).includes(requestedUser)) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }
      query.userId = requestedUser;
    }

    const rows = await PerformanceReview.find(query)
      .populate('cycleId', 'title type startDate endDate status')
      .sort({ _id: -1 })
      .limit(100);
    return res.json({
      success: true,
      data: rows.map((row) => serializeReview(row, req)),
      count: rows.length,
      userRole: roleFor(req),
      readOnly: true
    });
  } catch (error) {
    console.error('Legacy review query failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load historical reviews.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid review ID.' });
    }
    const cycleIds = await scopedCycleIds(req);
    const review = await PerformanceReview.findOne({
      _id: req.params.id,
      cycleId: { $in: cycleIds }
    }).populate('cycleId', 'title type startDate endDate status');
    if (!review) return res.status(404).json({ success: false, error: 'Review not found.' });
    if (!canReadReview(review, req)) {
      return res.status(403).json({ success: false, error: 'Access denied.' });
    }
    return res.json({
      success: true,
      data: serializeReview(review, req, { detail: true }),
      readOnly: true
    });
  } catch (error) {
    console.error('Legacy review detail query failed:', error.message);
    return res.status(500).json({ success: false, error: 'Unable to load the historical review.' });
  }
});

module.exports = router;
