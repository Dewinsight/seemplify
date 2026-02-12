const express = require('express');
const router = express.Router();

const PayrollRun = require('../models/PayrollRun');
const Payslip = require('../models/Payslip');
const PayrollProfile = require('../models/PayrollProfile');

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

const sumByType = (items, type) => (items || [])
  .filter(i => i && i.type === type)
  .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

/**
 * GET /api/payroll/reports/summary
 * Yearly payroll summary (HR Admin only)
 */
router.get('/summary', requireHRAdmin, async (req, res) => {
  try {
    const { organizationId } = getUserInfo(req);
    const { year = new Date().getFullYear() } = req.query;
    const y = parseInt(year);

    const payslips = await Payslip.find({
      organizationId,
      'payPeriod.year': y,
      status: { $in: APPROVED_PAYSLIP_STATUSES },
    }).lean();

    const profiles = await PayrollProfile.find({
      organizationId,
      isActive: true,
    }).lean();

    const totals = payslips.reduce((acc, p) => {
      acc.totalPayroll += Number(p.netPay) || 0;
      acc.totalGross += Number(p.earningsSummary?.grossPay) || 0;
      acc.totalDeductions += Number(p.deductionsSummary?.totalDeductions) || 0;
      acc.totalTax += Number(p.taxBreakdown?.taxAmount) || sumByType(p.deductions, 'income_tax');
      return acc;
    }, { totalPayroll: 0, totalGross: 0, totalDeductions: 0, totalTax: 0 });

    // Group by department (net payroll)
    const deptMap = new Map();
    payslips.forEach(p => {
      const dept = p.employeeSnapshot?.department || 'Unassigned';
      const current = deptMap.get(dept) || { total: 0, count: 0 };
      current.total += Number(p.netPay) || 0;
      current.count += 1;
      deptMap.set(dept, current);
    });

    const byDepartment = Array.from(deptMap.entries())
      .map(([department, data]) => ({ department, ...data }))
      .sort((a, b) => b.total - a.total);

    // Group by month
    const monthMap = new Map();
    payslips.forEach(p => {
      const monthNum = p.payPeriod?.month;
      if (!monthNum) return;
      const monthName = new Date(y, monthNum - 1, 1).toLocaleString('default', { month: 'short' });
      const current = monthMap.get(monthNum) || { month: monthName, gross: 0, net: 0, deductions: 0 };
      current.gross += Number(p.earningsSummary?.grossPay) || 0;
      current.net += Number(p.netPay) || 0;
      current.deductions += Number(p.deductionsSummary?.totalDeductions) || 0;
      monthMap.set(monthNum, current);
    });

    const byMonth = Array.from(monthMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, v]) => v);

    res.json({
      totalPayroll: totals.totalPayroll,
      totalGross: totals.totalGross,
      totalDeductions: totals.totalDeductions,
      totalTax: totals.totalTax,
      totalEmployees: profiles.length,
      avgSalary: profiles.length > 0 ? Math.round(totals.totalPayroll / profiles.length) : 0,
      currency: 'USD', // Mixed currency orgs should rely on per-employee currency in exports
      byDepartment,
      byMonth,
      year: y,
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

    const deptMap = new Map();
    payslips.forEach(p => {
      const dept = p.employeeSnapshot?.department || 'Unassigned';
      if (!deptMap.has(dept)) {
        deptMap.set(dept, {
          department: dept,
          employees: [],
          totalGross: 0,
          totalNet: 0,
          totalDeductions: 0,
          totalTax: 0,
        });
      }
      const data = deptMap.get(dept);
      data.employees.push({
        name: p.employeeSnapshot?.name || 'Unknown',
        grossPay: Number(p.earningsSummary?.grossPay) || 0,
        netPay: Number(p.netPay) || 0,
      });
      data.totalGross += Number(p.earningsSummary?.grossPay) || 0;
      data.totalNet += Number(p.netPay) || 0;
      data.totalDeductions += Number(p.deductionsSummary?.totalDeductions) || 0;
      data.totalTax += Number(p.taxBreakdown?.taxAmount) || sumByType(p.deductions, 'income_tax');
    });

    res.json({
      departments: Array.from(deptMap.values()).sort((a, b) => b.totalNet - a.totalNet),
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
    }).sort({ 'payPeriod.month': 1 }).lean();

    const ytd = {
      grossPay: 0,
      netPay: 0,
      totalDeductions: 0,
      totalTax: 0,
      payslipCount: payslips.length,
      months: [],
    };

    payslips.forEach(p => {
      ytd.grossPay += Number(p.earningsSummary?.grossPay) || 0;
      ytd.netPay += Number(p.netPay) || 0;
      ytd.totalDeductions += Number(p.deductionsSummary?.totalDeductions) || 0;
      ytd.totalTax += Number(p.taxBreakdown?.taxAmount) || sumByType(p.deductions, 'income_tax');
      ytd.months.push({
        month: p.payPeriod?.month,
        grossPay: Number(p.earningsSummary?.grossPay) || 0,
        netPay: Number(p.netPay) || 0,
      });
    });

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

    if (format !== 'csv') {
      return res.status(400).json({ error: 'Only csv export is supported' });
    }

    const csvEscape = (value) => {
      if (value === null || value === undefined) return '';
      const s = String(value);
      return /[\",\\n\\r]/.test(s) ? `\"${s.replace(/\"/g, '\"\"')}\"` : s;
    };

    const headers = [
      'Employee Name',
      'Employee ID',
      'Department',
      'Month',
      'Year',
      'Currency',
      'Gross Pay',
      'Total Deductions',
      'Income Tax',
      'Net Pay',
    ];

    const rows = payslips.map(p => [
      p.employeeSnapshot?.name || '',
      p.employeeSnapshot?.employeeId || '',
      p.employeeSnapshot?.department || '',
      p.payPeriod?.month || '',
      p.payPeriod?.year || '',
      p.currency || 'USD',
      Number(p.earningsSummary?.grossPay) || 0,
      Number(p.deductionsSummary?.totalDeductions) || 0,
      Number(p.taxBreakdown?.taxAmount) || sumByType(p.deductions, 'income_tax'),
      Number(p.netPay) || 0,
    ].map(csvEscape));

    const csv = [headers.map(csvEscape).join(','), ...rows.map(r => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-report-${y}${month ? `-${month}` : ''}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Export Error:', err);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

module.exports = router;

