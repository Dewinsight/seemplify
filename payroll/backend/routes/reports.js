const express = require('express');
const router = express.Router();

const PayrollRun = require('../models/PayrollRun');
const Payslip = require('../models/Payslip');
const PayrollProfile = require('../models/PayrollProfile');
const { buildPayrollRegisterCsv, buildPayrollRegisterWorkbook } = require('../services/payrollExportService');
const payrollReportingService = require('../services/PayrollReportingService');

// RBAC
const { requireAuth, requireHRAdmin } = require('../middleware/rbac');

function getUserInfo(req) {
  const user = req.session?.user || {};
  const currentOrgId = req.session?.currentOrganizationId || req.currentOrganization?.id;

  return {
    userId: user.id || user.sub,
    organizationId: currentOrgId,
    name: user.name,
    role: req.userRole,
  };
}

const APPROVED_PAYSLIP_STATUSES = ['approved', 'exported', 'paid'];

function reportingMetadata(reporting) {
  return {
    currency: reporting.reportingCurrency,
    reportingCurrency: reporting.reportingCurrency,
    hasAggregateTotals: reporting.hasAggregateTotals,
    isMultiCurrency: reporting.isMultiCurrency,
    currencies: reporting.currencies,
    unconvertedCurrencies: reporting.unconvertedCurrencies,
    conversionWarnings: reporting.conversionWarnings,
  };
}

function aggregatePreparedSubset(prepared, rows) {
  return payrollReportingService.aggregatePreparedRows(rows, {
    reportingCurrency: prepared.reportingCurrency,
    reportingMinorUnits: prepared.reportingMinorUnits,
  });
}

