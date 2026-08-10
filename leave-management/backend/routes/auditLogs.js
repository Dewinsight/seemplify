const express = require('express');

const { AuditLog } = require('../models');
const {
  requireAuth,
  requireOrganization,
  requireLeavePermission,
  asyncHandler,
} = require('../middleware');

const router = express.Router();
router.use(requireAuth);
router.use(requireOrganization);

router.get('/', requireLeavePermission('view_all_leaves'), asyncHandler(async (req, res) => {
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
  const query = { organizationId: req.organizationId };
  if (req.query.action) query.action = String(req.query.action);
  if (req.query.resourceType) query.resourceType = String(req.query.resourceType);
  if (req.query.userId) query['metadata.targetUserId'] = String(req.query.userId);
  if (req.query.startDate || req.query.endDate) {
    query.performedAt = {};
    if (req.query.startDate) query.performedAt.$gte = new Date(req.query.startDate);
    if (req.query.endDate) query.performedAt.$lte = new Date(req.query.endDate);
  }
  const search = String(req.query.search || '').trim();
  if (search) {
    const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
      { performedByName: { $regex: safe, $options: 'i' } },
      { details: { $regex: safe, $options: 'i' } },
      { 'metadata.targetUserName': { $regex: safe, $options: 'i' } },
      { 'metadata.targetUserEmail': { $regex: safe, $options: 'i' } },
    ];
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(query).sort({ performedAt: -1 }).skip((page - 1) * limit).limit(limit),
    AuditLog.countDocuments(query),
  ]);
  res.json({ logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

module.exports = router;
