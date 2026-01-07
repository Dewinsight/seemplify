const express = require('express');
const router = express.Router();
const PayrollRun = require('../models/PayrollRun');
const Payslip = require('../models/Payslip');
const PayrollProfile = require('../models/PayrollProfile');
const CompensationRequest = require('../models/CompensationRequest');
const PayrollEngineService = require('../services/PayrollEngineService');
const payrollEngineService = new PayrollEngineService();

// Import RBAC middleware
const { requireAuth, requireHRAdmin, requireManager, requirePermission } = require('../middleware/rbac');

// Helper to get user info from session
const getUserInfo = (req) => ({
  userId: req.session?.user?.sub || req.session?.user?.id,
  organizationId: req.currentOrganization?.id || req.session?.currentOrganizationId,
  name: req.session?.user?.name,
  role: req.currentOrganization?.role || req.session?.user?.currentRole
});

// =====================================================
// PAYROLL PROFILE ROUTES (Employee & HR Admin)
// =====================================================

/**
 * GET /api/payroll/profile/me
 * Get current user's payroll profile
 */
router.get('/profile/me', requireAuth, async (req, res) => {
  try {
    const { userId, organizationId } = getUserInfo(req);

    let profile = await PayrollProfile.findOne({ userId, organizationId });

    if (!profile) {
      // Create a basic profile if none exists
      profile = new PayrollProfile({
        userId,
        organizationId,
        basicSalary: 0,
        currency: 'USD',
        employeeInfo: {
          name: req.session.user?.name,
          email: req.session.user?.email
        }
      });
      await profile.save();
    }

    // Return limited info for employees
    const response = {
      id: profile._id,
      employeeInfo: profile.employeeInfo,
      basicSalary: profile.basicSalary,
      currency: profile.currency,
      salaryGrade: profile.salaryGrade,
      allowances: profile.allowances,
      recurringDeductions: profile.recurringDeductions,
      benefits: profile.benefits,
      status: profile.status,
      grossMonthlySalary: profile.grossMonthlySalary,
      totalAllowances: profile.totalAllowances,
      totalRecurringDeductions: profile.totalRecurringDeductions
    };

    res.json(response);
  } catch (err) {
    console.error('Get Profile Error:', err);
    res.status(500).json({ error: 'Failed to fetch payroll profile' });
  }
});

/**
 * GET /api/payroll/profiles
 * Get all payroll profiles (HR Admin only)
 */
