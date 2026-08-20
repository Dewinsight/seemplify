import express from 'express';
import { Account } from '../models/Account.js';
import CrossModuleApiService from '../../services/CrossModuleApiService.js';
import { getProfileCompletionForAccount } from '../utils/profileCompletion.js';
import { validatePersonalProfile } from '../utils/personalProfileValidation.js';

const router = express.Router();

// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.accountId) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
}

function resolveOrganizationId(req, account) {
    return req.session?.currentOrganization
        || account?.currentOrganization?._id?.toString?.()
        || account?.currentOrganization?.toString?.()
        || null;
}

async function updateCompletionTracking(req, account) {
    const completion = await getProfileCompletionForAccount(account, {
        organizationId: resolveOrganizationId(req, account)
    });
    account.profile = account.profile || {};
    account.profile.completionReminders = {
        ...(account.profile.completionReminders || {}),
        lastMissingSteps: (completion.steps || []).filter(step => !step.complete).map(step => step.key),
    };

    if (completion.complete) {
        account.profile.completionReminders.lastCompletedAt = new Date();
    }

    return completion;
}

/**
 * GET /api/profile/dashboard
 * Fetch aggregated employee dashboard data from all HR modules
 */
router.get('/api/profile/dashboard', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.session.accountId;
        const orgId = req.session.currentOrganization;

        if (!orgId) {
            return res.status(400).json({
                error: 'No organization selected',
                message: 'Please select an organization first'
            });
        }

        console.log(`📊 Fetching dashboard data for user: ${userId}, org: ${orgId}`);

        const crossModuleService = new CrossModuleApiService();
        const dashboardData = await crossModuleService.fetchAllEmployeeData(userId, orgId);

        res.json({
            success: true,
            data: dashboardData
        });
    } catch (error) {
        console.error('Dashboard data fetch error:', error);
        res.status(500).json({
            error: 'Failed to fetch dashboard data',
            message: error.message
        });
    }
});

/**
 * PUT /api/profile
 * Update basic user profile information
 */
router.put('/api/profile', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.session.accountId;
        const { name, preferredUsername } = req.body;

        const account = await Account.findOne({ sub: userId });
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        account.profile = account.profile || {};
        if (name !== undefined) account.profile.name = name;
        if (preferredUsername !== undefined) account.profile.preferred_username = preferredUsername;

        await account.save();

        res.json({
            success: true,
            message: 'Profile updated successfully',
            profile: account.profile
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

/**
 * PUT /api/profile/personal
 * Update extended personal information
 */
router.put('/api/profile/personal', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.session.accountId;
        const validation = validatePersonalProfile(req.body);
        if (!validation.valid) {
            return res.status(422).json({
                error: 'Check the highlighted fields and try again.',
                code: 'PERSONAL_PROFILE_VALIDATION_FAILED',
                fieldErrors: validation.fieldErrors
            });
        }

        const account = await Account.findOne({ sub: userId });
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        account.profile = account.profile || {};
        account.profile.personalInfo = validation.value;

        const completion = await updateCompletionTracking(req, account);
        account.markModified('profile');
        await account.save();

        res.json({
            success: true,
            message: 'Personal information updated successfully',
            profileCompletion: completion,
            nextStep: {
                key: 'dependents',
                label: 'Dependents',
                route: `${(process.env.PAYROLL_MANAGEMENT_URL || 'http://localhost:5007').replace(/\/$/, '')}/dependents`
            }
        });
    } catch (error) {
        console.error('Personal info update error:', error);
        res.status(500).json({ error: 'Failed to update personal information' });
    }
});

// Banking is owned by Payroll. Keep the legacy API explicit so old clients do
// not silently write a second, conflicting salary account in Identity.
router.put('/api/profile/banking', ensureAuthenticated, (_req, res) => {
    const payrollUrl = process.env.PAYROLL_MANAGEMENT_URL || 'http://localhost:5007';
    res.status(410).json({
        error: 'Banking and direct deposit are managed in Payroll.',
        code: 'BANKING_MOVED_TO_PAYROLL',
        location: `${payrollUrl.replace(/\/$/, '')}/banking`
    });
});

/**
 * PUT /api/profile/dependents
 * Add a dependent
 */
router.put('/api/profile/dependents', ensureAuthenticated, (_req, res) => {
    const payrollUrl = process.env.PAYROLL_MANAGEMENT_URL || 'http://localhost:5007';
    res.status(410).json({
        error: 'Dependents are managed in Payroll for benefits and tax processing.',
        code: 'DEPENDENTS_MOVED_TO_PAYROLL',
        location: `${payrollUrl.replace(/\/$/, '')}/dependents`
    });
});

/**
 * GET /api/profile/documents/payroll
 * Get list of payroll documents (payslips)
 */
router.get('/api/profile/documents/payroll', ensureAuthenticated, async (req, res) => {
    try {
        // TODO: Fetch from Payroll module
        res.json({
            success: true,
            documents: []  // Empty for now
        });
    } catch (error) {
        console.error('Error fetching payroll documents:', error);
        res.status(500).json({ error: 'Failed to fetch payroll documents' });
    }
});

export default router;
