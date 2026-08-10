import express from 'express';
import { Account } from '../models/Account.js';
import CrossModuleApiService from '../../services/CrossModuleApiService.js';
import { getProfileCompletionForAccount } from '../utils/profileCompletion.js';
import {
    getPayrollBankAccountTypes,
    getPayrollBankJurisdiction,
    normalizePayrollBankCountry,
} from '../config/payrollBankJurisdictions.js';

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

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeOptionalNumber(value, fallback = 100) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function isSalaryAccount(account = {}) {
    return normalizeText(account.accountType).toLowerCase() === 'salary';
}

function normalizeDigits(value) {
    return normalizeText(value).replace(/\D+/g, '');
}

function normalizeIban(value) {
    return normalizeText(value).replace(/\s+/g, '').toUpperCase();
}

function normalizeSwift(value) {
    return normalizeText(value).replace(/\s+/g, '').toUpperCase();
}

function compactBankValue(value) {
    return normalizeText(value).replace(/[\s-]+/g, '');
}

function isValidIban(value) {
    const iban = compactBankValue(value).toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
    const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
    let remainder = 0;
    for (const character of rearranged) {
        const part = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
        for (const digit of part) remainder = ((remainder * 10) + Number(digit)) % 97;
    }
    return remainder === 1;
}

function isValidAbaRoutingNumber(value) {
    const digits = normalizeDigits(value);
    if (!/^\d{9}$/.test(digits)) return false;
    const checksum = digits.split('').reduce((sum, digit, index) => (
        sum + (Number(digit) * [3, 7, 1][index % 3])
    ), 0);
    return checksum > 0 && checksum % 10 === 0;
}

function normalizeSortCode(value) {
    const digits = normalizeDigits(value);
    if (digits.length === 6) {
        return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
    }
    return normalizeText(value);
}

function normalizeBankAccount(country, account = {}) {
    const normalizedCountry = normalizePayrollBankCountry(account.country || country || 'Other');
    const jurisdiction = getPayrollBankJurisdiction(normalizedCountry);
    const accountTypes = getPayrollBankAccountTypes(normalizedCountry);
    const normalizedAccountType = normalizeText(account.accountType);
    const accountType = accountTypes.some((item) => item.value === normalizedAccountType)
        ? normalizedAccountType
        : (accountTypes[0]?.value || 'current');

    return {
        country: normalizedCountry,
        bankName: normalizeText(account.bankName),
        accountHolderName: normalizeText(account.accountHolderName),
        accountNumber: jurisdiction.requiresAccountNumber && ['USA', 'UK', 'Nigeria', 'South Africa'].includes(normalizedCountry)
            ? normalizeDigits(account.accountNumber)
            : normalizeText(account.accountNumber),
        routingNumber: normalizeDigits(account.routingNumber),
        sortCode: normalizeSortCode(account.sortCode),
        iban: normalizeIban(account.iban),
        bicSwift: normalizeSwift(account.bicSwift),
        bankCode: ['Nigeria', 'Canada', 'South Africa'].includes(normalizedCountry)
            ? normalizeDigits(account.bankCode)
            : normalizeText(account.bankCode).toUpperCase(),
        accountType,
        percentage: normalizeOptionalNumber(account.percentage, 100),
        isActive: account.isActive !== false,
        updatedAt: new Date()
    };
}