router.get('/profiles', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { status, teamId, department, limit = 50, skip = 0 } = req.query;

    const query = { organizationId };
    if (status) query.status = status;
    if (teamId) query['employeeInfo.teamId'] = teamId;
    if (department) query['employeeInfo.department'] = department;

    const profiles = await PayrollProfile.find(query)
      .sort({ 'employeeInfo.name': 1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await PayrollProfile.countDocuments(query);

    res.json({
      profiles,
      total,
      limit: parseInt(limit),
      skip: parseInt(skip)
    });
  } catch (err) {
    console.error('Get Profiles Error:', err);
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

/**
 * GET /api/payroll/profiles/:userId
 * Get specific user's payroll profile (HR Admin only)
 */
router.get('/profiles/:userId', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);

    const profile = await PayrollProfile.findOne({
      userId: req.params.userId,
      organizationId
    }).populate('salaryGrade.gradeId');

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(profile);
  } catch (err) {
    console.error('Get Profile Error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * PUT /api/payroll/profiles/:userId
 * Update user's payroll profile (HR Admin only)
 */
router.put('/profiles/:userId', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, userId: adminId, name: adminName } = getUserInfo(req);
    const { basicSalary, currency, allowances, recurringDeductions, benefits, taxConfig, status } = req.body;

    let profile = await PayrollProfile.findOne({
      userId: req.params.userId,
      organizationId
    });

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Track salary changes
    if (basicSalary !== undefined && basicSalary !== profile.basicSalary) {
      profile.recordSalaryChange(basicSalary, 'market_adjustment', adminId, adminName, 'Updated by HR');
    }

    // Update other fields
    if (currency) profile.currency = currency;
    if (allowances) profile.allowances = allowances;
    if (recurringDeductions) profile.recurringDeductions = recurringDeductions;
    if (benefits) profile.benefits = benefits;
    if (taxConfig) profile.taxConfig = taxConfig;
    if (status) profile.status = status;

    profile.lastModifiedBy = adminId;
    await profile.save();

    res.json({ success: true, profile });
  } catch (err) {
    console.error('Update Profile Error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * POST /api/payroll/profiles
 * Create new payroll profile (HR Admin only)
 */
router.post('/profiles', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, userId: adminId } = getUserInfo(req);
    const { userId, basicSalary, currency, employeeInfo, allowances } = req.body;

    // Check if profile already exists
    const existing = await PayrollProfile.findOne({ userId, organizationId });
    if (existing) {
      return res.status(400).json({ error: 'Profile already exists for this user' });
    }

    const profile = new PayrollProfile({
      userId,
      organizationId,
      basicSalary: basicSalary || 0,
      currency: currency || 'USD',
      employeeInfo: employeeInfo || {},
      allowances: allowances || [],
      createdBy: adminId
    });

    // Record initial salary
    if (basicSalary > 0) {
      profile.salaryHistory.push({
        effectiveDate: new Date(),
        newSalary: basicSalary,
        changeReason: 'joining',
        approvedBy: adminId
      });
    }

    await profile.save();
    res.status(201).json({ success: true, profile });
  } catch (err) {
    console.error('Create Profile Error:', err);
    res.status(500).json({ error: 'Failed to create profile' });
  }
});

// =====================================================
// PAYSLIP ROUTES (Employee & HR Admin)
// =====================================================

/**
 * GET /api/payroll/my-payslips
 * Get current user's payslips
 */
router.get('/my-payslips', requireAuth, async (req, res) => {
  try {
    const { userId, organizationId } = getUserInfo(req);
    const { year, limit = 12 } = req.query;

    const query = { userId, organizationId };
    if (year) query['payPeriod.year'] = parseInt(year);

    const payslips = await Payslip.find(query)
      .populate('payrollRunId', 'runNumber payPeriod status')
      .sort({ 'payPeriod.year': -1, 'payPeriod.month': -1 })
      .limit(parseInt(limit));

    res.json(payslips);
  } catch (err) {
    console.error('Get My Payslips Error:', err);
    res.status(500).json({ error: 'Failed to fetch payslips' });
  }
});

/**
 * GET /api/payroll/my-payslips/:id
 * Get specific payslip details
 */
router.get('/my-payslips/:id', requireAuth, async (req, res) => {
  try {
    const { userId, organizationId } = getUserInfo(req);

    const payslip = await Payslip.findOne({
      _id: req.params.id,
      userId,
      organizationId
    }).populate('payrollRunId');

    if (!payslip) {
      return res.status(404).json({ error: 'Payslip not found' });
    }

    res.json(payslip);
  } catch (err) {
    console.error('Get Payslip Error:', err);
    res.status(500).json({ error: 'Failed to fetch payslip' });
  }
});

/**
 * GET /api/payroll/payslips
 * Get all payslips for the organization (HR Admin only)
 */
router.get('/payslips', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year, month, payrollRunId, status, limit = 50, skip = 0 } = req.query;

    const query = { organizationId };
    if (year) query['payPeriod.year'] = parseInt(year);
    if (month) query['payPeriod.month'] = parseInt(month);
    if (payrollRunId) query.payrollRunId = payrollRunId;
    if (status) query.status = status;

    const payslips = await Payslip.find(query)
      .populate('payrollRunId', 'runNumber status')
      .sort({ 'employeeSnapshot.name': 1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await Payslip.countDocuments(query);

    res.json({
      payslips,
      total,
      limit: parseInt(limit),
      skip: parseInt(skip)
    });
  } catch (err) {
    console.error('Get Payslips Error:', err);
    res.status(500).json({ error: 'Failed to fetch payslips' });
  }
});

/**
 * GET /api/payroll/payslips/:id
 * Get specific payslip details (HR Admin only)
 */
router.get('/payslips/:id', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);

    const payslip = await Payslip.findOne({
      _id: req.params.id,
      organizationId
    }).populate('payrollRunId');

    if (!payslip) {
      return res.status(404).json({ error: 'Payslip not found' });
    }

    res.json(payslip);
  } catch (err) {
    console.error('Get Payslip Error:', err);
    res.status(500).json({ error: 'Failed to fetch payslip' });
  }
});

