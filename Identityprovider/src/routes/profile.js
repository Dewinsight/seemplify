import express from 'express';
import { Account } from '../models/Account.js';
import CrossModuleApiService from '../../services/CrossModuleApiService.js';

const router = express.Router();

// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.accountId) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
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
        const { mailingAddress, phoneNumbers, emergencyContacts } = req.body;

        const account = await Account.findOne({ sub: userId });
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        account.profile = account.profile || {};
        account.profile.personalInfo = account.profile.personalInfo || {};

        if (mailingAddress) account.profile.personalInfo.mailingAddress = mailingAddress;
        if (phoneNumbers) account.profile.personalInfo.phoneNumbers = phoneNumbers;
        if (emergencyContacts) account.profile.personalInfo.emergencyContacts = emergencyContacts;

        await account.save();

        res.json({
            success: true,
            message: 'Personal information updated successfully'
        });
    } catch (error) {
        console.error('Personal info update error:', error);
        res.status(500).json({ error: 'Failed to update personal information' });
    }
});

/**
 * PUT /api/profile/tax
 * Update tax withholding information
 */
router.put('/api/profile/tax', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.session.accountId;
        const orgId = req.session.currentOrganization;
        const { filingStatus, w4Allowances, additionalWithholding, multipleJobs } = req.body;

        const account = await Account.findOne({ sub: userId });
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        account.profile = account.profile || {};
        account.profile.taxInfo = {
            filingStatus,
            w4Allowances: w4Allowances || 0,
            additionalWithholding: additionalWithholding || 0,
            multipleJobs: multipleJobs || false,
            lastUpdated: new Date()
        };

        await account.save();

        // TODO: Send webhook to Payroll module with updated tax info
        console.log('📤 Tax info updated, should notify Payroll module');

        res.json({
            success: true,
            message: 'Tax information updated successfully! Payroll has been notified.'
        });
    } catch (error) {
        console.error('Tax info update error:', error);
        res.status(500).json({ error: 'Failed to update tax information' });
    }
});

/**
 * PUT /api/profile/banking
 * Update banking/direct deposit information
 */
router.put('/api/profile/banking', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.session.accountId;
        const { account: bankAccount } = req.body;

        const userAccount = await Account.findOne({ sub: userId });
        if (!userAccount) {
            return res.status(404).json({ error: 'Account not found' });
        }

        userAccount.profile = userAccount.profile || {};
        userAccount.profile.banking = userAccount.profile.banking || { accounts: [] };

        // Add new account (TODO: Implement edit/update logic)
        userAccount.profile.banking.accounts.push(bankAccount);

        await userAccount.save();

        // TODO: Send webhook to Payroll module with updated banking info
        console.log('📤 Banking info updated, should notify Payroll module');

        res.json({
            success: true,
            message: 'Banking information updated successfully! Payroll has been notified.'
        });
    } catch (error) {
        console.error('Banking info update error:', error);
        res.status(500).json({ error: 'Failed to update banking information' });
    }
});

/**
 * PUT /api/profile/dependents
 * Add a dependent
 */
router.put('/api/profile/dependents', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.session.accountId;
        const { dependent } = req.body;

        const account = await Account.findOne({ sub: userId });
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        account.profile = account.profile || {};
        account.profile.dependents = account.profile.dependents || [];

        account.profile.dependents.push(dependent);

        await account.save();

        res.json({
            success: true,
            message: 'Dependent added successfully'
        });
    } catch (error) {
        console.error('Dependent add error:', error);
        res.status(500).json({ error: 'Failed to add dependent' });
    }
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
