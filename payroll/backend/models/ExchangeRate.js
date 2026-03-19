const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const DEFAULT_PIVOT_CURRENCIES = ['USD', 'EUR', 'GBP'];

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

function getActiveDateQuery(date) {
    return {
        effectiveDate: { $lte: date },
        isActive: true,
        $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: { $gte: date } }
        ]
    };
}

async function findPreferredRate(model, organizationId, baseCurrency, targetCurrency, date) {
    const query = {
        organizationId,
        baseCurrency: baseCurrency.toUpperCase(),
        targetCurrency: targetCurrency.toUpperCase(),
        ...getActiveDateQuery(date)
    };

    let rate = await model.findOne({
        ...query,
        source: 'manual'
    }).sort({ effectiveDate: -1 });

    if (rate) {
        return rate;
    }

    return model.findOne(query).sort({ effectiveDate: -1 });
}

/**
 * Get current exchange rate
 */
ExchangeRateSchema.statics.getCurrentRate = async function (organizationId, baseCurrency, targetCurrency, date = new Date(), options = {}) {
    const normalizedBase = String(baseCurrency || '').trim().toUpperCase();
    const normalizedTarget = String(targetCurrency || '').trim().toUpperCase();

    // Same currency = rate is 1
    if (normalizedBase === normalizedTarget) {
        return { rate: 1, direct: true };
    }

    // Try direct rate
    let rate = await findPreferredRate(
        this,
        organizationId,
        normalizedBase,
        normalizedTarget,
        date
    );

    if (rate) {
        return { rate: rate.rate, direct: true, source: rate.source, effectiveDate: rate.effectiveDate };
    }

    // Try inverse rate
    rate = await findPreferredRate(
        this,
        organizationId,
        normalizedTarget,
        normalizedBase,
        date
    );

    if (rate) {
        return {
            rate: 1 / rate.rate,
            direct: false,
            inverse: true,
            source: rate.source,
            effectiveDate: rate.effectiveDate
        };
    }

    if (options.allowPivot === false) {
        return null;
    }

    const dynamicPivots = await this.distinct('baseCurrency', {
        organizationId,
        ...getActiveDateQuery(date)
    });

    const pivotCurrencies = Array.from(new Set([
        ...(options.pivotCurrencies || []),
        ...DEFAULT_PIVOT_CURRENCIES,
        ...dynamicPivots
    ]))
        .map((currency) => String(currency || '').trim().toUpperCase())
        .filter((currency) => currency && currency !== normalizedBase && currency !== normalizedTarget);

    for (const pivotCurrency of pivotCurrencies) {
        const baseToPivot = await this.getCurrentRate(
            organizationId,
            normalizedBase,
            pivotCurrency,
            date,
            { allowPivot: false }
        );
        if (!baseToPivot) {
            continue;
        }

        const pivotToTarget = await this.getCurrentRate(
            organizationId,
            pivotCurrency,
            normalizedTarget,
            date,
            { allowPivot: false }
        );
        if (!pivotToTarget) {
            continue;
        }

        const effectiveDates = [
            baseToPivot.effectiveDate,
            pivotToTarget.effectiveDate
        ].filter(Boolean).map((value) => new Date(value).getTime());

        return {
            rate: baseToPivot.rate * pivotToTarget.rate,
            direct: false,
            via: pivotCurrency,
            source: [baseToPivot.source, pivotToTarget.source].filter(Boolean).join('+') || 'derived',
            effectiveDate: effectiveDates.length > 0 ? new Date(Math.min(...effectiveDates)) : undefined
        };
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

    const rates = await this.find(query).sort({ effectiveDate: -1 });

    return rates.sort((a, b) => {
        const baseCompare = String(a.baseCurrency || '').localeCompare(String(b.baseCurrency || ''));
        if (baseCompare !== 0) return baseCompare;

        const targetCompare = String(a.targetCurrency || '').localeCompare(String(b.targetCurrency || ''));
        if (targetCompare !== 0) return targetCompare;

        const sourcePriority = (rate) => rate.source === 'manual' ? 0 : 1;
        const sourceCompare = sourcePriority(a) - sourcePriority(b);
        if (sourceCompare !== 0) return sourceCompare;

        return new Date(b.effectiveDate || 0).getTime() - new Date(a.effectiveDate || 0).getTime();
    });
};

module.exports = mongoose.model('ExchangeRate', ExchangeRateSchema);
