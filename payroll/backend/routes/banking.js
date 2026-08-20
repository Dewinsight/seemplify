const express = require('express');

const BankAccountChangeRequest = require('../models/BankAccountChangeRequest');
const PayrollProfile = require('../models/PayrollProfile');
const payrollCountryAutomationService = require('../services/PayrollCountryAutomationService');
const {
  accountFingerprint,
  accountSummary,
  approvalAccount,
  normalizeAccount,
  publicAccount,
} = require('../services/BankAccountChangeService');
const { requireAuth, requireHRAdmin } = require('../middleware/rbac');

const router = express.Router();

function actor(req) {
  const user = req.session?.user || {};
  return {
    userId: String(user.id || user.sub || ''),
    name: String(user.name || user.email || ''),
    organizationId: String(req.currentOrganization?.id || req.session?.currentOrganizationId || ''),
  };
}

function handleError(res, error, fallback) {
  return res.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : fallback,
    code: error.code,
    details: error.details,
  });
}

router.get('/me', requireAuth, async (req, res) => {
  try {
    const current = actor(req);
    if (!current.organizationId) return res.status(400).json({ error: 'No organization selected' });

    const [profile, pendingRequest, history] = await Promise.all([
      PayrollProfile.findOne({ organizationId: current.organizationId, userId: current.userId })
        .select('employeeInfo bankAccounts taxAssignment')
        .lean(),
      BankAccountChangeRequest.findOne({
        organizationId: current.organizationId,
        userId: current.userId,
        status: 'pending',
      }).sort({ createdAt: -1 }).lean(),
      BankAccountChangeRequest.find({ organizationId: current.organizationId, userId: current.userId })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);

    if (!profile) return res.status(404).json({ error: 'Your payroll profile has not been created yet.' });
    res.json({
      account: profile.bankAccounts?.length ? publicAccount(profile.bankAccounts.find((item) => item.isPrimary) || profile.bankAccounts[0]) : null,
      payrollCountryCode: profile.taxAssignment?.workCountryCode || '',
      pendingRequest,
      history,
    });
  } catch (error) {
    return handleError(res, error, 'Failed to load banking details');
  }
});

router.post('/requests', requireAuth, async (req, res) => {
  try {
    const current = actor(req);
    if (!current.organizationId) return res.status(400).json({ error: 'No organization selected' });

    const profile = await PayrollProfile.findOne({ organizationId: current.organizationId, userId: current.userId });
    if (!profile) return res.status(404).json({ error: 'Your payroll profile has not been created yet.' });

    const account = normalizeAccount(req.body?.account, profile.taxAssignment?.workCountryCode);
    const nextFingerprint = accountFingerprint(account);
    const existing = profile.bankAccounts?.find((item) => item.isPrimary) || profile.bankAccounts?.[0];
    if (existing && accountFingerprint(existing) === nextFingerprint) {
      return res.status(409).json({ error: 'These are already your active salary account details.', code: 'BANK_ACCOUNT_UNCHANGED' });
    }

    await BankAccountChangeRequest.updateMany(
      { organizationId: current.organizationId, userId: current.userId, status: 'pending' },
      { $set: { status: 'superseded', reviewedAt: new Date(), reviewComment: 'Replaced by a newer employee request.' } },
    );

    const request = await BankAccountChangeRequest.create({
      organizationId: current.organizationId,
      userId: current.userId,
      userName: profile.employeeInfo?.name || current.name,
      requestedBy: current.userId,
      requestedByName: current.name,
      proposedAccount: account,
      proposedAccountFingerprint: nextFingerprint,
      proposedAccountSummary: accountSummary(account),
      previousAccountFingerprint: existing ? accountFingerprint(existing) : '',
      previousAccountSummary: existing ? accountSummary(existing) : undefined,
      reason: String(req.body?.reason || '').trim(),
    });

    res.status(201).json({ request: request.toObject(), message: 'Your bank account change is waiting for HR approval.' });
  } catch (error) {
    return handleError(res, error, 'Failed to request a bank account change');
  }
});

router.delete('/requests/:id', requireAuth, async (req, res) => {
  try {
    const current = actor(req);
    const request = await BankAccountChangeRequest.findOneAndUpdate(
      { _id: req.params.id, organizationId: current.organizationId, userId: current.userId, status: 'pending' },
      { $set: { status: 'cancelled', reviewedAt: new Date(), reviewComment: 'Cancelled by employee.' } },
      { new: true },
    );
    if (!request) return res.status(404).json({ error: 'Pending request not found.' });
    res.json({ request });
  } catch (error) {
    return handleError(res, error, 'Failed to cancel the bank account request');
  }
});

router.get('/requests', requireHRAdmin, async (req, res) => {
  try {
    const current = actor(req);
    const status = String(req.query.status || '').trim();
    const query = { organizationId: current.organizationId };
    if (status && status !== 'all') query.status = status;
    const requests = await BankAccountChangeRequest.find(query)
      .select('+proposedAccount +proposedAccountFingerprint +previousAccountFingerprint')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ requests: requests.map((request) => ({ ...request, proposedAccount: publicAccount(request.proposedAccount) })) });
  } catch (error) {
    return handleError(res, error, 'Failed to load bank account requests');
  }
});

router.post('/requests/:id/action', requireHRAdmin, async (req, res) => {
  const current = actor(req);
  const action = String(req.body?.action || '').toLowerCase();
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Action must be approve or reject.' });

  let request;
  try {
    request = await BankAccountChangeRequest.findOneAndUpdate(
      { _id: req.params.id, organizationId: current.organizationId, status: 'pending' },
      { $set: { status: 'processing' } },
      { new: true },
    ).select('+proposedAccount +proposedAccountFingerprint +previousAccountFingerprint');
    if (!request) return res.status(409).json({ error: 'This request has already been reviewed.', code: 'BANK_ACCOUNT_REQUEST_ALREADY_REVIEWED' });

    const reviewedAt = new Date();
    if (action === 'reject') {
      request.status = 'rejected';
      request.reviewedBy = current.userId;
      request.reviewedByName = current.name;
      request.reviewComment = String(req.body?.comment || '').trim();
      request.reviewedAt = reviewedAt;
      await request.save();
      return res.json({ request: request.toObject() });
    }

    const profile = await PayrollProfile.findOne({ organizationId: current.organizationId, userId: request.userId });
    if (!profile) {
      request.status = 'pending';
      await request.save();
      return res.status(409).json({ error: 'Payroll profile not found for this employee.' });
    }

    const account = normalizeAccount(request.proposedAccount, profile.taxAssignment?.workCountryCode);
    profile.bankAccounts = [approvalAccount(account, { reviewedAt })];
    profile.lastModifiedBy = current.userId;
    const readiness = await payrollCountryAutomationService.reconcileProfile(profile, current.organizationId, {
      countryHint: profile.taxAssignment?.workCountryCode || account.countryCode,
      autoCreateEmployer: false,
      actor: { userId: current.userId, name: current.name },
    });
    payrollCountryAutomationService.applyReadiness(profile, readiness);
    await profile.save();

    request.status = 'approved';
    request.reviewedBy = current.userId;
    request.reviewedByName = current.name;
    request.reviewComment = String(req.body?.comment || '').trim();
    request.reviewedAt = reviewedAt;
    request.appliedAt = reviewedAt;
    await request.save();
    return res.json({ request: request.toObject(), account: publicAccount(profile.bankAccounts[0]) });
  } catch (error) {
    if (request?.status === 'processing') {
      request.status = 'pending';
      await request.save().catch(() => {});
    }
    return handleError(res, error, 'Failed to review the bank account request');
  }
});

module.exports = router;
