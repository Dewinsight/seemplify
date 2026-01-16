const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * ExchangeRate Model
 * Stores currency exchange rates for multi-currency payroll
 */
const ExchangeRateSchema = new Schema({
    organizationId: {
        type: String,
        required: true,
        index: true
    },

    baseCurrency: {
        type: String,
        required: true,
        uppercase: true,
        maxlength: 3
    },

    targetCurrency: {
        type: String,
        required: true,
        uppercase: true,
        maxlength: 3
    },

    rate: {
        type: Number,
        required: true,
        min: 0
    },

    effectiveDate: {
        type: Date,
        required: true,
        default: Date.now
    },

    expiresAt: {
        type: Date
    },

    source: {
        type: String,
        enum: ['manual', 'api', 'import'],
        default: 'manual'
    },

    isActive: {
        type: Boolean,
        default: true
    },

    notes: String,

    createdBy: String,
    createdByName: String
}, {
    timestamps: true
});

// Compound index for lookups
ExchangeRateSchema.index({ organizationId: 1, baseCurrency: 1, targetCurrency: 1, effectiveDate: -1 });

/**
 * Get current exchange rate
 */
ExchangeRateSchema.statics.getCurrentRate = async function (organizationId, baseCurrency, targetCurrency, date = new Date()) {
    // Same currency = rate is 1
    if (baseCurrency.toUpperCase() === targetCurrency.toUpperCase()) {
        return { rate: 1, direct: true };
    }

    // Try direct rate
    let rate = await this.findOne({
        organizationId,
        baseCurrency: baseCurrency.toUpperCase(),
        targetCurrency: targetCurrency.toUpperCase(),
        effectiveDate: { $lte: date },
        isActive: true,
        $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: { $gte: date } }
        ]
    }).sort({ effectiveDate: -1 });

    if (rate) {
        return { rate: rate.rate, direct: true, source: rate.source, effectiveDate: rate.effectiveDate };
    }

    // Try inverse rate
    rate = await this.findOne({
        organizationId,
        baseCurrency: targetCurrency.toUpperCase(),
        targetCurrency: baseCurrency.toUpperCase(),
        effectiveDate: { $lte: date },
        isActive: true
    }).sort({ effectiveDate: -1 });

    if (rate) {
        return { rate: 1 / rate.rate, direct: false, inverse: true, source: rate.source };
    }

    return null;
};

/**
 * Convert amount between currencies
 */
ExchangeRateSchema.statics.convert = async function (organizationId, amount, fromCurrency, toCurrency, date = new Date()) {
    const rateInfo = await this.getCurrentRate(organizationId, fromCurrency, toCurrency, date);

    if (!rateInfo) {
        throw new Error(`No exchange rate found for ${fromCurrency} to ${toCurrency}`);
    }

    return {
        originalAmount: amount,
        originalCurrency: fromCurrency,
        convertedAmount: amount * rateInfo.rate,
        targetCurrency: toCurrency,
        rate: rateInfo.rate,
        ...rateInfo
    };
};

/**
 * Get all active rates for organization
 */
ExchangeRateSchema.statics.getActiveRates = async function (organizationId, baseCurrency = null) {
    const query = { organizationId, isActive: true };
    if (baseCurrency) {
        query.baseCurrency = baseCurrency.toUpperCase();
    }

    return this.find(query).sort({ baseCurrency: 1, targetCurrency: 1, effectiveDate: -1 });
};

module.exports = mongoose.model('ExchangeRate', ExchangeRateSchema);
