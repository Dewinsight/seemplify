const express = require('express');
const router = express.Router();
const SalaryGrade = require('../models/SalaryGrade');
const { requireAuth, requireHRAdmin } = require('../middleware/rbac');

// Helper to get org ID from session
const getOrgId = (req) => req.currentOrganization?.id || req.session?.currentOrganizationId;

/**
 * GET /api/payroll/salary-grades
 * List all salary grades for the organization
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const organizationId = getOrgId(req);
        const { department, jobFamily, active } = req.query;

        const query = { organizationId };
        if (department) query.department = department;
        if (jobFamily) query.jobFamily = jobFamily;
        if (active !== undefined) query.isActive = active === 'true';

        const grades = await SalaryGrade.find(query)
            .sort({ gradeLevel: 1 })
            .lean();

        res.json(grades);
    } catch (err) {
        console.error('Get Salary Grades Error:', err);
        res.status(500).json({ error: 'Failed to fetch salary grades' });
    }
});

/**
 * GET /api/payroll/salary-grades/:id
 * Get a single salary grade
 */
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const organizationId = getOrgId(req);
        const grade = await SalaryGrade.findOne({ _id: req.params.id, organizationId });

        if (!grade) {
            return res.status(404).json({ error: 'Salary grade not found' });
        }

        res.json(grade);
    } catch (err) {
        console.error('Get Salary Grade Error:', err);
        res.status(500).json({ error: 'Failed to fetch salary grade' });
    }
});

/**
 * POST /api/payroll/salary-grades
 * Create a new salary grade (HR Admin only)
 */
router.post('/', requireHRAdmin, async (req, res) => {
    try {
        const organizationId = getOrgId(req);
        const userId = req.session?.user?.sub || req.session?.user?.id;

        const {
            gradeCode,
            gradeName,
            gradeLevel,
            salaryRange,
            variablePay,
            allowances,
            benefits,
            department,
            jobFamily
        } = req.body;

        // Check for duplicate grade code
        const existing = await SalaryGrade.findOne({ organizationId, gradeCode });
        if (existing) {
            return res.status(400).json({ error: 'Grade code already exists' });
        }

        const grade = new SalaryGrade({
            organizationId,
            gradeCode,
            gradeName,
            gradeLevel,
            salaryRange: {
                currency: salaryRange?.currency || 'USD',
                minimum: salaryRange?.minimum || 0,
                maximum: salaryRange?.maximum || 0,
                midpoint: salaryRange?.midpoint || ((salaryRange?.minimum || 0) + (salaryRange?.maximum || 0)) / 2
            },
            variablePay: variablePay || { eligible: false },
            allowances: allowances || [],
            benefits: benefits || [],
            department,
            jobFamily,
            created_by: userId
        });

        await grade.save();
        res.status(201).json({ success: true, grade });
    } catch (err) {
        console.error('Create Salary Grade Error:', err);
        res.status(500).json({ error: 'Failed to create salary grade' });
    }
});

/**
 * PUT /api/payroll/salary-grades/:id
 * Update a salary grade (HR Admin only)
 */
router.put('/:id', requireHRAdmin, async (req, res) => {
    try {
        const organizationId = getOrgId(req);
        const userId = req.session?.user?.sub || req.session?.user?.id;

        const grade = await SalaryGrade.findOne({ _id: req.params.id, organizationId });
        if (!grade) {
            return res.status(404).json({ error: 'Salary grade not found' });
        }

        const {
            gradeName,
            gradeLevel,
            salaryRange,
            variablePay,
            allowances,
            benefits,
            department,
            jobFamily,
            isActive
        } = req.body;

        if (gradeName) grade.gradeName = gradeName;
        if (gradeLevel !== undefined) grade.gradeLevel = gradeLevel;
        if (salaryRange) {
            grade.salaryRange = {
                ...grade.salaryRange,
                ...salaryRange,
                midpoint: salaryRange.midpoint || ((salaryRange.minimum || grade.salaryRange.minimum) + (salaryRange.maximum || grade.salaryRange.maximum)) / 2
            };
        }
        if (variablePay) grade.variablePay = variablePay;
        if (allowances) grade.allowances = allowances;
        if (benefits) grade.benefits = benefits;
        if (department !== undefined) grade.department = department;
        if (jobFamily !== undefined) grade.jobFamily = jobFamily;
        if (isActive !== undefined) grade.isActive = isActive;

        grade.updated_by = userId;
        await grade.save();

        res.json({ success: true, grade });
    } catch (err) {
        console.error('Update Salary Grade Error:', err);
        res.status(500).json({ error: 'Failed to update salary grade' });
    }
});

/**
 * DELETE /api/payroll/salary-grades/:id
 * Soft delete a salary grade (HR Admin only)
 */
router.delete('/:id', requireHRAdmin, async (req, res) => {
    try {
        const organizationId = getOrgId(req);
        const userId = req.session?.user?.sub || req.session?.user?.id;

        const grade = await SalaryGrade.findOne({ _id: req.params.id, organizationId });
        if (!grade) {
            return res.status(404).json({ error: 'Salary grade not found' });
        }

        // Soft delete
        grade.isActive = false;
        grade.endDate = new Date();
        grade.updated_by = userId;
        await grade.save();

        res.json({ success: true, message: 'Salary grade deactivated' });
    } catch (err) {
        console.error('Delete Salary Grade Error:', err);
        res.status(500).json({ error: 'Failed to delete salary grade' });
    }
});

module.exports = router;