function roundReportingAmount(value, minorUnits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const factor = 10 ** minorUnits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

/**
 * GET /api/payroll/reports/summary
 * Yearly payroll summary (HR Admin only)
 */
router.get('/summary', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year = new Date().getFullYear(), month } = req.query;
    const y = parseInt(year);

    const payslipQuery = {
      organizationId,
      'payPeriod.year': y,
      status: { $in: APPROVED_PAYSLIP_STATUSES },
    };
    if (month) payslipQuery['payPeriod.month'] = parseInt(month);
    const payslips = await Payslip.find(payslipQuery).lean();

    const profiles = await PayrollProfile.find({
      organizationId,
      isActive: true,
    }).lean();

    const reporting = await payrollReportingService.preparePayslips(
      organizationId,
      payslips
    );

    // Group by department in the reporting currency, retaining native-currency detail.
    const deptMap = new Map();
    reporting.rows.forEach((row) => {
      const department = row.payslip?.employeeSnapshot?.department || 'Unassigned';
      const rows = deptMap.get(department) || [];
      rows.push(row);
      deptMap.set(department, rows);
    });

    const byDepartment = Array.from(deptMap.entries()).map(([department, rows]) => {
      const departmentReporting = aggregatePreparedSubset(reporting, rows);
      return {
        department,
        currency: reporting.reportingCurrency,
        total: departmentReporting.totals.netPay,
        count: departmentReporting.employeeCount,
        currencyBreakdown: departmentReporting.currencyBreakdown,
        ...reportingMetadata(departmentReporting),
      };
    }).sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity));

    // Group by month
    const monthMap = new Map();
    reporting.rows.forEach((row) => {
      const monthNum = row.payslip?.payPeriod?.month;
      if (!monthNum) return;
      const rows = monthMap.get(monthNum) || [];
      rows.push(row);
      monthMap.set(monthNum, rows);
    });

    const byMonth = Array.from(monthMap.entries()).map(([monthNum, rows]) => {
      const monthReporting = aggregatePreparedSubset(reporting, rows);
      return {
        monthNum,
        month: new Date(y, monthNum - 1, 1).toLocaleString('default', { month: 'short' }),
        currency: reporting.reportingCurrency,
        gross: monthReporting.totals.grossPay,
        net: monthReporting.totals.netPay,
        deductions: monthReporting.totals.totalDeductions,
        tax: monthReporting.totals.totalTax,
        currencyBreakdown: monthReporting.currencyBreakdown,
        ...reportingMetadata(monthReporting),
      };
    }).sort((a, b) => a.monthNum - b.monthNum);

    const employmentMap = new Map();
    reporting.rows.forEach((row) => {
      const employmentType = row.payslip?.employeeSnapshot?.employmentType || 'unassigned';
      const rows = employmentMap.get(employmentType) || [];
      rows.push(row);
      employmentMap.set(employmentType, rows);
    });
    const byEmploymentType = Array.from(employmentMap.entries()).map(([employmentType, rows]) => {
      const employmentReporting = aggregatePreparedSubset(reporting, rows);
      return {
        employmentType,
        currency: reporting.reportingCurrency,
        count: employmentReporting.employeeCount,
        gross: employmentReporting.totals.grossPay,
        net: employmentReporting.totals.netPay,
        currencyBreakdown: employmentReporting.currencyBreakdown,
        ...reportingMetadata(employmentReporting),
      };
    }).sort((a, b) => (b.gross ?? -Infinity) - (a.gross ?? -Infinity));

    const currencyBreakdown = reporting.currencyBreakdown.map((entry) => ({
      currency: entry.currency,
      gross: entry.grossPay,
      deductions: entry.totalDeductions,
      tax: entry.totalTax,
      net: entry.netPay,
      employerContributions: entry.totalEmployerContributions,
      employerCost: entry.totalEmployerCost,
      payslips: entry.payslipCount,
      employees: entry.employeeCount,
    }));

    const paidEmployeeCount = new Set(payslips.map(p => String(p.userId))).size;
    res.json({
      totalPayroll: reporting.totals.netPay,
      totalGross: reporting.totals.grossPay,
      totalDeductions: reporting.totals.totalDeductions,
      totalTax: reporting.totals.totalTax,
      totalEmployerContributions: reporting.totals.totalEmployerContributions,
      totalEmployerCost: reporting.totals.totalEmployerCost,
      totalEmployees: paidEmployeeCount || profiles.length,
      avgSalary: reporting.totals.netPay === null || payslips.length === 0
        ? (payslips.length === 0 ? 0 : null)
        : roundReportingAmount(
          reporting.totals.netPay / payslips.length,
          reporting.reportingMinorUnits
        ),
      ...reportingMetadata(reporting),
      currencyBreakdown,
      byDepartment,
      byMonth,
      byEmploymentType,
      year: y,
      month: month ? parseInt(month) : null,
    });
  } catch (err) {
    console.error('Report Summary Error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

/**
 * GET /api/payroll/reports/department
 * Department breakdown (HR Admin only)
 */
router.get('/department', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year = new Date().getFullYear(), month } = req.query;
    const y = parseInt(year);

    const query = {
      organizationId,
      'payPeriod.year': y,
      status: { $in: APPROVED_PAYSLIP_STATUSES },
    };
    if (month) query['payPeriod.month'] = parseInt(month);

    const payslips = await Payslip.find(query).lean();
    const reporting = await payrollReportingService.preparePayslips(
      organizationId,
      payslips
    );

    const deptMap = new Map();
    reporting.rows.forEach((row) => {
      const department = row.payslip?.employeeSnapshot?.department || 'Unassigned';
      const rows = deptMap.get(department) || [];
      rows.push(row);
      deptMap.set(department, rows);
    });

    const departments = Array.from(deptMap.entries()).map(([department, rows]) => {
      const departmentReporting = aggregatePreparedSubset(reporting, rows);
      return {
        department,
        employees: rows.map((row) => ({
          name: row.payslip?.employeeSnapshot?.name || 'Unknown',
          userId: row.payslip?.userId,
          grossPay: row.convertedAmounts?.grossPay ?? null,
          netPay: row.convertedAmounts?.netPay ?? null,
          currency: reporting.reportingCurrency,
          sourceCurrency: row.sourceCurrency,
          sourceGrossPay: row.sourceAmounts.grossPay,
          sourceNetPay: row.sourceAmounts.netPay,
          paymentDate: row.paymentDate?.toISOString() || null,
          exchangeRate: row.reportingRate,
          exchangeRateMetadata: row.rateMetadata,
          conversionWarning: row.conversionWarning,
        })),
        totalGross: departmentReporting.totals.grossPay,
        totalNet: departmentReporting.totals.netPay,
        totalDeductions: departmentReporting.totals.totalDeductions,
        totalTax: departmentReporting.totals.totalTax,
        totalEmployerContributions: departmentReporting.totals.totalEmployerContributions,
        totalEmployerCost: departmentReporting.totals.totalEmployerCost,
        employeeCount: departmentReporting.employeeCount,
        currencyBreakdown: departmentReporting.currencyBreakdown,
        ...reportingMetadata(departmentReporting),
      };
    }).sort((a, b) => (b.totalNet ?? -Infinity) - (a.totalNet ?? -Infinity));

    res.json({
      departments,
      ...reportingMetadata(reporting),
      currencyBreakdown: reporting.currencyBreakdown,
      year: y,
      month: month ? parseInt(month) : null,
    });
  } catch (err) {
    console.error('Department Report Error:', err);
    res.status(500).json({ error: 'Failed to generate department report' });
  }
});