function validateBankAccount(account = {}) {
    const jurisdiction = getPayrollBankJurisdiction(account.country);

    if (!normalizeText(account.bankName)) {
        return 'Bank name is required';
    }

    if (jurisdiction.requiresAccountNumber && !normalizeText(account.accountNumber)) {
        return `${jurisdiction.accountNumberLabel || 'Account number'} is required`;
    }

    if (jurisdiction.requiresIban && !normalizeText(account.iban)) {
        return 'IBAN is required for this country';
    }

    if (jurisdiction.localField?.required) {
        const localValue = normalizeText(account[jurisdiction.localField.key]);
        if (!localValue) {
            return `${jurisdiction.localField.label} is required`;
        }
    }

    if (account.iban && !isValidIban(account.iban)) {
        return 'Enter a valid IBAN';
    }

    if (account.bicSwift && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(account.bicSwift)) {
        return 'SWIFT / BIC code must be 8 or 11 letters or numbers';
    }

    switch (account.country) {
        case 'USA':
            if (!/^\d{9}$/.test(account.routingNumber || '')) {
                return 'Routing number must be exactly 9 digits';
            }
            if (!isValidAbaRoutingNumber(account.routingNumber)) {
                return 'Routing number checksum is invalid';
            }
            break;
        case 'UK':
            if (!/^\d{2}-\d{2}-\d{2}$/.test(account.sortCode || '')) {
                return 'Sort code must be in format XX-XX-XX';
            }
            if (account.accountNumber && !/^\d{8}$/.test(account.accountNumber)) {
                return 'UK account numbers must be exactly 8 digits';
            }
            break;
        case 'Nigeria':
            if (!/^\d{3}$/.test(account.bankCode || '')) {
                return 'Bank code must be exactly 3 digits';
            }
            if (!/^\d{10}$/.test(account.accountNumber || '')) {
                return 'Nigerian account numbers must be exactly 10 digits';
            }
            break;
        case 'South Africa':
            if (account.bankCode && !/^\d{6}$/.test(account.bankCode)) {
                return 'South African branch codes must be 6 digits';
            }
            break;
        case 'Ghana':
        case 'Kenya':
            if (account.bankCode && !/^[A-Z0-9-]{3,12}$/i.test(account.bankCode)) {
                return `${jurisdiction.localField?.label || 'Bank code'} must be 3 to 12 letters, numbers, or hyphens`;
            }
            break;
        case 'Canada':
            if (!/^(?:0\d{8}|\d{8})$/.test(account.bankCode || '')) {
                return 'Institution and transit number must contain 3 institution digits followed by 5 transit digits, with an optional leading zero';
            }
            break;
        case 'Cameroon':
            if (!/^[A-Z0-9-]{2,12}$/i.test(account.bankCode || '')) {
                return 'Bank or branch code must contain 2 to 12 letters, numbers, or hyphens';
            }
            if (!/^[A-Z0-9-]{6,34}$/i.test(account.accountNumber || '')) {
                return 'Account or RIB number must contain 6 to 34 letters, numbers, or hyphens';
            }
            break;
        case 'Mozambique':
            if (!/^[A-Z0-9-]{6,34}$/i.test(account.accountNumber || '')) {
                return 'Account or NIB number must contain 6 to 34 letters, numbers, or hyphens';
            }
            break;
        default:
            break;
    }

    const allowedAccountTypes = getPayrollBankAccountTypes(account.country);
    if (!allowedAccountTypes.some((item) => item.value === account.accountType)) {
        return 'Account type is invalid for the selected country';
    }

    return null;
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
        const { dateOfBirth, mailingAddress, phoneNumbers, emergencyContacts } = req.body;

        const account = await Account.findOne({ sub: userId });
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        account.profile = account.profile || {};
        account.profile.personalInfo = account.profile.personalInfo || {};

        if (dateOfBirth !== undefined) {
            account.profile.personalInfo.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
        }
        if (mailingAddress) account.profile.personalInfo.mailingAddress = mailingAddress;
        if (phoneNumbers) account.profile.personalInfo.phoneNumbers = phoneNumbers;
        if (emergencyContacts) account.profile.personalInfo.emergencyContacts = emergencyContacts;

        const completion = await updateCompletionTracking(req, account);
        account.markModified('profile');
        await account.save();

        res.json({
            success: true,
            message: 'Personal information updated successfully',
            profileCompletion: completion,
            nextStep: completion.nextIncompleteStep
        });
    } catch (error) {
        console.error('Personal info update error:', error);
        res.status(500).json({ error: 'Failed to update personal information' });
    }
});

/**
 * PUT /api/profile/banking
 * Update banking/direct deposit information (International support)
 */
