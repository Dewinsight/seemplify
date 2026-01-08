const ExchangeRate = require('../models/ExchangeRate');

/**
 * Currency Service
 * Handles currency conversion and exchange rate management
 */
class CurrencyService {
    constructor() {
        // Supported currencies with metadata
        this.supportedCurrencies = [
            { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
            { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
            { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2 },
            { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', decimals: 2 },
            { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', decimals: 2 },
            { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimals: 2 },
            { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2 },
            { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', decimals: 2 },
            { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', decimals: 2 },
            { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', decimals: 0 },
            { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimals: 2 },
            { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimals: 2 },
            { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2 }
        ];
    }

    /**
     * Get all supported currencies
     */
    getSupportedCurrencies() {
        return this.supportedCurrencies;
    }

    /**
     * Get currency info by code
     */
    getCurrencyInfo(code) {
        return this.supportedCurrencies.find(c => c.code === code.toUpperCase());
    }

    /**
     * Format amount with currency symbol
     */
    formatAmount(amount, currencyCode) {
        const currency = this.getCurrencyInfo(currencyCode);
        if (!currency) {
            return `${currencyCode} ${amount.toLocaleString()}`;
        }

        const formatted = amount.toLocaleString(undefined, {
            minimumFractionDigits: currency.decimals,
            maximumFractionDigits: currency.decimals
        });

        return `${currency.symbol}${formatted}`;
    }

    /**
     * Convert amount between currencies
     */
    async convert(organizationId, amount, fromCurrency, toCurrency, date = new Date()) {
        // Same currency
        if (fromCurrency.toUpperCase() === toCurrency.toUpperCase()) {
            return {
                originalAmount: amount,
                originalCurrency: fromCurrency,
                convertedAmount: amount,
                targetCurrency: toCurrency,
                rate: 1,
                direct: true
            };
        }

        return ExchangeRate.convert(organizationId, amount, fromCurrency, toCurrency, date);
    }

    /**
     * Get current exchange rate
     */
    async getRate(organizationId, fromCurrency, toCurrency, date = new Date()) {
        return ExchangeRate.getCurrentRate(organizationId, fromCurrency, toCurrency, date);
    }

    /**
     * Get all active rates for organization
     */
    async getActiveRates(organizationId, baseCurrency = null) {
        return ExchangeRate.getActiveRates(organizationId, baseCurrency);
    }

    /**
     * Set exchange rate
     */
    async setRate(organizationId, baseCurrency, targetCurrency, rate, options = {}) {
        // Deactivate previous rate if exists
        await ExchangeRate.updateMany(
            {
                organizationId,
                baseCurrency: baseCurrency.toUpperCase(),
                targetCurrency: targetCurrency.toUpperCase(),
                isActive: true
            },
            { isActive: false }
        );

        // Create new rate
        const exchangeRate = new ExchangeRate({
            organizationId,
            baseCurrency: baseCurrency.toUpperCase(),
            targetCurrency: targetCurrency.toUpperCase(),
            rate,
            effectiveDate: options.effectiveDate || new Date(),
            expiresAt: options.expiresAt,
            source: options.source || 'manual',
            notes: options.notes,
            createdBy: options.createdBy,
            createdByName: options.createdByName,
            isActive: true
        });

        await exchangeRate.save();
        return exchangeRate;
    }

    /**
     * Bulk set rates (e.g., from API)
     */
    async setBulkRates(organizationId, baseCurrency, rates, options = {}) {
        const results = [];

        for (const [targetCurrency, rate] of Object.entries(rates)) {
            const result = await this.setRate(
                organizationId,
                baseCurrency,
                targetCurrency,
                rate,
                options
            );
            results.push(result);
        }

        return results;
    }

    /**
     * Calculate payroll in multiple currencies
     */
    async convertPayrollAmount(organizationId, amount, employeeCurrency, orgBaseCurrency) {
        // If same currency, no conversion needed
        if (employeeCurrency === orgBaseCurrency) {
            return {
                originalAmount: amount,
                originalCurrency: employeeCurrency,
                convertedAmount: amount,
                baseCurrency: orgBaseCurrency,
                rate: 1
            };
        }

        const conversion = await this.convert(
            organizationId,
            amount,
            employeeCurrency,
            orgBaseCurrency
        );

        return {
            originalAmount: amount,
            originalCurrency: employeeCurrency,
            convertedAmount: conversion.convertedAmount,
            baseCurrency: orgBaseCurrency,
            rate: conversion.rate
        };
    }
}

module.exports = new CurrencyService();