/**
 * GET /api/payroll/reports/ytd/:userId
 * Year-to-date summary for a user (self or HR Admin)
 */
router.get('/ytd/:userId', requireAuth, async (req, res) => {
  try {
    const { organizationId, userId: requesterId, role } = getUserInfo(req);
    const { userId } = req.params;
    const { year = new Date().getFullYear() } = req.query;
    const y = parseInt(year);

    const isHRAdmin = role === 'hr_admin';
    if (userId !== requesterId && !isHRAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const payslips = await Payslip.find({
      organizationId,
      userId,
      'payPeriod.year': y,
      status: { $in: APPROVED_PAYSLIP_STATUSES },
    }).sort({ 'payPeriod.paymentDate': 1 }).lean();
    const reporting = await payrollReportingService.preparePayslips(
      organizationId,
      payslips
    );

    const ytd = {
      grossPay: reporting.totals.grossPay,
      netPay: reporting.totals.netPay,
      totalDeductions: reporting.totals.totalDeductions,
      totalTax: reporting.totals.totalTax,
      payslipCount: payslips.length,
      ...reportingMetadata(reporting),
      currencyBreakdown: reporting.currencyBreakdown,
      months: reporting.rows.map((row) => ({
        month: row.payslip?.payPeriod?.month,
        paymentDate: row.paymentDate?.toISOString() || null,
        grossPay: row.convertedAmounts?.grossPay ?? null,
        netPay: row.convertedAmounts?.netPay ?? null,
        deductions: row.convertedAmounts?.totalDeductions ?? null,
        tax: row.convertedAmounts?.totalTax ?? null,
        currency: reporting.reportingCurrency,
        sourceCurrency: row.sourceCurrency,
        sourceGrossPay: row.sourceAmounts.grossPay,
        sourceNetPay: row.sourceAmounts.netPay,
        sourceDeductions: row.sourceAmounts.totalDeductions,
        sourceTax: row.sourceAmounts.totalTax,
        exchangeRate: row.reportingRate,
        exchangeRateMetadata: row.rateMetadata,
        conversionWarning: row.conversionWarning,
      })),
    };

    res.json({ ...ytd, year: y, userId });
  } catch (err) {
    console.error('YTD Report Error:', err);
    res.status(500).json({ error: 'Failed to generate YTD report' });
  }
});

/**
 * GET /api/payroll/reports/export
 * Export payroll data as CSV (HR Admin only)
 */
router.get('/export', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year = new Date().getFullYear(), month, format = 'csv' } = req.query;
    const y = parseInt(year);

    const query = {
      organizationId,
      'payPeriod.year': y,
      status: { $in: APPROVED_PAYSLIP_STATUSES },
    };
    if (month) query['payPeriod.month'] = parseInt(month);

    const payslips = await Payslip.find(query).sort({ 'payPeriod.month': 1, 'employeeSnapshot.name': 1 }).lean();

    if (!['csv', 'xlsx'].includes(format)) {
      return res.status(400).json({ error: 'Supported export formats are csv and xlsx' });
    }

    const runIds = Array.from(new Set(
      payslips
        .map((payslip) => String(payslip?.payrollRunId || '').trim())
        .filter(Boolean)
    ));
    const userIds = Array.from(new Set(
      payslips
        .map((payslip) => String(payslip?.userId || '').trim())
        .filter(Boolean)
    ));

    const [runs, profiles] = await Promise.all([
      runIds.length > 0
        ? PayrollRun.find({ _id: { $in: runIds }, organizationId }).lean()
        : Promise.resolve([]),
      userIds.length > 0
        ? PayrollProfile.find({ organizationId, userId: { $in: userIds } })
          .select('userId currency employeeInfo bankAccounts workTerms')
          .lean()
        : Promise.resolve([]),
    ]);

    const runById = new Map(runs.map((run) => [String(run._id), run]));
    const profileByUserId = new Map(profiles.map((profile) => [String(profile.userId), profile]));
    if (format === 'xlsx') {
      const workbook = await buildPayrollRegisterWorkbook({ payslips, runById, profileByUserId });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="payroll-workbook-${y}${month ? `-${month}` : ''}.xlsx"`);
      return res.send(workbook);
    }

    const { csv } = buildPayrollRegisterCsv({ payslips, runById, profileByUserId });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-register-${y}${month ? `-${month}` : ''}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Export Error:', err);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

module.exports = router;
