const express = require('express');
const router = express.Router();
const currencyService = require('../services/CurrencyService');
const exchangeRateSyncService = require('../services/ExchangeRateSyncService');
const ExchangeRate = require('../models/ExchangeRate');
const organizationCurrencyService = require('../services/OrganizationCurrencyService');
const { requireAuth, requireHRAdmin } = require('../middleware/rbac');
const {
    assertExchangeRatesReady,
    getExchangeRateRuntimeState,
} = require('../services/ExchangeRateRuntimeState');

// Helper to get user info
const getUserInfo = (req) => ({
    userId: req.session?.user?.sub || req.session?.user?.id,
    organizationId: req.currentOrganization?.id || req.session?.currentOrganizationId,
    name: req.session?.user?.name
});

/**
 * GET /api/payroll/currencies
 * Get all supported currencies
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const { organizationId, userId, name } = getUserInfo(req);
        const policy = await organizationCurrencyService.getPolicy(organizationId, { userId, name });
        res.json({
            currencies: organizationCurrencyService.buildCatalog(policy),
            policy: policy.toPublicJSON(),
            provider: exchangeRateSyncService.getProviderInfo()
        });
    } catch (err) {
        console.error('Get Currency Catalog Error:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch currency catalogue' });
    }
});

/**
 * GET /api/payroll/currencies/policy
 * Get the organization's payroll currency controls.
 */
router.get('/policy', requireHRAdmin, async (req, res) => {
    try {
        const { organizationId, userId, name } = getUserInfo(req);
        const policy = await organizationCurrencyService.getPolicy(organizationId, { userId, name });
        res.json({ policy: policy.toPublicJSON(), currencies: organizationCurrencyService.buildCatalog(policy) });
    } catch (err) {
        console.error('Get Currency Policy Error:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch currency policy', details: err.details });
    }
});

/**
 * PUT /api/payroll/currencies/policy
 * Update functional/reporting/payment currencies and custom reporting units.
 */
router.put('/policy', requireHRAdmin, async (req, res) => {
    try {
        const { organizationId, userId, name } = getUserInfo(req);
        const policy = await organizationCurrencyService.updatePolicy(
            organizationId,
            req.body || {},
            { userId, name }
        );
        res.json({
            success: true,
            policy: policy.toPublicJSON(),
            currencies: organizationCurrencyService.buildCatalog(policy)
        });
    } catch (err) {
        console.error('Update Currency Policy Error:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update currency policy', details: err.details });
    }
});

/**
 * GET /api/payroll/currencies/settings
 * Get exchange-rate sync settings for the current organization
 */
router.get('/settings', requireHRAdmin, async (req, res) => {
    try {
        const { organizationId, userId, name } = getUserInfo(req);
        const settings = await exchangeRateSyncService.getSettings(organizationId, {
            userId,
            name
        });
        const activeRateCount = await ExchangeRate.countDocuments({
            organizationId,
            isActive: true
        });

        res.json({
            settings,
            provider: exchangeRateSyncService.getProviderInfo(),
            activeRateCount,
            runtime: getExchangeRateRuntimeState()
        });
    } catch (err) {
        console.error('Get Currency Settings Error:', err);
        res.status(500).json({ error: 'Failed to fetch currency sync settings' });
    }
});

/**
 * PUT /api/payroll/currencies/settings
 * Update exchange-rate sync settings
 */
router.put('/settings', requireHRAdmin, async (req, res) => {
    try {
        const { organizationId, userId, name } = getUserInfo(req);
        const settings = await exchangeRateSyncService.updateSettings(
            organizationId,
            req.body || {},
            { userId, name }
        );

        res.json({
            success: true,
            settings,
            provider: exchangeRateSyncService.getProviderInfo()
        });
    } catch (err) {
        console.error('Update Currency Settings Error:', err);
        res.status(500).json({ error: 'Failed to update currency sync settings' });
    }
});

/**
 * GET /api/payroll/currencies/rates
 * Get active exchange rates for organization
 */
router.get('/rates', requireAuth, async (req, res) => {
    try {
        const { organizationId } = getUserInfo(req);
        const { baseCurrency } = req.query;

        const rates = await currencyService.getActiveRates(organizationId, baseCurrency);

        res.json({
            rates,
            baseCurrency: baseCurrency || null,
            count: rates.length
        });
    } catch (err) {
        console.error('Get Rates Error:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch exchange rates', code: err.code });
    }
});

/**
 * POST /api/payroll/currencies/rates
 * Set exchange rate (HR Admin only)
 */
router.post('/rates', requireHRAdmin, async (req, res) => {
    try {
        const { organizationId, userId, name } = getUserInfo(req);
        const { baseCurrency, targetCurrency, rate, effectiveDate, notes } = req.body;

        if (!baseCurrency || !targetCurrency || rate === undefined) {
            return res.status(400).json({
                error: 'baseCurrency, targetCurrency, and rate are required'
            });
        }

        if (rate <= 0) {
            return res.status(400).json({ error: 'Rate must be greater than 0' });
        }

        const exchangeRate = await currencyService.setRate(
            organizationId,
            baseCurrency,
            targetCurrency,
            parseFloat(rate),
            {
                effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
                notes,
                source: 'manual',
                createdBy: userId,
                createdByName: name
            }
        );

        res.status(201).json({
            success: true,
            rate: exchangeRate
        });
    } catch (err) {
        console.error('Set Rate Error:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to set exchange rate', code: err.code });
    }
});

