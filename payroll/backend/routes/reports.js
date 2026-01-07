const express = require('express');
const router = express.Router();
const PayrollRun = require('../models/PayrollRun');
const Payslip = require('../models/Payslip');
const PayrollProfile = require('../models/PayrollProfile');

// Import RBAC middleware
const { requireAuth, requireHRAdmin, requirePermission } = require('../middleware/rbac');

// Helper to get user info from session
function getUserInfo(req) {
    const session = req.session || {};
    return {
        userId: session.userId,
        organizationId: session.organizationId,
        name: session.userName,
        role: session.role
    };
}

// =====================================================
// REPORTS ROUTES (HR Admin only)
// =====================================================

/**
 * GET /api/payroll/reports/summary
 * Get yearly payroll summary
 */
router.get('/summary', requireHRAdmin, async (req, res) => {
    try {
        const { organizationId } = getUserInfo(req);
        const { year = new Date().getFullYear() } = req.query;

        // Get all payslips for the year
        const payslips = await Payslip.find({
            organizationId,
            'payPeriod.year': parseInt(year),
            status: { $in: ['paid', 'approved'] }
        });

        // Get all profiles
        const profiles = await PayrollProfile.find({ organizationId, status: 'active' });

        // Calculate totals
        const totalPayroll = payslips.reduce((sum, p) => sum + (p.netPay || 0), 0);
        const totalGross = payslips.reduce((sum, p) => sum + (p.grossPay || 0), 0);
        const totalDeductions = payslips.reduce((sum, p) => sum + (p.totalDeductions || 0), 0);

        // Group by department
        const deptMap = new Map();
        payslips.forEach(p => {
            const dept = p.employeeInfo?.department || 'Unassigned';
            const current = deptMap.get(dept) || { total: 0, count: 0 };
            current.total += p.netPay || 0;
            current.count++;
            deptMap.set(dept, current);
        });

        const byDepartment = Array.from(deptMap.entries())
            .map(([department, data]) => ({ department, ...data }))
            .sort((a, b) => b.total - a.total);

        // Group by month
        const monthMap = new Map();
        payslips.forEach(p => {
            const monthNum = p.payPeriod?.month || new Date(p.createdAt).getMonth() + 1;
            const monthName = new Date(year, monthNum - 1, 1).toLocaleString('default', { month: 'short' });
            const current = monthMap.get(monthNum) || { month: monthName, gross: 0, net: 0, deductions: 0 };
            current.gross += p.grossPay || 0;
            current.net += p.netPay || 0;
            current.deductions += p.totalDeductions || 0;
            monthMap.set(monthNum, current);
        });

        const byMonth = Array.from(monthMap.values()).sort((a, b) => {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return months.indexOf(a.month) - months.indexOf(b.month);
        });

        res.json({
            totalPayroll,
            totalGross,
            totalDeductions,
            totalEmployees: profiles.length,
            avgSalary: profiles.length > 0 ? Math.round(totalPayroll / profiles.length) : 0,
            currency: profiles[0]?.salary?.currency || 'USD',
            byDepartment,
            byMonth,
            year: parseInt(year)
        });
    } catch (err) {
        console.error('Report Summary Error:', err);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

/**
 * GET /api/payroll/reports/department
 * Get detailed department breakdown
 */
router.get('/department', requireHRAdmin, async (req, res) => {
    try {
        const { organizationId } = getUserInfo(req);
        const { year = new Date().getFullYear(), month } = req.query;

        const query = {
            organizationId,
            'payPeriod.year': parseInt(year),
            status: { $in: ['paid', 'approved'] }
        };

        if (month) {
            query['payPeriod.month'] = parseInt(month);
        }

        const payslips = await Payslip.find(query);

        // Group by department
        const deptMap = new Map();
        payslips.forEach(p => {
            const dept = p.employeeInfo?.department || 'Unassigned';
            if (!deptMap.has(dept)) {
                deptMap.set(dept, {
                    department: dept,
                    employees: [],
                    totalGross: 0,
                    totalNet: 0,
                    totalDeductions: 0,
                    totalTax: 0
                });
            }
            const data = deptMap.get(dept);
            data.employees.push({
                name: p.employeeInfo?.name,
                grossPay: p.grossPay,
                netPay: p.netPay
            });
            data.totalGross += p.grossPay || 0;
            data.totalNet += p.netPay || 0;
            data.totalDeductions += p.totalDeductions || 0;
            data.totalTax += p.tax?.total || 0;
        });

        res.json({
            departments: Array.from(deptMap.values()),
            year: parseInt(year),
            month: month ? parseInt(month) : null
        });
    } catch (err) {
        console.error('Department Report Error:', err);
        res.status(500).json({ error: 'Failed to generate department report' });
    }
});

/**
 * GET /api/payroll/reports/ytd/:userId
 * Get year-to-date summary for an employee
 */
router.get('/ytd/:userId', requireAuth, async (req, res) => {
    try {
        const { organizationId, userId: requesterId, role } = getUserInfo(req);
        const { userId } = req.params;
        const { year = new Date().getFullYear() } = req.query;

        // Check permission - only self or HR admin
        const isHRAdmin = ['owner', 'admin', 'hr_manager'].includes(role);
        if (userId !== requesterId && !isHRAdmin) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const payslips = await Payslip.find({
            organizationId,
            userId,
            'payPeriod.year': parseInt(year),
            status: { $in: ['paid', 'approved'] }
        }).sort({ 'payPeriod.month': 1 });

        const ytd = {
            grossPay: 0,
            netPay: 0,
            totalDeductions: 0,
            totalTax: 0,
            payslipCount: payslips.length,
            months: []
        };

        payslips.forEach(p => {
            ytd.grossPay += p.grossPay || 0;
            ytd.netPay += p.netPay || 0;
            ytd.totalDeductions += p.totalDeductions || 0;
            ytd.totalTax += p.tax?.total || 0;
            ytd.months.push({
                month: p.payPeriod?.month,
                grossPay: p.grossPay,
                netPay: p.netPay
            });
        });

        res.json({ ...ytd, year: parseInt(year), userId });
    } catch (err) {
        console.error('YTD Report Error:', err);
        res.status(500).json({ error: 'Failed to generate YTD report' });
    }
});

/**
 * GET /api/payroll/reports/export
 * Export payroll data as CSV
 */
router.get('/export', requireHRAdmin, async (req, res) => {
    try {
        const { organizationId } = getUserInfo(req);
        const { year = new Date().getFullYear(), month, format = 'csv' } = req.query;

        const query = {
            organizationId,
            'payPeriod.year': parseInt(year),
            status: { $in: ['paid', 'approved'] }
        };

        if (month) {
            query['payPeriod.month'] = parseInt(month);
        }

        const payslips = await Payslip.find(query).sort({ 'payPeriod.month': 1 });

        if (format === 'csv') {
            // Generate CSV
            const headers = ['Employee', 'Department', 'Month', 'Year', 'Gross Pay', 'Deductions', 'Tax', 'Net Pay'];
            const rows = payslips.map(p => [
                p.employeeInfo?.name || 'Unknown',
                p.employeeInfo?.department || 'Unassigned',
                p.payPeriod?.month || '',
                p.payPeriod?.year || '',
                p.grossPay || 0,
                p.totalDeductions || 0,
                p.tax?.total || 0,
                p.netPay || 0
            ]);

            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=payroll-report-${year}${month ? `-${month}` : ''}.csv`);
            res.send(csvContent);
        } else {
            // For PDF, return JSON for now (would need pdf generation library)
            res.json({ message: 'PDF export not yet implemented', data: payslips });
        }
    } catch (err) {
        console.error('Export Error:', err);
        res.status(500).json({ error: 'Failed to export report' });
    }
});

module.exports = router;