// =====================================================
// PAYROLL RUN ROUTES (HR Admin only)
// =====================================================

/**
 * GET /api/payroll/runs
 * Get payroll runs for the organization
 */
router.get('/runs', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year, status, limit = 12 } = req.query;

    const runs = await PayrollRun.getByOrganization(organizationId, {
      year: year ? parseInt(year) : undefined,
      status,
      limit: parseInt(limit)
    });

    res.json(runs);
  } catch (err) {
    console.error('Get Runs Error:', err);
    res.status(500).json({ error: 'Failed to fetch payroll runs' });
  }
});

/**
 * GET /api/payroll/runs/:id
 * Get specific payroll run details
 */
router.get('/runs/:id', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);

    const run = await PayrollRun.findOne({
      _id: req.params.id,
      organizationId
    });

    if (!run) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    res.json(run);
  } catch (err) {
    console.error('Get Run Error:', err);
    res.status(500).json({ error: 'Failed to fetch payroll run' });
  }
});

/**
 * POST /api/payroll/runs
 * Create and process a new payroll run
 */
router.post('/runs', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, userId: adminId, name: adminName } = getUserInfo(req);
    const { month, year, settings = {}, paymentDate } = req.body;

    // Validate month/year
    if (!month || !year) {
      return res.status(400).json({ error: 'Month and year are required' });
    }

    // Check if run already exists
    const exists = await PayrollRun.existsForPeriod(organizationId, year, month);
    if (exists) {
      return res.status(400).json({ error: 'Payroll run for this period already exists' });
    }

    // Generate run number
    const runNumber = await PayrollRun.generateRunNumber(organizationId, year, month);

    // Calculate pay period dates
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of month
    const defaultPaymentDate = paymentDate ? new Date(paymentDate) : endDate;

    // Create Run Record
    const run = new PayrollRun({
      runNumber,
      organizationId,
      payPeriod: {
        type: 'monthly',
        month,
        year,
        startDate,
        endDate,
        paymentDate: defaultPaymentDate
      },
      status: 'calculating',
      settings: {
        includeAllowances: settings.includeAllowances !== false,
        includeBonuses: settings.includeBonuses !== false,
        includeOvertime: settings.includeOvertime !== false,
        processStatutoryDeductions: settings.processStatutoryDeductions !== false,
        calculateTax: settings.calculateTax !== false,
        prorate: settings.prorate !== false,
        ...settings
      },
      createdBy: adminId,
      createdByName: adminName
    });

    await run.save();

    // =====================================================
    // DELEGATE TO PAYROLL ENGINE SERVICE
    // =====================================================

    const result = await payrollEngineService.calculateRun(run._id, organizationId);

    res.status(201).json({
      success: true,
      run: result.run,
      summary: result.summary,
      errors: result.errors
    });
  } catch (err) {
    console.error('Create Payroll Run Error:', err);
    res.status(500).json({ error: 'Failed to create payroll run', details: err.message });
  }
});

/**
 * POST /api/payroll/runs/:id/submit-for-approval
 * Submit payroll run for approval
 */
router.post('/runs/:id/submit-for-approval', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, userId: adminId, name: adminName } = getUserInfo(req);

    const run = await PayrollRun.findOne({
      _id: req.params.id,
      organizationId
    });

    if (!run) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    if (!['calculated', 'pending_review'].includes(run.status)) {
      return res.status(400).json({ error: `Cannot submit run with status: ${run.status}` });
    }

    run.addApproval('submitted', adminId, adminName, 'hr_admin', req.body.comments);
    run.status = 'pending_approval';
    await run.save();

    // Update all payslips status
    await Payslip.updateMany(
      { payrollRunId: run._id },
      { status: 'pending_approval' }
    );

    res.json({ success: true, run });
  } catch (err) {
    console.error('Submit Run Error:', err);
    res.status(500).json({ error: 'Failed to submit payroll run' });
  }
});

/**
 * POST /api/payroll/runs/:id/approve
 * Approve payroll run
 */