/**
 * POST /api/payroll/currencies/rates/sync
 * Fetch latest provider rates and seed/update the organization's active rates
 */
router.post('/rates/sync', requireHRAdmin, async (req, res) => {
    try {
        assertExchangeRatesReady();
        const { organizationId, userId, name } = getUserInfo(req);
        const { baseCurrency, preserveManualOverrides } = req.body || {};

        const result = await exchangeRateSyncService.syncOrganizationRates(
            organizationId,
            {
                baseCurrency,
                preserveManualOverrides,
                createdBy: userId,
                createdByName: name || 'HR Admin'
            }
        );

        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        console.error('Sync Rates Error:', err);
        res.status(err.statusCode || 500).json({
            error: err.message || 'Failed to sync live exchange rates',
            code: err.code
        });
    }
});

/**
 * POST /api/payroll/currencies/rates/seed
 * Seed rates for organizations that have not configured any rates yet
 */
router.post('/rates/seed', requireHRAdmin, async (req, res) => {
    try {
        assertExchangeRatesReady();
        const { organizationId, userId, name } = getUserInfo(req);
        const result = await exchangeRateSyncService.syncIfEmpty(organizationId, {
            ...req.body,
            userId,
            name
        });

        res.json({
            success: true,
            ...result
        });
    } catch (err) {
        console.error('Seed Rates Error:', err);
        res.status(err.statusCode || 500).json({
            error: err.message || 'Failed to seed live exchange rates',
            code: err.code
        });
    }
});

/**
 * POST /api/payroll/currencies/rates/bulk
 * Bulk set exchange rates
 */
router.post('/rates/bulk', requireHRAdmin, async (req, res) => {
    try {
        const { organizationId, userId, name } = getUserInfo(req);
        const { baseCurrency, rates } = req.body;

        if (!baseCurrency || !rates || typeof rates !== 'object') {
            return res.status(400).json({
                error: 'baseCurrency and rates object are required'
            });
        }

        const results = await currencyService.setBulkRates(
            organizationId,
            baseCurrency,
            rates,
            {
                source: 'manual',
                createdBy: userId,
                createdByName: name
            }
        );

        res.status(201).json({
            success: true,
            count: results.length,
            rates: results
        });
    } catch (err) {
        console.error('Bulk Set Rates Error:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to set exchange rates', code: err.code });
    }
});

/**
 * GET /api/payroll/currencies/convert
 * Convert amount between currencies
 */
router.get('/convert', requireAuth, async (req, res) => {
    try {
        const { organizationId } = getUserInfo(req);
        const { amount, from, to, date } = req.query;

        if (!amount || !from || !to) {
            return res.status(400).json({
                error: 'amount, from, and to currencies are required'
            });
        }

        const conversion = await currencyService.convert(
            organizationId,
            parseFloat(amount),
            from,
            to,
            date ? new Date(date) : new Date()
        );

        res.json({
            ...conversion,
            formattedOriginal: currencyService.formatAmount(parseFloat(amount), from),
            formattedConverted: currencyService.formatAmount(conversion.convertedAmount, to)
        });
    } catch (err) {
        console.error('Convert Error:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Failed to convert currency', code: err.code });
    }
});

/**
 * DELETE /api/payroll/currencies/rates/:id
 * Deactivate an exchange rate
 */
router.delete('/rates/:id', requireHRAdmin, async (req, res) => {
    try {
        assertExchangeRatesReady();
        const { organizationId } = getUserInfo(req);

        const existing = await ExchangeRate.findOne({ _id: req.params.id, organizationId });
        if (existing && new Date(existing.effectiveDate).getTime() <= Date.now()) {
            return res.status(409).json({
                error: 'Historical and currently-effective exchange rates are immutable because payroll and reports may reference them. Add a later correction instead.',
                code: 'EXCHANGE_RATE_IMMUTABLE',
            });
        }
        const rate = existing
            ? await ExchangeRate.findOneAndUpdate(
                { _id: existing._id, organizationId },
                { isActive: false },
                { new: true }
            )
            : null;

        if (!rate) {
            return res.status(404).json({ error: 'Rate not found' });
        }

        res.json({ success: true, rate });
    } catch (err) {
        console.error('Delete Rate Error:', err);
        res.status(500).json({ error: 'Failed to deactivate rate' });
    }
});

/**
 * GET /api/payroll/currencies/history
 * Get historical rates for a currency pair
 */
router.get('/history', requireAuth, async (req, res) => {
    try {
        assertExchangeRatesReady();
        const { organizationId } = getUserInfo(req);
        const { baseCurrency, targetCurrency, limit = 30 } = req.query;

        if (!baseCurrency || !targetCurrency) {
            return res.status(400).json({
                error: 'baseCurrency and targetCurrency are required'
            });
        }

        const rates = await ExchangeRate.find({
            organizationId,
            baseCurrency: baseCurrency.toUpperCase(),
            targetCurrency: targetCurrency.toUpperCase()
        })
            .sort({ effectiveDate: -1 })
            .limit(parseInt(limit));

        res.json({
            baseCurrency,
            targetCurrency,
            history: rates
        });
    } catch (err) {
        console.error('Get History Error:', err);
        res.status(500).json({ error: 'Failed to fetch rate history' });
    }
});

module.exports = router;
