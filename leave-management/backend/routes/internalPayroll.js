'use strict';

const express = require('express');

const { asyncHandler } = require('../middleware/errorHandler');
const { createInternalPayrollAuth } = require('../services/internalPayrollSecurity');
const { getApprovedUnpaidLeaveSummary } = require('../services/unpaidLeaveSummaryService');

const router = express.Router();
const authenticatePayroll = createInternalPayrollAuth();

router.post('/unpaid-leave-summary', authenticatePayroll, asyncHandler(async (req, res) => {
  const summary = await getApprovedUnpaidLeaveSummary(req.body);
  res.status(200).json(summary);
}));

module.exports = router;