router.post('/runs/:id/approve', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, userId: adminId, name: adminName, role } = getUserInfo(req);

    const run = await PayrollRun.findOne({
      _id: req.params.id,
      organizationId
    });

    if (!run) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    if (run.status !== 'pending_approval') {
      return res.status(400).json({ error: `Cannot approve run with status: ${run.status}` });
    }

    run.addApproval('approved', adminId, adminName, role, req.body.comments);
    await run.save();

    // Update payslips status if run is fully approved
    if (run.status === 'approved') {
      await Payslip.updateMany(
        { payrollRunId: run._id },
        { status: 'approved' }
      );
    }

    res.json({ success: true, run });
  } catch (err) {
    console.error('Approve Run Error:', err);
    res.status(500).json({ error: 'Failed to approve payroll run' });
  }
});

/**
 * POST /api/payroll/runs/:id/process-payment
 * Mark payroll run as paid
 */
router.post('/runs/:id/process-payment', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId, userId: adminId } = getUserInfo(req);
    const { bankReference, transactionId } = req.body;

    const run = await PayrollRun.findOne({
      _id: req.params.id,
      organizationId
    });

    if (!run) {
      return res.status(404).json({ error: 'Payroll run not found' });
    }

    if (run.status !== 'approved') {
      return res.status(400).json({ error: `Cannot process payment for run with status: ${run.status}` });
    }

    run.status = 'paid';
    run.paidAt = new Date();
    run.paymentBatch = {
      bankReference,
      processedAt: new Date(),
      status: 'completed'
    };

    await run.save();

    // =====================================================
    // UPDATE LOAN BALANCES & RECURRING DEDUCTIONS
    // =====================================================
    // Find all employees in this run who had a 'loan_repayment' deduction
    // Decrease their remainingAmount in PayrollProfile

    // We get the list of deductions from the stored payslips for this run
    const payslips = await Payslip.find({ payrollRunId: run._id });

    for (const payslip of payslips) {
      if (!payslip.deductions || payslip.deductions.length === 0) continue;

      // Find loan repayment deductions
      const loanDeductions = payslip.deductions.filter(d => d.type === 'loan_repayment');

      if (loanDeductions.length > 0) {
        const profile = await PayrollProfile.findOne({ userId: payslip.userId, organizationId });

        if (profile && profile.recurringDeductions) {
          let modified = false;

          loanDeductions.forEach(deduction => {
            // Match the deduction in the profile (by name or type)
            // Note: Ideally we'd link by ID, but for now we match by name/type
            const profileDeduction = profile.recurringDeductions.find(pd =>
              pd.type === 'loan_repayment' && pd.name === deduction.name
            );

            if (profileDeduction && profileDeduction.remainingAmount > 0) {
              profileDeduction.remainingAmount -= deduction.amount;
              if (profileDeduction.remainingAmount < 0) profileDeduction.remainingAmount = 0;

              // Auto-deactivate if paid off
              if (profileDeduction.remainingAmount === 0) {
                profileDeduction.isActive = false;
                profileDeduction.notes = (profileDeduction.notes || '') + ' [Paid Off via Run ' + run.runNumber + ']';
              }

              modified = true;
            }
          });

          if (modified) await profile.save();
        }
      }
    }

    // Update payslips status
    await Payslip.updateMany(
      { payrollRunId: run._id },
      {
        status: 'paid',
        'paymentDetails.method': 'bank_transfer',
        'paymentDetails.transactionId': transactionId,
        'paymentDetails.paymentDate': new Date(),
        'paymentDetails.bankReference': bankReference
      }
    );

    res.json({ success: true, run });
  } catch (err) {
    console.error('Process Payment Error:', err);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

// =====================================================
// ANALYTICS & REPORTING (HR Admin only)
// =====================================================

/**
 * GET /api/payroll/analytics/summary
 * Get payroll analytics summary
 */
router.get('/analytics/summary', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year = new Date().getFullYear() } = req.query;

    // Get all runs for the year
    const runs = await PayrollRun.find({
      organizationId,
      'payPeriod.year': parseInt(year),
      status: { $in: ['calculated', 'approved', 'paid'] }
    }).sort({ 'payPeriod.month': 1 });

    // Calculate yearly totals
    const summary = {
      year: parseInt(year),
      totalPayrollRuns: runs.length,
      totalEmployeesPaid: 0,
      totalGrossPayroll: 0,
      totalNetPayroll: 0,
      totalTaxWithheld: 0,
      monthlyBreakdown: []
    };

    runs.forEach(run => {
      summary.totalEmployeesPaid += run.summary?.processedCount || 0;
      summary.totalGrossPayroll += run.summary?.totalGrossPayroll || 0;
      summary.totalNetPayroll += run.summary?.totalNetPayroll || 0;
      summary.totalTaxWithheld += run.summary?.totalTaxWithheld || 0;

      summary.monthlyBreakdown.push({
        month: run.payPeriod.month,
        year: run.payPeriod.year,
        grossPayroll: run.summary?.totalGrossPayroll || 0,
        netPayroll: run.summary?.totalNetPayroll || 0,
        employees: run.summary?.processedCount || 0,
        status: run.status
      });
    });

    // Get active employee count
    const activeProfiles = await PayrollProfile.countDocuments({
      organizationId,
      isActive: true
    });

    summary.activeEmployees = activeProfiles;

    res.json(summary);
  } catch (err) {
    console.error('Analytics Summary Error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * GET /api/payroll/analytics/ytd/:userId
 * Get year-to-date summary for a user
 */
router.get('/analytics/ytd/:userId', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year = new Date().getFullYear() } = req.query;

    const payslips = await Payslip.find({
      userId: req.params.userId,
      organizationId,
      'payPeriod.year': parseInt(year),
      status: { $in: ['approved', 'paid'] }
    });

    const ytd = {
      year: parseInt(year),
      userId: req.params.userId,
      totalPayslips: payslips.length,
      totalGrossEarnings: 0,
      totalDeductions: 0,
      totalTax: 0,
      totalNetPay: 0,
      breakdown: []
    };

    payslips.forEach(payslip => {
      ytd.totalGrossEarnings += payslip.earningsSummary?.grossPay || 0;
      ytd.totalDeductions += payslip.deductionsSummary?.totalDeductions || 0;
      ytd.totalTax += payslip.taxBreakdown?.taxAmount || 0;
      ytd.totalNetPay += payslip.netPay || 0;

      ytd.breakdown.push({
        month: payslip.payPeriod.month,
        grossPay: payslip.earningsSummary?.grossPay || 0,
        deductions: payslip.deductionsSummary?.totalDeductions || 0,
        netPay: payslip.netPay
      });
    });

    res.json(ytd);
  } catch (err) {
    console.error('YTD Analytics Error:', err);
    res.status(500).json({ error: 'Failed to fetch YTD data' });
  }
});