router.put('/api/profile/banking', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.session.accountId;
        const orgId = req.session.currentOrganization;
        const { country, account: bankAccount, accountIndex } = req.body;

        const userAccount = await Account.findOne({ sub: userId });
        if (!userAccount) {
            return res.status(404).json({ error: 'Account not found' });
        }

        if (!bankAccount || typeof bankAccount !== 'object') {
            return res.status(400).json({ error: 'Bank account details are required' });
        }

        userAccount.profile = userAccount.profile || {};
        userAccount.profile.banking = userAccount.profile.banking || { country: country, accounts: [] };
        userAccount.profile.banking.accounts = Array.isArray(userAccount.profile.banking.accounts)
            ? userAccount.profile.banking.accounts
            : [];

        const hasAccountIndex = accountIndex !== undefined && accountIndex !== null && `${accountIndex}` !== '';
        const parsedAccountIndex = hasAccountIndex ? Number.parseInt(accountIndex, 10) : null;

        if (hasAccountIndex && (!Number.isInteger(parsedAccountIndex) || parsedAccountIndex < 0 || parsedAccountIndex >= userAccount.profile.banking.accounts.length)) {
            return res.status(400).json({ error: 'Invalid account selected for editing' });
        }

        const normalizedAccount = normalizeBankAccount(country, bankAccount);
        const validationError = validateBankAccount(normalizedAccount);
        if (validationError) {
            return res.status(400).json({ error: validationError });
        }

        const existingSalaryIndex = userAccount.profile.banking.accounts.findIndex((existingAccount, index) => {
            if (existingAccount?.isActive === false) {
                return false;
            }
            if (hasAccountIndex && index === parsedAccountIndex) {
                return false;
            }
            return isSalaryAccount(existingAccount);
        });

        const editingExistingSalaryAccount = hasAccountIndex && isSalaryAccount(userAccount.profile.banking.accounts[parsedAccountIndex]);
        if (isSalaryAccount(normalizedAccount) && existingSalaryIndex !== -1 && !editingExistingSalaryAccount) {
            return res.status(400).json({
                error: 'Only one salary account is allowed. Edit the existing salary account instead.'
            });
        }

        // Update primary banking country if provided
        if (normalizedAccount.country) {
            userAccount.profile.banking.country = normalizedAccount.country;
        }

        let message = 'Banking information updated successfully! Payroll has been notified.';
        if (hasAccountIndex) {
            const existingAccount = userAccount.profile.banking.accounts[parsedAccountIndex];
            existingAccount.country = normalizedAccount.country;
            existingAccount.bankName = normalizedAccount.bankName;
            existingAccount.accountHolderName = normalizedAccount.accountHolderName;
            existingAccount.accountNumber = normalizedAccount.accountNumber;
            existingAccount.routingNumber = normalizedAccount.routingNumber;
            existingAccount.sortCode = normalizedAccount.sortCode;
            existingAccount.iban = normalizedAccount.iban;
            existingAccount.bicSwift = normalizedAccount.bicSwift;
            existingAccount.bankCode = normalizedAccount.bankCode;
            existingAccount.accountType = normalizedAccount.accountType;
            existingAccount.percentage = normalizedAccount.percentage;
            existingAccount.isActive = normalizedAccount.isActive;
            existingAccount.updatedAt = new Date();
            if (!existingAccount.createdAt) {
                existingAccount.createdAt = new Date();
            }
            message = 'Payment account updated successfully! Payroll has been notified.';
        } else {
            userAccount.profile.banking.accounts.push({
                ...normalizedAccount,
                createdAt: new Date()
            });
            message = 'Payment account added successfully! Payroll has been notified.';
        }

        const completion = await updateCompletionTracking(req, userAccount);
        userAccount.markModified('profile');
        await userAccount.save();

        // TODO: Send webhook to Payroll module with updated banking info
        // Payload should include country-specific fields for payment processing
        console.log('📤 Banking info updated, should notify Payroll module with:', {
            employeeId: userId,
            organizationId: orgId,
            country: bankAccount.country,
            bankingMethod: userAccount.profile.banking.country,
            accountsCount: userAccount.profile.banking.accounts.length
        });

        res.json({
            success: true,
            message,
            profileCompletion: completion,
            nextStep: completion.nextIncompleteStep
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
        const { dependent, hasDependents } = req.body;

        const account = await Account.findOne({ sub: userId });
        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        account.profile = account.profile || {};
        account.profile.dependents = account.profile.dependents || [];
        account.profile.dependentsDeclaration = account.profile.dependentsDeclaration || {};

        if (hasDependents === false || hasDependents === 'false') {
            account.profile.dependentsDeclaration = {
                status: 'none',
                confirmedAt: new Date(),
                lastUpdated: new Date()
            };
            const completion = await updateCompletionTracking(req, account);
            account.markModified('profile');
            await account.save();

            return res.json({
                success: true,
                message: 'Dependents marked as complete',
                profileCompletion: completion,
                nextStep: completion.nextIncompleteStep
            });
        }

        if (!dependent || typeof dependent !== 'object') {
            return res.status(400).json({ error: 'Dependent details are required' });
        }

        account.profile.dependents.push(dependent);
        account.profile.dependentsDeclaration = {
            status: 'provided',
            confirmedAt: new Date(),
            lastUpdated: new Date()
        };

        const completion = await updateCompletionTracking(req, account);
        account.markModified('profile');
        await account.save();

        res.json({
            success: true,
            message: 'Dependent added successfully',
            profileCompletion: completion,
            nextStep: completion.nextIncompleteStep
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