/**
 * GET /api/payroll/my-ytd
 * Get year-to-date summary for current user
 */
router.get('/my-ytd', requireAuth, async (req, res) => {
  try {
    const { userId, organizationId } = getUserInfo(req);
    const { year = new Date().getFullYear() } = req.query;

    const payslips = await Payslip.find({
      userId,
      organizationId,
      'payPeriod.year': parseInt(year),
      status: { $in: ['approved', 'paid'] }
    });

    const ytd = {
      year: parseInt(year),
      totalPayslips: payslips.length,
      totalGrossEarnings: 0,
      totalDeductions: 0,
      totalTax: 0,
      totalNetPay: 0,
      breakdown: []
    };

    payslips.forEach(payslip => {
      ytd.totalGrossEarnings += payslip.earningsSummary?.grossPay || 0;
      ytd.totalDeductions += payslip.deductionsSummary?.totalDeductions || 0;
      ytd.totalTax += payslip.taxBreakdown?.taxAmount || 0;
      ytd.totalNetPay += payslip.netPay || 0;

      ytd.breakdown.push({
        month: payslip.payPeriod.month,
        periodDisplay: payslip.periodDisplay,
        grossPay: payslip.earningsSummary?.grossPay || 0,
        deductions: payslip.deductionsSummary?.totalDeductions || 0,
        netPay: payslip.netPay
      });
    });

    res.json(ytd);
  } catch (err) {
    console.error('My YTD Error:', err);
    res.status(500).json({ error: 'Failed to fetch YTD data' });
  }
});

module.exports = router;
